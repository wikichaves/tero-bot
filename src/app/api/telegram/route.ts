import { NextRequest, NextResponse } from "next/server";
import {
  answerCallbackQuery,
  editTelegramMessage,
  getAdminChatId,
  getWebhookSecret,
  sendTelegramMessage,
  escapeHtml,
  timingSafeEqual,
  type TelegramUpdate,
} from "@/lib/telegram";
import {
  parseAdminCommand,
  runAdminCommand,
  HELP_TEXT,
} from "@/lib/admin-commands";
import {
  parseCallbackData,
  runCallback,
} from "@/lib/admin-commands/callbacks";

/**
 * Telegram webhook receiver (WIK-97).
 *
 * Telegram POSTs cada update acá. Vs el handler de WhatsApp/Kapso este
 * es MUCHO más simple:
 *  - Auth: secret token en `X-Telegram-Bot-Api-Secret-Token` (no HMAC).
 *  - Authz: chat_id del sender vs `TELEGRAM_ADMIN_CHAT_ID` env var.
 *  - Sin DB writes — Telegram no es el inbox del staff, es solo dev/admin.
 *  - Sin 24h-window restrictions — el bot te puede responder cuando sea.
 *
 * Setup (one-time, ver docs/WIK-97-claude-bot.md):
 *   1. Crear bot via @BotFather → guardar TELEGRAM_BOT_TOKEN.
 *   2. Generar TELEGRAM_WEBHOOK_SECRET (openssl rand -hex 32).
 *   3. Registrar webhook:
 *      curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://tero.bot/api/telegram&secret_token=<SECRET>"
 *   4. Mandarle un mensaje al bot → ver logs de Vercel para tu chat_id.
 *   5. Setear TELEGRAM_ADMIN_CHAT_ID con ese número.
 *
 * Telegram retry policy: si devolvemos 5xx, reintenta hasta 5 min después.
 * Devolvemos siempre 200 (incluso en errores de comando) para evitar
 * loops — el error se reporta al user vía mensaje, no via HTTP status.
 */

