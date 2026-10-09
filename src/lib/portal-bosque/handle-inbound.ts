import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PostmarkInbound } from "@/lib/inbound/postmark";
import {
  getAdminChatId,
  getOpsBotToken,
  sendTelegramMessage,
} from "@/lib/telegram";
import { parseWikibotInbound } from "./parse-inbound";
import { storeWikibotInbound } from "./store-inbound";

export async function handleWikibotInbound(
  body: PostmarkInbound,
  admin: SupabaseClient,
): Promise<NextResponse> {
  const messageId = await storeWikibotInbound(admin, body);
  const parsed = parseWikibotInbound(body);
  if (parsed.kind === "unknown") {
    console.log(`[inbound wikibot] stored message_id="${messageId}"`);
    return NextResponse.json({ ok: true, stored: true, message_id: messageId });
  }

  if (parsed.kind === "portal_bosque") {
    console.log(
      `[inbound wikibot] stored Portal Bosque message_id="${messageId}" without Telegram alert`,
    );
    return NextResponse.json({
      ok: true,
      stored: true,
      message_id: messageId,
      kind: parsed.kind,
    });
  }

  const chatId = getAdminChatId();
  const token = getOpsBotToken();
  if (!chatId || !token) {
    console.error("[inbound wikibot] Telegram admin delivery is not configured");
    return NextResponse.json({ ok: false, error: "delivery unavailable" }, { status: 503 });
  }

  const sent = await sendTelegramMessage({
    chatId,
    token,
    text: "Llegó la verificación de reenvío de Gmail para wikibot@tero.bot.",
    disableWebPagePreview: true,
    inlineKeyboard: parsed.actionUrl
      ? [[{ text: "Verificar reenvío", url: parsed.actionUrl }]]
      : undefined,
  });

  if (!sent) {
    return NextResponse.json({ ok: false, error: "delivery failed" }, { status: 503 });
  }
  return NextResponse.json({ ok: true, stored: true, message_id: messageId, kind: parsed.kind });
}
