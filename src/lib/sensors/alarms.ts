import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Lógica de evaluación de alarmas para sensores (WIK-82 Fase 3).
 *
 * Después de cada snapshot, llamamos `evaluateAlarmsForSnapshot()` con
 * la lectura recién insertada. Recorre todas las `alarm_rules` enabled
 * que aplican al device (scope global | property | room | device) y:
 *
 *   - Si la métrica cruza el threshold → si NO hay un alarm_event
 *     abierto para esa (rule, device) Y pasó el debounce desde el
 *     último evento resuelto → CREAR nuevo event + notificar por WA.
 *   - Si la métrica vuelve dentro del rango → si HAY un alarm_event
 *     abierto, marcar `resolved_at = now()`.
 *
 * Debounce: previene spam de alarmas cuando una métrica oscila cerca
 * del threshold. Si el último evento para (rule, device) se resolvió
 * hace menos de `debounce_minutes`, no creamos uno nuevo (esperamos).
 */

export type AlarmRule = {
  id: string;
  property_id: string | null;
  room_id: string | null;
  property_device_id: string | null;
  metric: "temperature_c" | "humidity_pct";
  operator: "gt" | "lt";
  threshold: number;
  debounce_minutes: number;
  enabled: boolean;
};

export type AlarmReading = {
  temperature_c: number | null;
  humidity_pct: number | null;
};

export type AlarmDeviceContext = {
  property_device_id: string;
  property_id: string;
  room_id: string | null;
  device_name: string | null;
  property_name: string | null;
  room_name: string | null;
};

export type EvaluatedEvent = {
  kind: "fired" | "resolved";
  rule: AlarmRule;
  device: AlarmDeviceContext;
  value: number;
  event_id: string;
};

/**
 * True si la regla aplica al device (cualquiera de los 4 scopes matchea).
 * Una rule sin scope (todos los FKs null) es "global" — aplica a todos.
 */
function ruleAppliesToDevice(
  rule: AlarmRule,
  device: AlarmDeviceContext,
): boolean {
  // Global rule (sin scope)
  if (!rule.property_id && !rule.room_id && !rule.property_device_id) {
    return true;
  }
  if (rule.property_device_id === device.property_device_id) return true;
  if (rule.room_id && rule.room_id === device.room_id) return true;
  if (rule.property_id === device.property_id) return true;
  return false;
}

function isOutOfRange(
  value: number,
  operator: "gt" | "lt",
  threshold: number,
): boolean {
  return operator === "gt" ? value > threshold : value < threshold;
}

/**
 * Evalúa todas las reglas para un único device con su lectura.
 * Devuelve la lista de eventos creados o resueltos (para que el caller
 * los pueda notificar).
 */
export async function evaluateAlarmsForSnapshot(
  admin: SupabaseClient,
  device: AlarmDeviceContext,
  reading: AlarmReading,
  rules: AlarmRule[],
): Promise<EvaluatedEvent[]> {
  const events: EvaluatedEvent[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (!ruleAppliesToDevice(rule, device)) continue;

    const value =
      rule.metric === "temperature_c"
        ? reading.temperature_c
        : reading.humidity_pct;
    if (value == null) continue;

    const outOfRange = isOutOfRange(value, rule.operator, rule.threshold);

    // ¿Hay un alarm_event abierto para esta (rule, device)?
    const { data: openEvents } = await admin
      .from("alarm_events")
      .select("id, fired_at")
      .eq("rule_id", rule.id)
      .eq("property_device_id", device.property_device_id)
      .is("resolved_at", null)
      .order("fired_at", { ascending: false })
      .limit(1);
    const openEvent = openEvents?.[0] ?? null;

    if (outOfRange) {
      if (openEvent) {
        // Ya hay alarma abierta — nada que hacer (no re-notificamos).
        continue;
      }
      // Antes de crear: chequear debounce contra el último event resuelto.
      const { data: lastResolved } = await admin
        .from("alarm_events")
        .select("resolved_at")
        .eq("rule_id", rule.id)
        .eq("property_device_id", device.property_device_id)
        .not("resolved_at", "is", null)
        .order("resolved_at", { ascending: false })
        .limit(1);
      const lastResolvedAt = lastResolved?.[0]?.resolved_at;
      if (lastResolvedAt) {
        const msSince =
          Date.now() - new Date(lastResolvedAt as string).getTime();
        if (msSince < rule.debounce_minutes * 60_000) {
          // Dentro de la ventana de debounce — skippear el firing.
          continue;
        }
      }

      const { data: inserted, error: insErr } = await admin
        .from("alarm_events")
        .insert({
          rule_id: rule.id,
          property_device_id: device.property_device_id,
          fired_at: new Date().toISOString(),
          trigger_value: value,
        })
        .select("id")
        .single();
      if (insErr || !inserted) continue;
      events.push({
        kind: "fired",
        rule,
        device,
        value,
        event_id: inserted.id,
      });
    } else {
      // En rango: si hay un evento abierto, resolverlo.
      if (openEvent) {
        const { error: updErr } = await admin
          .from("alarm_events")
          .update({ resolved_at: new Date().toISOString() })
          .eq("id", openEvent.id);
        if (updErr) continue;
        events.push({
          kind: "resolved",
          rule,
          device,
          value,
          event_id: openEvent.id,
        });
      }
    }
  }

  return events;
}

/**
 * Convenience: trae todas las rules enabled de DB. Llamado una vez por
 * batch de snapshots (no por device, para evitar N queries).
 */
export async function loadEnabledRules(
  admin: SupabaseClient,
): Promise<AlarmRule[]> {
  const { data, error } = await admin
    .from("alarm_rules")
    .select("*")
    .eq("enabled", true);
  if (error) {
    console.error("[loadEnabledRules]", error.message);
    return [];
  }
  return (data ?? []) as AlarmRule[];
}
