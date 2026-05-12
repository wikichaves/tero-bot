import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseAirbnbEmail } from "@/lib/airbnb/parse-email";
import type { ParsedAirbnbEmail, Property } from "@/lib/types";

/**
 * Inbound email webhook for Postmark Inbound. Receives parsed Airbnb
 * confirmation / modification / cancellation emails (Gmail filter forwards
 * `from:airbnb.com` to `airbnb@inbound.example.com`, MX of that
 * subdomain points at Postmark).
 *
 * Behavior:
 *   1. Basic Auth check (Postmark posts with `Authorization: Basic …`).
 *   2. Idempotency: dedup by `MessageID` against `airbnb_inbound_emails`.
 *   3. Parse with regex. On `kind="unknown"` we still store it (for debug)
 *      and return 200 so Postmark doesn't retry.
 *   4. Match property by `listing_name` (fuzzy substring) → if ambiguous,
 *      leave `property_id` null.
 *   5. Match reservation by `reservation_code`. If missing, create a
 *      placeholder so the iCal sync can later rewrite its `external_id`.
 *   6. Update fields with `coalesce(parsed, existing)` so we don't clobber
 *      values an admin already typed by hand.
 *   7. On cancellation: status='cancelled', delete pending cleaning task
 *      for the checkout date (skip if in_progress/done), revoke any active
 *      lock_passwords for that reservation.
 *
 * Always returns 200 to Postmark unless the request itself is malformed
 * (no auth, no JSON). Errors during processing are logged but acked, since
 * Postmark retries don't fix parser bugs and we have raw in DB for replay.
 */

type PostmarkInbound = {
  MessageID?: string;
  Subject?: string;
  TextBody?: string;
  HtmlBody?: string;
  StrippedTextReply?: string;
  From?: string;
  To?: string;
};

function verifyBasicAuth(header: string | null): boolean {
  const user = process.env.POSTMARK_INBOUND_USER;
  const password = process.env.POSTMARK_INBOUND_PASSWORD;
  if (!user || !password) {
    console.warn(
      "[inbound airbnb] POSTMARK_INBOUND_USER/PASSWORD not set — refusing all",
    );
    return false;
  }
  if (!header?.startsWith("Basic ")) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  } catch {
    return false;
  }
  const expected = `${user}:${password}`;
  const a = Buffer.from(decoded);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Fuzzy-match a property by listing name. Returns the property if exactly
 * one matches, null if none, undefined if ambiguous (caller leaves null
 * and logs).
 */
function matchProperty(
  listingName: string | null,
  properties: Pick<Property, "id" | "name">[],
): Pick<Property, "id" | "name"> | null | undefined {
  if (properties.length === 1) return properties[0];
  if (!listingName) return undefined;
  const needle = listingName.toLowerCase();
  // Exact substring first.
  const exact = properties.filter((p) =>
    needle.includes(p.name.toLowerCase()),
  );
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return undefined;
  // Word-level fallback (any ≥4-char word in common).
  const words = properties.map((p) => ({
    p,
    words: p.name.toLowerCase().split(/[\s,.\-]+/).filter((w) => w.length >= 4),
  }));
  const hits = words.filter((x) => x.words.some((w) => needle.includes(w)));
  if (hits.length === 1) return hits[0].p;
  return undefined;
}

