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
import {
  buildBillBody,
  detectBillProvider,
  extractBillFields,
  parseBillEmail,
} from "@/lib/bills/parse-email";
import { extractPdfText } from "@/lib/bills/parse-pdf";
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

/** Per-attachment record returned by uploadAttachments. PDFs carry their
 *  extracted text so the handler can choose between single-bill (concat
 *  with email body) and multi-bill (one row per PDF) flows. */
type ProcessedAttachment = {
  path: string;
  name: string;
  isPdf: boolean;
  text: string | null;
};

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
): Promise<ProcessedAttachment[]> {
  if (!attachments?.length) return [];
  const processed: ProcessedAttachment[] = [];
  for (const att of attachments) {
    try {
      // Skip inline tracking pixels / tiny content.
      if (att.ContentLength != null && att.ContentLength < 200) continue;
      const safeName = att.Name.replace(/[^A-Za-z0-9._\-]/g, "_").slice(0, 80);
      const path = `${folder}/${safeName}`;
      const buf = Buffer.from(att.Content, "base64");
      const isPdf = /pdf$/i.test(att.ContentType ?? safeName);

      // Extract text BEFORE upload so a failed upload still lets us parse.
      // PDF parsing is best-effort; on error we just skip this attachment's
      // text and keep going.
      let text: string | null = null;
      if (isPdf) {
        text = await extractPdfText(buf);
        if (text) {
          console.log(
            `[inbound bills] extracted ${text.length} chars from ${att.Name}`,
          );
        }
      }

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
      processed.push({ path, name: att.Name, isPdf, text });
    } catch (err) {
      console.error("[inbound bills] attachment upload threw", err);
    }
  }
  return processed;
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

  // Process attachments first so we can hand the PDF text to the parser —
  // most utilities ship the actual amount/period/account inside the PDF,
  // not in the email body. The same regex landmarks work on both.
  const folder = `inbound/${new Date().toISOString().slice(0, 10)}/${randomUUID()}`;
  const processed = await uploadAttachments(
    admin,
    body.Attachments,
    folder,
  );
  const attachmentPaths = processed.map((p) => p.path);
  const pdfs = processed.filter((p) => p.isPdf);
  const combinedPdfText = pdfs
    .map((p) => (p.text ? `--- ${p.name} ---\n${p.text}` : ""))
    .filter(Boolean)
    .join("\n\n");

  // Alias-based override: if the email was forwarded to `luz@…` we trust
  // that utility_type even when the sender is e.g. a personal Gmail.
  const aliasUtility =
    recipientLocal && ALIAS_TO_UTILITY[recipientLocal]
      ? ALIAS_TO_UTILITY[recipientLocal]
      : null;

  // Branch: 0 or 1 PDFs → single-bill flow (combined-text parsing). 2+ PDFs
  // → multi-bill flow (each PDF becomes its own utility_bills row). Both
  // branches share the same inbound email row.
  const subject = body.Subject ?? "";
  const text = body.TextBody ?? "";
  const html = body.HtmlBody;

  if (pdfs.length >= 2) {
    return handleMultiPdfBatch({
      admin,
      messageId,
      rawBody: body,
      attachmentPaths,
      combinedPdfText,
      pdfs,
      fromEmail,
      fromName,
      subject,
      text,
      html,
      aliasUtility,
    });
  }

  // Single-bill flow (1 PDF or none).
  let parsed: ParsedBillEmail;
  try {
    parsed = parseBillEmail({
      fromEmail,
      fromName,
      subject,
      text,
      html,
      pdfText: combinedPdfText,
    });
  } catch (err) {
    console.error("[inbound bills] parse threw", err);
    parsed = {
      kind: "unknown",
      reason: `parse threw: ${(err as Error).message}`,
    };
  }
  if (aliasUtility && parsed.kind !== "unknown") {
    parsed.utility_type = aliasUtility;
  }

  const currencyHint = parsed.kind !== "unknown" ? parsed.currency : null;
  const property =
    parsed.kind !== "unknown" && parsed.property_id
      ? null /* explicit hint not implemented yet */
      : await resolveProperty(admin, currencyHint);

  const inboundRowId = await insertInboundRow(admin, {
    messageId,
    parsedKind: parsed.kind,
    providerHint: parsed.kind !== "unknown" ? parsed.provider : null,
    utilityTypeHint: parsed.kind !== "unknown" ? parsed.utility_type : null,
    propertyHint: property?.id ?? null,
    parsed,
    rawBody: body,
    attachmentPaths,
    pdfTextExtract: combinedPdfText || null,
  });

  if (parsed.kind === "unknown") {
    console.warn(`[inbound bills] unknown: ${parsed.reason}`);
    return NextResponse.json({ ok: true, kind: "unknown" });
  }
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

  const firstPdf = pdfs[0]?.path ?? null;
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

/**
 * Multi-PDF flow: when one email carries ≥2 PDF attachments (typical of a
 * manual historical-backfill — "acá te mando 7 facturas de Edenor"), we
 * create one utility_bills row per PDF instead of squashing them all into
 * one. Provider is detected once from the email envelope so every PDF
 * shares the same provider/currency.
 */
async function handleMultiPdfBatch(args: {
  admin: SupabaseClient;
  messageId: string | null;
  rawBody: PostmarkInbound;
  attachmentPaths: string[];
  combinedPdfText: string;
  pdfs: ProcessedAttachment[];
  fromEmail: string | null;
  fromName: string | null;
  subject: string;
  text: string;
  html: string | null | undefined;
  aliasUtility: UtilityType | null;
}): Promise<NextResponse> {
  const {
    admin,
    messageId,
    rawBody,
    attachmentPaths,
    combinedPdfText,
    pdfs,
    fromEmail,
    fromName,
    subject,
    text,
    html,
    aliasUtility,
  } = args;

  const envelopeBody = buildBillBody(text, html, combinedPdfText, subject);
  const rule = detectBillProvider(fromEmail, fromName, subject, envelopeBody);

  if (!rule) {
    const parsed: ParsedBillEmail = {
      kind: "unknown",
      reason: `multi-pdf: provider not recognized (from="${fromEmail ?? "?"}", subject="${subject.slice(0, 60)}")`,
    };
    await insertInboundRow(admin, {
      messageId,
      parsedKind: "unknown",
      providerHint: null,
      utilityTypeHint: null,
      propertyHint: null,
      parsed,
      rawBody,
      attachmentPaths,
      pdfTextExtract: combinedPdfText || null,
    });
    console.warn(`[inbound bills] multi-pdf unknown: ${parsed.reason}`);
    return NextResponse.json({ ok: true, kind: "unknown", multi: true });
  }

  const utility_type = aliasUtility ?? rule.utility_type;
  const property = await resolveProperty(admin, rule.currency);

  // Parse each PDF independently — every PDF becomes its own bill.
  const perPdfParsed: ParsedBillEmail[] = pdfs.map((pdf) => {
    const body = buildBillBody("", null, pdf.text ?? "", subject);
    const parsed = extractBillFields(rule, body, subject);
    if (parsed.kind !== "unknown") parsed.utility_type = utility_type;
    return parsed;
  });

  const allMatched = perPdfParsed.every((p) => p.kind === "matched");
  const aggregateKind: "matched" | "partial" = allMatched ? "matched" : "partial";

  const inboundRowId = await insertInboundRow(admin, {
    messageId,
    parsedKind: aggregateKind,
    providerHint: rule.provider,
    utilityTypeHint: utility_type,
    propertyHint: property?.id ?? null,
    parsed: { multi: true, perPdf: perPdfParsed },
    rawBody,
    attachmentPaths,
    pdfTextExtract: combinedPdfText || null,
  });

  if (!property) {
    console.warn(
      `[inbound bills] multi-pdf: no property match for ${rule.provider}/${rule.currency} — leaving orphan inbound row`,
    );
    return NextResponse.json({
      ok: true,
      kind: aggregateKind,
      multi: true,
      orphan: true,
      provider: rule.provider,
    });
  }

  // Insert one utility_bills row per PDF.
  const billIds: string[] = [];
  for (let i = 0; i < pdfs.length; i++) {
    const pdf = pdfs[i];
    const parsed = perPdfParsed[i];
    if (parsed.kind === "unknown") continue; // shouldn't happen — rule is set
    const { data: billRow, error: billErr } = await admin
      .from("utility_bills")
      .insert({
        property_id: property.id,
        utility_type: utility_type,
        provider: rule.provider,
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
        pdf_path: pdf.path,
        status: "pending",
      })
      .select("id")
      .single();
    if (billErr) {
      console.error(
        `[inbound bills] multi-pdf insert failed for ${pdf.name}:`,
        billErr.message,
      );
      continue;
    }
    if (billRow?.id) billIds.push(billRow.id);
  }

  console.log(
    `[inbound bills] multi-pdf: created ${billIds.length}/${pdfs.length} bills for ${rule.provider} → ${property.name}`,
  );
  return NextResponse.json({
    ok: true,
    kind: aggregateKind,
    multi: true,
    bill_ids: billIds,
    provider: rule.provider,
    property: property.name,
  });
}

async function insertInboundRow(
  admin: SupabaseClient,
  args: {
    messageId: string | null;
    parsedKind: string;
    providerHint: string | null;
    utilityTypeHint: string | null;
    propertyHint: string | null;
    parsed: unknown;
    rawBody: PostmarkInbound;
    attachmentPaths: string[];
    pdfTextExtract: string | null;
  },
): Promise<string | null> {
  try {
    const { data, error } = await admin
      .from("bill_inbound_emails")
      .insert({
        message_id: args.messageId,
        parsed_kind: args.parsedKind,
        provider_hint: args.providerHint,
        utility_type_hint: args.utilityTypeHint,
        property_hint: args.propertyHint,
        parsed: args.parsed,
        raw: args.rawBody,
        attachment_paths: args.attachmentPaths,
        pdf_text_extract: args.pdfTextExtract,
      })
      .select("id")
      .single();
    if (error) {
      console.error("[inbound bills] persist failed", error.message);
      return null;
    }
    return data?.id ?? null;
  } catch (err) {
    console.error("[inbound bills] persist threw", err);
    return null;
  }
}
