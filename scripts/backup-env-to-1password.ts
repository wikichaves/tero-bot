/**
 * Backup local + production env vars to 1Password as Secure Notes.
 *
 * Idempotent: re-running updates the existing items instead of creating dupes.
 * Title fields are stable, looked up via `op item get`.
 *
 * Requires:
 *   - `op` CLI installed + signed in:
 *       brew install --cask 1password-cli
 *       op signin
 *   - For --include-vercel: `vercel` CLI linked to this project
 *       (.vercel/project.json must exist; run `npx vercel link` once)
 *
 * Usage:
 *   tsx scripts/backup-env-to-1password.ts                    # .env.local only
 *   tsx scripts/backup-env-to-1password.ts --include-vercel   # + Vercel prod
 *   tsx scripts/backup-env-to-1password.ts --vault="Work"     # custom vault
 *   tsx scripts/backup-env-to-1password.ts --dry-run          # preview only
 */

import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

const USAGE = `Usage: tsx scripts/backup-env-to-1password.ts [options]

Options:
  --include-vercel   Also pull Vercel production env and back it up
  --vault=NAME       1Password vault (default: "Private")
  --dry-run          Show what would happen without writing to 1Password
  --help, -h         Show this help
`;

type Args = {
  vault: string;
  includeVercel: boolean;
  dryRun: boolean;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = { vault: "Private", includeVercel: false, dryRun: false };
  for (const a of argv) {
    if (a === "--include-vercel") args.includeVercel = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a.startsWith("--vault=")) args.vault = a.slice("--vault=".length);
    else if (a === "--help" || a === "-h") {
      console.log(USAGE);
      process.exit(0);
    } else {
      console.error(`Unknown arg: ${a}\n${USAGE}`);
      process.exit(1);
    }
  }
  return args;
}

function run(
  cmd: string,
  cmdArgs: string[],
): { code: number; stdout: string; stderr: string; error?: NodeJS.ErrnoException } {
  const r: SpawnSyncReturns<string> = spawnSync(cmd, cmdArgs, { encoding: "utf8" });
  return {
    code: r.status ?? -1,
    stdout: r.stdout?.trim() ?? "",
    stderr: r.stderr?.trim() ?? "",
    error: r.error as NodeJS.ErrnoException | undefined,
  };
}

function requireOpReady() {
  const r = run("op", ["whoami"]);
  if (r.error?.code === "ENOENT") {
    console.error(
      "[backup-env] `op` CLI not found. Install with:\n  brew install --cask 1password-cli",
    );
    process.exit(1);
  }
  if (r.code !== 0) {
    console.error(
      "[backup-env] not signed in to 1Password. Run:\n  op signin",
    );
    if (r.stderr) console.error(r.stderr);
    process.exit(1);
  }
}

function itemExists(title: string, vault: string): boolean {
  const r = run("op", ["item", "get", title, `--vault=${vault}`]);
  return r.code === 0;
}

function upsertSecureNote(opts: {
  title: string;
  vault: string;
  content: string;
  dryRun: boolean;
}): void {
  const exists = itemExists(opts.title, opts.vault);
  const verb = exists ? "update" : "create";
  if (opts.dryRun) {
    console.log(
      `[dry-run] would ${verb} secure note "${opts.title}" in vault "${opts.vault}" (${opts.content.length} bytes)`,
    );
    return;
  }
  const args = exists
    ? ["item", "edit", opts.title, `--vault=${opts.vault}`, `notesPlain=${opts.content}`]
    : [
        "item",
        "create",
        "--category=Secure Note",
        `--title=${opts.title}`,
        `--vault=${opts.vault}`,
        `notesPlain=${opts.content}`,
      ];
  const r = run("op", args);
  if (r.code !== 0) {
    console.error(`[backup-env] op ${verb} failed for "${opts.title}":`);
    console.error(r.stderr || r.stdout);
    process.exit(1);
  }
  console.log(`✓ ${exists ? "updated" : "created"}  ${opts.title}`);
}

function backupLocal(args: Args) {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) {
    console.error(`[backup-env] .env.local not found at ${path}`);
    process.exit(1);
  }
  upsertSecureNote({
    title: "tero-bot — .env.local (dev)",
    vault: args.vault,
    content: readFileSync(path, "utf8"),
    dryRun: args.dryRun,
  });
}

function backupVercelProd(args: Args) {
  if (!existsSync(resolve(process.cwd(), ".vercel/project.json"))) {
    console.error(
      "[backup-env] .vercel/project.json missing. Link the project first:\n  npx vercel link",
    );
    process.exit(1);
  }
  const tmpPath = resolve(process.cwd(), ".env.production.local.backup-tmp");
  const pull = run("npx", [
    "vercel",
    "env",
    "pull",
    "--environment=production",
    "--yes",
    tmpPath,
  ]);
  if (pull.code !== 0) {
    console.error("[backup-env] `vercel env pull` failed:");
    console.error(pull.stderr || pull.stdout);
    if (existsSync(tmpPath)) unlinkSync(tmpPath);
    process.exit(1);
  }
  try {
    upsertSecureNote({
      title: "tero-bot — Vercel production env",
      vault: args.vault,
      content: readFileSync(tmpPath, "utf8"),
      dryRun: args.dryRun,
    });
  } finally {
    if (existsSync(tmpPath)) unlinkSync(tmpPath);
  }
}

function main() {
  const args = parseArgs();
  if (args.dryRun) console.log("[dry-run] no writes to 1Password will happen\n");
  requireOpReady();
  backupLocal(args);
  if (args.includeVercel) backupVercelProd(args);
  console.log("\nDone.");
}

main();
