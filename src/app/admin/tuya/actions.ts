"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth";
import { isDeviceKind } from "@/lib/tuya/property-devices";

const assignSchema = z.object({
  tuya_device_id: z.string().min(1),
  tuya_device_name: z.string().optional().nullable(),
  property_id: z.string().uuid(),
  device_kind: z.string().refine(isDeviceKind, {
    message: "Tipo de dispositivo inválido.",
  }),
  is_primary: z.boolean(),
});

export async function assignDevice(input: {
  tuya_device_id: string;
  tuya_device_name?: string | null;
  property_id: string;
  device_kind: string;
  is_primary: boolean;
}) {
  await requireRole(["admin", "gestor"]);
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const admin = createAdminClient();

  // If marking as primary, clear any other primary in this (property, kind).
  if (parsed.data.is_primary) {
    const { error: clearError } = await admin
      .from("property_devices")
      .update({ is_primary: false })
      .eq("property_id", parsed.data.property_id)
      .eq("device_kind", parsed.data.device_kind)
      .eq("is_primary", true)
      .neq("tuya_device_id", parsed.data.tuya_device_id);
    if (clearError) return { error: clearError.message };
  }

  // Upsert the device assignment.
  const { error } = await admin.from("property_devices").upsert(
    {
      tuya_device_id: parsed.data.tuya_device_id,
      tuya_device_name: parsed.data.tuya_device_name ?? null,
      property_id: parsed.data.property_id,
      device_kind: parsed.data.device_kind,
      is_primary: parsed.data.is_primary,
    },
    { onConflict: "tuya_device_id" },
  );
  if (error) return { error: error.message };

  revalidatePath("/admin/tuya");
  return { ok: true };
}

export async function unassignDevice(tuyaDeviceId: string) {
  await requireRole(["admin", "gestor"]);
  if (!tuyaDeviceId) return { error: "Falta el ID del dispositivo." };
  const admin = createAdminClient();
  const { error } = await admin
    .from("property_devices")
    .delete()
    .eq("tuya_device_id", tuyaDeviceId);
  if (error) return { error: error.message };
  revalidatePath("/admin/tuya");
  return { ok: true };
}
