/**
 * Utility-bill inbound handler. Triggered from `/api/inbound` (the router)
 * when the Postmark webhook delivers an email addressed to one of the bill
 * aliases (`bills@`, `luz@`, `agua@`, `internet@`, `alarma@`).
 *
 * Behavior:
 *   1. Idempotency: dedup by `MessageID` against `bill_inbound_emails`.
 *   2. Parse via `parseBillEmail`. Provider is identified by sender
 *      domain; the rest of the fields are best-effort (most utilities
 *      ship the actual numbers inside the PDF attachment).
 *   3. Persist every attachment to Storage (`bill-attachments` bucket)
 *      so the admin can open the PDF from /facturas, even when the
 *      parser couldn't extract anything useful.
 *   4. Resolve property by parsed currency → properties.currency single
 *      match (works for the current 1-UY + 1-AR setup; extend with
 *      explicit account-number columns when we have collisions).
 *   5. Create a `utility_bills` row whenever we have at least a property
 *      + provider, even if amount is null — the admin completes the gap.
 *
 * Always returns 200 to Postmark. Errors are logged but acked so we can
 * replay from the stored raw payload.
 */

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { parseBillEmail } from "@/lib/bills/parse-email";
import type {
  ParsedBillEmail,
  Property,
  UtilityType,
} from "@/lib/types";
import type {
  PostmarkInbound,
  PostmarkAttachment,
} from "@/lib/inbound/postmark";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Which Postmark `To` aliases route to this handler. The router uses
 *  this same set to decide dispatch. Centralized here so adding a new
 *  alias is a one-line change. */
export const BILL_ROUTE_ALIASES = new Set<string>([
  "bills",
  "facturas",
  "factura",
  "luz",
  "agua",
  "internet",
  "alarma",
]);

/** If the alias itself hints at a utility type (e.g. `luz@…`), we trust
 *  it over what we detected from the sender domain. Useful when the email
 *  is forwarded manually and the sender doesn't match a known provider. */
const ALIAS_TO_UTILITY: Record<string, UtilityType> = {
  luz: "luz",
  agua: "agua",
  internet: "internet",
  alarma: "alarma",
};

async function uploadAttachments(
  admin: SupabaseClient,
  attachments: PostmarkAttachment[] | undefined,
  folder: string,
): Promise<{ paths: string[]; firstPdf: string | null }> {
  if (!attachments?.length) return { paths: [], firstPdf: null };
  const paths: string[] = [];
  let firstPdf: string | null = null;
  for (const att of attachments) {
    try {
      // Skip inline tracking pixels / tiny content.
      if (att.ContentLength != null && att.ContentLength < 200) continue;
      const safeName = att.Name.replace(/[^A-Za-z0-9._\-]/g, "_").slice(0, 80);
      const path = `${folder}/${safeName}`;
      const buf = Buffer.from(att.Content, "base64");
      const { error } = await admin.storage
        .from("bill-attachments")
        .upload(path, buf, {
          contentType: att.ContentType || "application/octet-stream",
          upsert: true,
        });
      if (error) {
        console.error(
          `[inbound bills] attachment upload failed (${safeName}):`,
          error.message,
        );
        continue;
      }
      paths.push(path);
      if (!firstPdf && /pdf$/i.test(att.ContentType ?? safeName)) {
        firstPdf = path;
      }
    } catch (err) {
      console.error("[inbound bills] attachment upload threw", err);
    }
  }
  return { paths, firstPdf };
}

async function resolveProperty(
  admin: SupabaseClient,
  currencyHint: string | null,
): Promise<Pick<Property, "id" | "name"> | null> {
  if (!currencyHint) return null;
  const { data } = await admin
    .from("properties")
    .select("id, name, currency")
    .eq("currency", currencyHint);
  const rows = (data ?? []) as Array<
    Pick<Property, "id" | "name"> & { currency: string }
  >;
  if (rows.length === 1) return rows[0];
  return null;
}

