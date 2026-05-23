import "server-only";
import { createLinearIssue } from "@/lib/linear/create-issue";
import { triggerClaudeWorker } from "@/lib/github/trigger-workflow";
import { APP_NAME } from "@/lib/brand";

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
    }
  | { type: "claude_queue"; prompt: string }
  | {
      type: "work_trigger";
      /** Si viene, el worker procesa este ticket específico. Si no,
       *  agarra el top de la cola con label claude:autonomous. */
      ticketId?: string;
    }
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
      let priority: 0 | 1 | 2 | 3 | 4 = 3;
      let titleSource = firstLine.trim();
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
      };
    }
  }

  // /claude <prompt>
  {
    const m = cleaned.match(/^\/?(claude)\s+([\s\S]+)$/i);
    if (m) {
      const prompt = m[2].trim();
      if (prompt.length === 0) return null;
      return { type: "claude_queue", prompt };
    }
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
          `🎫 <b>Ticket creado${prioLabel}</b>\n\n` +
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
          labels: ["claude:autonomous"],
        });
        return (
          `🤖 <b>Trabajo encolado para Claude</b>\n\n` +
          `<b>${issue.identifier}</b>: ${escapeHtml(issue.title)}\n\n` +
          `<a href="${issue.url}">${issue.url}</a>\n\n` +
          `<i>Cuando el worker corra (manual o cron) lo levanta.</i>`
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
          `<i>Tarda 5-10 min. Te aviso cuando termine (si WIK-138 está activo) o ` +
          `revisás el PR en GitHub directamente.</i>`
        );
      } catch (e) {
        return `❌ No pude disparar el worker: <code>${escapeHtml(
          (e as Error).message,
        )}</code>`;
      }
  }
}
