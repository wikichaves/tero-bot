import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { mapWithConcurrency, withRetry } from "@/lib/util/concurrent";
import { getDeviceStatus } from "@/lib/tuya/energy";
import { parseSensorReading, type SensorReading } from "@/lib/tuya/sensors";
import {
  evaluateAlarmsForSnapshot,
  loadEnabledRules,
  type AlarmDeviceContext,
} from "./alarms";
import { notifyAlarmEvent } from "./notify";

/**
 * WIK-161 v2: cap de concurrencia para Tuya. Ver doc en
 * `src/lib/tuya/snapshots.ts` — mismo razonamiento.
 */
const TUYA_CONCURRENCY = 3;

/**
 * Snapshot horario de sensores T/H. Mirrorea el patrón de
 * `src/lib/tuya/snapshots.ts` (energy) pero para sensores:
 *
 *   1. Lista `property_devices` con `device_kind='sensor'`.
 *   2. Por cada uno llama `/v1.0/devices/{id}/status` en paralelo.
 *   3. Parsea con `parseSensorReading`.
 *   4. Inserta una fila en `sensor_snapshots`. Idempotente por
 *      `(property_device_id, taken_at)` — si el cron se dispara dos
 *      veces dentro del mismo segundo (raro), la segunda falla con
 *      conflict y la skippeamos sin error.
 *
 * Devices que no devuelven ni temp ni humidity se skippean para no
 * llenar la tabla de NULLs (típicamente un device mal marcado como
 * sensor o un firmware que necesita config extra).
 */

export type SensorSnapshotResult = {
  property_device_id: string;
  tuya_device_id: string;
  ok: boolean;
  reading?: SensorReading;
  inserted?: boolean;
  reason?: string;
};

/**
 * Si el snapshot más reciente tiene más de `staleMinutes` de antigüedad,
 * dispara una nueva captura. Si está fresco, no hace nada. Útil para
 * llamar desde el render de `/rooms` y compensar la limitación de
 * Vercel Hobby (cron diario-only) — cada vez que alguien abre la
 * página, se asegura de que los datos sean ≤60 min antiguos.
 *
 * Idempotente y safe to fire-and-forget: errores se loggean pero no
 * tiran. Lo mismo que `maybeSnapshotIfStale` de energy/snapshots.
 */
export async function maybeSnapshotSensorsIfStale(
  staleMinutes: number = 60,
): Promise<{ skipped: boolean; reason?: string }> {
  const admin = createAdminClient();
  const { data: latest, error } = await admin
    .from("sensor_snapshots")
    .select("taken_at")
    .order("taken_at", { ascending: false })
    .limit(1);
  if (error) {
    return { skipped: true, reason: `latest read failed: ${error.message}` };
  }
  const lastTs = latest?.[0]?.taken_at;
  if (lastTs) {
    const ageMin =
      (Date.now() - new Date(lastTs).getTime()) / 1000 / 60;
    if (ageMin < staleMinutes) {
      return { skipped: true, reason: `fresh (${Math.round(ageMin)}min)` };
    }
  }
  try {
    await snapshotAllSensors();
    return { skipped: false };
  } catch (e) {
    return { skipped: true, reason: (e as Error).message };
  }
}

