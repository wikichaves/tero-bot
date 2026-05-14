/**
 * Airbnb inbound-email handler. Extracted from the original webhook so it
 * can be shared between the legacy `/api/inbound/airbnb` route and the
 * new `/api/inbound` router (which dispatches by `To` field).
 *
 * Behavior (unchanged from the legacy route):
 *   1. Idempotency: dedup by `MessageID` against `airbnb_inbound_emails`.
 *   2. Parse with regex. On `kind="unknown"` we still store it (for debug).
 *   3. Match property by `airbnb_listing_id` (preferred) or fuzzy
 *      `listing_name` substring.
 *   4. Match reservation by `reservation_code`. If missing, create a
 *      placeholder so the iCal sync can later rewrite its `external_id`.
 *   5. Update fields with `coalesce(parsed, existing)` so we don't clobber
 *      values an admin already typed by hand.
 *   6. On cancellation: status='cancelled', delete pending cleaning task
 *      for the checkout date (skip if in_progress/done), revoke any active
 *      lock_passwords for that reservation.
 *
 * Always resolves to a NextResponse with 200 unless the request itself is
 * malformed. Errors during processing are logged but acked, since Postmark
 * retries don't fix parser bugs and we have raw in DB for replay.
 */

import { NextResponse } from "next/server";
import { parseAirbnbEmail } from "@/lib/airbnb/parse-email";
import type { ParsedAirbnbEmail, Property } from "@/lib/types";
import type { PostmarkInbound } from "@/lib/inbound/postmark";
import type { SupabaseClient } from "@supabase/supabase-js";

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
  const exact = properties.filter((p) =>
    needle.includes(p.name.toLowerCase()),
  );
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return undefined;
  const words = properties.map((p) => ({
    p,
    words: p.name
      .toLowerCase()
      .split(/[\s,.\-]+/)
      .filter((w) => w.length >= 4),
  }));
  const hits = words.filter((x) => x.words.some((w) => needle.includes(w)));
  if (hits.length === 1) return hits[0].p;
  return undefined;
}

export async function handleAirbnbInbound(
  body: PostmarkInbound,
  admin: SupabaseClient,
): Promise<NextResponse> {
  const messageId = body.MessageID ?? null;

  // Idempotency check.
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
    parsed = {
      kind: "unknown",
      reason: `parse threw: ${(err as Error).message}`,
    };
  }

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
      return NextResponse.json({
        ok: true,
        kind: "cancellation",
        noop: true,
      });
    }
    await admin
      .from("reservations")
      .update({ status: "cancelled" })
      .eq("id", existingReservation.id);

    await admin
      .from("tasks")
      .delete()
      .eq("property_id", existingReservation.property_id)
      .eq("kind", "limpieza")
      .eq("due_date", existingReservation.check_out)
      .eq("status", "pending");

    await admin
      .from("lock_passwords")
      .update({ status: "revoked" })
      .eq("reservation_id", existingReservation.id)
      .eq("status", "active");

    if (inboundRowId) {
      await admin
        .from("airbnb_inbound_emails")
        .update({ reservation_id: existingReservation.id })
        .eq("id", inboundRowId);
    }
    console.log(`[inbound airbnb] cancelled ${code}`);
    return NextResponse.json({ ok: true, kind: "cancellation" });
  }

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