export async function POST(req: NextRequest) {
  if (!verifyBasicAuth(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: PostmarkInbound;
  try {
    body = (await req.json()) as PostmarkInbound;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const admin = createAdminClient();
  const messageId = body.MessageID ?? null;

  // Idempotency check: same MessageID = already processed.
  if (messageId) {
    const { data: existing } = await admin
      .from("airbnb_inbound_emails")
      .select("id")
      .eq("message_id", messageId)
      .maybeSingle();
    if (existing) {
      console.log(
        `[inbound airbnb] dedup: ${messageId} already processed`,
      );
      return NextResponse.json({ ok: true, deduped: true });
    }
  }

  let parsed: ParsedAirbnbEmail;
  try {
    parsed = parseAirbnbEmail({
      subject: body.Subject ?? "",
      text: body.TextBody ?? "",
      html: body.HtmlBody,
    });
  } catch (err) {
    console.error("[inbound airbnb] parse threw", err);
    parsed = { kind: "unknown", reason: `parse threw: ${(err as Error).message}` };
  }

  // Always persist (raw + parsed) for debug, even on `unknown`.
  let inboundRowId: string | null = null;
  try {
    const { data, error } = await admin
      .from("airbnb_inbound_emails")
      .insert({
        message_id: messageId,
        parsed_kind: parsed.kind,
        parsed,
        raw: body,
      })
      .select("id")
      .single();
    if (error) {
      console.error("[inbound airbnb] persist failed", error.message);
    } else {
      inboundRowId = data?.id ?? null;
    }
  } catch (err) {
    console.error("[inbound airbnb] persist threw", err);
  }

  if (parsed.kind === "unknown") {
    console.warn(`[inbound airbnb] unknown: ${parsed.reason}`);
    return NextResponse.json({ ok: true, kind: "unknown" });
  }

  // Resolve property: first by airbnb_listing_id (most reliable — set by
  // admin in /admin/properties), then by fuzzy listing name match.
  const { data: propsRows } = await admin
    .from("properties")
    .select("id, name, airbnb_listing_id")
    .order("name");
  const propsAll = (propsRows ?? []) as Array<
    Pick<Property, "id" | "name"> & { airbnb_listing_id: string | null }
  >;
  let propertyHit: Pick<Property, "id" | "name"> | null | undefined;
  if (parsed.airbnb_listing_id) {
    const byId = propsAll.find(
      (p) => p.airbnb_listing_id === parsed.airbnb_listing_id,
    );
    if (byId) {
      propertyHit = byId;
      console.log(
        `[inbound airbnb] matched property by listing_id ${parsed.airbnb_listing_id} → ${byId.name}`,
      );
    }
  }
  if (!propertyHit) {
    propertyHit = matchProperty(parsed.listing_name, propsAll);
  }
  if (propertyHit === undefined) {
    console.warn(
      `[inbound airbnb] ambiguous property for "${parsed.listing_name}" (no listing_id match either)`,
    );
  }

  // Look up the reservation by HM code (across all properties).
  const code = parsed.reservation_code;
  const { data: existingReservation } = await admin
    .from("reservations")
    .select("*")
    .eq("source", "airbnb")
    .eq("reservation_code", code)
    .maybeSingle();

  if (parsed.kind === "cancellation") {
    if (!existingReservation) {
      console.warn(
        `[inbound airbnb] cancellation for unknown code ${code} — nothing to mark`,
      );
      return NextResponse.json({ ok: true, kind: "cancellation", noop: true });
    }
    await admin
      .from("reservations")
      .update({ status: "cancelled" })
      .eq("id", existingReservation.id);

    // Delete the pending cleaning task for this checkout (skip if it's
    // already in progress or done — staff may have started it).
    await admin
      .from("tasks")
      .delete()
      .eq("property_id", existingReservation.property_id)
      .eq("kind", "limpieza")
      .eq("due_date", existingReservation.check_out)
      .eq("status", "pending");

    // Revoke active Tuya lock codes tied to this reservation. We just mark
    // them as revoked in the DB; Tuya revoke is a separate call that can
    // be implemented later (best-effort).
    await admin
      .from("lock_passwords")
      .update({ status: "revoked" })
      .eq("reservation_id", existingReservation.id)
      .eq("status", "active");

    // Link the inbound row to the reservation for traceability.
    if (inboundRowId) {
      await admin
        .from("airbnb_inbound_emails")
        .update({ reservation_id: existingReservation.id })
        .eq("id", inboundRowId);
    }
    console.log(`[inbound airbnb] cancelled ${code}`);
    return NextResponse.json({ ok: true, kind: "cancellation" });
  }

  // Confirmation or modification: enrich (or create placeholder).
  const fields: Record<string, unknown> = {
    reservation_code: code,
  };
  if (parsed.guest_first_name && !existingReservation?.guest_name) {
    fields.guest_name = parsed.guest_first_name;
  }
  if (parsed.guest_count != null) fields.guest_count = parsed.guest_count;
  if (parsed.guest_adults != null) fields.guest_adults = parsed.guest_adults;
  if (parsed.guest_children != null)
    fields.guest_children = parsed.guest_children;
  if (parsed.guest_infants != null)
    fields.guest_infants = parsed.guest_infants;
  if (parsed.guest_identity_verified != null)
    fields.guest_identity_verified = parsed.guest_identity_verified;
  if (parsed.guest_location) fields.guest_location = parsed.guest_location;
  if (parsed.payout_amount != null) fields.payout_amount = parsed.payout_amount;
  if (parsed.payout_currency) fields.payout_currency = parsed.payout_currency;
  if (parsed.guest_message) fields.guest_message = parsed.guest_message;
  if (parsed.guest_photo_url) fields.guest_photo_url = parsed.guest_photo_url;
  if (parsed.check_in_time && !existingReservation?.check_in_time)
    fields.check_in_time = parsed.check_in_time;
  if (parsed.check_out_time && !existingReservation?.check_out_time)
    fields.check_out_time = parsed.check_out_time;
  if (parsed.kind === "modification") fields.status = "altered";

  let reservationId: string | null = existingReservation?.id ?? null;
  if (existingReservation) {
    await admin
      .from("reservations")
      .update(fields)
      .eq("id", existingReservation.id);
  } else if (propertyHit && parsed.check_in && parsed.check_out) {
    // Email arrived before iCal sync — create a placeholder. external_id is
    // temporarily set to the HM code; the iCal sync rewrites it to the
    // proper UID later (see `src/lib/airbnb.ts` race-fix logic). We only
    // create the placeholder when we have both dates; otherwise the iCal
    // sync (hourly) will pick it up first and the next email will enrich.
    const { data, error } = await admin
      .from("reservations")
      .insert({
        property_id: propertyHit.id,
        source: "airbnb",
        external_id: code,
        check_in: parsed.check_in,
        check_out: parsed.check_out,
        ...fields,
      })
      .select("id")
      .single();
    if (error) {
      console.error(
        `[inbound airbnb] placeholder insert failed for ${code}: ${error.message}`,
      );
    } else {
      reservationId = data?.id ?? null;
      console.log(`[inbound airbnb] placeholder created for ${code}`);
    }
  } else {
    console.warn(
      `[inbound airbnb] no existing reservation; ${propertyHit ? "missing dates" : "no property match"} — leaving orphan inbound row ${code}`,
    );
  }

  if (inboundRowId && reservationId) {
    await admin
      .from("airbnb_inbound_emails")
      .update({ reservation_id: reservationId })
      .eq("id", inboundRowId);
  }

  return NextResponse.json({
    ok: true,
    kind: parsed.kind,
    reservation_id: reservationId,
  });
}
