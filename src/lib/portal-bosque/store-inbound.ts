import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  extractRecipient,
  type PostmarkInbound,
} from "@/lib/inbound/postmark";

export function wikibotMessageId(body: PostmarkInbound) {
  if (body.MessageID?.trim()) return body.MessageID.trim();

  const stablePayload = JSON.stringify({
    from: body.FromFull?.Email ?? body.From ?? "",
    to: extractRecipient(body),
    subject: body.Subject ?? "",
    text: body.TextBody ?? "",
    html: body.HtmlBody ?? "",
  });
  return `sha256:${createHash("sha256").update(stablePayload).digest("hex")}`;
}

export function wikibotInboundRow(body: PostmarkInbound) {
  return {
    message_id: wikibotMessageId(body),
    from_email: body.FromFull?.Email ?? body.From ?? null,
    from_name: body.FromFull?.Name ?? null,
    to_email: extractRecipient(body) || null,
    subject: body.Subject ?? null,
    text_body: body.TextBody ?? body.StrippedTextReply ?? null,
    html_body: body.HtmlBody ?? null,
    headers: body.Headers ?? [],
    attachment_metadata: (body.Attachments ?? []).map((attachment) => ({
      name: attachment.Name,
      content_type: attachment.ContentType,
      content_length: attachment.ContentLength,
      content_id: attachment.ContentID ?? null,
    })),
  };
}

export async function storeWikibotInbound(
  admin: SupabaseClient,
  body: PostmarkInbound,
) {
  const row = wikibotInboundRow(body);
  const { error } = await admin
    .from("wikibot_inbound_emails")
    .upsert(row, { onConflict: "message_id", ignoreDuplicates: true });

  if (error) throw new Error(`Could not store wikibot inbound email: ${error.message}`);
  return row.message_id;
}
