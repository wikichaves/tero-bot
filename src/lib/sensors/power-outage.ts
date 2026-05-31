import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDevice } from "@/lib/tuya/devices";
import { notifyAlarmEvent } from "./notify";
import type { AlarmRule, AlarmDeviceContext } from "./alarms";

/**
 * WIK-280: detección de corte de luz por estado online de los breakers (dlq).
 *
 * Distinto al evaluador de snapshots (T/H): acá NO hay una lectura — el
 * trigger es la CONECTIVIDAD del breaker. Un breaker `dlq` sin energía pierde
 * conexión con Tuya → `online=false`. El cron `/api/cron/power-outage` corre
 * esto cada ~10 min.
 *
 * Por cada regla `power_outage` (scope = propiedad), evaluamos CADA breaker
 * de esa propiedad por separado (un breaker = un alarm_event). Con un solo
 * breaker por propiedad es un corte total; si en el futuro hay varios, cada
 * uno dispara su propio evento (granularidad "parcial" gratis).
 *
 * Debounce sin estado extra, usando `alarm_events.notified_via_whatsapp`:
 *   - offline + sin evento abierto → crear evento (fired_at=now,
 *     notified=false). NO notificar todavía.
 *   - offline + evento abierto + !notified + (now - fired_at ≥ debounce) →
 *     notificar "corte" (notifyAlarmEvent marca notified=true).
 *   - offline + evento abierto + notified → nada (ya avisamos).
 *   - online + evento abierto:
 *       · si ya se notificó → resolver + avisar "volvió la luz".
 *       · si nunca se notificó (fue un parpadeo) → resolver en silencio.
 */

type BreakerRow = {
  id: string;
  tuya_device_id: string;
  tuya_device_name: string | null;
  property_id: string;
  room_id: string | null;
  property: { name: string } | null;
};

async function isBreakerOnline(tuyaDeviceId: string): Promise<boolean | null> {
  try {
    const d = await getDevice(tuyaDeviceId);
    return d?.online ?? null;
  } catch (e) {
    console.warn(
      `[power-outage] getDevice falló para ${tuyaDeviceId}: ${(e as Error).message}`,
    );
    return null; // desconocido → no tomamos decisión
  }
}

export async function evaluatePowerOutages(): Promise<{
  checked: number;
  fired: number;
  resolved: number;
}> {
  const admin = createAdminClient();
  let checked = 0;
  let fired = 0;
  let resolved = 0;

  // 1. Reglas de corte de luz habilitadas.
  const { data: rulesData, error: rulesErr } = await admin
    .from("alarm_rules")
    .select("*")
    .eq("enabled", true)
    .eq("metric", "power_outage");
  if (rulesErr) {
    console.error("[power-outage] load rules:", rulesErr.message);
    return { checked, fired, resolved };
  }
  const rules = (rulesData ?? []) as AlarmRule[];
  if (rules.length === 0) return { checked, fired, resolved };

  for (const rule of rules) {
    // Scope esperado: propiedad. (Sin property_id no sabemos qué breakers
    // mirar — se ignora.)
    if (!rule.property_id) continue;

    // 2. Breakers de la propiedad.
    const { data: breakers } = await admin
      .from("property_devices")
      .select(
        "id, tuya_device_id, tuya_device_name, property_id, room_id, property:properties(name)",
      )
      .eq("property_id", rule.property_id)
      .eq("device_kind", "breaker");

    // Supabase tipa el join `property:properties(name)` como array; en
    // runtime es un objeto (FK to-one). Cast vía unknown.
    for (const b of (breakers ?? []) as unknown as BreakerRow[]) {
      const online = await isBreakerOnline(b.tuya_device_id);
      if (online == null) continue; // estado desconocido → skip
      checked++;

      const device: AlarmDeviceContext = {
        property_device_id: b.id,
        property_id: b.property_id,
        room_id: b.room_id,
        device_name: b.tuya_device_name,
        property_name: b.property?.name ?? null,
        room_name: null,
      };

      // ¿Evento abierto para (rule, breaker)?
      const { data: openRows } = await admin
        .from("alarm_events")
        .select("id, fired_at, notified_via_whatsapp")
        .eq("rule_id", rule.id)
        .eq("property_device_id", b.id)
        .is("resolved_at", null)
        .order("fired_at", { ascending: false })
        .limit(1);
      const open = openRows?.[0] ?? null;

      if (!online) {
        if (!open) {
          // Primer offline detectado — crear evento, sin notificar (debounce).
          await admin.from("alarm_events").insert({
            rule_id: rule.id,
            property_device_id: b.id,
            fired_at: new Date().toISOString(),
            trigger_value: null,
          });
          continue;
        }
        if (open.notified_via_whatsapp) continue; // ya avisamos
        // Pasó el debounce?
        const offlineMs = Date.now() - new Date(open.fired_at as string).getTime();
        if (offlineMs < rule.debounce_minutes * 60_000) continue;
        // Notificar corte (marca notified=true adentro).
        const ok = await notifyAlarmEvent({
          kind: "fired",
          rule,
          device,
          value: null,
          event_id: open.id,
        });
        if (ok) fired++;
      } else {
        // Online: si había evento abierto, resolverlo.
        if (!open) continue;
        await admin
          .from("alarm_events")
          .update({ resolved_at: new Date().toISOString() })
          .eq("id", open.id);
        resolved++;
        // Solo avisar "volvió la luz" si antes habíamos avisado el corte.
        if (open.notified_via_whatsapp) {
          await notifyAlarmEvent({
            kind: "resolved",
            rule,
            device,
            value: null,
            event_id: open.id,
          });
        }
      }
    }
  }

  return { checked, fired, resolved };
}
