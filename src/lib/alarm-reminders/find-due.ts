import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Source of truth for the alarm-reminder cron (WIK-124). Finds tasks and
 * reservations whose alarm should fire in the current 15-minute window.
 *
 * Each candidate is matched against `alarm_notifications_sent` so we
 * never send twice for the same item. The cron handler is the only
 * write-side caller — admin edits of due_date/check_in_time/alarm_hours
 * delete the tracking row separately to allow re-evaluation.
 */

export type TaskCandidate = {
  kind: "task";
  task_id: string;
  reservation_id?: never;
  title: string;
  property_name: string | null;
  due_at_iso: string;
  alarm_at_iso: string;
  assignee_id: string;
  assignee_name: string | null;
  assignee_phone: string;
  /** profile.language del assignee (free-form en DB, ej. "en", "es", null). */
  assignee_language: string | null;
};

export type ReservationCandidate = {
  kind: "reservation";
  reservation_id: string;
  task_id?: never;
  guest_name: string | null;
  property_name: string | null;
  check_in_at_iso: string;
  alarm_at_iso: string;
  // Reservas no tienen "assignee" — el WhatsApp va al gestor/admin que
  // tiene la property asignada. El cron resuelve eso por separado.
  notify_profile_id: string;
  notify_phone: string;
  notify_name: string | null;
  /** profile.language del notify profile (free-form en DB). */
  notify_language: string | null;
};

export type AlarmCandidate = TaskCandidate | ReservationCandidate;

/**
 * Combine a YYYY-MM-DD date string and an optional HH:MM time into an ISO
 * timestamp interpreted in America/Montevideo (UTC-3, no DST). Hardcoding
 * the offset is fine for this property: all guests use the same zone, and
 * we'd rather have a stable formula than a wrong tz library result.
 *
 * If `time` is null, returns midnight local of that date.
 */
function localToIso(date: string, time: string | null): string {
  const t = time ?? "00:00";
  const hhmm = t.length === 5 ? `${t}:00` : t.length === 8 ? t : `${t}:00`;
  // Montevideo is UTC-3 year-round.
  return `${date}T${hhmm}-03:00`;
}

/**
 * Find tasks whose alarm timestamp falls inside [windowStart, windowEnd]
 * AND don't already have a row in alarm_notifications_sent.
 *
 * The 15-minute window matches the cron cadence — anything that "should
 * have fired in the last 15 min" gets caught on the next run, no more.
 * Tasks that drift past the window without firing (e.g. cron downtime)
 * stay un-fired — we don't want a backlog of stale alarms exploding.
 */
