/**
 * Pre-computa stats de git para la landing y las escribe a un JSON
 * que se importa en runtime. Necesario porque Vercel no incluye
 * `.git` en el bundle serverless — sin esto los stats salían vacíos
 * en prod aunque andaban localmente.
 *
 * Corre como `prebuild` y `predev` (ver package.json). El JSON
 * resultante (`src/lib/landing/stats.generated.json`) se commitea
 * al repo como snapshot — cada build lo regenera y el diff queda
 * trazable.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const execAsync = promisify(exec);

// git-hours heuristic. Ver doc en src/lib/landing/stats.ts (el lib
// runtime que consume el JSON que generamos acá).
const MAX_COMMIT_DIFF_MS = 2 * 60 * 60 * 1000;
const FIRST_COMMIT_ADD_MS = 30 * 60 * 1000;

async function commitCount(): Promise<number | null> {
  try {
    const { stdout } = await execAsync("git rev-list --count HEAD");
    const n = Number(stdout.trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

async function activeHours(): Promise<number | null> {
  try {
    const { stdout } = await execAsync("git log --reverse --format=%ct", {
      maxBuffer: 16 * 1024 * 1024,
    });
    const ts = stdout
      .split("\n")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0)
      .map((s) => s * 1000);
    if (ts.length === 0) return null;
    let totalMs = FIRST_COMMIT_ADD_MS;
    for (let i = 1; i < ts.length; i++) {
      const gap = ts[i] - ts[i - 1];
      totalMs += gap < MAX_COMMIT_DIFF_MS ? gap : FIRST_COMMIT_ADD_MS;
    }
    return Math.max(1, Math.round(totalMs / (60 * 60 * 1000)));
  } catch {
    return null;
  }
}

async function activeDays(): Promise<number | null> {
  try {
    const { stdout } = await execAsync("git log --format=%cs", {
      maxBuffer: 16 * 1024 * 1024,
    });
    const days = new Set(
      stdout
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    return days.size > 0 ? days.size : null;
  } catch {
    return null;
  }
}

async function main() {
  const [commits, hours, days] = await Promise.all([
    commitCount(),
    activeHours(),
    activeDays(),
  ]);
  const data = {
    commits,
    activeHours: hours,
    activeDays: days,
    generatedAt: new Date().toISOString(),
  };
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const out = resolve(
    __dirname,
    "../src/lib/landing/stats.generated.json",
  );
  await writeFile(out, JSON.stringify(data, null, 2) + "\n");
  console.log(`[landing-stats] wrote ${out}`);
  console.log(`  commits=${commits} activeHours=${hours} activeDays=${days}`);
}

main().catch((err) => {
  console.error("[landing-stats] generation failed:", err);
  process.exit(1);
});
