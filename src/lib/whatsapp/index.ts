import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { WhatsAppDirection } from "@/lib/types";

/**
 * Server-only helpers for the Kapso/WhatsApp integration. Persistence layer
 * for conversations + messages, and outbound message sending.
 */

const KAPSO_BASE = "https://api.kapso.ai/meta/whatsapp/v24.0";

/** Normalize a phone number to E.164-ish ("+5491234..."). */
function normalizePhone(p: string): string {
  const trimmed = p.trim();
  return trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
}

export type UpsertConversationInput = {
  phone_number: string;
  display_name?: string | null;
};

export async function upsertConversation(
  input: UpsertConversationInput,
): Promise<{ id: string }> {
  const admin = createAdminClient();
  const phone = normalizePhone(input.phone_number);

  const { data: existing } = await admin
    .from("whatsapp_conversations")
    .select("id")
    .eq("phone_number", phone)
    .maybeSingle();

  if (existing?.id) {
    if (input.display_name) {
      await admin
        .from("whatsapp_conversations")
        .update({ display_name: input.display_name })
        .eq("id", existing.id)
        .is("display_name", null);
    }
    return { id: existing.id };
  }

  const { data, error } = await admin
    .from("whatsapp_conversations")
    .insert({
      phone_number: phone,
      display_name: input.display_name ?? null,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(
      `upsertConversation failed: ${error?.message ?? "no data"}`,
    );
  }
  return { id: data.id };
}

export type PersistMessageInput = {
  conversation_id: string;
  external_id?: string | null;
  direction: WhatsAppDirection;
  type?: string;
  body?: string | null;
  media_url?: string | null;
  template_name?: string | null;
  status?: string | null;
  raw?: unknown;
};

export async function persistMessage(input: PersistMessageInput) {
  const admin = createAdminClient();

  // Idempotency: dedup by external_id when present.
  if (input.external_id) {
    const { data: existing } = await admin
      .from("whatsapp_messages")
      .select("id")
      .eq("external_id", input.external_id)
      .maybeSingle();
    if (existing?.id) return { id: existing.id, deduped: true };
  }

  const { data, error } = await admin
    .from("whatsapp_messages")
    .insert({
      conversation_id: input.conversation_id,
      external_id: input.external_id ?? null,
      direction: input.direction,
      type: input.type ?? "text",
      body: input.body ?? null,
      media_url: input.media_url ?? null,
      template_name: input.template_name ?? null,
      status: input.status ?? null,
      raw: input.raw ?? null,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`persistMessage failed: ${error?.message ?? "no data"}`);
  }

  // Update conversation summary fields.
  const updates: Record<string, unknown> = {
    last_message_at: new Date().toISOString(),
    last_message_text: input.body ?? `(${input.type ?? "media"})`,
    last_message_direction: input.direction,
    updated_at: new Date().toISOString(),
  };
  if (input.direction === "inbound") {
    // Bump unread count atomically via RPC-less workaround.
    const { data: convo } = await admin
      .from("whatsapp_conversations")
      .select("unread_count")
      .eq("id", input.conversation_id)
      .single();
    updates.unread_count = (convo?.unread_count ?? 0) + 1;
  }
  await admin
    .from("whatsapp_conversations")
    .update(updates)
    .eq("id", input.conversation_id);

  return { id: data.id, deduped: false };
}

export async function markConversationRead(conversationId: string) {
  const admin = createAdminClient();
  await admin
    .from("whatsapp_conversations")
    .update({ unread_count: 0, updated_at: new Date().toISOString() })
    .eq("id", conversationId);
}

/**
 * Send a free-form text message via Kapso. Only valid within the 24-hour
 * customer-service window after the user's last inbound message — outside
 * that window, WhatsApp requires a pre-approved template.
 *
 * Returns the Kapso/WhatsApp message id on success.
 */
export async function sendKapsoText(
  phoneNumberId: string,
  to: string,
  text: string,
): Promise<{ messageId?: string; raw: unknown }> {
  const apiKey = process.env.KAPSO_API_KEY;
  if (!apiKey) {
    throw new Error("KAPSO_API_KEY is not set.");
  }
  const url = `${KAPSO_BASE}/${phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: to.replace(/^\+/, ""),
      type: "text",
      text: { body: text },
    }),
  });
  const responseText = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    parsed = responseText;
  }
  if (!res.ok) {
    throw new Error(
      `Kapso send failed: HTTP ${res.status} ${responseText.slice(0, 300)}`,
    );
  }
  const messageId =
    (parsed as { messages?: { id?: string }[] })?.messages?.[0]?.id;
  return { messageId, raw: parsed };
}