export async function findDueAlarms({
  windowStartMs,
  windowEndMs,
}: {
  windowStartMs: number;
  windowEndMs: number;
}): Promise<AlarmCandidate[]> {
  const admin = createAdminClient();

  // Pre-fetch all already-notified ids so we filter in JS without a join
  // (Supabase ".not.in()" with subquery is awkward via the JS client).
  const { data: alreadySent } = await admin
    .from("alarm_notifications_sent")
    .select("task_id, reservation_id");
  const sentTaskIds = new Set<string>();
  const sentReservationIds = new Set<string>();
  for (const r of (alreadySent ?? []) as Array<{
    task_id: string | null;
    reservation_id: string | null;
  }>) {
    if (r.task_id) sentTaskIds.add(r.task_id);
    if (r.reservation_id) sentReservationIds.add(r.reservation_id);
  }

  // Tasks: candidates are pending/in_progress with alarm_hours_before set.
  // We over-fetch (any task with alarm config + future due_date) and filter
  // in JS — keeps the SQL simple, the dataset is small (<100 active tasks).
  const { data: taskRows } = await admin
    .from("tasks")
    .select(
      "id, title, due_date, due_time, alarm_hours_before, status, " +
        "assignee:profiles!tasks_assigned_to_fkey(id, full_name, whatsapp, language), " +
        "property:properties(name)",
    )
    .not("alarm_hours_before", "is", null)
    .not("due_date", "is", null)
    .in("status", ["pending", "in_progress"]);

  // Type assertion via `unknown` — Supabase's auto-generated relation
  // types are opaque (`GenericStringError`) when the schema isn't typed
  // in advance via codegen. We know the actual shape from the .select()
  // string above, so the double-cast is safe and explicit.
  type TaskJoin = {
    id: string;
    title: string;
    due_date: string;
    due_time: string | null;
    alarm_hours_before: number;
    assignee: {
      id: string;
      full_name: string | null;
      whatsapp: string | null;
      language: string | null;
    } | null;
    property: { name: string } | null;
  };
  const taskCandidates: TaskCandidate[] = [];
  for (const t of ((taskRows ?? []) as unknown) as TaskJoin[]) {
    if (sentTaskIds.has(t.id)) continue;
    if (!t.assignee?.whatsapp) continue; // sin destino, sin alarma
    const dueIso = localToIso(t.due_date, t.due_time);
    const dueMs = new Date(dueIso).getTime();
    const alarmMs = dueMs - t.alarm_hours_before * 60 * 60 * 1000;
    if (alarmMs < windowStartMs || alarmMs > windowEndMs) continue;
    taskCandidates.push({
      kind: "task",
      task_id: t.id,
      title: t.title,
      property_name: t.property?.name ?? null,
      due_at_iso: dueIso,
      alarm_at_iso: new Date(alarmMs).toISOString(),
      assignee_id: t.assignee.id,
      assignee_name: t.assignee.full_name,
      assignee_phone: t.assignee.whatsapp,
      assignee_language: t.assignee.language,
    });
  }

  // Reservations: candidates are confirmed reservations with
  // alarm_hours_before set. We notify the FIRST gestor/admin assigned to
  // the property (via profile_properties scope). Falls back to "any admin"
  // if no gestor is assigned to that property specifically.
  const { data: reservationRows } = await admin
    .from("reservations")
    .select(
      "id, guest_name, check_in, check_in_time, alarm_hours_before, status, property_id, " +
        "property:properties(name)",
    )
    .not("alarm_hours_before", "is", null)
    .eq("status", "confirmed");

  // Pre-resolve property → primary-notify-profile map. We pick the first
  // gestor assigned to the property; if none, any admin.
  type ReservationJoin = {
    id: string;
    guest_name: string | null;
    check_in: string;
    check_in_time: string | null;
    alarm_hours_before: number;
    property_id: string;
    property: { name: string } | null;
  };
  const reservationList =
    ((reservationRows ?? []) as unknown) as ReservationJoin[];
  const propertyIds = [
    ...new Set(reservationList.map((r) => r.property_id)),
  ];
  const notifyByProperty = new Map<
    string,
    {
      profile_id: string;
      name: string | null;
      phone: string;
      language: string | null;
    }
  >();
  if (propertyIds.length > 0) {
    const { data: assignments } = await admin
      .from("profile_properties")
      .select(
        "property_id, profile:profiles!inner(id, full_name, whatsapp, role, language)",
      )
      .in("property_id", propertyIds);
    type AssignmentJoin = {
      property_id: string;
      profile: {
        id: string;
        full_name: string | null;
        whatsapp: string | null;
        role: string;
        language: string | null;
      };
    };
    const byProperty = new Map<
      string,
      Array<{
        profile_id: string;
        name: string | null;
        phone: string | null;
        role: string;
        language: string | null;
      }>
    >();
    for (const a of ((assignments ?? []) as unknown) as AssignmentJoin[]) {
      const arr = byProperty.get(a.property_id) ?? [];
      arr.push({
        profile_id: a.profile.id,
        name: a.profile.full_name,
        phone: a.profile.whatsapp,
        role: a.profile.role,
        language: a.profile.language,
      });
      byProperty.set(a.property_id, arr);
    }
    // Fallback: list of admins for properties with no specific gestor.
    const { data: adminRows } = await admin
      .from("profiles")
      .select("id, full_name, whatsapp, language")
      .eq("role", "admin")
      .not("whatsapp", "is", null);
    type AdminRow = {
      id: string;
      full_name: string | null;
      whatsapp: string;
      language: string | null;
    };
    const adminFallback = (((adminRows ?? []) as unknown) as AdminRow[])[0];
    for (const pid of propertyIds) {
      const candidates = byProperty.get(pid) ?? [];
      // Prefer gestor > admin; require whatsapp set.
      const gestor = candidates.find(
        (c) => c.role === "gestor" && c.phone,
      );
      if (gestor) {
        notifyByProperty.set(pid, {
          profile_id: gestor.profile_id,
          name: gestor.name,
          phone: gestor.phone!,
          language: gestor.language,
        });
        continue;
      }
      const admin2 = candidates.find((c) => c.role === "admin" && c.phone);
      if (admin2) {
        notifyByProperty.set(pid, {
          profile_id: admin2.profile_id,
          name: admin2.name,
          phone: admin2.phone!,
          language: admin2.language,
        });
        continue;
      }
      if (adminFallback) {
        notifyByProperty.set(pid, {
          profile_id: adminFallback.id,
          name: adminFallback.full_name,
          phone: adminFallback.whatsapp,
          language: adminFallback.language,
        });
      }
    }
  }

  const reservationCandidates: ReservationCandidate[] = [];
  for (const r of reservationList) {
    if (sentReservationIds.has(r.id)) continue;
    const notify = notifyByProperty.get(r.property_id);
    if (!notify) continue; // sin destino, sin alarma
    const checkInIso = localToIso(r.check_in, r.check_in_time);
    const checkInMs = new Date(checkInIso).getTime();
    const alarmMs = checkInMs - r.alarm_hours_before * 60 * 60 * 1000;
    if (alarmMs < windowStartMs || alarmMs > windowEndMs) continue;
    reservationCandidates.push({
      kind: "reservation",
      reservation_id: r.id,
      guest_name: r.guest_name,
      property_name: r.property?.name ?? null,
      check_in_at_iso: checkInIso,
      alarm_at_iso: new Date(alarmMs).toISOString(),
      notify_profile_id: notify.profile_id,
      notify_phone: notify.phone,
      notify_name: notify.name,
      notify_language: notify.language,
    });
  }

  return [...taskCandidates, ...reservationCandidates];
}