export async function POST(req: NextRequest) {
  // 1. Verify secret token. Si no está configurado en env, rechazamos
  //    cualquier request — fail-closed contra mal-setup.
  const secret = getWebhookSecret();
  if (!secret) {
    console.error("[telegram] TELEGRAM_WEBHOOK_SECRET not set — refusing");
    return new NextResponse("Webhook not configured", { status: 503 });
  }
  const provided = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!timingSafeEqual(provided, secret)) {
    console.warn("[telegram] webhook secret mismatch");
    return new NextResponse("Forbidden", { status: 403 });
  }

  // 2. Parse update.
  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    return new NextResponse("Bad JSON", { status: 400 });
  }
  // WIK-186: callback_query = tap en un inline button. Lo procesamos
  // antes que `message` porque viene en updates distintos del usual
  // text-message flow.
  if (update.callback_query) {
    const cb = update.callback_query;
    const adminId = getAdminChatId();
    if (!adminId || cb.from.id !== adminId) {
      // Authz check para callbacks: solo admin. Si no es, ack pero no
      // hacemos nada (no le filtramos info).
      await answerCallbackQuery({
        callbackQueryId: cb.id,
        text: "🔒 No autorizado.",
        showAlert: true,
      });
      return NextResponse.json({ ok: true });
    }
    const parsed = parseCallbackData(cb.data);
    if (!parsed) {
      await answerCallbackQuery({
        callbackQueryId: cb.id,
        text: "Callback desconocido.",
      });
      return NextResponse.json({ ok: true });
    }
    try {
      // Ack rápido para no dejar el spinner pendiente. El resultado real
      // lo reportamos editando el mensaje.
      await answerCallbackQuery({ callbackQueryId: cb.id });
      const result = await runCallback(parsed);
      if (cb.message) {
        await editTelegramMessage({
          chatId: cb.message.chat.id,
          messageId: cb.message.message_id,
          text: result.text,
          parseMode: "HTML",
          disableWebPagePreview: true,
          inlineKeyboard: result.nextKeyboard ?? [],
        });
      }
    } catch (err) {
      console.error("[telegram] callback error", err);
      if (cb.message) {
        await editTelegramMessage({
          chatId: cb.message.chat.id,
          messageId: cb.message.message_id,
          text: `❌ Error procesando callback: <code>${escapeHtml((err as Error).message)}</code>`,
          parseMode: "HTML",
          inlineKeyboard: [],
        });
      }
    }
    return NextResponse.json({ ok: true });
  }

  const msg = update.message ?? update.edited_message;
  if (!msg) {
    // Otros tipos de updates (edited_channel_post, etc.) — ignoramos.
    return NextResponse.json({ ok: true });
  }

  // 3. Authz: solo admin.
  const adminId = getAdminChatId();
  if (!adminId) {
    console.error(
      "[telegram] TELEGRAM_ADMIN_CHAT_ID not set — el bot solo loguea tu chat_id",
    );
    // Bootstrap mode: si todavía no configuramos el admin chat_id,
    // respondemos diciendo cuál es tu chat_id para que vos lo copies
    // y lo metas en Vercel. Después de setearlo este branch ya no se
    // ejecuta. Útil en el primer setup.
    await sendTelegramMessage({
      chatId: msg.chat.id,
      text:
        `👋 Hola ${escapeHtml(msg.from?.first_name ?? "")}.\n\n` +
        `Tu chat_id es <code>${msg.from?.id ?? msg.chat.id}</code>.\n\n` +
        `Copiá ese número y agregalo como env var ` +
        `<code>TELEGRAM_ADMIN_CHAT_ID</code> en Vercel. ` +
        `Después redeployá y reintentá.`,
      parseMode: "HTML",
    });
    return NextResponse.json({ ok: true });
  }
  const fromId = msg.from?.id;
  if (fromId !== adminId) {
    console.warn(
      `[telegram] unauthorized from=${fromId} expected=${adminId}`,
    );
    // Le decimos a la persona cuál es su chat_id pero no procesamos
    // su comando. Útil si vos te mandás un mensaje desde otra cuenta
    // por accidente.
    await sendTelegramMessage({
      chatId: msg.chat.id,
      text:
        `🔒 Este bot es privado. Tu chat_id es <code>${fromId}</code>.`,
      parseMode: "HTML",
    });
    return NextResponse.json({ ok: true });
  }

  // 4. Dispatch.
  if (!msg.text) {
    await sendTelegramMessage({
      chatId: msg.chat.id,
      text: "Solo entiendo texto por ahora. Mandá /help para ver los comandos.",
      parseMode: "HTML",
    });
    return NextResponse.json({ ok: true });
  }

  try {
    const command = parseAdminCommand(msg.text);
    if (!command) {
      // No matchea ningún comando — mostrar help.
      await sendTelegramMessage({
        chatId: msg.chat.id,
        text: HELP_TEXT,
        parseMode: "HTML",
        disableWebPagePreview: true,
      });
      return NextResponse.json({ ok: true });
    }
    const reply = await runAdminCommand(command);
    await sendTelegramMessage({
      chatId: msg.chat.id,
      text: reply,
      parseMode: "HTML",
      disableWebPagePreview: true,
      replyToMessageId: msg.message_id,
    });
  } catch (err) {
    console.error("[telegram] command error", err);
    await sendTelegramMessage({
      chatId: msg.chat.id,
      text:
        `❌ Error procesando el comando: <code>` +
        `${escapeHtml((err as Error).message)}</code>`,
      parseMode: "HTML",
    });
  }

  return NextResponse.json({ ok: true });
}

// GET para verificar manualmente que el endpoint está vivo (útil después
// de deployar). Devuelve un JSON con el estado de configuración para
// debugging sin requerir hablar con Telegram.
export async function GET() {
  return NextResponse.json({
    ok: true,
    configured: {
      bot_token: !!process.env.TELEGRAM_BOT_TOKEN,
      admin_chat_id: !!process.env.TELEGRAM_ADMIN_CHAT_ID,
      webhook_secret: !!process.env.TELEGRAM_WEBHOOK_SECRET,
      linear_token: !!process.env.LINEAR_API_TOKEN,
      // WIK-139: opcional. Si no está seteado, solo el cmd /work falla;
      // el resto (linear, claude) sigue funcionando.
      github_pat: !!process.env.GITHUB_PAT,
    },
  });
}
