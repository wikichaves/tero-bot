"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  addOfflineTempPassword,
  clearAllOfflineTempPasswords,
  deleteOfflineTempPassword,
} from "@/lib/tuya/lock";

const generateSchema = z.object({
  device_id: z.string().min(1),
  name: z.string().min(1, "Falta el nombre.").max(50),
  effective_at: z.string().min(1),
  invalid_at: z.string().min(1),
});

function toUnixSeconds(value: string): number | null {
  const t = new Date(value).getTime();
  if (!Number.isFinite(t) || t <= 0) return null;
  return Math.floor(t / 1000);
}

export async function generateLockPassword(input: {
  device_id: string;
  name: string;
  effective_at: string;
  invalid_at: string;
}) {
  const profile = await requireRole(["admin", "gestor"]);
  const parsed = generateSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const rawEffective = toUnixSeconds(parsed.data.effective_at);
  const rawInvalid = toUnixSeconds(parsed.data.invalid_at);
  if (!rawEffective || !rawInvalid) {
    return { error: "Fechas inválidas." };
  }

  // Tuya requires offline temp password times to be aligned to hour
  // boundaries (minute=0, second=0). It also rejects effective_time values
  // that are in the past — "invalid offline time".
  // We round effective UP to the NEXT hour (always future), and invalid UP
  // to the next hour after that as a minimum.
  const HOUR = 3600;
  const nowSec = Math.floor(Date.now() / 1000);
  const nextHour = (Math.floor(nowSec / HOUR) + 1) * HOUR;

  const effective = Math.max(
    Math.ceil(rawEffective / HOUR) * HOUR,
    nextHour,
  );
  const invalid = Math.max(
    Math.ceil(rawInvalid / HOUR) * HOUR,
    effective + HOUR,
  );
  if (invalid <= effective) {
    return {
      error:
        "La duración mínima es 1 hora (Tuya solo acepta horarios redondeados a la hora completa).",
    };
  }

  // Look up the property_device row for this Tuya device — needed to link
  // the persisted password back to the property.
  const supabase = await createClient();
  const { data: device } = await supabase
    .from("property_devices")
    .select("id")
    .eq("tuya_device_id", parsed.data.device_id)
    .maybeSingle();

  let created;
  try {
    created = await addOfflineTempPassword(parsed.data.device_id, {
      name: parsed.data.name,
      effective_time: effective,
      invalid_time: invalid,
    });
  } catch (e) {
    return { error: (e as Error).message };
  }

  // Persist to lock_passwords if the device is associated with a property.
  // If not, we still return success but log a warning — the code is on the
  // lock, just won't appear in our ledger.
  if (device?.id) {
    const admin = createAdminClient();
    const { error: persistError } = await admin
      .from("lock_passwords")
      .insert({
        property_device_id: device.id,
        name: created.name,
        password: created.password,
        tuya_password_id: created.id,
        effective_time: new Date(created.effective_time * 1000).toISOString(),
        invalid_time: new Date(created.invalid_time * 1000).toISOString(),
        created_by: profile.id,
      });
    if (persistError) {
      console.error("[lock_passwords insert]", persistError);
    }
  } else {
    console.warn(
      `[generateLockPassword] device ${parsed.data.device_id} not assigned to a property — code won't be persisted.`,
    );
  }

  revalidatePath("/admin/tuya/lock");
  return { ok: true, created };
}

export async function revokeLockPassword(input: {
  device_id: string;
  password_id: string;
}) {
  await requireRole(["admin", "gestor"]);
  if (!input.device_id || !input.password_id) {
    return { error: "Faltan datos para revocar." };
  }
  try {
    await deleteOfflineTempPassword(input.device_id, input.password_id);
  } catch (e) {
    return { error: (e as Error).message };
  }
  // Mark our DB row as revoked (best-effort — no-op if row doesn't exist).
  const admin = createAdminClient();
  await admin
    .from("lock_passwords")
    .update({ status: "revoked" })
    .eq("tuya_password_id", input.password_id);
  revalidatePath("/admin/tuya/lock");
  return { ok: true };
}

export async function clearAllPasswords(input: { device_id: string }) {
  await requireRole(["admin"]);
  if (!input.device_id) return { error: "Falta el ID del dispositivo." };
  try {
    await clearAllOfflineTempPasswords(input.device_id);
  } catch (e) {
    return { error: (e as Error).message };
  }
  // Mark all of our DB rows for this device as revoked.
  const admin = createAdminClient();
  const { data: device } = await admin
    .from("property_devices")
    .select("id")
    .eq("tuya_device_id", input.device_id)
    .maybeSingle();
  if (device?.id) {
    await admin
      .from("lock_passwords")
      .update({ status: "revoked" })
      .eq("property_device_id", device.id)
      .eq("status", "active");
  }
  revalidatePath("/admin/tuya/lock");
  return { ok: true };
}
