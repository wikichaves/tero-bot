import "server-only";
import { exec } from "node:child_process";
import { promisify } from "node:util";

/**
 * Real-time stats que se renderean en la landing.
 *
 * Diseño: 4 chips cortos con número grande + label mono uppercase. La
 * misma forma que el case study (wikichaves.com/design/projects/tero).
 *
 * Stats (WIK-165 refresh):
 *   - Commits     → git rev-list --count HEAD
 *   - Active hours → git-hours heuristic (sumar gaps entre commits con
 *                    threshold de 2h por sesión, + 30 min de "pre-commit"
 *                    al primer commit de cada sesión)
 *   - Active days  → días distintos con al menos 1 commit
 *   - Status      → manual ("WIP"), pintado en accent color
 *
 * Implementado como helper server-only invocado desde el page server
 * component. Las queries a git son baratas (~10-30ms) y no se cachean —
 * cada request las recalcula. Si scaleamos, agregamos `revalidate` en
 * el page.
 */

const execAsync = promisify(exec);

export type LandingStat = {
  /** Big number / value (ej. "287", "WIP", "85"). */
  value: string;
  /** Short label key (i18n) — resuelto por el page. */
  labelKey: "commits" | "activeHours" | "activeDays" | "status";
  /** Si true, el value se pinta con accent color (verde tero). Usado
   *  para "WIP" para que cante visualmente como "no terminado". */
  accent?: boolean;
};

/**
 * git-hours heuristic. Lee timestamps unix de todos los commits y los
 * agrupa en sesiones de trabajo: dos commits en menos de
 * `MAX_COMMIT_DIFF_MS` cuentan como misma sesión y sumamos el gap real;
 * si el gap supera el threshold, abrimos sesión nueva y sumamos
 * `FIRST_COMMIT_ADD_MS` (asume que el dev empezó a trabajar X minutos
 * antes del primer commit visible). El mismo offset se agrega al
 * primer commit absoluto.
 *
 * Constantes calibradas a los defaults de git-hours / scc / similares.
 */
async function computeActiveHours(): Promise<number | null> {
  const MAX_COMMIT_DIFF_MS = 2 * 60 * 60 * 1000;
  const FIRST_COMMIT_ADD_MS = 30 * 60 * 1000;
  try {
    const { stdout } = await execAsync(
      "git log --reverse --format=%ct",
      { maxBuffer: 16 * 1024 * 1024 },
    );
    const timestamps = stdout
      .split("\n")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0)
      .map((s) => s * 1000); // → ms
    if (timestamps.length === 0) return null;

    let totalMs = FIRST_COMMIT_ADD_MS;
    for (let i = 1; i < timestamps.length; i++) {
      const gap = timestamps[i] - timestamps[i - 1];
      totalMs += gap < MAX_COMMIT_DIFF_MS ? gap : FIRST_COMMIT_ADD_MS;
    }
    return Math.max(1, Math.round(totalMs / (60 * 60 * 1000)));
  } catch {
    return null;
  }
}

async function computeActiveDays(): Promise<number | null> {
  try {
    // %cs = committer date short (YYYY-MM-DD). Dedup en JS.
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

async function computeCommitCount(): Promise<number | null> {
  try {
    const { stdout } = await execAsync("git rev-list --count HEAD");
    const n = Number(stdout.trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export async function getLandingStats(): Promise<LandingStat[]> {
  const [commits, activeHours, activeDays] = await Promise.all([
    computeCommitCount(),
    computeActiveHours(),
    computeActiveDays(),
  ]);

  const stats: LandingStat[] = [];
  if (commits != null) stats.push({ value: String(commits), labelKey: "commits" });
  if (activeHours != null)
    stats.push({ value: String(activeHours), labelKey: "activeHours" });
  if (activeDays != null)
    stats.push({ value: String(activeDays), labelKey: "activeDays" });

  // Status — manual. Cambiar a "Live" cuando el proyecto deje de ser WIP.
  // Pintado en accent para que destaque de los números.
  stats.push({ value: "WIP", labelKey: "status", accent: true });

  return stats;
}
