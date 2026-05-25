import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { WhatsAppDirection } from "@/lib/types";
import type { Locale } from "@/i18n/locales";

/**
 * Server-only helpers for the Kapso/WhatsApp integration. Persistence layer
 * for conversations + messages, and outbound message sending.
 */

const KAPSO_BASE = "https://api.kapso.ai/meta/whatsapp/v24.0";

/**
 * Normalize a phone number to a canonical E.164 "+<digits>" form for
 * exact-match comparison against what WhatsApp/Meta sends in webhooks.
 *
 * Strips non-digits, then handles country-specific trunk prefixes that
 * people commonly type but aren't actually part of the international
 * number:
 *
 *  - **Uruguay (+598)**: many people type `+598 099 123 456` (with the
 *    domestic trunk `0`). E.164 / WhatsApp uses `+598 99 123 456`. We
 *    strip the trunk `0`.
 *  - **Argentina (+54)**: WhatsApp specifically requires the mobile
 *    prefix `9` after the country code (`+54 9 11 ...`). If a number
 *    starts with `54` followed by `11` (Buenos Aires) or another known
 *    mobile area code without the `9`, we insert it. This is best-effort;
 *    landlines may share area codes so we restrict to common mobile
 *    lengths.
 *
 * Returns null for empty / whitespace-only inputs.
 */
export function normalizePhone(p: string | null | undefined): string | null {
  if (!p) return null;
  let digits = p.replace(/\D/g, "");
  if (!digits) return null;

  // Uruguay: strip trunk "0" between country code (598) and national number.
  // Pattern: 598 + 0 + 8-digit national mobile = 12 digits total.
  if (digits.length === 12 && digits.startsWith("598") && digits[3] === "0") {
    digits = digits.slice(0, 3) + digits.slice(4);
  }

  // Argentina: ensure the mobile "9" after country code 54 is present —
  // WhatsApp stores numbers as +54 9 <area> <line>. Without the 9, matches
  // against WA payloads fail.
  // Pattern: 54 + (10 digits not starting with 9) → insert 9 after 54.
  if (
    digits.length === 12 &&
    digits.startsWith("54") &&
    digits[2] !== "9"
  ) {
    digits = digits.slice(0, 2) + "9" + digits.slice(2);
  }

  return "+" + digits;
}

export type WhatsAppAudienceMatch = {
  audience: "guest" | "staff" | "unknown";
  profile_id: string | null;
  display_name: string | null;
};

/**
 * Try to identify a WhatsApp peer by phone number.
 *  - First check `profiles.whatsapp` → "staff" if match
 *  - Else check active reservations' `guest_phone` → "guest" if match
 *  - Else "unknown"
 *
 * Both stored and incoming phones are normalized before comparing.
 */
