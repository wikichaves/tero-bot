import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  persistMessage,
  sendKapsoText,
  upsertConversation,
} from "@/lib/whatsapp";

/**
 * Webhook receiver for Kapso (BSP wrapper around Meta WhatsApp Cloud API).
 *
 * Configure on Kapso side: set webhook URL to
 *   https://admin.example.com/api/whatsapp
 * with secret == KAPSO_WEBHOOK_SECRET env var.
 *
 * Behavior:
 *   1. Verify HMAC-SHA256 signature.
 *   2. For each event in the batch: upsert the conversation, persist the
 *      message (idempotent by external_id), record outbound delivery status.
 *   3. For inbound text messages: auto-reply (legacy behavior preserved
 *      while we build the inbox; will be replaced/disabled later).
 *   4. Always 200 if signature valid (so Kapso doesn't retry endlessly).
 */

const REPLY_TEXT = "Hola, como andás? Que te gustaría saber?";

function verifySignature(
  rawBody: string,
  signature: string,
  secret: string,
): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  let a: Buffer;
  let b: Buffer;
  try {
    a = Buffer.from(expected, "hex");
    b = Buffer.from(signature, "hex");
  } catch {
    return false;
  }
  return a.length === b.length && timingSafeEqual(a, b);
}

type KapsoTextContent = { body?: string };

type KapsoMessage = {
  id?: string;
  from?: string;
  to?: string;
  type?: string;
  text?: KapsoTextContent;
  image?: { link?: string; caption?: string };
  audio?: { link?: string };
  video?: { link?: string };
  timestamp?: string | number;
  kapso?: { direction?: "inbound" | "outbound" };
};

type KapsoStatus = {
  id?: string;
  status?: string; // sent | delivered | read | failed
  recipient_id?: string;
};

type KapsoContact = {
  wa_id?: string;
  profile?: { name?: string };
};

type KapsoEvent = {
  message?: KapsoMessage;
  status?: KapsoStatus;
  contacts?: KapsoContact[];
  phone_number_id?: string;
};

type KapsoWebhookBody = {
  type?: string;
  data?: KapsoEvent[];
};

function extractBody(message: KapsoMessage): string | null {
  if (message.type === "text") return message.text?.body ?? null;
  if (message.type === "image") return message.image?.caption ?? null;
  return null;
}

function extractMediaUrl(message: KapsoMessage): string | null {
  return (
    message.image?.link ??
    message.audio?.link ??
    message.video?.link ??
    null
  );
}

async function processEvent(event: KapsoEvent, eventType: string | null) {
  const phoneNumberId = event.phone_number_id;
  const message = event.message;

  // --- Inbound message ---
  if (
    eventType === "whatsapp.message.received" &&
    message?.from &&
    message?.kapso?.direction === "inbound"
  ) {
    const peer = message.from;
    const displayName = event.contacts?.[0]?.profile?.name ?? null;
    const { id: conversationId } = await upsertConversation({
      phone_number: peer,
      display_name: displayName,
    });
    await persistMessage({
      conversation_id: conversationId,
      external_id: message.id ?? null,
      direction: "inbound",
      type: message.type ?? "text",
      body: extractBody(message),
      media_url: extractMediaUrl(message),
      raw: event,
    });
    return { conversationId, peer, phoneNumberId, message };
  }

  // --- Outbound delivery status updates ---
  if (event.status?.id) {
    // Update existing message row's status if we have it.
    // (We don't necessarily have it if the outbound was sent from outside
    // this app; ignore silently in that case.)
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const admin = createAdminClient();
    await admin
      .from("whatsapp_messages")
      .update({ status: event.status.status ?? null })
      .eq("external_id", event.status.id);
  }

  return null;
}

async function autoReply(opts: {
  phoneNumberId: string;
  peer: string;
  conversationId: string;
}) {
  try {
    const { messageId } = await sendKapsoText(
      opts.phoneNumberId,
      opts.peer,
      REPLY_TEXT,
    );
    await persistMessage({
      conversation_id: opts.conversationId,
      external_id: messageId ?? null,
      direction: "outbound",
      type: "text",
      body: REPLY_TEXT,
      status: "sent",
    });
  } catch (err) {
    console.error("[kapso autoReply] error", err);
  }
}

export async function POST(req: NextRequest) {
  const meta = {
    event: req.headers.get("x-webhook-event"),
    signature: req.headers.get("x-webhook-signature"),
    idempotencyKey: req.headers.get("x-idempotency-key"),
    batch: req.headers.get("x-webhook-batch"),
    batchSize: req.headers.get("x-batch-size"),
  };

  const rawBody = await req.text();

  // Signature validation.
  const secret = process.env.KAPSO_WEBHOOK_SECRET;
  if (secret) {
    if (!meta.signature) {
      console.warn("[kapso webhook] missing X-Webhook-Signature header");
      return NextResponse.json(
        { error: "missing signature" },
        { status: 401 },
      );
    }
    if (!verifySignature(rawBody, meta.signature, secret)) {
      console.warn("[kapso webhook] invalid signature", {
        idempotencyKey: meta.idempotencyKey,
      });
      return NextResponse.json(
        { error: "invalid signature" },
        { status: 401 },
      );
    }
  } else {
    console.warn(
      "[kapso webhook] KAPSO_WEBHOOK_SECRET not set — skipping signature verification",
    );
  }

  let body: KapsoWebhookBody | string;
  try {
    body = JSON.parse(rawBody) as KapsoWebhookBody;
  } catch {
    body = rawBody;
  }

  if (typeof body !== "object" || !Array.isArray(body.data)) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // Process events; collect inbound text events so we can auto-reply once
  // the persistence is committed.
  const replyTargets: Array<{
    phoneNumberId: string;
    peer: string;
    conversationId: string;
  }> = [];

  await Promise.allSettled(
    body.data.map(async (event) => {
      try {
        const result = await processEvent(event, meta.event);
        if (
          result &&
          result.message?.type === "text" &&
          result.phoneNumberId
        ) {
          replyTargets.push({
            phoneNumberId: result.phoneNumberId,
            peer: result.peer,
            conversationId: result.conversationId,
          });
        }
      } catch (err) {
        console.error("[kapso webhook] processEvent error", err);
      }
    }),
  );

  // Fire-and-forget auto-replies.
  await Promise.allSettled(replyTargets.map(autoReply));

  return NextResponse.json({ ok: true }, { status: 200 });
}
