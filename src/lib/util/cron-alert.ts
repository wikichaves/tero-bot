import "server-only";

import { NextResponse } from "next/server";
import {
  escapeHtml,
  getAdminChatId,
  sendTelegramMessage,
} from "@/lib/telegram";

/**
 * Cron alerting (vacation-safe).
 *
 * Wrap each cron route export with `withCronAlerts(name, handler)` so that any
 * uncaught throw OR HTTP 5xx response surfaces as a Telegram message to the
 * admin chat (`TELEGRAM_ADMIN_CHAT_ID`). 401 responses are NOT alerted — those
 * are auth failures from unauthenticated probes, not real cron breakage.
 *
 * The wrapper is transparent: same request type in, same Response out. If the
 * Telegram side blips, it logs and continues (we never block the cron's
 * response on alert delivery).
 */

const STACK_LINES_IN_ALERT = 5;
const ERROR_TEXT_MAX = 500;
const RESPONSE_BODY_PREVIEW_MAX = 500;

export function withCronAlerts<Req extends Request>(
  cronName: string,
  handler: (request: Req) => Promise<Response>,
): (request: Req) => Promise<Response> {
  return async (request: Req) => {
    try {
      const res = await handler(request);
      if (res.status >= 500) {
        let bodyPreview = "";
        try {
          bodyPreview = await res.clone().text();
        } catch {
          // ignore — body unreadable
        }
        await notifyAdminCronFailure({
          cronName,
          error: `HTTP ${res.status}: ${summarizeErrorText(bodyPreview).slice(0, RESPONSE_BODY_PREVIEW_MAX)}`,
        });
      }
      return res;
    } catch (err) {
      await notifyAdminCronFailure({ cronName, error: err });
      const errMsg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { error: "cron handler threw", message: errMsg },
        { status: 500 },
      );
    }
  };
}

/**
 * Colapsa un cuerpo de error que en realidad es una página HTML a una sola
 * línea legible. Pasa cuando Supabase/Cloudflare devuelve un 5xx/525 como
 * HTML en vez de JSON: sin esto, el alert de Telegram se llena con el
 * `<!DOCTYPE html> ie6 oldie …` de Cloudflare y el motivo real (ej.
 * "525: SSL handshake failed", que vive en el <title>) queda enterrado.
 *
 * Preserva el prefijo útil que pueda venir antes del HTML (ej.
 * "property_devices read failed: ") y le pega el motivo resumido.
 */
function summarizeErrorText(raw: string): string {
  const htmlIdx = raw.search(/<!doctype html|<html[\s>]/i);
  if (htmlIdx === -1) return raw;

  const prefix = raw.slice(0, htmlIdx).trim();
  const html = raw.slice(htmlIdx);

  // Cloudflare/Supabase ponen el motivo en el <title>
  // (ej. "supabase.co | 525: SSL handshake failed").
  const title = html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim();
  const summary = title
    ? /supabase/i.test(title)
      ? `Supabase inalcanzable — ${title}`
      : title
    : "respuesta HTML de error (servicio inalcanzable)";

  return prefix ? `${prefix} ${summary}` : summary;
}

async function notifyAdminCronFailure(opts: {
  cronName: string;
  error: unknown;
}): Promise<void> {
  const chatId = getAdminChatId();
  if (!chatId) {
    console.warn(
      `[cron-alert] TELEGRAM_ADMIN_CHAT_ID not set; skipping alert for ${opts.cronName}`,
    );
    return;
  }

  const rawMsg =
    opts.error instanceof Error
      ? `${opts.error.name}: ${opts.error.message}`
      : String(opts.error);
  const errMsg = summarizeErrorText(rawMsg);
  const stack = opts.error instanceof Error ? opts.error.stack : undefined;

  const lines = [
    `🚨 <b>Cron falló: ${escapeHtml(opts.cronName)}</b>`,
    "",
    `<b>Error:</b> ${escapeHtml(errMsg.slice(0, ERROR_TEXT_MAX))}`,
  ];
  if (stack) {
    const trimmed = stack.split("\n").slice(0, STACK_LINES_IN_ALERT).join("\n");
    lines.push("", `<pre>${escapeHtml(trimmed)}</pre>`);
  }

  await sendTelegramMessage({
    chatId,
    text: lines.join("\n"),
    parseMode: "HTML",
    disableWebPagePreview: true,
  });
}
