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
 *      so the admin can open the PDF from /bills, even when the
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

  // Process every attachment in parallel: pdf-parse + storage upload happen
  // concurrently. For 7 PDFs this drops total time from ~7×N seconds to
  // about max(N) seconds, well inside Postmark's 10s webhook deadline.
  const tasks = attachments.map(async (att): Promise<ProcessedAttachment | null> => {
    try {
      if (att.ContentLength != null && att.ContentLength < 200) return null;
      const safeName = att.Name.replace(/[^A-Za-z0-9._\-]/g, "_").slice(0, 80);
      const path = `${folder}/${safeName}`;
      const buf = Buffer.from(att.Content, "base64");
      const isPdf = /pdf$/i.test(att.ContentType ?? safeName);

      const [text, uploadRes] = await Promise.all([
        isPdf ? extractPdfText(buf) : Promise.resolve(null),
        admin.storage
          .from("bill-attachments")
          .upload(path, buf, {
            contentType: att.ContentType || "application/octet-stream",
            upsert: true,
          }),
      ]);

      if (uploadRes.error) {
        console.error(
          `[inbound bills] attachment upload failed (${safeName}):`,
          uploadRes.error.message,
        );
        return null;
      }
      if (isPdf && text) {
        console.log(
          `[inbound bills] extracted ${text.length} chars from ${att.Name}`,
        );
      }
      return { path, name: att.Name, isPdf, text };
    } catch (err) {
      console.error("[inbound bills] attachment processing threw", err);
      return null;
    }
  });

  const results = await Promise.all(tasks);
  return results.filter((r): r is ProcessedAttachment => r !== null);
}

/**
 * Smart upsert for utility_bills. Looks for an existing row matching
 * (property_id, provider, period_to) — if found, MERGE the new parsed
 * fields with the existing ones (prefer new non-null values, keep
 * existing values when the new parse returned null). If not found,
 * insert a new row.
 *
 * Dedup is keyed on period_to only because that's the most stable
 * single-field identifier of "which billing cycle is this". Without
 * period_to (e.g. a partial parse from a notification email), we let
 * the row through and the admin can merge / delete by hand if needed.
 */
type BillInsertFields = {
  property_id: string;
  utility_type: UtilityType;
  provider: string;
  amount: number | null;
  currency: string | null;
  period_from: string | null;
  period_to: string | null;
  issue_date: string | null;
  due_date: string | null;
  kwh_billed: number | null;
  m3_billed: number | null;
  account_number: string | null;
  invoice_number: string | null;
  inbound_email_id: string | null;
  pdf_path: string | null;
};

async function upsertBill(
  admin: SupabaseClient,
  fields: BillInsertFields,
): Promise<{
  id: string | null;
  action: "inserted" | "updated" | "error";
  error?: string;
}> {
  if (fields.period_to) {
    const { data: existing } = await admin
      .from("utility_bills")
      .select(
        "id, amount, currency, period_from, issue_date, due_date, kwh_billed, m3_billed, account_number, invoice_number, pdf_path",
      )
      .eq("property_id", fields.property_id)
      .eq("provider", fields.provider)
      .eq("period_to", fields.period_to)
      .maybeSingle();
    if (existing) {
      // Coalesce-style merge: new value wins when present, existing
      // value wins when the new parse returned null. The inbound_email_id
      // is overwritten to the latest one so traceability stays current.
      const merged = {
        amount: fields.amount ?? existing.amount,
        currency: fields.currency ?? existing.currency,
        period_from: fields.period_from ?? existing.period_from,
        issue_date: fields.issue_date ?? existing.issue_date,
        due_date: fields.due_date ?? existing.due_date,
        kwh_billed: fields.kwh_billed ?? existing.kwh_billed,
        m3_billed: fields.m3_billed ?? existing.m3_billed,
        account_number: fields.account_number ?? existing.account_number,
        invoice_number: fields.invoice_number ?? existing.invoice_number,
        pdf_path: fields.pdf_path ?? existing.pdf_path,
        inbound_email_id: fields.inbound_email_id,
      };
      const { error } = await admin
        .from("utility_bills")
        .update(merged)
        .eq("id", existing.id);
      if (error) {
        return { id: existing.id, action: "error", error: error.message };
      }
      return { id: existing.id, action: "updated" };
    }
  }
  const { data, error } = await admin
    .from("utility_bills")
    .insert({ ...fields, status: "pending" })
    .select("id")
    .single();
  if (error) return { id: null, action: "error", error: error.message };
  return { id: data?.id ?? null, action: "inserted" };
}

