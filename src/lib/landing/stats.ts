import "server-only";
import generated from "./stats.generated.json";

/**
 * Stats que se renderean en la landing.
 *
 * Diseño: 4 chips cortos con número grande + label mono uppercase.
 * Misma forma que el case study en wikichaves.com/design/projects/tero.
 *
 * Stats:
 *   - Commits      → git rev-list --count HEAD (build time)
 *   - Active hours → git-hours heuristic — sesiones de commits con
 *                    gap máx 2h, + 30 min "pre-commit" por sesión.
 *   - Active days  → días distintos con al menos 1 commit
 *   - Status       → manual ("WIP"), pintado en accent color
 *
 * Implementación: las 3 stats de git se calculan en build time vía
 * `scripts/generate-landing-stats.ts` (corre como prebuild/predev) y
 * se persisten en `stats.generated.json`. Razón: Vercel no incluye
 * `.git` en el bundle serverless, así que las queries en runtime
 * salían vacías y la landing solo mostraba "WIP". El JSON se commitea
 * al repo como snapshot y cada build lo regenera.
 *
 * Si querés forzar refresh local: `npx tsx scripts/generate-landing-stats.ts`.
 */

export type LandingStat = {
  /** Big number / value (ej. "287", "WIP", "85"). */
  value: string;
  /** Short label key (i18n) — resuelto por el page. */
  labelKey: "commits" | "activeHours" | "activeDays" | "status";
  /** Si true, el value se pinta con accent color (verde tero). */
  accent?: boolean;
};

export async function getLandingStats(): Promise<LandingStat[]> {
  const stats: LandingStat[] = [];

  if (typeof generated.commits === "number") {
    stats.push({ value: String(generated.commits), labelKey: "commits" });
  }
  if (typeof generated.activeHours === "number") {
    stats.push({ value: String(generated.activeHours), labelKey: "activeHours" });
  }
  if (typeof generated.activeDays === "number") {
    stats.push({ value: String(generated.activeDays), labelKey: "activeDays" });
  }

  // Status manual. Cambiar a "Live" cuando el proyecto deje de ser WIP.
  stats.push({ value: "WIP", labelKey: "status", accent: true });

  return stats;
}
