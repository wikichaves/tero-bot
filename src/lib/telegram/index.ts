import "server-only";

/**
 * Cliente mínimo para Telegram Bot API (WIK-97).
 *
 * Solo expone lo que necesitamos: `sendTelegramMessage`. Para registrar
 * el webhook hay un script en `docs/WIK-97-claude-bot.md` (curl one-liner).
 *
 * No usamos `node-telegram-bot-api` o `grammy` para mantener cero deps —
 * la API es muy simple, raw fetch alcanza.
 */

const TELEGRAM_API_BASE = "https://api.telegram.org";

export function getTelegramBotToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN ?? null;
}

/**
 * Chat ID del único admin autorizado (vos). Telegram usa ints positivos
 * para users, negativos para groups. Lo guardamos como string en env y
 * lo parseamos acá.
 */
export function getAdminChatId(): number | null {
  const v = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Secret token configurado al registrar el webhook. Telegram lo envía
 * en el header `X-Telegram-Bot-Api-Secret-Token` de cada POST, y nuestro
 * handler lo valida. Es el equivalente al HMAC de Kapso pero más simple
 * (string compare timing-safe).
 */
export function getWebhookSecret(): string | null {
  return process.env.TELEGRAM_WEBHOOK_SECRET ?? null;
}

export type TelegramUser = {
  id: number;
  is_bot: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
};

export type TelegramChat = {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
};

export type TelegramMessage = {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
};

/**
 * Tap event sobre un inline button (WIK-186). Telegram lo manda como
 * un update con `callback_query` en vez de `message`.
 *
 * - `id`: string opaco que hay que pasar a `answerCallbackQuery` para
 *   que Telegram apague el spinner de loading en el cliente.
 * - `data`: hasta 64 bytes que nosotros definimos al construir el
 *   keyboard (ej. "merge:42" o "next").
 * - `message`: el mensaje original al que pertenecía el botón — útil
 *   para hacer `editMessageText` y actualizar la UI post-tap.
 */
export type TelegramCallbackQuery = {
  id: string;
  from: TelegramUser;
  data?: string;
  message?: TelegramMessage;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

/**
 * Un botón inline. Telegram acepta varios tipos (url, switch_inline_query,
 * etc.) pero acá solo usamos `callback_data` (tap → callback_query) y
 * `url` (tap → abre browser).
 */
export type TelegramInlineKeyboardButton =
  | { text: string; callback_data: string }
  | { text: string; url: string };

/** Matriz de botones (filas × columnas). Cada sub-array es una fila. */
export type TelegramInlineKeyboard = TelegramInlineKeyboardButton[][];

/**
 * Manda un mensaje al chat indicado. Devuelve el message_id de Telegram
 * o null si falló. Errores se loguean a console — no throws (es side-effect,
 * no queremos romper el handler si Telegram tiene un blip).
 */
export async function sendTelegramMessage(opts: {
  chatId: number | string;
  text: string;
  parseMode?: "HTML" | "MarkdownV2" | "Markdown";
  disableWebPagePreview?: boolean;
  replyToMessageId?: number;
  /** WIK-186: inline buttons debajo del mensaje. Tap → callback_query. */
  inlineKeyboard?: TelegramInlineKeyboard;
}): Promise<{ messageId: number } | null> {
  const token = getTelegramBotToken();
  if (!token) {
    console.error("[telegram] TELEGRAM_BOT_TOKEN not set");
    return null;
  }
  const body: Record<string, unknown> = {
    chat_id: opts.chatId,
    text: opts.text,
  };
  if (opts.parseMode) body.parse_mode = opts.parseMode;
  if (opts.disableWebPagePreview != null) {
    body.disable_web_page_preview = opts.disableWebPagePreview;
  }
  if (opts.replyToMessageId) body.reply_to_message_id = opts.replyToMessageId;
  if (opts.inlineKeyboard) {
    body.reply_markup = { inline_keyboard: opts.inlineKeyboard };
  }

  try {
    const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error(`[telegram] sendMessage ${res.status}: ${errText}`);
      return null;
    }
    const json = (await res.json()) as {
      ok: boolean;
      result?: { message_id: number };
    };
    return json.result ? { messageId: json.result.message_id } : null;
  } catch (e) {
    console.error("[telegram] sendMessage exception", e);
    return null;
  }
}

/**
 * Edita el texto de un mensaje existente (WIK-186). Usado para
 * actualizar la UI después de un tap de inline button — ej. cambiar
 * "✅ PR #10 [Mergear] [Stop]" por "🚢 Mergeado en abc1234" sin que el
 * user vea botones obsoletos.
 *
 * Para QUITAR los botones después del tap, pasá `inlineKeyboard: []`
 * (Telegram acepta matriz vacía y elimina el reply_markup).
 */
export async function editTelegramMessage(opts: {
  chatId: number | string;
  messageId: number;
  text: string;
  parseMode?: "HTML" | "MarkdownV2" | "Markdown";
  disableWebPagePreview?: boolean;
  inlineKeyboard?: TelegramInlineKeyboard;
}): Promise<boolean> {
  const token = getTelegramBotToken();
  if (!token) {
    console.error("[telegram] TELEGRAM_BOT_TOKEN not set");
    return false;
  }
  const body: Record<string, unknown> = {
    chat_id: opts.chatId,
    message_id: opts.messageId,
    text: opts.text,
  };
  if (opts.parseMode) body.parse_mode = opts.parseMode;
  if (opts.disableWebPagePreview != null) {
    body.disable_web_page_preview = opts.disableWebPagePreview;
  }
  if (opts.inlineKeyboard) {
    body.reply_markup = { inline_keyboard: opts.inlineKeyboard };
  }
  try {
    const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error(`[telegram] editMessage ${res.status}: ${errText}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[telegram] editMessage exception", e);
    return false;
  }
}

/**
 * Telegram requiere que respondas a CADA callback_query (acknowledgement)
 * dentro de los 30s, sino el cliente del user queda con el spinner
 * cargando indefinidamente. El `text` opcional aparece como toast/alert
 * encima del mensaje. Si la operación es lenta, mandá un ack rápido
 * y después hacé el trabajo pesado en background.
 */
export async function answerCallbackQuery(opts: {
  callbackQueryId: string;
  text?: string;
  /** Si true muestra como alert modal (en vez de toast). Default false. */
  showAlert?: boolean;
}): Promise<void> {
  const token = getTelegramBotToken();
  if (!token) return;
  try {
    await fetch(`${TELEGRAM_API_BASE}/bot${token}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callback_query_id: opts.callbackQueryId,
        text: opts.text,
        show_alert: opts.showAlert ?? false,
      }),
    });
  } catch (e) {
    console.error("[telegram] answerCallbackQuery exception", e);
  }
}

/**
 * Escape mínimo para HTML parse_mode. Solo hace falta para `<`, `>`, `&`.
 * NO se aplica a contenido que ya viene como HTML (ej. `<b>...</b>`).
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Constant-time string compare para el secret token del webhook.
 * Usar esto en vez de `===` evita timing attacks si el endpoint queda
 * expuesto público (que lo está — Telegram lo necesita).
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
