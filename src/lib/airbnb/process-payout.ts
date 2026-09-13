import type { SupabaseClient } from "@supabase/supabase-js";
import { isPayoutNotice, parsePayout, type AirbnbPayout } from "./parse-payout";
import type { PostmarkInbound } from "../inbound/postmark";
import { stripHtml } from "./parse-email";
export function payoutFromEmail(body: PostmarkInbound): AirbnbPayout | null {
  const text = body.TextBody ?? "";
  const html = stripHtml(body.HtmlBody ?? "");
  if (!isPayoutNotice([body.Subject, text, html].join("\n"))) return null;
  // Parse one representation only. A truncated text part can fall back to HTML.
  try { return parsePayout(text); } catch (error) {
    if (!html) throw error;
    return parsePayout(html);
  }
}
export async function recordPayout(admin: SupabaseClient, payout: AirbnbPayout, inboundId: string) {
  const { data, error } = await admin.rpc("record_airbnb_payout", { p: payout });
  if (error) throw new Error(error.message);
  const { error: auditError } = await admin.from("airbnb_inbound_emails").update({
    parsed_kind: "payout", parsed: payout,
  }).eq("id", inboundId);
  if (auditError) throw new Error(auditError.message);
  return data;
}
