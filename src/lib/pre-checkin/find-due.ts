import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { isInStageWindow } from "./evaluate";

/**
 * Source of truth for what the pre-checkin cron should process this run.
 *
 * Three "stages" matching the user's spec (WIK-125):
 *   - 2h before: first alert with target temp + Sí/No buttons
 *   - 1h before: progress check (only if started)
 *   - 0h before: final check (only if started)
 *
 * Each call returns a list of candidates per stage. The cron processes
 * them sequentially.
 */

export type PreCheckinCandidate = {
  reservation_id: string;
  property_id: string;
  property_name: string;
  property_short_code: string;
  check_in_at_iso: string;
  target_min_c: number | null;
  target_max_c: number | null;
  cool_scene_id: string | null;
  heat_scene_id: string | null;
  // The gestor/admin to ping for this property. Same resolution logic as
  // the reservation_checkin_reminder in alarm-reminders.
  notify_profile_id: string;
  notify_phone: string;
  notify_name: string | null;
  /** profile.language del notify profile (free-form en DB, ej. "en" / "es" / null). */
  notify_language: string | null;
  // Existing tracking row (if any) — null when stage = 2h on first hit.
  existing_stage: string | null;
  existing_id: string | null;
  initial_temp_c: number | null;
};

type ReservationJoin = {
  id: string;
  property_id: string;
  check_in: string;
  check_in_time: string | null;
  status: string;
  property: {
    id: string;
    name: string;
    target_temp_min_c: number | null;
    target_temp_max_c: number | null;
    cool_scene_id: string | null;
    heat_scene_id: string | null;
  } | null;
};

/**
 * UY is UTC-3 year-round; combine date + optional HH:MM to ISO. Default
 * to 16:00 local if check_in_time is null (typical Airbnb default).
 */
function localToIso(date: string, time: string | null): string {
  const t = time ?? "16:00";
  const hhmm = t.length === 5 ? `${t}:00` : t;
  return `${date}T${hhmm}-03:00`;
}

/**
 * Make a short, human-friendly code from a property name for the SI/NO
 * disambiguation prompt ("Responde SI bosque vs SI julio"). Strip
 * accents, take first non-trivial word, lowercase, max 10 chars.
 */
function shortCode(propertyName: string): string {
  const noAccents = propertyName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  const first = noAccents
    .toLowerCase()
    .split(/\s+/)
    .find((w) => w.length >= 3 && !["casa", "the", "los", "las"].includes(w));
  return (first ?? noAccents.toLowerCase().replace(/\s+/g, "")).slice(0, 10);
}

async function resolveNotifyProfile(
  admin: ReturnType<typeof createAdminClient>,
  propertyId: string,
): Promise<{
  id: string;
  name: string | null;
  phone: string;
  language: string | null;
} | null> {
  // Prefer gestor assigned to the property; fallback to any admin with
  // whatsapp set. Mirrors lib/alarm-reminders/find-due.ts logic.
  type AssignmentRow = {
    profile: {
      id: string;
      full_name: string | null;
      whatsapp: string | null;
      role: string;
      language: string | null;
    };
  };
  const { data: assignments } = await admin
    .from("profile_properties")
    .select("profile:profiles!inner(id, full_name, whatsapp, role, language)")
    .eq("property_id", propertyId);
  const list = ((assignments ?? []) as unknown) as AssignmentRow[];
  const gestor = list.find((a) => a.profile.role === "gestor" && a.profile.whatsapp);
  if (gestor) {
    return {
      id: gestor.profile.id,
      name: gestor.profile.full_name,
      phone: gestor.profile.whatsapp!,
      language: gestor.profile.language,
    };
  }
  const admin2 = list.find((a) => a.profile.role === "admin" && a.profile.whatsapp);
  if (admin2) {
    return {
      id: admin2.profile.id,
      name: admin2.profile.full_name,
      phone: admin2.profile.whatsapp!,
      language: admin2.profile.language,
    };
  }
  // Fallback: any admin with whatsapp.
  type AdminRow = {
    id: string;
    full_name: string | null;
    whatsapp: string;
    language: string | null;
  };
  const { data: adminRows } = await admin
    .from("profiles")
    .select("id, full_name, whatsapp, language")
    .eq("role", "admin")
    .not("whatsapp", "is", null)
    .limit(1);
  const a = (((adminRows ?? []) as unknown) as AdminRow[])[0];
  if (a)
    return {
      id: a.id,
      name: a.full_name,
      phone: a.whatsapp,
      language: a.language,
    };
  return null;
}

/**
 * Find reservations that should be evaluated at the 2h-before stage AND
 * don't yet have a `pre_checkin_conditioning` row. These are first-time
 * entries into the flow.
 */
