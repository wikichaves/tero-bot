import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { addOfflineTempPassword } from "./lock";

/**
 * Auto-generate (or fetch existing) lock access code for a reservation.
 *
 * Flow:
 *   1. Fetch the reservation.
 *   2. If a `lock_passwords` row already exists with status='active' for this
 *      reservation, return it (idempotent).
 *   3. Look up the property's primary lock (`property_devices.is_primary`
 *      where `device_kind='lock'`).
 *   4. Build a validity window: from check_in date 09:00 UTC (≈ 06:00 UY/AR)
 *      to check_out date 23:00 UTC (≈ 20:00 UY/AR). Both align to hour
 *      boundaries (Tuya requirement). Effective time is also bumped to
 *      "next hour" if the check_in is already past.
 *   5. Call Tuya `addOfflineTempPassword` to actually create the code.
 *   6. Persist in `lock_passwords` linked to `reservation_id`.
 *
 * Returns the code on success or a reason for failure. The caller decides
 * whether to surface failures (user-driven) or swallow them (sync hook).
 */
export type GenerateCodeResult =
  | {
      ok: true;
      code: string;
      tuya_password_id: string;
      lock_password_id: string;
      effective_at: string;
      invalid_at: string;
      already_existed: boolean;
    }
  | { ok: false; reason: string; reason_code: AutoCodeFailureReason };

export type AutoCodeFailureReason =
  | "reservation_not_found"
  | "no_property"
  | "no_primary_lock"
  | "invalid_dates"
  | "already_expired"
  | "tuya_failed"
  | "persist_failed";

const HOUR = 3600;

function buildValidityWindow(
  checkInDate: string,
  checkOutDate: string,
):
  | { effective: number; invalid: number }
  | null {
  // ISO date strings like "2026-05-15". Compose with explicit UTC times so
  // both Vercel (UTC) and locals interpret consistently.
  const ci = new Date(`${checkInDate}T09:00:00Z`).getTime() / 1000;
  const co = new Date(`${checkOutDate}T23:00:00Z`).getTime() / 1000;
  if (!Number.isFinite(ci) || !Number.isFinite(co)) return null;

  // Tuya rejects past effective_time. If check_in is already past (mid-stay
  // generation), bump effective to next full hour.
  const nowSec = Math.floor(Date.now() / 1000);
  const nextHour = (Math.floor(nowSec / HOUR) + 1) * HOUR;

  const effective = Math.max(Math.floor(ci / HOUR) * HOUR, nextHour);
  const invalid = Math.max(Math.ceil(co / HOUR) * HOUR, effective + HOUR);

  if (invalid <= effective) return null;
  return { effective, invalid };
}

export async function generateCodeForReservation(
  reservationId: string,
  opts?: { byUserId?: string | null },
): Promise<GenerateCodeResult> {
  const admin = createAdminClient();

  // 1. Fetch reservation
  const { data: reservation } = await admin
    .from("reservations")
    .select(
      "id, property_id, guest_name, check_in, check_out, source, external_id",
    )
    .eq("id", reservationId)
    .maybeSingle();
  if (!reservation) {
    return { ok: false, reason_code: "reservation_not_found", reason: "Reserva no encontrada." };
  }
  if (!reservation.property_id) {
    return { ok: false, reason_code: "no_property", reason: "Reserva sin propiedad asignada." };
  }

  // 2. Idempotent: if there's already an active code for this reservation,
  // return it without calling Tuya.
  const { data: existing } = await admin
    .from("lock_passwords")
    .select("id, password, tuya_password_id, effective_time, invalid_time")
    .eq("reservation_id", reservationId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) {
    return {
      ok: true,
      code: existing.password,
      tuya_password_id: existing.tuya_password_id,
      lock_password_id: existing.id,
      effective_at: existing.effective_time,
      invalid_at: existing.invalid_time,
      already_existed: true,
    };
  }

  // 3. Find primary lock for property
  const { data: lockDevice } = await admin
    .from("property_devices")
    .select("id, tuya_device_id")
    .eq("property_id", reservation.property_id)
    .eq("device_kind", "lock")
    .eq("is_primary", true)
    .maybeSingle();
  if (!lockDevice) {
    return {
      ok: false,
      reason_code: "no_primary_lock",
      reason:
        "La propiedad no tiene cerradura primaria asignada. Asigná una en /admin/tuya marcando 'primaria' en el tipo lock.",
    };
  }

  // 4. Build validity window
  const window = buildValidityWindow(
    reservation.check_in,
    reservation.check_out,
  );
  if (!window) {
    return {
      ok: false,
      reason_code: "invalid_dates",
      reason: "Las fechas de check-in/check-out son inválidas.",
    };
  }

  // Reservations that already ended don't need codes.
  const nowSec = Math.floor(Date.now() / 1000);
  if (window.invalid <= nowSec) {
    return {
      ok: false,
      reason_code: "already_expired",
      reason: "La reserva ya finalizó — no se genera código retroactivo.",
    };
  }

  // 5. Generate code on Tuya
  const guestLabel = reservation.guest_name?.trim() || "Huésped";
  const codeName = reservation.external_id
    ? `${guestLabel.slice(0, 30)} · ${reservation.external_id.slice(0, 12)}`
    : guestLabel.slice(0, 50);

  let tuyaResult;
  try {
    tuyaResult = await addOfflineTempPassword(lockDevice.tuya_device_id, {
      name: codeName,
      effective_time: window.effective,
      invalid_time: window.invalid,
    });
  } catch (e) {
    return {
      ok: false,
      reason_code: "tuya_failed",
      reason: `Tuya rechazó la creación: ${(e as Error).message}`,
    };
  }

  // 6. Persist in lock_passwords linked to reservation
  const { data: persisted, error: persistError } = await admin
    .from("lock_passwords")
    .insert({
      property_device_id: lockDevice.id,
      reservation_id: reservation.id,
      name: codeName,
      password: tuyaResult.password,
      tuya_password_id: tuyaResult.id,
      effective_time: new Date(tuyaResult.effective_time * 1000).toISOString(),
      invalid_time: new Date(tuyaResult.invalid_time * 1000).toISOString(),
      created_by: opts?.byUserId ?? null,
    })
    .select("id, effective_time, invalid_time")
    .single();
  if (persistError || !persisted) {
    return {
      ok: false,
      reason_code: "persist_failed",
      reason: persistError?.message ?? "No se pudo persistir el código en la DB.",
    };
  }

  return {
    ok: true,
    code: tuyaResult.password,
    tuya_password_id: tuyaResult.id,
    lock_password_id: persisted.id,
    effective_at: persisted.effective_time as string,
    invalid_at: persisted.invalid_time as string,
    already_existed: false,
  };
}
