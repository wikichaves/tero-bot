import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { decodeFault, getDeviceFaultLogs } from "@/lib/tuya/fault-logs";
import { notifyAlarmEvent } from "./notify";
import type { AlarmRule, AlarmDeviceContext } from "./alarms";

/**
 * WIK-281: detección de corte de luz por el DP `fault` de los breakers (dlq).
 *
 * Reemplaza la detección por estado `online` (WIK-280), que falló en un corte
 * real: el modem estaba en un UPS chico, así que el breaker siguió reportando
 * online y la alarma nunca disparó. Además, `online` tarda ~3min en cambiar y
 * jamás capta micro-cortes de segundos.
 *
 * En vez de eso leemos los device logs del breaker (`/v1.0/devices/{id}/logs`),
 * que guardan cada transición del DP `fault` con timestamp exacto. Un corte de
 * luz = fault de subtensión/outage; vuelve la luz = fault vuelve a 0. Esto:
 *   - capta micro-cortes de ~5s aunque empiecen y terminen entre dos polls;
 *   - capta cortes totales retroactivamente (el breaker loguea la subtensión
 *     justo antes de morir y el cloud lo entrega cuando vuelve la conexión).
 *
 * El cron `/api/cron/power-outage` corre esto cada ~10 min. Por breaker
 * guardamos un cursor (`tuya_log_cursors.last_event_time_ms`) para no
 * re-escanear ni re-disparar.
 *
 * Máquina de estados (por breaker), reusando alarm_events + notifyAlarmEvent:
 *   - transición a power-loss y NO hay evento abierto → crear alarm_event
 *     (fired_at = timestamp del log) + notificar "corte".
 *   - transición fuera de power-loss y HAY evento abierto → resolver
 *     (resolved_at = timestamp del log) + notificar "volvió la luz".
 *   - power-loss estando ya en corte / fault=0 estando ya normal → no-op.
 */

// Ventana a mirar en la primera corrida de un breaker (sin cursor previo).
// Cubre un par de ciclos del cron para no perder un corte reciente, sin
// arrastrar historia vieja que dispararía alarmas retroactivas inútiles.
const FIRST_RUN_LOOKBACK_MS = 30 * 60_000;

type BreakerRow = {
  id: string;
  tuya_device_id: string;
  tuya_device_name: string | null;
  property_id: string;
  room_id: string | null;
  property: { name: string } | null;
};

async function getCursor(
  admin: ReturnType<typeof createAdminClient>,
  tuyaDeviceId: string,
): Promise<number | null> {
  const { data } = await admin
    .from("tuya_log_cursors")
    .select("last_event_time_ms")
    .eq("tuya_device_id", tuyaDeviceId)
    .maybeSingle();
  const v = data?.last_event_time_ms;
  return v == null ? null : Number(v);
}

async function setCursor(
  admin: ReturnType<typeof createAdminClient>,
  tuyaDeviceId: string,
  eventTimeMs: number,
): Promise<void> {
  await admin.from("tuya_log_cursors").upsert(
    {
      tuya_device_id: tuyaDeviceId,
      last_event_time_ms: eventTimeMs,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tuya_device_id" },
  );
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

  const now = Date.now();

  for (const rule of rules) {
    // Scope esperado: propiedad. Sin property_id no sabemos qué breakers mirar.
    if (!rule.property_id) continue;

    // 2. Breakers de la propiedad.
    const { data: breakers } = await admin
      .from("property_devices")
      .select(
        "id, tuya_device_id, tuya_device_name, property_id, room_id, property:properties(name)",
      )
      .eq("property_id", rule.property_id)
      .eq("device_kind", "breaker");

    // Supabase tipa el join `property:properties(name)` como array; en runtime
    // es un objeto (FK to-one). Cast vía unknown.
    for (const b of (breakers ?? []) as unknown as BreakerRow[]) {
      checked++;

      const device: AlarmDeviceContext = {
        property_device_id: b.id,
        property_id: b.property_id,
        room_id: b.room_id,
        device_name: b.tuya_device_name,
        property_name: b.property?.name ?? null,
        room_name: null,
      };

      // 3. Ventana de logs: desde el cursor (exclusivo) hasta ahora.
      const cursor = await getCursor(admin, b.tuya_device_id);
      const startMs = cursor != null ? cursor + 1 : now - FIRST_RUN_LOOKBACK_MS;

      let logs;
      try {
        logs = await getDeviceFaultLogs(b.tuya_device_id, startMs, now);
      } catch (e) {
        console.warn(
          `[power-outage] getDeviceFaultLogs falló para ${b.tuya_device_id}: ${(e as Error).message}`,
        );
        continue; // no avanzamos el cursor → reintentamos la ventana
      }

      // 4. Estado inicial: ¿hay un evento abierto para (rule, breaker)?
      const { data: openRows } = await admin
        .from("alarm_events")
        .select("id, notified_via_whatsapp")
        .eq("rule_id", rule.id)
        .eq("property_device_id", b.id)
        .is("resolved_at", null)
        .order("fired_at", { ascending: false })
        .limit(1);
      let openEvent = openRows?.[0] ?? null;

      // 5. Recorrer las transiciones del fault en orden cronológico.
      for (const entry of logs) {
        const { isPowerLoss } = decodeFault(Number(entry.value));
        const at = new Date(entry.event_time).toISOString();

        if (isPowerLoss && !openEvent) {
          // Empieza un corte. Crear evento con el timestamp real del log.
          const { data: inserted } = await admin
            .from("alarm_events")
            .insert({
              rule_id: rule.id,
              property_device_id: b.id,
              fired_at: at,
              trigger_value: null,
            })
            .select("id, notified_via_whatsapp")
            .single();
          if (!inserted) continue;
          openEvent = inserted;
          const ok = await notifyAlarmEvent({
            kind: "fired",
            rule,
            device,
            value: null,
            event_id: inserted.id,
          });
          if (ok) fired++;
        } else if (!isPowerLoss && openEvent) {
          // Vuelve la luz. Resolver con el timestamp real del log.
          await admin
            .from("alarm_events")
            .update({ resolved_at: at })
            .eq("id", openEvent.id);
          resolved++;
          // Solo avisar "volvió la luz" si antes avisamos el corte.
          if (openEvent.notified_via_whatsapp) {
            await notifyAlarmEvent({
              kind: "resolved",
              rule,
              device,
              value: null,
              event_id: openEvent.id,
            });
          }
          openEvent = null;
        }
      }

      // 6. Avanzar el cursor a `now` (la ventana ya quedó cubierta). La
      // máquina de estados deja los logs sin transición como no-op, pero NO
      // re-escaneamos para no arriesgar un doble-disparo de episodios ya
      // resueltos.
      await setCursor(admin, b.tuya_device_id, now);
    }
  }

  return { checked, fired, resolved };
}
