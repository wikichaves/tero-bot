import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDeviceStatus } from "@/lib/tuya/energy";
import { parseSensorReading, type SensorReading } from "@/lib/tuya/sensors";

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
 * llamar desde el render de `/ambientes` y compensar la limitación de
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
}> {
  const admin = createAdminClient();
  const { data: devices, error } = await admin
    .from("property_devices")
    .select("id, tuya_device_id, tuya_device_name")
    .eq("device_kind", "sensor");
  if (error) {
    throw new Error(`property_devices read failed: ${error.message}`);
  }

  const ranAt = new Date().toISOString();
  const results: SensorSnapshotResult[] = await Promise.all(
    (devices ?? []).map(async (d): Promise<SensorSnapshotResult> => {
      try {
        const status = await getDeviceStatus(d.tuya_device_id);
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
    }),
  );

  return { ranAt, results };
}
