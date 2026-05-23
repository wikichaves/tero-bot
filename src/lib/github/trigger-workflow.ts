import "server-only";

/**
 * Trigger del workflow autónomo de Claude vía GitHub REST API (WIK-139).
 *
 * Endpoint: POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches
 * Doc: https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event
 *
 * Auth: Personal Access Token con scope `workflow` (o `repo` para
 * tokens classic). Setear en env como GITHUB_PAT.
 *
 * Caveat: el endpoint de dispatch retorna 204 sin body — no devuelve
 * el run_id ni la URL del run. Para construir un link al run hacemos
 * un segundo query (list workflow runs) ordered desc y tomamos el
 * primero. Hay race conditions menores pero el typical-case anda bien.
 */

const GITHUB_API = "https://api.github.com";

// Hardcoded — para este proyecto solo. Si en algún momento abrimos a
// múltiples repos, esto pasa a env. Por ahora sería over-engineering.
const REPO_OWNER = "wikichaves";
const REPO_NAME = "tero-bot";
const WORKFLOW_FILE = "claude-worker.yml";

export type TriggerResult = {
  /** URL a la página del workflow (todos sus runs). Garantizado. */
  workflowUrl: string;
  /** URL al run específico que acabamos de disparar. Best-effort —
   *  puede ser null si la 2da query falla. */
  runUrl: string | null;
};

function getToken(): string {
  const token = process.env.GITHUB_PAT;
  if (!token) {
    throw new Error(
      "GITHUB_PAT no está configurado. Generá uno con scope `workflow` " +
        "en github.com/settings/tokens y seteá en Vercel env vars.",
    );
  }
  return token;
}

async function gh<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; data: T | null }> {
  const token = getToken();
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok && res.status !== 204) {
    const body = await res.text();
    throw new Error(`GitHub API ${res.status} on ${path}: ${body}`);
  }
  // 204 No Content (workflow_dispatch) → no body.
  if (res.status === 204) return { status: 204, data: null };
  const data = (await res.json()) as T;
  return { status: res.status, data };
}

/**
 * Dispara el workflow claude-worker.yml. Si `forcedTicketId` viene, lo
 * pasa como input al workflow para que procese ese ticket específico
 * (en vez del top de la queue por label).
 *
 * Retorna URLs útiles para reportar al usuario en Telegram.
 */
export async function triggerClaudeWorker(
  forcedTicketId?: string,
): Promise<TriggerResult> {
  const workflowUrl = `https://github.com/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE}`;

  // 1. Dispatch.
  const dispatchBody: {
    ref: string;
    inputs?: Record<string, string>;
  } = { ref: "main" };
  if (forcedTicketId) {
    dispatchBody.inputs = { ticket_id: forcedTicketId };
  }
  await gh(
    `/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dispatchBody),
    },
  );

  // 2. Query the latest run para obtener su URL. GitHub no la
  //    retorna sincrónicamente — tarda 1-2s en aparecer en la lista.
  //    Le damos un par de intentos con backoff corto.
  let runUrl: string | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const { data } = await gh<{
        workflow_runs?: Array<{ id: number; html_url: string; status: string }>;
      }>(
        `/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=1&event=workflow_dispatch`,
      );
      const latest = data?.workflow_runs?.[0];
      if (latest && (latest.status === "queued" || latest.status === "in_progress")) {
        runUrl = latest.html_url;
        break;
      }
    } catch {
      // Silently retry; el dispatch ya se ejecutó, el query es bonus.
    }
  }

  return { workflowUrl, runUrl };
}

export type MergeResult = {
  prNumber: number;
  prTitle: string;
  prUrl: string;
  mergeSha: string;
};

/**
 * Mergea el PR indicado vía GitHub REST API (WIK-139).
 *
 * - Si `prNumber` viene, ese específico
 * - Si no, busca el PR open más reciente cuyo head branch empieza
 *   con `claude/` (= creado por el worker autónomo) y lo mergea.
 *
 * Default method: `squash` — historia limpia en main, un commit por
 * PR. Override via segundo arg si querés otro.
 */
export async function mergePR(
  prNumber?: number,
  method: "merge" | "squash" | "rebase" = "squash",
): Promise<MergeResult> {
  // 1. Resolver PR num si no vino.
  let resolved = prNumber;
  if (!resolved) {
    const { data } = await gh<
      Array<{ number: number; head: { ref: string }; title: string; html_url: string }>
    >(
      `/repos/${REPO_OWNER}/${REPO_NAME}/pulls?state=open&sort=created&direction=desc&per_page=30`,
    );
    const claudePr = data?.find((pr) => pr.head.ref.startsWith("claude/"));
    if (!claudePr) {
      throw new Error(
        "No hay PRs open de Claude (branches `claude/*`). Mandá " +
          "`/merge <N>` con un número si querés mergear otro.",
      );
    }
    resolved = claudePr.number;
  }

  // 2. Fetch PR meta para incluir title/url en la respuesta.
  const { data: pr } = await gh<{
    number: number;
    title: string;
    html_url: string;
    mergeable: boolean | null;
    mergeable_state: string;
    state: string;
  }>(`/repos/${REPO_OWNER}/${REPO_NAME}/pulls/${resolved}`);
  if (!pr) throw new Error(`PR #${resolved} no encontrado`);
  if (pr.state !== "open") {
    throw new Error(
      `PR #${resolved} no está open (state: ${pr.state}). Ya mergeado o cerrado.`,
    );
  }
  if (pr.mergeable === false) {
    throw new Error(
      `PR #${resolved} no es mergeable (mergeable_state: ${pr.mergeable_state}). ` +
        `Posiblemente tiene conflictos con main — resolvelo manual desde GitHub.`,
    );
  }

  // 3. Merge.
  const { data: merged } = await gh<{ sha: string; merged: boolean }>(
    `/repos/${REPO_OWNER}/${REPO_NAME}/pulls/${resolved}/merge`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ merge_method: method }),
    },
  );
  if (!merged?.merged) {
    throw new Error(`Merge de PR #${resolved} reportó merged=false`);
  }

  return {
    prNumber: resolved,
    prTitle: pr.title,
    prUrl: pr.html_url,
    mergeSha: merged.sha,
  };
}
