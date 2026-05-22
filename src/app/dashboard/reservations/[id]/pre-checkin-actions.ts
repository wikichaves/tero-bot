"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth";
import { sendPreCheckinAlert } from "@/lib/pre-checkin/send-alert";
import type { PreCheckinCandidate } from "@/lib/pre-checkin/find-due";

/**
 * Manual override: forzar el flow de pre-checkin conditioning ahora,
 * ignorando la ventana T-2h del cron (WIK-125).
 *
 * Casos donde el cron no aplica:
 *   - check-in en menos de 2h (caímos en la ventana sin alerta inicial)
 *   - check-in en quiet hours (cron pospuso, pero el admin quiere actuar)
 *   - el cron falló (caso raro, pero el override sirve como kill-switch)
 *
 * Borra cualquier tracking row existente para esa reserva antes de
 * disparar — el flow arranca desde cero. Es destructivo, lo cual es OK
 * para un override manual.
 */
export async function triggerPreCheckinNow(reservationId: string): Promise<
  | { ok: true; outcome: string; reason: string }
  | { error: string }
> {
  await requireRole(["admin", "gestor"]);
  const admin = createAdminClient();

  // Load reservation + property + assignee
  type Row = {
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
  const { data: rRaw } = await admin
    .from("reservations")
    .select(
      "id, property_id, check_in, check_in_time, status, " +
        "property:properties(id, name, target_temp_min_c, target_temp_max_c, cool_scene_id, heat_scene_id)",
    )
    .eq("id", reservationId)
    .maybeSingle();
  const r = (rRaw as unknown) as Row | null;
  if (!r || !r.property) return { error: "Reserva no encontrada." };
  if (r.status !== "confirmed") {
    return { error: `La reserva no está confirmada (${r.status}).` };
  }
  if (r.property.target_temp_min_c == null || r.property.target_temp_max_c == null) {
    return {
      error: "La propiedad no tiene rango target configurado. Editala primero.",
    };
  }

  // Resolve notify profile (same logic as find-due)
  type AssignmentRow = {
    profile: {
      id: string;
      full_name: string | null;
      whatsapp: string | null;
      role: string;
    };
  };
  const { data: assignments } = await admin
    .from("profile_properties")
    .select("profile:profiles!inner(id, full_name, whatsapp, role)")
    .eq("property_id", r.property_id);
  const list = ((assignments ?? []) as unknown) as AssignmentRow[];
  const gestor =
    list.find((a) => a.profile.role === "gestor" && a.profile.whatsapp) ?? null;
  const admin2 =
    list.find((a) => a.profile.role === "admin" && a.profile.whatsapp) ?? null;
  const notify = gestor?.profile ?? admin2?.profile;
  if (!notify || !notify.whatsapp) {
    return {
      error: "No hay gestor ni admin con whatsapp configurado para esta propiedad.",
    };
  }

  // Wipe any existing tracking row → fresh start.
  await admin
    .from("pre_checkin_conditioning")
    .delete()
    .eq("reservation_id", reservationId);

  // Build candidate + call the same send path the cron uses.
  const checkInIso = `${r.check_in}T${r.check_in_time ?? "16:00"}:00-03:00`;
  const candidate: PreCheckinCandidate = {
    reservation_id: r.id,
    property_id: r.property_id,
    property_name: r.property.name,
    property_short_code: r.property.name.split(/\s+/)[0]?.toLowerCase() ?? "",
    check_in_at_iso: checkInIso,
    target_min_c: r.property.target_temp_min_c,
    target_max_c: r.property.target_temp_max_c,
    cool_scene_id: r.property.cool_scene_id,
    heat_scene_id: r.property.heat_scene_id,
    notify_profile_id: notify.id,
    notify_phone: notify.whatsapp,
    notify_name: notify.full_name,
    existing_stage: null,
    existing_id: null,
    initial_temp_c: null,
  };
  const result = await sendPreCheckinAlert(candidate, Date.now());

  revalidatePath(`/dashboard/reservations/${reservationId}`);
  revalidatePath("/dashboard");
  return { ok: true, outcome: result.outcome, reason: result.reason };
}
