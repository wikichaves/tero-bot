import "server-only";

/**
 * Registry de repos manejados por el flujo autónomo de Telegram (WIK-266).
 *
 * Un mismo workspace de Linear (team WIK) agrupa el trabajo de varios repos
 * vía *projects*. Este registry mapea, para cada repo:
 *   - el Linear `project` donde viven sus tickets,
 *   - el `owner`/`repo` de GitHub donde se abre el PR,
 *   - `aliases` que el user puede tipear en Telegram (`/claude wiki ...`).
 *
 * `tero-bot` es el default — si un comando no lleva prefijo de alias, el
 * ticket se crea en el project "Tero Bot".
 *
 * El worker centralizado (Fase 2) deriva el repo a clonar a partir del
 * `project` del ticket usando `repoForProject()`.
 */

export type RepoConfig = {
  /** Clave canónica (= nombre del repo de GitHub). */
  key: string;
  /** Nombre del Linear project donde se crean los tickets de este repo. */
  project: string;
  /** Owner de GitHub. */
  owner: string;
  /** Nombre del repo de GitHub. */
  repo: string;
  /** Label legible para mostrar en las respuestas de Telegram. */
  label: string;
  /** Aliases que el user puede tipear como prefijo (`/claude <alias> ...`). */
  aliases: string[];
};

export const REPOS: RepoConfig[] = [
  {
    key: "tero-bot",
    project: "Tero Bot",
    owner: "wikichaves",
    repo: "tero-bot",
    label: "tero-bot",
    // Aliases inequívocos — evitamos palabras comunes ("bot", "web") que
    // podrían arrancar un prompt normal y misrutear el ticket. Igual es el
    // default, así que matchear acá no cambia nada.
    aliases: ["tero", "tero-bot", "terobot"],
  },
  {
    key: "wikichaves.com",
    project: "wikichaves.com",
    owner: "wikichaves",
    repo: "wikichaves.com",
    label: "wikichaves.com",
    // Sin "web"/"com" — demasiado comunes como primera palabra de un prompt.
    aliases: ["wiki", "wikichaves", "wikichaves.com", "portfolio"],
  },
  {
    key: "casabosquemontoya",
    project: "Casa Bosque Montoya",
    owner: "wikichaves",
    repo: "casabosquemontoya",
    label: "casabosquemontoya",
    aliases: ["casa", "cbm", "montoya", "bosque", "casabosquemontoya"],
  },
];

/** Repo por defecto cuando el comando no lleva prefijo de alias. */
export const DEFAULT_REPO: RepoConfig =
  REPOS.find((r) => r.key === "tero-bot") ?? REPOS[0];

/**
 * Resuelve un token de alias (case-insensitive) a un repo. Devuelve null
 * si el token no matchea ningún alias conocido.
 */
export function resolveRepoAlias(token: string): RepoConfig | null {
  const t = token.trim().toLowerCase();
  if (!t) return null;
  return (
    REPOS.find((r) => r.aliases.some((a) => a.toLowerCase() === t)) ?? null
  );
}

/**
 * Mapea un Linear project name al repo correspondiente (case-insensitive).
 * Lo usa el worker centralizado para saber qué repo clonar a partir del
 * ticket. Devuelve null si el project no está en el registry.
 */
export function repoForProject(projectName: string): RepoConfig | null {
  const p = projectName.trim().toLowerCase();
  return REPOS.find((r) => r.project.toLowerCase() === p) ?? null;
}

/**
 * Separa un prefijo de alias opcional del resto del texto.
 *
 *   "wiki arreglar el footer"  → { repo: <wikichaves>, rest: "arreglar el footer" }
 *   "arreglar el footer"       → { repo: <tero-bot default>, rest: "arreglar el footer" }
 *
 * Solo trata la primera palabra como alias si (a) matchea un alias conocido
 * y (b) queda texto después — así un prompt que arranca con una palabra que
 * casualmente es un alias pero es la única palabra no se malinterpreta.
 */
export function splitRepoAlias(text: string): {
  repo: RepoConfig;
  rest: string;
} {
  const trimmed = text.trim();
  const match = trimmed.match(/^(\S+)\s+([\s\S]+)$/);
  if (match) {
    const candidate = resolveRepoAlias(match[1]);
    if (candidate) {
      return { repo: candidate, rest: match[2].trim() };
    }
  }
  return { repo: DEFAULT_REPO, rest: trimmed };
}
