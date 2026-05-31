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
  // WIK-275: usuarios asignados a la regla (checkbox group). Vacío =
  // fallback a todos los admin/gestor con whatsapp (ver notify.ts).
  recipient_profile_ids: z.array(z.string().uuid()).default([]),
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
  let ruleId = v.id;
  if (v.id) {
    const { error } = await admin
      .from("alarm_rules")
      .update(row)
      .eq("id", v.id);
    if (error) return { error: error.message };
  } else {
    const { data: inserted, error } = await admin
      .from("alarm_rules")
      .insert(row)
      .select("id")
      .single();
    if (error) return { error: error.message };
    ruleId = inserted.id;
  }

  // WIK-275: sincronizar destinatarios (delete + insert). Idempotente.
  if (ruleId) {
    const { error: delErr } = await admin
      .from("alarm_rule_recipients")
      .delete()
      .eq("rule_id", ruleId);
    if (delErr) return { error: delErr.message };
    if (v.recipient_profile_ids.length > 0) {
      const { error: insErr } = await admin
        .from("alarm_rule_recipients")
        .insert(
          v.recipient_profile_ids.map((profile_id) => ({
            rule_id: ruleId,
            profile_id,
          })),
        );
      if (insErr) return { error: insErr.message };
    }
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
