import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Webhook receiver for Kapso (BSP wrapper around Meta WhatsApp Cloud API).
 *
 * Migrated from example (public site) on 2026-05-01 — the public
 * site shouldn't host server-side integrations. From here we'll evolve this
 * into a proper inbox + outbound messaging from the admin panel; for now it
 * preserves the existing auto-reply behavior to avoid breaking production
 * once the Kapso webhook URL is repointed to this app.
 *
 * Configure on Kapso side: set webhook URL to
 *   https://example-admin.vercel.app/api/whatsapp
 * with secret == KAPSO_WEBHOOK_SECRET env var.
 */

const REPLY_TEXT = "Hola, como andás? Que te gustaría saber?";

/**
 * HMAC-SHA256 over the raw body, using the Kapso webhook secret.
 * timingSafeEqual to avoid timing attacks.
 */
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

/**
 * Send a text message via the Kapso API.
 * Doesn't throw — errors are logged and swallowed so the webhook always 200s.
 */
async function sendKapsoText(
  phoneNumberId: string,
  to: string,
  text: string,
): Promise<void> {
  const apiKey = process.env.KAPSO_API_KEY;
  if (!apiKey) {
    console.warn("[kapso reply] KAPSO_API_KEY not set — skipping send");
    return;
  }

  const url = `https://api.kapso.ai/meta/whatsapp/v24.0/${phoneNumberId}/messages`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text },
      }),
    });
    const responseText = await res.text();
    if (!res.ok) {
      console.error("[kapso reply] failed", {
        status: res.status,
        body: responseText,
      });
      return;
    }
    console.log("[kapso reply] sent", { to, status: res.status });
  } catch (err) {
    console.error("[kapso reply] error", err);
  }
}

type KapsoMessageEvent = {
  message?: {
    from?: string;
    type?: string;
    kapso?: { direction?: string };
  };
  phone_number_id?: string;
};

type KapsoWebhookBody = {
  type?: string;
  data?: KapsoMessageEvent[];
};

export async function POST(req: NextRequest) {
  const meta = {
    event: req.headers.get("x-webhook-event"),
    signature: req.headers.get("x-webhook-signature"),
    idempotencyKey: req.headers.get("x-idempotency-key"),
    batch: req.headers.get("x-webhook-batch"),
    batchSize: req.headers.get("x-batch-size"),
  };

  // Raw body needed for byte-exact signature validation.
  const rawBody = await req.text();

  // --- Signature validation ---
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

  // Parse body for logging/routing.
  let body: KapsoWebhookBody | string;
  try {
    body = JSON.parse(rawBody) as KapsoWebhookBody;
  } catch {
    body = rawBody;
  }

  console.log("[kapso webhook]", JSON.stringify({ meta, body }, null, 2));

  // --- Auto-reply (preserved from public-site implementation) ---
  // Only reply to inbound text messages. Redundant filters on event header
  // AND direction to avoid auto-replying to our own outbound echoes.
  if (
    meta.event === "whatsapp.message.received" &&
    typeof body === "object" &&
    Array.isArray(body.data)
  ) {
    const replies = body.data
      .filter(
        (evt) =>
          !!evt?.message?.from &&
          !!evt?.phone_number_id &&
          evt?.message?.type === "text" &&
          evt?.message?.kapso?.direction === "inbound",
      )
      .map((evt) =>
        sendKapsoText(evt.phone_number_id!, evt.message!.from!, REPLY_TEXT),
      );

    // allSettled so one failure doesn't block the rest of the batch.
    await Promise.allSettled(replies);
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
