import { NextRequest, NextResponse } from "next/server";
import {
  getOpsBotToken,
  getOpsWebhookSecret,
  sendTelegramMessage,
  timingSafeEqual,
  type TelegramUpdate,
} from "@/lib/telegram";
import { resolveOpsProfile, opsLocaleOf } from "@/lib/ops-bot/auth";
import {
  parseOpsCommand,
  runOpsCommand,
  opsHelpText,
} from "@/lib/ops-bot/commands";

/**
 * Webhook del bot de OPERACIÓN (@tero_ops_bot, WIK-285).
 *
 * Distinto del webhook de dev (WIK-97, /api/telegram):
 *  - Bot y secret propios (TELEGRAM_OPS_BOT_TOKEN / TELEGRAM_OPS_WEBHOOK_SECRET).
 *  - Authz por ROL, no por un único chat_id: resolvemos el profiles cuyo
 *    telegram_chat_id === from.id. Sirve para DM y para grupos (en grupos
 *    chat.id es el grupo pero from.id sigue siendo la persona).
 *  - Sin comandos de código. Solo operación: /estado, /incidente, /tareas.
 *
 * Setup (one-time):
 *   1. Crear bot en @BotFather → TELEGRAM_OPS_BOT_TOKEN.
 *   2. openssl rand -hex 32 → TELEGRAM_OPS_WEBHOOK_SECRET.
 *   3. setWebhook a https://tero.bot/api/telegram-ops con secret_token.
 *   4. En grupos: /setprivacy → Disable en BotFather para que el bot vea
 *      todos los mensajes (o los usuarios usan /cmd@tero_ops_bot).
 *   5. Registrar telegram_chat_id de cada profile (admin/gestor).
 *      Bootstrap: si un user no está registrado, el bot le dice su chat_id.
 *
 * Siempre devolvemos 200 salvo mal-setup (evita retry loops de Telegram).
 */

export async function POST(req: NextRequest) {
  // 1. Verify secret token. Fail-closed.
  const secret = getOpsWebhookSecret();
  if (!secret) {
    console.error("[ops-bot] TELEGRAM_OPS_WEBHOOK_SECRET not set — refusing");
    return new NextResponse("Webhook not configured", { status: 503 });
  }
  const provided = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!timingSafeEqual(provided, secret)) {
    console.warn("[ops-bot] webhook secret mismatch");
    return new NextResponse("Forbidden", { status: 403 });
  }

  const token = getOpsBotToken();
  if (!token) {
    console.error("[ops-bot] TELEGRAM_OPS_BOT_TOKEN not set — refusing");
    return new NextResponse("Webhook not configured", { status: 503 });
  }

  // 2. Parse update.
  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ ok: true });
  }

  const msg = update.message ?? update.edited_message;
  if (!msg) return NextResponse.json({ ok: true });

  const fromId = msg.from?.id;
  const chatId = msg.chat.id;

  // 3. Authz por rol. Resolvemos el profile del sender.
  const profile = await resolveOpsProfile(fromId);
  if (!profile) {
    // No registrado o rol no operativo. En DM le damos su chat_id para
    // bootstrap (que el admin lo registre). En grupo, silencio salvo que
    // nos hayan mencionado con un comando explícito (evita ruido).
    const isDm = chatId === fromId;
    const looksLikeCommand = !!msg.text && /^\//.test(msg.text.trim());
    if (isDm) {
      await sendTelegramMessage({
        token,
        chatId,
        parseMode: "HTML",
        text:
          `🔒 No estás registrado en Tero Ops todavía.\n\n` +
          `Tu chat_id de Telegram es <code>${fromId}</code>.\n` +
          `Pasáselo al admin para que te dé de alta (columna ` +
          `<code>telegram_chat_id</code> en tu perfil).`,
      });
    } else if (looksLikeCommand) {
      await sendTelegramMessage({
        token,
        chatId,
        parseMode: "HTML",
        replyToMessageId: msg.message_id,
        text:
          `🔒 No estás autorizado en Tero Ops. Tu chat_id es ` +
          `<code>${fromId}</code> — pasáselo al admin para el alta.`,
      });
    }
    if (fromId) {
      console.warn(`[ops-bot] unauthorized from=${fromId} chat=${chatId}`);
    }
    return NextResponse.json({ ok: true });
  }

  const locale = opsLocaleOf(profile);

  // 4. Dispatch.
  if (!msg.text) {
    await sendTelegramMessage({
      token,
      chatId,
      parseMode: "HTML",
      text: opsHelpText(locale),
    });
    return NextResponse.json({ ok: true });
  }

  const cmd = parseOpsCommand(msg.text);
  if (!cmd) {
    // En grupo no respondemos a texto libre (evita ruido); en DM sí ayudamos.
    if (chatId === fromId) {
      await sendTelegramMessage({
        token,
        chatId,
        parseMode: "HTML",
        text: opsHelpText(locale),
      });
    }
    return NextResponse.json({ ok: true });
  }

  try {
    const reply = await runOpsCommand(cmd, profile, locale);
    await sendTelegramMessage({
      token,
      chatId,
      parseMode: "HTML",
      disableWebPagePreview: true,
      replyToMessageId: chatId === fromId ? undefined : msg.message_id,
      text: reply,
    });
  } catch (err) {
    console.error("[ops-bot] command error", err);
    await sendTelegramMessage({
      token,
      chatId,
      parseMode: "HTML",
      text:
        locale === "en"
          ? "Something went wrong running that. Try again."
          : `Algo falló ejecutando eso. Probá de nuevo.`,
    });
  }

  return NextResponse.json({ ok: true });
}

// Telegram health check / manual GET.
export async function GET() {
  return NextResponse.json({
    ok: true,
    bot: "tero_ops",
    configured: {
      token: !!process.env.TELEGRAM_OPS_BOT_TOKEN,
      secret: !!process.env.TELEGRAM_OPS_WEBHOOK_SECRET,
    },
  });
}
