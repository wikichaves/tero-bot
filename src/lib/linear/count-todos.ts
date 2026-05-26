import "server-only";

/**
 * Linear query helper para contar tickets en Todo con label
 * `claude:autonomous` (WIK-186 follow-up — `/work all`).
 *
 * Reusa el pattern de `create-issue.ts`: raw GraphQL, sin SDK.
 *
 * Filter:
 *   - state.name = "Todo"
 *   - labels.some(name = "claude:autonomous")
 *
 * Devolvemos también los `identifier`s para que el handler de Telegram
 * pueda mostrarlos en la confirmación inicial ("voy a procesar WIK-X,
 * WIK-Y, WIK-Z en este orden").
 */

const LINEAR_GRAPHQL_ENDPOINT = "https://api.linear.app/graphql";

const DEFAULT_TEAM_KEY = process.env.LINEAR_TEAM_KEY ?? "WIK";

export type ClaudeTodoSummary = {
  identifier: string;
  title: string;
  priority: number;
};

/**
 * Lista todos los Todos con label `claude:autonomous`, ordenados por
 * priority (urgent primero) y createdAt asc. Mismo orden que usa el
 * worker para "pick next" — predecible para el user.
 *
 * Lanza si falta `LINEAR_API_TOKEN` o la API devuelve error.
 */
export async function listClaudeTodos(): Promise<ClaudeTodoSummary[]> {
  const apiToken = process.env.LINEAR_API_TOKEN;
  if (!apiToken) {
    throw new Error(
      "LINEAR_API_TOKEN no está configurado. Generar en linear.app/wikichaves/settings/api.",
    );
  }

  // Linear's filter syntax expects nested filters for relations. La
  // combinación de state name + labels name se hace con AND implícito
  // (multiple keys del filter object).
  const query = `
    query ClaudeTodos($teamKey: String!) {
      issues(
        first: 50,
        filter: {
          team: { key: { eq: $teamKey } },
          state: { name: { eq: "Todo" } },
          labels: { name: { eq: "claude:autonomous" } }
        }
        orderBy: createdAt
      ) {
        nodes {
          identifier
          title
          priority
        }
      }
    }
  `;

  const res = await fetch(LINEAR_GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: apiToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      variables: { teamKey: DEFAULT_TEAM_KEY },
    }),
  });
  if (!res.ok) {
    throw new Error(`Linear count HTTP ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as {
    data?: {
      issues?: { nodes?: ClaudeTodoSummary[] };
    };
    errors?: Array<{ message: string }>;
  };
  if (json.errors?.length) {
    throw new Error(
      `Linear count errors: ${json.errors.map((e) => e.message).join(", ")}`,
    );
  }
  const nodes = json.data?.issues?.nodes ?? [];
  // Ordenamos client-side: priority asc (urgent=1 primero), luego
  // identifier asc para estabilidad. Linear's `orderBy` no acepta
  // múltiples campos en un solo arg.
  return [...nodes].sort((a, b) => {
    // priority=0 (None) lo mandamos al final (lo tratamos como max).
    const pa = a.priority === 0 ? 99 : a.priority;
    const pb = b.priority === 0 ? 99 : b.priority;
    if (pa !== pb) return pa - pb;
    return a.identifier.localeCompare(b.identifier);
  });
}
