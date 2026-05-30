import "server-only";
import { createLinearIssue } from "@/lib/linear/create-issue";
import { listClaudeTodos } from "@/lib/linear/count-todos";
import {
  triggerClaudeWorker,
  mergePR,
  mergeAllClaudePRs,
} from "@/lib/github/trigger-workflow";
import { APP_NAME } from "@/lib/brand";
import { splitRepoAlias } from "@/lib/repos";

/**
 * Comandos admin/developer (WIK-97).
 *
 * Lib agnóstica del transport — la consume el handler de Telegram
 * (`/api/telegram`) y potencialmente otros canales en el futuro.
 * NO debe asumir un canal específico: devuelve texto Markdown/HTML
 * y deja al caller el formatting final.
 *
 * Decisión de fuerza:
 * - Los strings devueltos usan HTML (compatible con Telegram parse_mode
 *   "HTML"). Es más permisivo que MarkdownV2 para escapar.
 * - Cada comando devuelve string con formato lleno — el caller solo
 *   manda `text` al transport.
 */

export type AdminCommand =
  | { type: "help" }
  | {
      type: "linear_issue";
      title: string;
      description: string;
      priority: 0 | 1 | 2 | 3 | 4;
      /** WIK-266: Linear project donde crear el ticket (según alias de repo). */
      projectName: string;
      /** Label legible del repo, para la confirmación de Telegram. */
      repoLabel: string;
    }
  | {
      type: "claude_queue";
      prompt: string;
      /** WIK-266: project + repo destino (resuelto del prefijo de alias). */
      projectName: string;
      repoLabel: string;
    }
  | {
      type: "work_trigger";
      /** Si viene, el worker procesa este ticket específico. Si no,
       *  agarra el top de la cola con label claude:autonomous. */
      ticketId?: string;
    }
  | { type: "work_all" }
  | {
      type: "merge_pr";
      /** Número del PR. Si no viene, mergea el más reciente PR open
       *  con head branch `claude/*`. */
      prNumber?: number;
    }
  | { type: "merge_all" }
  | null;

export const HELP_TEXT = `<b>${APP_NAME} — comandos admin</b>

🎫 <b>Linear</b>
/linear &lt;título&gt; — crear ticket
/linear urgente &lt;título&gt; — priority urgent
/linear alto &lt;título&gt; — priority high
/linear bajo &lt;título&gt; — priority low

🤖 <b>Claude autónomo</b>
/claude &lt;prompt&gt; — encolar trabajo
   <i>El worker (GitHub Action) lo levanta y abre PR.</i>
/work — disparar el worker ahora mismo (toma el top de la cola)
/work WIK-XXX — forzar el worker sobre un ticket específico
/work all — encolar N runs (uno por cada Todo con label claude:autonomous)
/merge — mergear el último PR autonomous (squash) → Vercel deploya
/merge &lt;N&gt; — mergear un PR específico por número
/merge all — mergear TODOS los PRs autonomous open (en orden)

🗂️ <b>Multi-repo</b> (prefijo de alias, default tero-bot)
/claude wiki &lt;prompt&gt; — ticket en wikichaves.com
/claude casa &lt;prompt&gt; — ticket en casabosquemontoya
/linear wiki &lt;título&gt; — idem para tickets manuales
   <i>Aliases: tero · wiki/web · casa/cbm/montoya</i>

❓ <b>Help</b>
/help — esta lista

<i>Tip: si querés una descripción multi-línea para el ticket, dejá la primera línea como título y mandá el resto en el mismo mensaje separado por enter.</i>`;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Parse free-form text into a command. Acepta slash-commands estilo
 * Telegram (`/linear ...`) o sin slash (`linear ...`). Si el comando
 * lleva mención de bot (`/linear@tero_dev_bot`), se ignora la mención.
 */