export async function matchAudience(
  phoneNumber: string,
): Promise<WhatsAppAudienceMatch> {
  const normalized = normalizePhone(phoneNumber);
  if (!normalized) {
    return { audience: "unknown", profile_id: null, display_name: null };
  }
  const admin = createAdminClient();

  // Staff lookup by exact match on normalized phone.
  const { data: profile } = await admin
    .from("profiles")
    .select("id, full_name")
    .eq("whatsapp", normalized)
    .maybeSingle();
  if (profile) {
    return {
      audience: "staff",
      profile_id: profile.id,
      display_name: profile.full_name,
    };
  }

  // Guest lookup: any reservation whose check_out hasn't passed yet.
  const today = new Date().toISOString().slice(0, 10);
  const { data: reservation } = await admin
    .from("reservations")
    .select("guest_name")
    .eq("guest_phone", normalized)
    .gte("check_out", today)
    .order("check_in", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (reservation) {
    return {
      audience: "guest",
      profile_id: null,
      display_name: reservation.guest_name,
    };
  }

  return { audience: "unknown", profile_id: null, display_name: null };
}

export type UpsertConversationInput = {
  phone_number: string;
  display_name?: string | null;
};

export async function upsertConversation(
  input: UpsertConversationInput,
): Promise<{ id: string; audience: WhatsAppAudienceMatch["audience"] }> {
  const admin = createAdminClient();
  const phone = normalizePhone(input.phone_number);
  if (!phone) {
    throw new Error(
      `upsertConversation: invalid phone "${input.phone_number}"`,
    );
  }

  const match = await matchAudience(phone);

  const { data: existing } = await admin
    .from("whatsapp_conversations")
    .select("id, audience")
    .eq("phone_number", phone)
    .maybeSingle();

  if (existing?.id) {
    // Refresh display_name + audience link if we now know more about the peer.
    const updates: Record<string, unknown> = {};
    if (input.display_name) updates.display_name = input.display_name;
    if (match.display_name && !input.display_name) {
      updates.display_name = match.display_name;
    }
    if (match.audience !== "unknown") {
      updates.audience = match.audience;
      if (match.profile_id) updates.profile_id = match.profile_id;
    }
    if (Object.keys(updates).length > 0) {
      await admin
        .from("whatsapp_conversations")
        .update(updates)
        .eq("id", existing.id);
    }
    return { id: existing.id, audience: match.audience };
  }

  const { data, error } = await admin
    .from("whatsapp_conversations")
    .insert({
      phone_number: phone,
      display_name: input.display_name ?? match.display_name ?? null,
      audience: match.audience,
      profile_id: match.profile_id,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(
      `upsertConversation failed: ${error?.message ?? "no data"}`,
    );
  }
  return { id: data.id, audience: match.audience };
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
 * Mark an inbound WhatsApp message as read AND show "escribiendo…" until
 * we send the actual reply (or ~25s timeout). Uses Meta's typing-indicator
 * extension (available in WhatsApp Cloud API since late 2024) which Kapso
 * passes through.
 *
 * Best-effort: if Kapso/Meta rejects the field, the call still marks the
 * message read and we continue. Errors are caught and logged by the caller.
 */
export async function sendTypingIndicator(
  phoneNumberId: string,
  incomingMessageId: string,
): Promise<void> {
  const apiKey = process.env.KAPSO_API_KEY;
  if (!apiKey) throw new Error("KAPSO_API_KEY is not set.");
  const url = `${KAPSO_BASE}/${phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      status: "read",
      message_id: incomingMessageId,
      typing_indicator: { type: "text" },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Typing indicator failed: HTTP ${res.status} ${text.slice(0, 200)}`,
    );
  }
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

/**
 * Send a pre-approved WhatsApp template (WIK-124). Templates are the only
 * way to message a user outside the 24-hour customer-service window — and
 * also the only way to message someone who has never written to us first.
 *
 * Variables must match the template's body in order ({{1}}, {{2}}, …).
 *
 * Returns the Kapso/WhatsApp message id on success. Throws on failure;
 * callers (e.g. the alarm-reminder cron) should wrap in try/catch and
 * decide whether to retry or move on.
 */
export async function sendKapsoTemplate(input: {
  phoneNumberId: string;
  to: string;
  templateName: string;
  languageCode: string;
  bodyVariables: string[];
}): Promise<{ messageId?: string; raw: unknown }> {
  const apiKey = process.env.KAPSO_API_KEY;
  if (!apiKey) {
    throw new Error("KAPSO_API_KEY is not set.");
  }
  const url = `${KAPSO_BASE}/${input.phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: input.to.replace(/^\+/, ""),
      type: "template",
      template: {
        name: input.templateName,
        language: { code: input.languageCode },
        components: [
          {
            type: "body",
            parameters: input.bodyVariables.map((text) => ({
              type: "text",
              text,
            })),
          },
        ],
      },
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
      `Kapso template send failed (${input.templateName}): HTTP ${res.status} ${responseText.slice(0, 300)}`,
    );
  }
  const messageId =
    (parsed as { messages?: { id?: string }[] })?.messages?.[0]?.id;
  return { messageId, raw: parsed };
}

/**
 * Locale-aware wrapper around `sendKapsoTemplate` (WIK-151 P5).
 *
 * Each template is registered with Meta as a `(name, language)` pair —
 * the EN and ES variants are independent records, each with its own
 * approval state. There's a 24-72h window after submission where the
 * EN variant is still PENDING / REJECTED while the ES one is APPROVED.
 *
 * To keep operational messages flowing during that window, this helper:
 *  1. Tries the recipient's preferred language (en/es).
 *  2. On any Meta/Kapso failure, retries with `"es"` (always approved
 *     since Meta first-pass) and logs that we fell back.
 *  3. If the fallback was already ES, just re-throws — the caller can
 *     decide whether to retry on a future cron tick.
 *
 * Callers should pass `preferredLanguage` from the recipient's
 * `profile.language` (coerced to `Locale`), defaulting to "en" when
 * absent. For guest recipients with no profile, "en" is the conservative
 * default once Meta approves the EN variants.
 */
export async function sendKapsoTemplateWithFallback(input: {
  phoneNumberId: string;
  to: string;
  templateName: string;
  preferredLanguage: Locale;
  bodyVariables: string[];
}): Promise<{
  messageId?: string;
  raw: unknown;
  languageUsed: Locale;
  fellBack: boolean;
}> {
  const { preferredLanguage, ...rest } = input;
  try {
    const result = await sendKapsoTemplate({
      ...rest,
      languageCode: preferredLanguage,
    });
    return { ...result, languageUsed: preferredLanguage, fellBack: false };
  } catch (err) {
    if (preferredLanguage === "es") {
      // No fallback available — propagate the original error.
      throw err;
    }
    const msg = (err as Error).message;
    console.warn(
      `[whatsapp] template "${input.templateName}" failed in ${preferredLanguage} (${msg.slice(0, 200)}). Falling back to es.`,
    );
    const result = await sendKapsoTemplate({
      ...rest,
      languageCode: "es",
    });
    return { ...result, languageUsed: "es", fellBack: true };
  }
}