export async function snapshotAllSensors(): Promise<{
  ranAt: string;
  results: SensorSnapshotResult[];
  alarmsFired?: number;
  alarmsResolved?: number;
}> {
  const admin = createAdminClient();
  // Cargamos todos los sensores + context (property + room) en una sola
  // query para que la evaluación de alarmas no haga lookups extra.
  const { data: devices, error } = await admin
    .from("property_devices")
    .select(
      "id, tuya_device_id, tuya_device_name, property_id, room_id, property:properties(name), room:rooms(name)",
    )
    .eq("device_kind", "sensor")
    .overrideTypes<
      Array<{
        id: string;
        tuya_device_id: string;
        tuya_device_name: string | null;
        property_id: string;
        room_id: string | null;
        property: { name: string } | null;
        room: { name: string } | null;
      }>
    >();
  if (error) {
    throw new Error(`property_devices read failed: ${error.message}`);
  }

  // Reglas activas (una sola query para todo el batch).
  const rules = await loadEnabledRules(admin);

  const ranAt = new Date().toISOString();
  const results: SensorSnapshotResult[] = await mapWithConcurrency(
    devices ?? [],
    async (d): Promise<SensorSnapshotResult> => {
      try {
        // WIK-161 v2: retry con backoff ante 429 / network errors.
        const status = await withRetry(() => getDeviceStatus(d.tuya_device_id));
        const reading = parseSensorReading(status);
        if (reading.temperature_c == null && reading.humidity_pct == null) {
          return {
            property_device_id: d.id,
            tuya_device_id: d.tuya_device_id,
            ok: true,
            inserted: false,
            reason: "no sensor data",
          };
        }
        const { error: insertError } = await admin
          .from("sensor_snapshots")
          .insert({
            property_device_id: d.id,
            taken_at: ranAt,
            temperature_c: reading.temperature_c,
            humidity_pct: reading.humidity_pct,
            battery_pct: reading.battery_pct,
            raw_dps: status,
          });
        if (insertError) {
          // Conflict por unique (property_device_id, taken_at) → idempotente.
          if (insertError.code === "23505") {
            return {
              property_device_id: d.id,
              tuya_device_id: d.tuya_device_id,
              ok: true,
              reading,
              inserted: false,
              reason: "duplicate (idempotent)",
            };
          }
          return {
            property_device_id: d.id,
            tuya_device_id: d.tuya_device_id,
            ok: false,
            reading,
            reason: `insert failed: ${insertError.message}`,
          };
        }
        return {
          property_device_id: d.id,
          tuya_device_id: d.tuya_device_id,
          ok: true,
          reading,
          inserted: true,
        };
      } catch (e) {
        return {
          property_device_id: d.id,
          tuya_device_id: d.tuya_device_id,
          ok: false,
          reason: (e as Error).message,
        };
      }
    },
    TUYA_CONCURRENCY,
  );

  // Evaluación de alarmas — corre después del INSERT por cada device que
  // tuvo lectura válida. Evaluamos en secuencia (no en paralelo) para
  // evitar race conditions en el chequeo de "alarm_event abierto".
  //
  // Recolectamos los notifies en una lista y los esperamos al final con
  // Promise.allSettled. Antes hacíamos fire-and-forget (sin await) pero
  // en Vercel serverless eso fallaba: la function termina antes de que
  // se complete el send a Kapso y las promises pendientes se cortan,
  // dejando los outbound messages sin persistir. Bug detectado al
  // probar end-to-end con WIK-82.
  let alarmsFired = 0;
  let alarmsResolved = 0;
  const notifyPromises: Promise<unknown>[] = [];
  if (rules.length > 0) {
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (!r.reading) continue;
      const d = (devices ?? [])[i];
      if (!d) continue;
      const ctx: AlarmDeviceContext = {
        property_device_id: d.id,
        property_id: d.property_id,
        room_id: d.room_id,
        device_name: d.tuya_device_name,
        property_name: d.property?.name ?? null,
        room_name: d.room?.name ?? null,
      };
      try {
        const events = await evaluateAlarmsForSnapshot(
          admin,
          ctx,
          r.reading,
          rules,
        );
        for (const ev of events) {
          if (ev.kind === "fired") alarmsFired++;
          else alarmsResolved++;
          notifyPromises.push(
            notifyAlarmEvent(ev).catch((e) =>
              console.warn(
                "[snapshotAllSensors] notify failed:",
                (e as Error).message,
              ),
            ),
          );
        }
      } catch (e) {
        console.warn(
          `[snapshotAllSensors] alarm eval failed device=${d.id}:`,
          (e as Error).message,
        );
      }
    }
  }
  // Esperar todos los sends antes de devolver — garantiza que los
  // outbound messages queden persisted aun en Vercel serverless.
  if (notifyPromises.length > 0) {
    await Promise.allSettled(notifyPromises);
  }

  return { ranAt, results, alarmsFired, alarmsResolved };
}
