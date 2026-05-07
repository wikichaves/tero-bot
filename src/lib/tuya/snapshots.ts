import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDeviceStatus, parseEnergyReading } from "./energy";

export type SnapshotResult = {
  property_device_id: string;
  tuya_device_id: string;
  ok: boolean;
  inserted?: boolean;
  reason?: string;
};

/**
 * Snapshot every property_device's current reading into energy_snapshots.
 * Idempotent per hour via the unique index on (property_device_id, hour).
 *
 * Skips devices that don't return any energy data (e.g. switches without
 * power monitoring) to avoid filling the table with empty rows.
 */
export async function snapshotAllDevices(): Promise<{
  ranAt: string;
  results: SnapshotResult[];
}> {
  const admin = createAdminClient();
  const { data: devices, error } = await admin
    .from("property_devices")
    .select("id, tuya_device_id, tuya_device_name, device_kind");
  if (error) {
    throw new Error(`property_devices read failed: ${error.message}`);
  }

  const results: SnapshotResult[] = await Promise.all(
    (devices ?? []).map(async (d): Promise<SnapshotResult> => {
      try {
        const status = await getDeviceStatus(d.tuya_device_id);
        const reading = parseEnergyReading(status);
        // Skip if nothing useful — most devices won't be energy meters.
        if (
          reading.power_w == null &&
          reading.total_energy_kwh == null &&
          reading.voltage_v == null &&
          reading.current_a == null
        ) {
          return {
            property_device_id: d.id,
            tuya_device_id: d.tuya_device_id,
            ok: true,
            inserted: false,
            reason: "no energy data",
          };
        }
        const { error: insertError } = await admin
          .from("energy_snapshots")
          .insert({
            property_device_id: d.id,
            power_w: reading.power_w,
            total_energy_kwh: reading.total_energy_kwh,
            voltage_v: reading.voltage_v,
            current_a: reading.current_a,
          });
        // Duplicate-key on the unique hourly index → already snapshotted; OK.
        if (insertError && /duplicate key|unique/i.test(insertError.message)) {
          return {
            property_device_id: d.id,
            tuya_device_id: d.tuya_device_id,
            ok: true,
            inserted: false,
            reason: "already snapshotted this hour",
          };
        }
        if (insertError) {
          return {
            property_device_id: d.id,
            tuya_device_id: d.tuya_device_id,
            ok: false,
            reason: insertError.message,
          };
        }
        return {
          property_device_id: d.id,
          tuya_device_id: d.tuya_device_id,
          ok: true,
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

  return { ranAt: new Date().toISOString(), results };
}

/**
 * Compute consumption (kWh delta) and time-window snapshots for a single
 * device. `since` is an ISO timestamp (UTC).
 */
export async function getConsumptionSince(
  propertyDeviceId: string,
  sinceIso: string,
): Promise<{
  first: { taken_at: string; total_energy_kwh: number | null } | null;
  last: { taken_at: string; total_energy_kwh: number | null } | null;
  delta_kwh: number | null;
}> {
  const admin = createAdminClient();
  const [firstRes, lastRes] = await Promise.all([
    admin
      .from("energy_snapshots")
      .select("taken_at, total_energy_kwh")
      .eq("property_device_id", propertyDeviceId)
      .gte("taken_at", sinceIso)
      .not("total_energy_kwh", "is", null)
      .order("taken_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    admin
      .from("energy_snapshots")
      .select("taken_at, total_energy_kwh")
      .eq("property_device_id", propertyDeviceId)
      .not("total_energy_kwh", "is", null)
      .order("taken_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const first = firstRes.data
    ? {
        taken_at: firstRes.data.taken_at as string,
        total_energy_kwh: firstRes.data.total_energy_kwh as number | null,
      }
    : null;
  const last = lastRes.data
    ? {
        taken_at: lastRes.data.taken_at as string,
        total_energy_kwh: lastRes.data.total_energy_kwh as number | null,
      }
    : null;
  let delta: number | null = null;
  if (
    first &&
    last &&
    first.total_energy_kwh != null &&
    last.total_energy_kwh != null &&
    last.total_energy_kwh >= first.total_energy_kwh
  ) {
    delta = last.total_energy_kwh - first.total_energy_kwh;
  }
  return { first, last, delta_kwh: delta };
}

export function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function startOfDaysAgoIso(daysAgo: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

/**
 * If the most recent snapshot is older than `maxAgeMinutes` (or there are
 * none), take a fresh one. Used as a fallback when the cron frequency is
 * limited (Vercel Hobby allows only daily crons).
 *
 * Best-effort: errors are swallowed so a flaky Tuya call doesn't break
 * page rendering.
 */
export async function maybeSnapshotIfStale(
  maxAgeMinutes = 60,
): Promise<{ snapshotted: boolean; reason?: string }> {
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from("energy_snapshots")
    .select("taken_at")
    .gte("taken_at", cutoff)
    .order("taken_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    return { snapshotted: false, reason: error.message };
  }
  if (data?.taken_at) {
    return { snapshotted: false, reason: "fresh enough" };
  }
  try {
    await snapshotAllDevices();
    return { snapshotted: true };
  } catch (e) {
    return { snapshotted: false, reason: (e as Error).message };
  }
}
