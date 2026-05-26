import "server-only";
import { mergePR, triggerClaudeWorker } from "@/lib/github/trigger-workflow";
import {
  escapeHtml,
  type TelegramInlineKeyboard,
} from "@/lib/telegram";

/**
 * Handler de `callback_query` (WIK-186) — taps en inline buttons que
 * mandamos en notifications del worker.
 *
 * Convención de `data` (max 64 bytes):
 *   - `merge:<N>`     → mergea PR #N + ofrece próximo
 *   - `next`          → dispara un nuevo run del worker (top de queue)
 *   - `noop`          → no-op, solo cierra los buttons del mensaje
 *
 * El return shape es lo que el route handler usa para actualizar la UI:
 * `text` es el reemplazo del mensaje original (sin botones), `ack` es
 * el toast efímero que aparece arriba al tapear.
 */

export type CallbackResult = {
  /** Texto HTML para reemplazar el mensaje original (`editMessageText`). */
  text: string;
  /** Si tiene buttons nuevos (ej. después de merge → ofrecer próximo). */
  nextKeyboard?: TelegramInlineKeyboard;
  /** Toast efímero que Telegram muestra arriba al tapear el botón. */
  ack: string;
};

export type CallbackData =
  | { kind: "merge"; prNumber: number }
  | { kind: "next" }
  | { kind: "noop" };

/** Parsea el `data` field de un callback_query a un tipo discriminado. */
export function parseCallbackData(raw: string | undefined): CallbackData | null {
  if (!raw) return null;
  const cleaned = raw.trim();
  if (cleaned === "next") return { kind: "next" };
  if (cleaned === "noop" || cleaned === "stop") return { kind: "noop" };
  const m = cleaned.match(/^merge:(\d+)$/);
  if (m) return { kind: "merge", prNumber: Number(m[1]) };
  return null;
}

/**
 * Ejecuta el callback y devuelve cómo debe quedar el mensaje original
 * post-tap. Nunca tira — los errores se formatean inline para que el
 * user los vea y decida.
 */
export async function runCallback(data: CallbackData): Promise<CallbackResult> {
  switch (data.kind) {
    case "merge": {
      try {
        const r = await mergePR(data.prNumber);
        return {
          ack: `Mergeado #${r.prNumber}`,
          text:
            `🚢 <b>PR #${r.prNumber} mergeado</b>\n\n` +
            `${escapeHtml(r.prTitle)}\n` +
            `<code>${r.mergeSha.slice(0, 7)}</code> en main\n\n` +
            `<i>¿Seguir con el próximo ticket de la queue?</i>`,
          nextKeyboard: [
            [
              { text: "🚀 Próximo", callback_data: "next" },
              { text: "🛑 Pausa", callback_data: "noop" },
            ],
          ],
        };
      } catch (e) {
        return {
          ack: "Error",
          text: `❌ <b>No pude mergear #${data.prNumber}</b>\n\n<code>${escapeHtml((e as Error).message)}</code>`,
        };
      }
    }

    case "next": {
      try {
        const r = await triggerClaudeWorker();
        const link = r.runUrl
          ? `<a href="${r.runUrl}">Ver run</a>`
          : `<a href="${r.workflowUrl}">Ver workflow</a>`;
        return {
          ack: "Worker disparado",
          text:
            `🚀 <b>Worker arrancando</b> con el próximo de la queue.\n\n` +
            `${link}\n\n` +
            `<i>Te aviso acá cuando termine.</i>`,
        };
      } catch (e) {
        return {
          ack: "Error",
          text: `❌ <b>No pude disparar el worker</b>\n\n<code>${escapeHtml((e as Error).message)}</code>`,
        };
      }
    }

    case "noop":
      return {
        ack: "Cerrado",
        text: "<i>Loop pausado. Mandá /work cuando quieras retomar.</i>",
      };
  }
}