export async function findDueAt2h(nowMs: number): Promise<PreCheckinCandidate[]> {
  const admin = createAdminClient();

  // Pull confirmed reservations whose check_in is "today or tomorrow"
  // (the 2h window can straddle midnight in edge cases). We filter
  // precisely in JS using isInStageWindow.
  const todayIso = new Date(nowMs).toISOString().slice(0, 10);
  const tomorrowIso = new Date(nowMs + 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const { data: reservationRows } = await admin
    .from("reservations")
    .select(
      "id, property_id, check_in, check_in_time, status, " +
        "property:properties(id, name, target_temp_min_c, target_temp_max_c, cool_scene_id, heat_scene_id)",
    )
    .eq("status", "confirmed")
    .in("check_in", [todayIso, tomorrowIso]);

  const reservations = ((reservationRows ?? []) as unknown) as ReservationJoin[];
  if (reservations.length === 0) return [];

  // Already-tracked reservation ids — skip if any row exists (idempotency).
  const reservationIds = reservations.map((r) => r.id);
  const { data: existing } = await admin
    .from("pre_checkin_conditioning")
    .select("reservation_id")
    .in("reservation_id", reservationIds);
  const trackedIds = new Set(
    ((existing ?? []) as { reservation_id: string }[]).map((r) => r.reservation_id),
  );

  const candidates: PreCheckinCandidate[] = [];
  for (const r of reservations) {
    if (trackedIds.has(r.id)) continue;
    if (!r.property) continue;
    const checkInIso = localToIso(r.check_in, r.check_in_time);
    const checkInMs = new Date(checkInIso).getTime();
    if (!isInStageWindow({ nowMs, checkInMs, stageHoursBefore: 2 })) continue;

    const notify = await resolveNotifyProfile(admin, r.property_id);
    if (!notify) continue; // sin destino, no podemos alertar; skip silencioso

    candidates.push({
      reservation_id: r.id,
      property_id: r.property_id,
      property_name: r.property.name,
      property_short_code: shortCode(r.property.name),
      check_in_at_iso: checkInIso,
      target_min_c: r.property.target_temp_min_c,
      target_max_c: r.property.target_temp_max_c,
      cool_scene_id: r.property.cool_scene_id,
      heat_scene_id: r.property.heat_scene_id,
      notify_profile_id: notify.id,
      notify_phone: notify.phone,
      notify_name: notify.name,
      notify_language: notify.language,
      existing_stage: null,
      existing_id: null,
      initial_temp_c: null,
    });
  }
  return candidates;
}

/**
 * Find reservations in the "started" stage whose check-in is ~1h or ~0h
 * away. Used for the progress check at T-1h and the final check at T-0h.
 */
export async function findStartedAtStage(
  nowMs: number,
  stageHoursBefore: 1 | 0,
): Promise<PreCheckinCandidate[]> {
  const admin = createAdminClient();
  const wantedStage = stageHoursBefore === 1 ? "started" : "check_1h_done";

  // Pull rows in the appropriate stage. We over-fetch and filter by window in JS.
  const { data: rows } = await admin
    .from("pre_checkin_conditioning")
    .select(
      "id, reservation_id, stage, initial_temp_c, " +
        "reservation:reservations!inner(" +
        "id, property_id, check_in, check_in_time, status, " +
        "property:properties(id, name, target_temp_min_c, target_temp_max_c, cool_scene_id, heat_scene_id)" +
        ")",
    )
    .eq("stage", wantedStage);

  type Row = {
    id: string;
    reservation_id: string;
    stage: string;
    initial_temp_c: number | null;
    reservation: ReservationJoin;
  };
  const list = ((rows ?? []) as unknown) as Row[];

  const candidates: PreCheckinCandidate[] = [];
  for (const row of list) {
    const r = row.reservation;
    if (!r || !r.property) continue;
    if (r.status !== "confirmed") continue;
    const checkInIso = localToIso(r.check_in, r.check_in_time);
    const checkInMs = new Date(checkInIso).getTime();
    if (!isInStageWindow({ nowMs, checkInMs, stageHoursBefore })) continue;

    const notify = await resolveNotifyProfile(admin, r.property_id);
    if (!notify) continue;

    candidates.push({
      reservation_id: r.id,
      property_id: r.property_id,
      property_name: r.property.name,
      property_short_code: shortCode(r.property.name),
      check_in_at_iso: checkInIso,
      target_min_c: r.property.target_temp_min_c,
      target_max_c: r.property.target_temp_max_c,
      cool_scene_id: r.property.cool_scene_id,
      heat_scene_id: r.property.heat_scene_id,
      notify_profile_id: notify.id,
      notify_phone: notify.phone,
      notify_name: notify.name,
      notify_language: notify.language,
      existing_stage: row.stage,
      existing_id: row.id,
      initial_temp_c: row.initial_temp_c,
    });
  }
  return candidates;
}
