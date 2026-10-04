import { NextResponse } from "next/server";
import type { PostmarkInbound } from "@/lib/inbound/postmark";
import {
  getAdminChatId,
  getOpsBotToken,
  sendTelegramMessage,
} from "@/lib/telegram";
import { parseWikibotInbound } from "./parse-inbound";

export async function handleWikibotInbound(body: PostmarkInbound): Promise<NextResponse> {
  const parsed = parseWikibotInbound(body);
  if (parsed.kind === "unknown") {
    console.warn("[inbound wikibot] ignored unrecognized message");
    return NextResponse.json({ ok: true, ignored: true });
  }

  const chatId = getAdminChatId();
  const token = getOpsBotToken();
  if (!chatId || !token) {
    console.error("[inbound wikibot] Telegram admin delivery is not configured");
    return NextResponse.json({ ok: false, error: "delivery unavailable" }, { status: 503 });
  }

  const isPortal = parsed.kind === "portal_bosque";
  const sent = await sendTelegramMessage({
    chatId,
    token,
    text: isPortal
      ? "Llegó un correo de Portal Bosque para confirmar asistencia."
      : "Llegó la verificación de reenvío de Gmail para wikibot@tero.bot.",
    disableWebPagePreview: true,
    inlineKeyboard: parsed.actionUrl
      ? [[{ text: isPortal ? "Abrir Portal Bosque" : "Verificar reenvío", url: parsed.actionUrl }]]
      : undefined,
  });

  if (!sent) {
    return NextResponse.json({ ok: false, error: "delivery failed" }, { status: 503 });
  }
  return NextResponse.json({ ok: true, kind: parsed.kind });
}
