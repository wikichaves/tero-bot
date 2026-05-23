"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth";

const ruleSchema = z.object({
  id: z.string().uuid().optional(),
  scope_type: z.enum(["global", "property", "room", "device"]),
  scope_id: z.string().uuid().nullable(),
  metric: z.enum(["temperature_c", "humidity_pct"]),
  operator: z.enum(["gt", "lt"]),
  threshold: z.coerce.number(),
  debounce_minutes: z.coerce.number().int().min(0).max(1440).default(15),
  enabled: z.boolean().default(true),
});

export async function saveAlarmRule(input: unknown) {
  await requireRole(["admin", "gestor"]);
  const parsed = ruleSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join(", ") };
  }
  const v = parsed.data;
  // scope_type → FK column. Solo uno de los 3 FKs queda seteado.
  const row = {
    property_id: v.scope_type === "property" ? v.scope_id : null,
    room_id: v.scope_type === "room" ? v.scope_id : null,
    property_device_id: v.scope_type === "device" ? v.scope_id : null,
    metric: v.metric,
    operator: v.operator,
    threshold: v.threshold,
    debounce_minutes: v.debounce_minutes,
    enabled: v.enabled,
  };

  if (v.scope_type !== "global" && !v.scope_id) {
    return { error: "Falta seleccionar el scope específico." };
  }

  const admin = createAdminClient();
  if (v.id) {
    const { error } = await admin
      .from("alarm_rules")
      .update(row)
      .eq("id", v.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await admin.from("alarm_rules").insert(row);
    if (error) return { error: error.message };
  }
  revalidatePath("/admin/alarms");
  return { ok: true };
}

export async function deleteAlarmRule(id: string) {
  await requireRole(["admin", "gestor"]);
  const admin = createAdminClient();
  const { error } = await admin.from("alarm_rules").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/alarms");
  return { ok: true };
}

export async function toggleAlarmRule(id: string, enabled: boolean) {
  await requireRole(["admin", "gestor"]);
  const admin = createAdminClient();
  const { error } = await admin
    .from("alarm_rules")
    .update({ enabled })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/alarms");
  return { ok: true };
}

export async function resolveAlarmEvent(id: string) {
  await requireRole(["admin", "gestor"]);
  const admin = createAdminClient();
  const { error } = await admin
    .from("alarm_events")
    .update({ resolved_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/alarms");
  return { ok: true };
}