export async function handleBillInbound(
  body: PostmarkInbound,
  admin: SupabaseClient,
  recipientLocal: string | null,
): Promise<NextResponse> {
  const messageId = body.MessageID ?? null;

  if (messageId) {
    const { data: existing } = await admin
      .from("bill_inbound_emails")
      .select("id")
      .eq("message_id", messageId)
      .maybeSingle();
    if (existing) {
      console.log(`[inbound bills] dedup: ${messageId} already processed`);
      return NextResponse.json({ ok: true, deduped: true });
    }
  }

  const fromEmail = (body.FromFull?.Email ?? body.From ?? null)
    ?.toLowerCase()
    ?.match(/<([^>]+)>|([^\s<>]+@[^\s<>]+)/)?.[0]
    ?.replace(/[<>]/g, "")
    ?.trim() ?? null;
  const fromName = body.FromFull?.Name ?? null;

  let parsed: ParsedBillEmail;
  try {
    parsed = parseBillEmail({
      fromEmail,
      fromName,
      subject: body.Subject ?? "",
      text: body.TextBody ?? "",
      html: body.HtmlBody,
    });
  } catch (err) {
    console.error("[inbound bills] parse threw", err);
    parsed = {
      kind: "unknown",
      reason: `parse threw: ${(err as Error).message}`,
    };
  }

  // Alias-based override: if the email was forwarded to `luz@…` we trust
  // that utility_type even when the sender is e.g. a personal Gmail.
  const aliasUtility =
    recipientLocal && ALIAS_TO_UTILITY[recipientLocal]
      ? ALIAS_TO_UTILITY[recipientLocal]
      : null;
  if (aliasUtility && parsed.kind !== "unknown") {
    parsed.utility_type = aliasUtility;
  }

  // Upload attachments first so the inbound row references them.
  const folder = `inbound/${new Date().toISOString().slice(0, 10)}/${randomUUID()}`;
  const { paths: attachmentPaths, firstPdf } = await uploadAttachments(
    admin,
    body.Attachments,
    folder,
  );

  // Resolve property by currency (MVP heuristic: 1 property per currency).
  const currencyHint =
    parsed.kind !== "unknown" ? parsed.currency : null;
  const property =
    parsed.kind !== "unknown" && parsed.property_id
      ? null /* explicit hint not implemented yet */
      : await resolveProperty(admin, currencyHint);

  let inboundRowId: string | null = null;
  try {
    const { data, error } = await admin
      .from("bill_inbound_emails")
      .insert({
        message_id: messageId,
        parsed_kind: parsed.kind,
        provider_hint:
          parsed.kind !== "unknown" ? parsed.provider : null,
        utility_type_hint:
          parsed.kind !== "unknown" ? parsed.utility_type : null,
        property_hint: property?.id ?? null,
        parsed,
        raw: body,
        attachment_paths: attachmentPaths,
      })
      .select("id")
      .single();
    if (error) {
      console.error("[inbound bills] persist failed", error.message);
    } else {
      inboundRowId = data?.id ?? null;
    }
  } catch (err) {
    console.error("[inbound bills] persist threw", err);
  }

  if (parsed.kind === "unknown") {
    console.warn(`[inbound bills] unknown: ${parsed.reason}`);
    return NextResponse.json({ ok: true, kind: "unknown" });
  }

  // Create the bill row even with partial data — admin completes manually
  // in /facturas. We only skip if we can't pin a property (otherwise the
  // row would be orphaned and invisible in the UI).
  if (!property) {
    console.warn(
      `[inbound bills] no property match for currency ${parsed.currency} — leaving orphan inbound row`,
    );
    return NextResponse.json({
      ok: true,
      kind: parsed.kind,
      orphan: true,
      provider: parsed.provider,
    });
  }

  const { data: billRow, error: billErr } = await admin
    .from("utility_bills")
    .insert({
      property_id: property.id,
      utility_type: parsed.utility_type,
      provider: parsed.provider,
      amount: parsed.amount,
      currency: parsed.currency,
      period_from: parsed.period_from,
      period_to: parsed.period_to,
      issue_date: parsed.issue_date,
      due_date: parsed.due_date,
      kwh_billed: parsed.kwh_billed,
      m3_billed: parsed.m3_billed,
      account_number: parsed.account_number,
      invoice_number: parsed.invoice_number,
      inbound_email_id: inboundRowId,
      pdf_path: firstPdf,
      status: "pending",
    })
    .select("id")
    .single();
  if (billErr) {
    console.error("[inbound bills] insert utility_bills failed:", billErr.message);
    return NextResponse.json({ ok: true, kind: parsed.kind, error: billErr.message });
  }

  console.log(
    `[inbound bills] created ${parsed.provider}/${parsed.utility_type} → ${property.name} (kind=${parsed.kind})`,
  );
  return NextResponse.json({
    ok: true,
    kind: parsed.kind,
    bill_id: billRow?.id ?? null,
    provider: parsed.provider,
    property: property.name,
  });
}
