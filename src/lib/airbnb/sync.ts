import "server-only";
import { createHash } from "node:crypto";
import ICAL from "ical.js";
import { parseAvailability } from "@/lib/availability/core";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateCodeForReservation } from "@/lib/tuya/auto-code";

export type SyncResult = {
  property_id: string;
  fetched: number;
  reservations: number;
  blocks: number;
  codes_generated: number;
  cleaning_tasks_created: number;
  errors: string[];
};

/**
 * Fetch and parse an Airbnb iCal feed for a property and upsert reservations
 * into the database. Idempotent: re-running the same feed produces no new
 * rows and only updates dates that changed.
 *
 * Notes about Airbnb's iCal:
 *  - DTEND is the exclusive end (Airbnb checkout date itself).
 *  - SUMMARY is "Reserved" for real bookings, "Airbnb (Not available)" or
 *    "Not available" for manual blocks.
 *  - No guest PII is exposed — only dates + UID + a reservation code in
 *    DESCRIPTION (e.g. "Reservation URL: .../HMABC123").
 */
async function syncAirbnbInternal(
  propertyId: string,
  icalUrl: string,
): Promise<SyncResult> {
  const result: SyncResult = {
    property_id: propertyId,
    fetched: 0,
    reservations: 0,
    blocks: 0,
    codes_generated: 0,
    cleaning_tasks_created: 0,
    errors: [],
  };

  let ics: string;
  try {
    const res = await fetch(icalUrl, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    ics = await res.text();
  } catch (e) {
    throw new Error(`Fetching iCal failed: ${(e as Error).message}`);
  }

  let comp: ICAL.Component;
  try {
    comp = new ICAL.Component(ICAL.parse(ics));
  } catch (e) {
    throw new Error(`Parsing iCal failed: ${(e as Error).message}`);
  }

  const snapshot = parseAvailability(ics);
  const vevents = comp.getAllSubcomponents("vevent");
  result.fetched = vevents.length;

  const admin = createAdminClient();
  const reservations: Array<{uid:string; check_in:string; check_out:string; notes:string|null; reservation_code:string|null}> = [];
  const snapshotByUid = new Map(snapshot.map((event) => [event.uid, event]));

  for (const vevent of vevents) {
    try {
      const event = new ICAL.Event(vevent);
      const summary = event.summary ?? "";
      const uid = event.uid;
      if (!uid) continue;
      const snapshotEvent = snapshotByUid.get(uid);
      if (!snapshotEvent || snapshotEvent.kind !== "reservation") continue;

      // Skip manual blocks — they aren't reservations.
      if (
        /not\s*available|airbnb\s*\(not\s*available\)|^block/i.test(summary)
      ) {
        result.blocks++;
        continue;
      }
      // Only handle entries that look like reservations.
      if (!/reserv/i.test(summary)) {
        continue;
      }

      const checkIn = snapshotEvent.start_date;
      const checkOut = snapshotEvent.end_date;

      const description = event.description ?? "";
      // HM code regex stays loose — Airbnb has used HM*, HMS*, HMP*.
      const codeMatch = description.match(/\bH[A-Z0-9]{6,12}\b/);
      const reservationCode = codeMatch?.[0] ?? null;
      const notes = reservationCode
        ? `Airbnb reservation: ${reservationCode}`
        : null;

      reservations.push({ uid, check_in: checkIn, check_out: checkOut, notes, reservation_code: reservationCode });
      result.reservations++;

    } catch (e) {
      result.errors.push((e as Error).message);
    }
  }

  if (result.errors.length) throw new Error("Incomplete calendar sync");
  const { data: committed, error: snapshotError } = await admin.rpc("reconcile_airbnb_import", { p_property: propertyId, p_reservations: reservations, p_events: snapshot, p_source_hash: createHash("sha256").update(icalUrl).digest("hex") });
  if (snapshotError) throw new Error(`Availability reconciliation failed: ${snapshotError.message}`);
  const today = new Date().toISOString().slice(0, 10);
  for (const row of (committed ?? []) as Array<{uid:string; id:string; check_out:string}>) {
    const item = reservations.find((r) => r.uid === row.uid);
    if (!item || row.check_out < today) continue;
    try {
        const code = await generateCodeForReservation(row.id);
        if (code.ok && !code.already_existed) result.codes_generated++;
        if (!code.ok && code.reason_code !== "no_primary_lock" && code.reason_code !== "already_expired") result.errors.push(`code:${item.uid}: ${code.reason}`);
      } catch (e) { result.errors.push(`code:${item.uid}: ${(e as Error).message}`); }
      try {
        if (await ensureCheckoutCleaningTask(admin, propertyId, row.check_out)) result.cleaning_tasks_created++;
      } catch (e) { result.errors.push(`task:${item.uid}: ${(e as Error).message}`); }
  }
  return result;
}

export async function syncAirbnb(propertyId: string, icalUrl: string): Promise<SyncResult> {
  try { return await syncAirbnbInternal(propertyId, icalUrl); }
  catch (error) {
    const { error: stateError } = await createAdminClient().from("availability_sync").upsert({ property_id: propertyId, failed: true }, { onConflict: "property_id" });
    if (stateError) console.error("availability.sync.state_failed");
    throw error;
  }
}

/**
 * Ensure a "Limpieza post-checkout" task exists for the given property and
 * check-out date. Idempotent: returns false if one already exists.
 */
async function ensureCheckoutCleaningTask(
  admin: ReturnType<typeof createAdminClient>,
  propertyId: string,
  checkOut: string,
): Promise<boolean> {
  const { data: existing, error: existErr } = await admin
    .from("tasks")
    .select("id")
    .eq("property_id", propertyId)
    .eq("kind", "limpieza")
    .eq("due_date", checkOut)
    .limit(1);
  if (existErr) throw new Error(existErr.message);
  if (existing && existing.length > 0) return false;

  const { error } = await admin.from("tasks").insert({
    property_id: propertyId,
    kind: "limpieza",
    title: "Limpieza post-checkout",
    description: "Generada automáticamente al sincronizar la reserva.",
    due_date: checkOut,
    status: "pending",
  });
  if (error) throw new Error(error.message);
  return true;
}
