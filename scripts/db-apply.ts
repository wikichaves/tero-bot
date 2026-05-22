/**
 * Apply SQL to the Supabase Postgres directly via the Session Pooler.
 *
 * Usage:
 *   pnpm db:apply <path-to-sql-file>      → apply a .sql file
 *   pnpm db:apply --check                 → connection test only
 *   pnpm db:apply --section <heading>     → apply only the schema.sql section
 *                                            matching the heading text
 *
 * The `--section` mode is the workflow for incremental migrations:
 * `supabase/schema.sql` has commented section headers like
 * `-- ─── WhatsApp alarm reminders (WIK-124) ───`. Pass `--section WIK-124`
 * and only that block runs — useful for re-applying a single migration
 * without re-running everything.
 *
 * Connects via DATABASE_URL (Session Pooler) which allows DDL.
 * Idempotent: every statement we add to schema.sql uses
 * `add column if not exists` / `create table if not exists` so reruns
 * are safe.
 */

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { config as loadDotenv } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(__dirname, "../.env.local") });

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client } = require("pg") as typeof import("pg");

const args = process.argv.slice(2);
const flagCheck = args.includes("--check");
const sectionIdx = args.indexOf("--section");
const sectionArg = sectionIdx > -1 ? args[sectionIdx + 1] : null;
const fileArg = args.find((a) => !a.startsWith("--") && a !== sectionArg);

function extractSection(sql: string, marker: string): string | null {
  // Section starts at a line containing the marker (case-insensitive) after
  // `-- ─── ` (the dashes are how we format section headers in schema.sql).
  // Ends at the next `-- ─── ` line OR end of file.
  const lines = sql.split("\n");
  const startRx = new RegExp(
    `^\\s*--\\s*[─=-]{2,}.*${marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
    "i",
  );
  const nextSectionRx = /^\s*--\s*[─=-]{2,}/;

  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (startRx.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (nextSectionRx.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set in .env.local");
    process.exit(1);
  }
  const masked = url.replace(/:([^@:]+)@/, ":****@");
  console.log(`Target: ${masked}`);

  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    if (flagCheck) {
      const { rows } = await client.query(
        "SELECT current_database() as db, current_user as usr",
      );
      console.log(`✓ Connected (db=${rows[0].db}, user=${rows[0].usr})`);
      return;
    }

    let sql: string;
    let sourceLabel: string;
    if (sectionArg) {
      const schemaPath = resolve(__dirname, "../supabase/schema.sql");
      const all = readFileSync(schemaPath, "utf8");
      const section = extractSection(all, sectionArg);
      if (!section) {
        console.error(
          `Section matching "${sectionArg}" not found in schema.sql`,
        );
        process.exit(1);
      }
      sql = section;
      sourceLabel = `schema.sql · section "${sectionArg}"`;
    } else if (fileArg) {
      sql = readFileSync(resolve(process.cwd(), fileArg), "utf8");
      sourceLabel = fileArg;
    } else {
      console.error(
        "Usage:\n" +
          "  pnpm db:apply <file.sql>\n" +
          "  pnpm db:apply --section <heading>\n" +
          "  pnpm db:apply --check",
      );
      process.exit(1);
    }

    console.log(
      `Applying SQL from ${sourceLabel} (${sql.length} bytes, ${sql.split("\n").length} lines)\n`,
    );
    // Echo preview of first 5 non-empty non-comment lines so we know
    // what's about to run.
    const preview = sql
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("--"))
      .slice(0, 5);
    console.log("Preview:");
    for (const p of preview) console.log(`  ${p}`);
    console.log("");

    // pg.Client.query accepts multiple statements separated by `;` as one
    // string when no parameter substitution is involved. Wrap in a single
    // transaction so partial failures roll back.
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("COMMIT");
      console.log("✓ Applied (transaction committed)");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("\n❌ Failed:", (err as Error).message);
  process.exit(1);
});
