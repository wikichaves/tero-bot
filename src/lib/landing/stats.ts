import "server-only";
import { exec } from "node:child_process";
import { promisify } from "node:util";

/**
 * Real-time stats que se renderean en la landing (WIK-154).
 *
 * Mezcla: git para mostrar actividad de desarrollo + values estáticos
 * para info del producto. Diseño minimalista al estilo del case study
 * (wikichaves.com/design/projects/tero) — 4 números cortos con su label.
 *
 * Implementado como helper server-only que se invoca desde el page
 * server component. Las queries a git son baratas (~10ms) y no se
 * cachean — cada deploy las recalcula. Si scaleamos a muchas
 * visitas, podríamos cachear con `revalidate = 3600` en el page.
 */

const execAsync = promisify(exec);

export type LandingStat = {
  /** Big number / value (ej. "287", "Live", "2"). */
  value: string;
  /** Short label key (i18n) — resuelto por el page. */
  labelKey: "commits" | "daysActive" | "languages" | "status";
};

export async function getLandingStats(): Promise<LandingStat[]> {
  const stats: LandingStat[] = [];

  // 1. Commit count desde el git log. `git rev-list --count HEAD`
  //    devuelve el total de commits accesibles desde HEAD.
  try {
    const { stdout } = await execAsync("git rev-list --count HEAD");
    const n = Number(stdout.trim());
    if (Number.isFinite(n) && n > 0) {
      stats.push({ value: String(n), labelKey: "commits" });
    }
  } catch {
    // Si no hay git disponible (improbable pero defensivo), skipear.
  }

  // 2. Days active desde el primer commit. `git log --reverse --format=%ct`
  //    lista los timestamps unix de cada commit en orden cronológico —
  //    el primero (`head -1`) es el commit inicial del repo.
  try {
    const { stdout } = await execAsync(
      "git log --reverse --format=%ct | head -1",
    );
    const firstTs = Number(stdout.trim());
    if (Number.isFinite(firstTs) && firstTs > 0) {
      const days = Math.max(
        1,
        Math.floor((Date.now() / 1000 - firstTs) / 86400),
      );
      stats.push({ value: String(days), labelKey: "daysActive" });
    }
  } catch {
    // skip
  }

  // 3. Idiomas soportados — hardcoded. Si en algún momento se suma un
  //    locale (ej. portugués), bumpear acá + actualizar `src/i18n/locales.ts`.
  stats.push({ value: "2", labelKey: "languages" });

  // 4. Status — hardcoded "Live" porque el repo está deployado y el
  //    bot está respondiendo. Si en algún momento queremos un check
  //    de salud real (ej. fetch al endpoint /api/telegram), podemos
  //    convertirlo en async. Por ahora la simplicidad gana.
  stats.push({ value: "Live", labelKey: "status" });

  return stats;
}