/**
 * Resolve which property a bill belongs to. Two-stage match:
 *
 *   1. **By provider+account_number** (preferred). Each property carries a
 *      `provider_accounts` jsonb mapping `{"UTE": "4131911000", ...}`. When
 *      we know the account number from the parsed PDF, we can do an exact
 *      unique match — works even when many properties share a currency.
 *   2. **By currency** (fallback). When account_number is missing or no
 *      property has it registered, fall back to the legacy heuristic: if
 *      exactly one property exists for this currency, use it.
 *
 * Returns null when neither stage can disambiguate (orphan bill — admin
 * has to assign manually or fill in the missing `provider_accounts`).
 */
async function resolveProperty(
  admin: SupabaseClient,
  currencyHint: string | null,
  provider: string | null,
  accountNumber: string | null,
): Promise<Pick<Property, "id" | "name"> | null> {
  if (provider && accountNumber) {
    // jsonb `?` operator + ->> for value match. Filter syntax in
    // PostgREST: `provider_accounts->>UTE=eq.4131911000`.
    // When multiple properties share the same account (e.g. Casa Frente
    // and Casa Fondo share one UTE meter), we deterministically pick the
    // one with the LOWEST sort_order — the admin can put the "primary"
    // unit first in /admin/properties.
    const { data } = await admin
      .from("properties")
      .select("id, name, sort_order")
      .filter(`provider_accounts->>${provider}`, "eq", accountNumber)
      .order("sort_order", { ascending: true });
    const rows = (data ?? []) as Array<Pick<Property, "id" | "name">>;
    if (rows.length >= 1) {
      if (rows.length > 1) {
        console.log(
          `[inbound bills] ${rows.length} properties share ${provider} account=${accountNumber}; using lowest sort_order → ${rows[0].name}`,
        );
      } else {
        console.log(
          `[inbound bills] matched property by ${provider} account=${accountNumber} → ${rows[0].name}`,
        );
      }
      return rows[0];
    }
  }
  if (!currencyHint) return null;
  const { data } = await admin
    .from("properties")
    .select("id, name, currency, sort_order")
    .eq("currency", currencyHint)
    .order("sort_order", { ascending: true });
  const rows = (data ?? []) as Array<
    Pick<Property, "id" | "name"> & { currency: string }
  >;
  if (rows.length === 1) return rows[0];
  if (rows.length > 1) {
    // Currency-only fallback stays strict (returns null) — we don't want
    // to silently route an unmatched bill to a random property. The fix
    // is to fill in provider_accounts in /admin/properties.
    console.warn(
      `[inbound bills] ${rows.length} properties share currency ${currencyHint} — set provider_accounts to disambiguate`,
    );
  }
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
  const providerHint = parsed.kind !== "unknown" ? parsed.provider : null;
  const accountHint = parsed.kind !== "unknown" ? parsed.account_number : null;
  const property =
    parsed.kind !== "unknown" && parsed.property_id
      ? null /* explicit hint not implemented yet */
      : await resolveProperty(admin, currencyHint, providerHint, accountHint);

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
  const upsertResult = await upsertBill(admin, {
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
  });
  if (upsertResult.action === "error") {
    console.error("[inbound bills] upsert utility_bills failed:", upsertResult.error);
    return NextResponse.json({ ok: true, kind: parsed.kind, error: upsertResult.error });
  }

  console.log(
    `[inbound bills] ${upsertResult.action} ${parsed.provider}/${parsed.utility_type} → ${property.name} (kind=${parsed.kind})`,
  );
  return NextResponse.json({
    ok: true,
    kind: parsed.kind,
    bill_id: upsertResult.id,
    action: upsertResult.action,
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

  // Parse each PDF independently — every PDF becomes its own bill.
  const perPdfParsed: ParsedBillEmail[] = pdfs.map((pdf) => {
    const body = buildBillBody("", null, pdf.text ?? "", subject);
    const parsed = extractBillFields(rule, body, subject);
    if (parsed.kind !== "unknown") parsed.utility_type = utility_type;
    return parsed;
  });

  // Resolve property per-PDF using its own account number. Falls back to
  // currency-only match when account is missing. Each PDF could in theory
  // belong to a different property (multi-account batch); we don't assume
  // they share one.
  const perPdfProperty: Array<Pick<Property, "id" | "name"> | null> =
    await Promise.all(
      perPdfParsed.map((p) => {
        if (p.kind === "unknown") return Promise.resolve(null);
        return resolveProperty(admin, p.currency, p.provider, p.account_number);
      }),
    );

  // Surface the most-common property as the inbound row's "property_hint"
  // for traceability. When all PDFs resolve to the same property it's the
  // only one; mixed-property batches just pick the first.
  const inboundPropertyHint =
    perPdfProperty.find((p) => p !== null)?.id ?? null;

  const allMatched = perPdfParsed.every((p) => p.kind === "matched");
  const aggregateKind: "matched" | "partial" = allMatched ? "matched" : "partial";

  const inboundRowId = await insertInboundRow(admin, {
    messageId,
    parsedKind: aggregateKind,
    providerHint: rule.provider,
    utilityTypeHint: utility_type,
    propertyHint: inboundPropertyHint,
    parsed: { multi: true, perPdf: perPdfParsed },
    rawBody,
    attachmentPaths,
    pdfTextExtract: combinedPdfText || null,
  });

  // Upsert one utility_bills row per PDF. The dedup is keyed on
  // (property, provider, period_to) so reforwards / partial re-sends
  // merge into the existing row instead of duplicating.
  const billIds: string[] = [];
  let inserted = 0;
  let updated = 0;
  let skippedNoProperty = 0;
  for (let i = 0; i < pdfs.length; i++) {
    const pdf = pdfs[i];
    const parsed = perPdfParsed[i];
    const property = perPdfProperty[i];
    if (parsed.kind === "unknown") continue; // shouldn't happen — rule is set
    if (!property) {
      skippedNoProperty++;
      console.warn(
        `[inbound bills] multi-pdf: no property match for PDF ${pdf.name} (account=${parsed.account_number ?? "—"})`,
      );
      continue;
    }
    const upsertResult = await upsertBill(admin, {
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
    });
    if (upsertResult.action === "error") {
      console.error(
        `[inbound bills] multi-pdf upsert failed for ${pdf.name}:`,
        upsertResult.error,
      );
      continue;
    }
    if (upsertResult.action === "inserted") inserted++;
    if (upsertResult.action === "updated") updated++;
    if (upsertResult.id) billIds.push(upsertResult.id);
  }

  // Surface the property summary: when all PDFs land on the same property
  // we name it; otherwise just count the unique destinations.
  const propertyNames = Array.from(
    new Set(perPdfProperty.filter((p) => p).map((p) => p!.name)),
  );
  const propertySummary =
    propertyNames.length === 1
      ? propertyNames[0]
      : propertyNames.length > 1
        ? `${propertyNames.length} properties`
        : "no property";

  console.log(
    `[inbound bills] multi-pdf: ${inserted} inserted + ${updated} updated + ${skippedNoProperty} skipped (no property) of ${pdfs.length} PDFs for ${rule.provider} → ${propertySummary}`,
  );
  return NextResponse.json({
    ok: true,
    kind: aggregateKind,
    multi: true,
    bill_ids: billIds,
    inserted,
    updated,
    skipped_no_property: skippedNoProperty,
    provider: rule.provider,
    property: propertySummary,
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
