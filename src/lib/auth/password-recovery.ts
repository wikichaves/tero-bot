import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { APP_URL } from "@/lib/brand";

/** Called only by the signature-verified WhatsApp webhook, never a browser action.
 * Sender identity is the envelope's phone, not a phone typed into a form/message.
 * Returns a bearer secret: callers must not persist or log this URL.
 */
export async function createWhatsAppRecoveryLink(input: {
  phone: string; conversationId: string; messageId: string;
}): Promise<string | null> {
  const admin = createAdminClient();
  // Atomic unique external_id claim: webhook retries cannot mint another token.
  const { error: claimError } = await admin.from("whatsapp_messages").insert({
    conversation_id: input.conversationId,
    external_id: `password-recovery:${input.messageId}`,
    direction: "outbound", type: "text", status: "pending",
    body: "[Password recovery request — link omitted]",
    template_name: "password_recovery",
  });
  if (claimError?.code === "23505") return null;
  if (claimError) throw new Error("Recovery claim unavailable");

  // Durable, per authenticated WhatsApp sender; fail closed if counting fails.
  const { count, error: countError } = await admin.from("whatsapp_messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", input.conversationId)
    .eq("template_name", "password_recovery")
    .gte("sent_at", new Date(Date.now() - 10 * 60_000).toISOString());
  if (countError || count === null) throw new Error("Recovery limit unavailable");
  if (count > 3) return null;

  const { data: profile, error } = await admin.from("profiles").select("id")
    .eq("whatsapp", input.phone).maybeSingle();
  if (error) throw new Error("Recovery profile unavailable");
  if (!profile) return null;
  const { data: user, error: userError } = await admin.auth.admin.getUserById(profile.id);
  if (userError || !user.user?.email) return null;
  // Works with the internal @phone.tero.local identity too; generateLink sends no email.
  const { data, error: linkError } = await admin.auth.admin.generateLink({
    type: "recovery", email: user.user.email,
  });
  if (linkError || !data.properties?.hashed_token) throw new Error("Recovery link unavailable");
  // Fragment keeps the token out of HTTP URLs, access logs and referrers.
  return `${APP_URL}/auth/reset-password#token=${data.properties.hashed_token}`;
}
