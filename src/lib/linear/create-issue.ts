import "server-only";

/**
 * Linear GraphQL client minimalista (WIK-97).
 *
 * Solo expone `createLinearIssue` — todo lo demás (gestión de
 * estados, labels, etc.) se hace por la app de Linear desde el celular.
 *
 * No usamos `@linear/sdk` para evitar agregar deps — la única operación
 * que necesitamos es un INSERT. Raw fetch a la GraphQL endpoint y listo.
 *
 * Auth: `LINEAR_API_TOKEN` env var. Genera uno en
 *   https://linear.app/wikichaves/settings/api → Personal API keys
 * con permisos de escritura sobre el team WIK. NO uses el OAuth flow
 * para esto — es un bot de un solo usuario operando bajo su propia
 * identidad.
 */

const LINEAR_GRAPHQL_ENDPOINT = "https://api.linear.app/graphql";

/** Defaults para nuestro setup. Si el repo se fork, override via env. */
const DEFAULT_TEAM_KEY = process.env.LINEAR_TEAM_KEY ?? "WIK";
const DEFAULT_PROJECT_NAME =
  process.env.LINEAR_DEFAULT_PROJECT_NAME ?? "Tero Bot";

export type LinearIssuePriority = 0 | 1 | 2 | 3 | 4;
// 0 = none, 1 = urgent, 2 = high, 3 = medium, 4 = low. Mismo mapping
// que Linear usa internamente.

type CreateIssueArgs = {
  title: string;
  description?: string;
  /** Override del default team (WIK). Usa el key del team, ej "WIK". */
  teamKey?: string;
  /** Override del project. Si no se pasa usa "Tero Bot". null → sin proj. */
  projectName?: string | null;
  /** 1-4 priority. Default 0 (none). */
  priority?: LinearIssuePriority;
  /** Labels (names) a agregar al issue. Linear crea las que no existan. */
  labels?: string[];
};

type LinearIssueResult = {
  id: string;
  identifier: string;
  url: string;
  title: string;
};

/**
 * Lookup del UUID interno de team / project / label. Linear GraphQL
 * requiere UUIDs, no nombres. Hacemos un round-trip antes del create.
 */
async function fetchEntityIds(
  apiToken: string,
  teamKey: string,
  projectName: string | null,
  labelNames: string[],
): Promise<{
  teamId: string;
  projectId: string | null;
  labelIds: string[];
}> {
  const query = `
    query Lookup($teamKey: String!) {
      teams(filter: { key: { eq: $teamKey } }, first: 1) {
        nodes { id labels(first: 100) { nodes { id name } } }
      }
      projects(first: 100) { nodes { id name } }
    }
  `;
  const res = await fetch(LINEAR_GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: apiToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables: { teamKey } }),
  });
  if (!res.ok) {
    throw new Error(`Linear lookup HTTP ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as {
    data?: {
      teams?: {
        nodes?: Array<{
          id: string;
          labels?: { nodes?: Array<{ id: string; name: string }> };
        }>;
      };
      projects?: { nodes?: Array<{ id: string; name: string }> };
    };
    errors?: Array<{ message: string }>;
  };
  if (json.errors?.length) {
    throw new Error(
      `Linear lookup error: ${json.errors.map((e) => e.message).join(", ")}`,
    );
  }
  const team = json.data?.teams?.nodes?.[0];
  if (!team) {
    throw new Error(`Linear team con key "${teamKey}" no encontrado`);
  }
  let projectId: string | null = null;
  if (projectName) {
    const proj = json.data?.projects?.nodes?.find(
      (p) => p.name.toLowerCase() === projectName.toLowerCase(),
    );
    projectId = proj?.id ?? null;
    // Si el proyecto no existe lo dejamos null en vez de fallar — el
    // issue se crea sin project assignment y el user lo agrupa después.
  }
  // Match labels case-insensitive contra los del team. Las que no
  // existen las ignoramos silenciosamente — Linear no permite crear
  // labels via API sin team admin perms, mejor no fallar.
  const teamLabels = team.labels?.nodes ?? [];
  const labelIds = labelNames
    .map((name) =>
      teamLabels.find((l) => l.name.toLowerCase() === name.toLowerCase())?.id,
    )
    .filter((id): id is string => !!id);
  return { teamId: team.id, projectId, labelIds };
}

/**
 * Crea un issue en Linear. Devuelve la URL para mostrarla en la
 * respuesta de WhatsApp.
 *
 * Lanza si:
 *  - falta `LINEAR_API_TOKEN`
 *  - el team key no existe
 *  - la API responde error
 *
 * El caller (typically un handler de WhatsApp) se encarga de envolver
 * en try/catch y devolver un mensaje de error legible.
 */
export async function createLinearIssue(
  args: CreateIssueArgs,
): Promise<LinearIssueResult> {
  const apiToken = process.env.LINEAR_API_TOKEN;
  if (!apiToken) {
    throw new Error(
      "LINEAR_API_TOKEN no está configurado. Generar en linear.app/wikichaves/settings/api.",
    );
  }
  const teamKey = args.teamKey ?? DEFAULT_TEAM_KEY;
  const projectName =
    args.projectName === undefined ? DEFAULT_PROJECT_NAME : args.projectName;
  const labels = args.labels ?? [];

  const { teamId, projectId, labelIds } = await fetchEntityIds(
    apiToken,
    teamKey,
    projectName,
    labels,
  );

  const mutation = `
    mutation Create($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { id identifier url title }
      }
    }
  `;
  const input: Record<string, unknown> = {
    teamId,
    title: args.title,
  };
  if (args.description) input.description = args.description;
  if (args.priority != null) input.priority = args.priority;
  if (projectId) input.projectId = projectId;
  if (labelIds.length > 0) input.labelIds = labelIds;

  const res = await fetch(LINEAR_GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: apiToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: mutation, variables: { input } }),
  });
  if (!res.ok) {
    throw new Error(`Linear create HTTP ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as {
    data?: {
      issueCreate?: { success: boolean; issue?: LinearIssueResult };
    };
    errors?: Array<{ message: string }>;
  };
  if (json.errors?.length) {
    throw new Error(
      `Linear create error: ${json.errors.map((e) => e.message).join(", ")}`,
    );
  }
  if (!json.data?.issueCreate?.success || !json.data.issueCreate.issue) {
    throw new Error("Linear create devolvió success=false sin issue");
  }
  return json.data.issueCreate.issue;
}
