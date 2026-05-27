import "server-only";
import ICAL from "ical.js";
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
export async function syncAirbnb(
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

  const vevents = comp.getAllSubcomponents("vevent");
  result.fetched = vevents.length;

  const admin = createAdminClient();

  for (const vevent of vevents) {
    try {
      const event = new ICAL.Event(vevent);
      const summary = event.summary ?? "";
      const uid = event.uid;
      if (!uid) continue;

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

      const checkIn = toIsoDate(event.startDate.toJSDate());
      const checkOut = toIsoDate(event.endDate.toJSDate());

      const description = event.description ?? "";
      // HM code regex stays loose — Airbnb has used HM*, HMS*, HMP*.
      const codeMatch = description.match(/\bH[A-Z0-9]{6,12}\b/);
      const reservationCode = codeMatch?.[0] ?? null;
      const notes = reservationCode
        ? `Airbnb reservation: ${reservationCode}`
        : null;

      // Race fix: if the inbound-email webhook (Postmark) created a
      // placeholder row using the HM code as external_id, rewrite that
      // row's external_id to the canonical UID so the upsert key works
      // for future syncs.
      if (reservationCode) {
        const { data: placeholder } = await admin
          .from("reservations")
          .select("id, external_id")
          .eq("source", "airbnb")
          .eq("reservation_code", reservationCode)
          .neq("external_id", uid)
          .maybeSingle();
        if (placeholder) {
          await admin
            .from("reservations")
            .update({ external_id: uid })
            .eq("id", placeholder.id);
        }
      }

      const { data: upserted, error } = await admin
        .from("reservations")
        .upsert(
          {
            property_id: propertyId,
            source: "airbnb",
            external_id: uid,
            check_in: checkIn,
            check_out: checkOut,
            notes,
            reservation_code: reservationCode,
          },
          { onConflict: "source,external_id" },
        )
        .select("id, check_out")
        .single();
      if (error) throw new Error(error.message);
      result.reservations++;

      // Auto-generate access code for upcoming reservations only.
      // generateCodeForReservation is idempotent — no-op if a code already
      // exists, no-op if no primary lock is configured.
      const today = new Date().toISOString().slice(0, 10);
      if (upserted?.id && upserted.check_out >= today) {
        const codeResult = await generateCodeForReservation(upserted.id);
        if (codeResult.ok && !codeResult.already_existed) {
          result.codes_generated++;
        } else if (
          !codeResult.ok &&
          codeResult.reason_code !== "no_primary_lock" &&
          codeResult.reason_code !== "already_expired"
        ) {
          // Surface unexpected failures (e.g. Tuya API down) but ignore the
          // boring "no lock configured" case to keep sync output clean.
          result.errors.push(`code:${uid}: ${codeResult.reason}`);
        }

        // Auto-create a cleaning task for the check-out date. Idempotent —
        // skips if a limpieza task already exists for this (property, date).
        const created = await ensureCheckoutCleaningTask(
          admin,
          propertyId,
          checkOut,
        );
        if (created) result.cleaning_tasks_created++;
      }
    } catch (e) {
      result.errors.push((e as Error).message);
    }
  }

  return result;
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
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
