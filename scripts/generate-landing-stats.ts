/**
 * Pre-computa stats del repo para la landing y las escribe a un JSON
 * que se importa en runtime.
 *
 * Por qué: Vercel hace **shallow clone** en el build (solo los últimos
 * commits) y además no incluye `.git` en el bundle serverless. Así
 * que ni runtime ni build-time git local sirven — el primer enfoque
 * mostraba 10/2/1 en vez de los números reales.
 *
 * Estrategia actual:
 *   1. Intentar GitHub API (commits del repo público). Es la fuente
 *      autoritativa y funciona desde Vercel build sin permisos.
 *   2. Fallback a `git` local — útil para dev offline o si la API
 *      está caída.
 *
 * Corre como `prebuild` y `predev` (ver package.json). El JSON
 * resultante (`src/lib/landing/stats.generated.json`) se commitea
 * al repo como snapshot — cada build lo regenera y el diff queda
 * trazable.
 *
 * Para forzar refresh local: `npm run stats:landing`.
 * Para pasar un token (rate limit más alto): `GITHUB_TOKEN=... npm run stats:landing`.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const execAsync = promisify(exec);

// Repo owner/name — hardcoded porque queremos las stats del repo
// canónico, no del fork local del que builds desde Vercel (que es
// el mismo, pero ser explícito evita ambigüedad).
const GH_OWNER = "wikichaves";
const GH_REPO = "tero-bot";

// git-hours heuristic (igual que cuando lo computábamos localmente).
const MAX_COMMIT_DIFF_MS = 2 * 60 * 60 * 1000;
const FIRST_COMMIT_ADD_MS = 30 * 60 * 1000;

type Stats = {
  commits: number;
  activeHours: number;
  activeDays: number;
};

/**
 * Fetcha todos los commits del repo via GitHub API paginated. Devuelve
 * los timestamps en ms (sorted ASC). Si la API falla, devuelve null.
 */
async function fetchCommitsFromGitHub(): Promise<number[] | null> {
  const token = process.env.GITHUB_TOKEN || process.env.VERCEL_GIT_TOKEN;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "tero-bot-landing-stats",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const all: number[] = [];
  let page = 1;
  const perPage = 100;
  // Defensa contra runaway loops si el repo crece mucho — al ritmo
  // actual (~300 commits) 10 páginas es overkill, dejo holgura.
  const maxPages = 50;

  while (page <= maxPages) {
    const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/commits?per_page=${perPage}&page=${page}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      console.warn(
        `[landing-stats] GitHub API page ${page} returned ${res.status}: ${(await res.text()).slice(0, 200)}`,
      );
      return null;
    }
    const batch = (await res.json()) as Array<{
      commit: { author: { date: string } | null; committer: { date: string } | null };
    }>;
    if (batch.length === 0) break;
    for (const c of batch) {
      const iso = c.commit?.committer?.date ?? c.commit?.author?.date;
      if (iso) {
        const ts = new Date(iso).getTime();
        if (Number.isFinite(ts)) all.push(ts);
      }
    }
    if (batch.length < perPage) break; // última página
    page++;
  }
  if (all.length === 0) return null;
  all.sort((a, b) => a - b);
  return all;
}

/**
 * Fallback: timestamps de git local. Devuelve null si git no está
 * disponible o si `.git` está shallow / vacío.
 */
async function fetchCommitsFromLocalGit(): Promise<number[] | null> {
  try {
    const { stdout } = await execAsync("git log --reverse --format=%ct", {
      maxBuffer: 16 * 1024 * 1024,
    });
    const ts = stdout
      .split("\n")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0)
      .map((s) => s * 1000);
    return ts.length > 0 ? ts : null;
  } catch {
    return null;
  }
}

function computeStats(timestamps: number[]): Stats {
  const sorted = timestamps.slice().sort((a, b) => a - b);
  // Active hours via git-hours heuristic.
  let totalMs = FIRST_COMMIT_ADD_MS;
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1];
    totalMs += gap < MAX_COMMIT_DIFF_MS ? gap : FIRST_COMMIT_ADD_MS;
  }
  const activeHours = Math.max(1, Math.round(totalMs / (60 * 60 * 1000)));
  // Active days: distinct YYYY-MM-DD strings.
  const days = new Set(
    sorted.map((ms) => new Date(ms).toISOString().slice(0, 10)),
  );
  return {
    commits: sorted.length,
    activeHours,
    activeDays: days.size,
  };
}

async function main() {
  console.log("[landing-stats] fetching from GitHub API…");
  let timestamps = await fetchCommitsFromGitHub();
  let source = "github";
  if (!timestamps) {
    console.log("[landing-stats] GitHub API unavailable, falling back to local git");
    timestamps = await fetchCommitsFromLocalGit();
    source = "local-git";
  }
  if (!timestamps || timestamps.length === 0) {
    console.error("[landing-stats] no commits available from any source");
    process.exit(1);
  }
  const stats = computeStats(timestamps);
  const data = {
    ...stats,
    source,
    generatedAt: new Date().toISOString(),
  };
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const out = resolve(
    __dirname,
    "../src/lib/landing/stats.generated.json",
  );
  await writeFile(out, JSON.stringify(data, null, 2) + "\n");
  console.log(
    `[landing-stats] wrote ${out} (source=${source})\n  commits=${stats.commits} activeHours=${stats.activeHours} activeDays=${stats.activeDays}`,
  );
}

main().catch((err) => {
  console.error("[landing-stats] generation failed:", err);
  process.exit(1);
});
