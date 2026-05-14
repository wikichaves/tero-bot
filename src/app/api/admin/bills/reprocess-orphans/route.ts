import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ParsedBillEmail, UtilityType } from "@/lib/types";

/**
 * Admin-only reprocess endpoint: walks `bill_inbound_emails` rows that
 * never landed in `utility_bills` (orphans), re-runs the property
 * resolution using the now-populated `properties.provider_accounts`,
 * and creates the missing `utility_bills` rows.
 *
 * Use case: after WIK-65, the user fills in provider accounts on each
 * property in /admin/properties. The historical orphan inbounds — UTE
 * bills that never matched because 5 properties shared currency=UYU —
 * can be retroactively created without re-forwarding the emails.
 *
 * POST /api/admin/bills/reprocess-orphans
 *   body: {} (optional)
 *
 * Returns a per-inbound report with what happened. Idempotent — running
 * twice does the right thing because `upsertBill` dedups by
 * (property_id, provider, period_to). Inbounds whose `parsed_kind` was
 * `unknown` are skipped (no provider info to act on).
 */
export const maxDuration = 60;

type InboundRow = {
  id: string;
  parsed_kind: string | null;
  provider_hint: string | null;
  utility_type_hint: string | null;
  property_hint: string | null;
  attachment_paths: string[] | null;
  parsed: unknown;
};

export async function POST() {
  await requireRole(["admin"]);
  const admin = createAdminClient();

  // Find inbounds without a property_hint that have a usable parsed
  // payload. We don't filter by parsed_kind=unknown because matched
  // inbounds with no property_hint are exactly the orphans we want
  // to retry.
  const { data: orphans, error } = await admin
    .from("bill_inbound_emails")
    .select(
      "id, parsed_kind, provider_hint, utility_type_hint, property_hint, attachment_paths, parsed",
    )
    .is("property_hint", null)
    .neq("parsed_kind", "unknown")
    .order("received_at", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const list = (orphans ?? []) as InboundRow[];

  const results: Array<{
    inbound_id: string;
    inserted: number;
    updated: number;
    skipped: number;
    notes: string[];
  }> = [];

  for (const inbound of list) {
    const report = {
      inbound_id: inbound.id,
      inserted: 0,
      updated: 0,
      skipped: 0,
      notes: [] as string[],
    };
    const parsed = inbound.parsed as
      | (ParsedBillEmail & { multi?: undefined })
      | { multi: true; perPdf: ParsedBillEmail[] }
      | null;
    if (!parsed) {
      report.notes.push("no parsed payload");
      report.skipped++;
      results.push(report);
      continue;
    }

    const attachmentPaths = (inbound.attachment_paths ?? []) as string[];
    const pdfPaths = attachmentPaths.filter((p) => /\.pdf$/i.test(p));

    // Normalize to a list of (parsed, pdf_path) entries to process.
    const entries: Array<{
      parsed: Extract<ParsedBillEmail, { kind: "matched" | "partial" }>;
      pdfPath: string | null;
    }> = [];
    if ("multi" in parsed && parsed.multi) {
      for (let i = 0; i < parsed.perPdf.length; i++) {
        const p = parsed.perPdf[i];
        if (p.kind === "unknown") continue;
        entries.push({ parsed: p, pdfPath: pdfPaths[i] ?? null });
      }
    } else if (parsed.kind !== "unknown") {
      entries.push({ parsed, pdfPath: pdfPaths[0] ?? null });
    }

    if (entries.length === 0) {
      report.notes.push("no usable parsed entries");
      report.skipped++;
      results.push(report);
      continue;
    }

    for (const { parsed: p, pdfPath } of entries) {
      const property = await resolveProperty(admin, p);
      if (!property) {
        report.notes.push(
          `${p.provider}/${p.account_number ?? "—"}: still no property match`,
        );
        report.skipped++;
        continue;
      }

      const action = await upsertBill(admin, {
        property_id: property.id,
        utility_type: p.utility_type as UtilityType,
        provider: p.provider,
        amount: p.amount,
        currency: p.currency,
        period_from: p.period_from,
        period_to: p.period_to,
        issue_date: p.issue_date,
        due_date: p.due_date,
        kwh_billed: p.kwh_billed,
        m3_billed: p.m3_billed,
        account_number: p.account_number,
        invoice_number: p.invoice_number,
        inbound_email_id: inbound.id,
        pdf_path: pdfPath,
      });
      if (action === "inserted") report.inserted++;
      else if (action === "updated") report.updated++;
      else report.skipped++;
    }

    // If we created any bill, link the inbound row to the first property
    // we resolved (best-effort traceability for the activity log).
    if (report.inserted + report.updated > 0) {
      const firstMatch = await resolveProperty(admin, entries[0].parsed);
      if (firstMatch) {
        await admin
          .from("bill_inbound_emails")
          .update({ property_hint: firstMatch.id })
          .eq("id", inbound.id);
      }
    }
    results.push(report);
  }

  const summary = {
    inbounds_checked: list.length,
    bills_inserted: results.reduce((s, r) => s + r.inserted, 0),
    bills_updated: results.reduce((s, r) => s + r.updated, 0),
    bills_skipped: results.reduce((s, r) => s + r.skipped, 0),
  };
  console.log("[bills/reprocess-orphans]", summary);
  return NextResponse.json({ ok: true, summary, results });
}

// ---- helpers (mirror handle-inbound.ts so this endpoint stands alone) ----

async function resolveProperty(
  admin: ReturnType<typeof createAdminClient>,
  parsed: Extract<ParsedBillEmail, { kind: "matched" | "partial" }>,
): Promise<{ id: string; name: string } | null> {
  // Account-based first.
  if (parsed.provider && parsed.account_number) {
    const { data } = await admin
      .from("properties")
      .select("id, name")
      .filter(
        `provider_accounts->>${parsed.provider}`,
        "eq",
        parsed.account_number,
      );
    const rows = (data ?? []) as Array<{ id: string; name: string }>;
    if (rows.length === 1) return rows[0];
  }
  // Currency fallback.
  if (parsed.currency) {
    const { data } = await admin
      .from("properties")
      .select("id, name, currency")
      .eq("currency", parsed.currency);
    const rows = (data ?? []) as Array<{ id: string; name: string }>;
    if (rows.length === 1) return rows[0];
  }
  return null;
}

async function upsertBill(
  admin: ReturnType<typeof createAdminClient>,
  fields: {
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
  },
): Promise<"inserted" | "updated" | "error"> {
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
      return error ? "error" : "updated";
    }
  }
  const { error } = await admin
    .from("utility_bills")
    .insert({ ...fields, status: "pending" });
  return error ? "error" : "inserted";
}