export function parseAdminCommand(text: string | null | undefined): AdminCommand {
  if (!text) return null;
  // Strip optional `@bot_name` que Telegram pega después del cmd cuando
  // el comando viene de un group chat. Acá usamos 1:1 pero defensivo.
  const cleaned = text.replace(/^(\/[a-zA-Z_]+)@\S+/, "$1").trim();

  if (/^\/?(help|comandos|menu|start|ayuda)\b/i.test(cleaned)) {
    return { type: "help" };
  }

  // /linear <título> — soporta también ticket / bug / feature / issue.
  {
    const m = cleaned.match(
      /^\/?(linear|ticket|bug|feature|issue)\s+([\s\S]+)$/i,
    );
    if (m) {
      const rest = m[2];
      const [firstLine, ...descLines] = rest.split("\n");
      const description = descLines.join("\n").trim();
      // WIK-266: prefijo de alias opcional al inicio (`/linear wiki ...`).
      // Solo afecta la primera línea (el título); el resto es descripción.
      const { repo, rest: afterAlias } = splitRepoAlias(firstLine.trim());
      let priority: 0 | 1 | 2 | 3 | 4 = 3;
      let titleSource = afterAlias.trim();
      const prio = titleSource.match(/^(urgente|alto|medio|bajo)\s+(.+)$/i);
      if (prio) {
        const word = prio[1].toLowerCase();
        priority =
          word === "urgente"
            ? 1
            : word === "alto"
              ? 2
              : word === "bajo"
                ? 4
                : 3;
        titleSource = prio[2].trim();
      }
      if (titleSource.length === 0) return null;
      return {
        type: "linear_issue",
        title: titleSource,
        description,
        priority,
        projectName: repo.project,
        repoLabel: repo.label,
      };
    }
  }

  // /claude <prompt>
  {
    const m = cleaned.match(/^\/?(claude)\s+([\s\S]+)$/i);
    if (m) {
      // WIK-266: prefijo de alias opcional (`/claude wiki <prompt>`).
      const { repo, rest } = splitRepoAlias(m[2].trim());
      const prompt = rest.trim();
      if (prompt.length === 0) return null;
      return {
        type: "claude_queue",
        prompt,
        projectName: repo.project,
        repoLabel: repo.label,
      };
    }
  }

  // /work all — disparar 1 run del worker por CADA Todo con label
  // claude:autonomous. Concurrency group serializa los runs.
  // Importante: matchear ANTES de `/work [WIK-XXX]` porque "all" no es
  // un WIK-id válido pero el regex genérico no lo distinguiría.
  if (/^\/?(work|run|trabaj[áa])\s+(all|todo|todos)\s*$/i.test(cleaned)) {
    return { type: "work_all" };
  }

  // /work [WIK-XXX] — disparar el GH Action ahora. Acepta también
  // "run", "trabaja", "trabajá" como aliases.
  {
    const m = cleaned.match(
      /^\/?(work|run|trabaj[áa])(?:\s+(WIK-\d+))?\s*$/i,
    );
    if (m) {
      return {
        type: "work_trigger",
        ticketId: m[2]?.toUpperCase(),
      };
    }
  }

  // /merge all — mergear TODOS los PRs autonomous open.
  // Igual que /work, matchear esta variante ANTES de `/merge [N]`.
  if (
    /^\/?(merge|merge[ae][rs]?|mergear|mergeá)\s+(all|todo|todos)\s*$/i.test(
      cleaned,
    )
  ) {
    return { type: "merge_all" };
  }

  // /merge [N] — mergear PR via GitHub API. Acepta también
  // "mergea", "mergear" como aliases (con o sin acento).
  {
    const m = cleaned.match(
      /^\/?(merge|merge[ae][rs]?|mergear|mergeá)(?:\s+#?(\d+))?\s*$/i,
    );
    if (m) {
      const num = m[2] ? Number(m[2]) : undefined;
      return { type: "merge_pr", prNumber: num };
    }
  }

  return null;
}

/**
 * Ejecutar el comando. Devuelve un string HTML listo para mandar por
 * Telegram (con `parse_mode: "HTML"`). Nunca throws — los errores se
 * formatean inline como respuesta.
 */
export async function runAdminCommand(cmd: AdminCommand): Promise<string> {
  if (!cmd) return HELP_TEXT;

  switch (cmd.type) {
    case "help":
      return HELP_TEXT;

    case "linear_issue":
      try {
        const issue = await createLinearIssue({
          title: cmd.title,
          description: cmd.description || undefined,
          priority: cmd.priority,
          projectName: cmd.projectName,
        });
        const prioLabel =
          cmd.priority === 1
            ? " (urgente)"
            : cmd.priority === 2
              ? " (alto)"
              : cmd.priority === 4
                ? " (bajo)"
                : "";
        return (
          `🎫 <b>Ticket creado${prioLabel}</b> · <code>${escapeHtml(cmd.repoLabel)}</code>\n\n` +
          `<b>${issue.identifier}</b>: ${escapeHtml(issue.title)}\n\n` +
          `<a href="${issue.url}">${issue.url}</a>`
        );
      } catch (e) {
        return `❌ No pude crear el ticket: <code>${escapeHtml(
          (e as Error).message,
        )}</code>`;
      }

    case "claude_queue":
      try {
        // Title: primera línea, cap a 120 (límite UI razonable de Linear).
        // Description: SIEMPRE el prompt completo, no solo lo que sobra
        // después del primer \n. Antes había un bug donde si el prompt
        // era una sola línea larga, la parte truncada se perdía y el
        // worker veía un "haz X" mutilado (ej. "reemplazar este bloque"
        // sin la parte de "con esto").
        const [firstLine] = cmd.prompt.split("\n");
        const title = firstLine.trim().slice(0, 120);
        const description = [
          "**Prompt completo (lo que va a ver Claude):**",
          "",
          cmd.prompt.trim(),
          "",
          "---",
          "_Encolado vía /claude de Telegram. El worker autónomo lo va a levantar._",
        ].join("\n");
        const issue = await createLinearIssue({
          title,
          description,
          priority: 3,
          projectName: cmd.projectName,
          labels: ["claude:autonomous"],
          // Todo directo → el worker lo levanta sin paso manual del user.
          state: "Todo",
        });
        return (
          `🤖 <b>Trabajo encolado para Claude</b> · <code>${escapeHtml(cmd.repoLabel)}</code>\n\n` +
          `<b>${issue.identifier}</b>: ${escapeHtml(issue.title)}\n\n` +
          `<a href="${issue.url}">${issue.url}</a>\n\n` +
          `<i>Está en <b>Todo</b> (project ${escapeHtml(cmd.projectName)}). Disparalo con /work o esperá al próximo /work all.</i>`
        );
      } catch (e) {
        return `❌ No pude encolar: <code>${escapeHtml(
          (e as Error).message,
        )}</code>`;
      }

    case "work_trigger":
      try {
        const result = await triggerClaudeWorker(cmd.ticketId);
        const targetLine = cmd.ticketId
          ? `🎯 Forzado a <b>${cmd.ticketId}</b>\n\n`
          : `🎯 Va a tomar el top de la cola <code>claude:autonomous</code>\n\n`;
        const runLink = result.runUrl
          ? `<a href="${result.runUrl}">Ver run en vivo</a>`
          : `<a href="${result.workflowUrl}">Ver workflow</a> (el run específico aparece en 1-2 seg)`;
        return (
          `🚀 <b>Worker disparado</b>\n\n` +
          targetLine +
          `${runLink}\n\n` +
          `<i>Tarda 5-10 min. Te aviso por acá cuando termine.</i>`
        );
      } catch (e) {
        return `❌ No pude disparar el worker: <code>${escapeHtml(
          (e as Error).message,
        )}</code>`;
      }

    case "merge_pr":
      try {
        const result = await mergePR(cmd.prNumber);
        if (result.mergeSha) {
          return (
            `✅ <b>PR #${result.prNumber} mergeado</b>\n\n` +
            `${escapeHtml(result.prTitle)}\n\n` +
            `<a href="${result.prUrl}">${result.prUrl}</a>\n\n` +
            `<i>Vercel deploya en 2-3 min. Commit en main: ` +
            `<code>${result.mergeSha.slice(0, 7)}</code></i>`
          );
        }
        // Auto-merge habilitado — GitHub lo mergea solo cuando CI pase.
        return (
          `🔄 <b>Auto-merge habilitado en PR #${result.prNumber}</b>\n\n` +
          `${escapeHtml(result.prTitle)}\n\n` +
          `<a href="${result.prUrl}">${result.prUrl}</a>\n\n` +
          `<i>${escapeHtml(result.autoMergeReason ?? "esperando CI")}. ` +
          `GitHub te avisa cuando termine.</i>`
        );
      } catch (e) {
        return `❌ No pude mergear: <code>${escapeHtml(
          (e as Error).message,
        )}</code>`;
      }

    case "work_all":
      // Encolá un workflow_dispatch por cada Todo con label autonomous.
      // El concurrency group `claude-worker` los serializa — vas a ver
      // una notif por cada run via el flow de WIK-186.
      try {
        const todos = await listClaudeTodos();
        if (todos.length === 0) {
          return (
            `📭 <b>Queue vacía</b>\n\n` +
            `No hay tickets en <b>Todo</b> con label <code>claude:autonomous</code>. ` +
            `Encolá uno nuevo con /claude &lt;prompt&gt; y movelo a Todo cuando esté listo.`
          );
        }
        // Listado preview con priority emoji.
        const PRIO_EMOJI: Record<number, string> = {
          1: "🔴",
          2: "🟠",
          3: "🟡",
          4: "⚪",
          0: "⚫",
        };
        const preview = todos
          .slice(0, 10)
          .map(
            (t) =>
              `${PRIO_EMOJI[t.priority] ?? "⚫"} <b>${t.identifier}</b> — ${escapeHtml(
                t.title.slice(0, 60),
              )}${t.title.length > 60 ? "…" : ""}`,
          )
          .join("\n");
        const tail = todos.length > 10 ? `\n…y ${todos.length - 10} más` : "";

        // Dispatch secuencial (no Promise.all) — el endpoint de GH
        // workflow_dispatch puede rate-limitar y queremos un orden
        // predecible si algo falla a mitad de camino.
        const dispatched: string[] = [];
        const failed: Array<{ ticket: string; reason: string }> = [];
        for (const t of todos) {
          try {
            await triggerClaudeWorker(t.identifier);
            dispatched.push(t.identifier);
          } catch (e) {
            failed.push({ ticket: t.identifier, reason: (e as Error).message });
          }
        }
        const failedLine =
          failed.length > 0
            ? `\n\n⚠ ${failed.length} no se pudieron disparar:\n` +
              failed
                .slice(0, 5)
                .map(
                  (f) =>
                    `• ${f.ticket}: <code>${escapeHtml(f.reason.slice(0, 80))}</code>`,
                )
                .join("\n")
            : "";
        return (
          `🚀 <b>${dispatched.length} runs en cola</b>\n\n` +
          `${preview}${tail}\n\n` +
          `<i>El concurrency group los serializa — vas a ver una notif por cada run cuando termine.</i>` +
          failedLine
        );
      } catch (e) {
        return `❌ No pude disparar /work all: <code>${escapeHtml(
          (e as Error).message,
        )}</code>`;
      }

    case "merge_all":
      // Loop secuencial sobre los PRs autonomous open. Cada falla se
      // reporta inline pero no detiene el loop — útil cuando hay PRs
      // con conflictos mezclados con PRs limpios.
      try {
        const result = await mergeAllClaudePRs();
        if (
          result.merged.length === 0 &&
          result.autoMergeQueued.length === 0 &&
          result.failed.length === 0
        ) {
          return (
            `📭 <b>No hay PRs autonomous open</b>\n\n` +
            `Nada que mergear.`
          );
        }
        const mergedLine =
          result.merged.length > 0
            ? `✅ <b>${result.merged.length} mergeados</b>\n` +
              result.merged
                .map(
                  (m) =>
                    `• #${m.prNumber} <code>${m.mergeSha.slice(0, 7)}</code> — ${escapeHtml(
                      m.prTitle.slice(0, 60),
                    )}`,
                )
                .join("\n")
            : "";
        const queuedLine =
          result.autoMergeQueued.length > 0
            ? `\n\n🔄 <b>${result.autoMergeQueued.length} en auto-merge</b> <i>(esperando CI)</i>\n` +
              result.autoMergeQueued
                .map(
                  (q) =>
                    `• #${q.prNumber} — ${escapeHtml(q.prTitle.slice(0, 60))}`,
                )
                .join("\n")
            : "";
        const failedLine =
          result.failed.length > 0
            ? `\n\n⚠ <b>${result.failed.length} con problema</b>\n` +
              result.failed
                .map(
                  (f) =>
                    `• #${f.prNumber} — <code>${escapeHtml(f.reason.slice(0, 100))}</code>`,
                )
                .join("\n")
            : "";
        const deployLine =
          result.merged.length > 0
            ? `\n\n<i>Vercel deploya en 2-3 min.</i>`
            : "";
        return `${mergedLine}${queuedLine}${failedLine}${deployLine}`;
      } catch (e) {
        return `❌ No pude correr /merge all: <code>${escapeHtml(
          (e as Error).message,
        )}</code>`;
      }
  }
}
