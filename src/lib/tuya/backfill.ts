import "server-only";
import { tuyaFetch } from "./client";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Backfill historical `energy_snapshots` rows by pulling daily consumption
 * from Tuya's Statistics API. Used once to seed a year of history so that
 * existing utility_bills can be compared against measured Tuya usage —
 * the cron only collects going forward.
 *
 * Strategy per device:
 *   1. Read current `total_energy_kwh` from the most recent live snapshot.
 *      That's our anchor: at time T_now, cumulative meter = M_now.
 *   2. Fetch daily kWh consumed for the past N months from Tuya.
 *   3. Working backwards: M_start_of_today = M_now − today_so_far_kwh.
 *      Then for each prior day, M_start_of_day = M_start_of_next_day −
 *      that_day's_kwh.
 *   4. Insert one synthetic snapshot per day at 00:00 UTC. The unique
 *      hourly index ensures we don't double-insert if backfill is re-run.
 *
 * Caveats:
 *   - Tuya's Statistics API response shape varies by device family. We
 *     normalize a handful of common forms ({days: {...}}, [{day, value}],
 *     {result: {...}}).
 *   - Devices whose latest snapshot has `total_energy_kwh = null` are
 *     skipped (we have no anchor cumulative value).
 *   - Values are taken at face value (no unit conversion). The existing
 *     live-snapshot code stores kWh directly, so we match that.
 */

export type DayStat = { day: string; kwh: number };

export type BackfillResult = {
  device_id: string;
  tuya_device_id: string;
  inserted: number;
  skipped_duplicate: number;
  start_day: string | null;
  end_day: string | null;
  current_total_kwh: number | null;
  computed_start_kwh: number | null;
  error?: string;
};

function formatDay(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/**
 * Fetch daily energy consumption (kWh per UTC day) for a Tuya device.
 * Tries the legacy path first, falls back to iot-03. Normalizes the
 * response shape so callers see a clean `[{day, kwh}, ...]` list.
 */
export async function fetchDailyEnergyKwh(
  tuyaDeviceId: string,
  startDay: string,
  endDay: string,
): Promise<DayStat[]> {
  const paths = [
    `/v1.0/devices/${tuyaDeviceId}/statistics/days`,
    `/v1.0/iot-03/devices/${tuyaDeviceId}/statistics/days`,
  ];
  // Energy meters expose daily consumption under one of these DP codes.
  // Order = most-common-first for the TBCin/Smart Life family.
  const codes = ["add_ele", "forward_energy_total", "energy_total"];

  let lastErr: unknown = null;
  for (const path of paths) {
    for (const code of codes) {
      try {
        const r = await tuyaFetch<unknown>("GET", path, {
          query: {
            start_day: startDay,
            end_day: endDay,
            type: "sum",
            code,
          },
        });
        const parsed = parseStatsResponse(r);
        if (parsed.length > 0) {
          console.log(
            `[tuya backfill] ${tuyaDeviceId}: path=${path} code=${code} → ${parsed.length} days`,
          );
          return parsed;
        }
      } catch (err) {
        lastErr = err;
        console.warn(
          `[tuya backfill] ${tuyaDeviceId}: ${path} code=${code} failed: ${(err as Error).message}`,
        );
      }
    }
  }
  if (lastErr) throw lastErr;
  return [];
}

/**
 * Tuya's response shapes we've observed in the wild:
 *   1. `{ "20240101": "5.23", "20240102": "4.87", ... }`
 *   2. `{ "days": { "20240101": 5.23, ... } }`
 *   3. `[{ "day": "20240101", "value": "5.23" }, ...]`
 *   4. `{ "result": { ... same as (1) ... } }`
 *
 * `tuyaFetch` already unwraps `data.result`, so we mostly land on (1)-(3).
 */
function parseStatsResponse(r: unknown): DayStat[] {
  if (!r) return [];
  const out: DayStat[] = [];
  if (Array.isArray(r)) {
    for (const item of r) {
      if (item && typeof item === "object") {
        const it = item as Record<string, unknown>;
        const day = String(it.day ?? it.date ?? "");
        const value = it.value ?? it.kwh ?? it.sum;
        const kwh = Number(value);
        if (/^\d{8}$/.test(day) && Number.isFinite(kwh)) {
          out.push({ day, kwh });
        }
      }
    }
    return sortDays(out);
  }
  if (typeof r === "object") {
    const obj = r as Record<string, unknown>;
    // Look for a nested "days" container; otherwise treat the top-level
    // object as the day-map.
    const inner =
      obj.days && typeof obj.days === "object"
        ? (obj.days as Record<string, unknown>)
        : obj;
    for (const [k, v] of Object.entries(inner)) {
      if (!/^\d{8}$/.test(k)) continue;
      const kwh = Number(v);
      if (Number.isFinite(kwh)) out.push({ day: k, kwh });
    }
  }
  return sortDays(out);
}

function sortDays(xs: DayStat[]): DayStat[] {
  return xs.sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * Backfill snapshots for a single device. Returns a per-device report so
 * the caller can show what happened in the UI / logs.
 */
async function backfillDevice(
  device: { id: string; tuya_device_id: string },
  months: number,
): Promise<BackfillResult> {
  const admin = createAdminClient();
  const today = new Date();
  const startDate = new Date(today);
  startDate.setUTCMonth(startDate.getUTCMonth() - months);
  const startDay = formatDay(startDate);
  const endDay = formatDay(today);

  const result: BackfillResult = {
    device_id: device.id,
    tuya_device_id: device.tuya_device_id,
    inserted: 0,
    skipped_duplicate: 0,
    start_day: startDay,
    end_day: endDay,
    current_total_kwh: null,
    computed_start_kwh: null,
  };

  // Anchor: most recent live snapshot with a non-null cumulative reading.
  const { data: latest } = await admin
    .from("energy_snapshots")
    .select("total_energy_kwh, taken_at")
    .eq("property_device_id", device.id)
    .not("total_energy_kwh", "is", null)
    .order("taken_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latest?.total_energy_kwh) {
    result.error = "no anchor snapshot (run 'Snapshot ahora' first)";
    return result;
  }
  result.current_total_kwh = Number(latest.total_energy_kwh);

  let stats: DayStat[];
  try {
    stats = await fetchDailyEnergyKwh(device.tuya_device_id, startDay, endDay);
  } catch (err) {
    result.error = `tuya stats failed: ${(err as Error).message}`;
    return result;
  }
  if (stats.length === 0) {
    result.error = "no daily stats returned by Tuya";
    return result;
  }

  // Compute the cumulative meter reading at the start of each day.
  // Sum of all kWh in window = M_now − M_start_of_oldest_day.
  const totalInWindow = stats.reduce((s, x) => s + x.kwh, 0);
  const startTotal = result.current_total_kwh - totalInWindow;
  result.computed_start_kwh = startTotal;

  let running = startTotal;
  for (const stat of stats) {
    // Insert at 00:00 UTC of `stat.day`. The day in `stat` is when the
    // consumption happened, and `running` going into the loop iteration
    // is the meter reading at the start of that day.
    const iso = `${stat.day.slice(0, 4)}-${stat.day.slice(4, 6)}-${stat.day.slice(6, 8)}T00:00:00Z`;
    const { error } = await admin.from("energy_snapshots").insert({
      property_device_id: device.id,
      total_energy_kwh: Number(running.toFixed(2)),
      taken_at: iso,
      power_w: null,
      voltage_v: null,
      current_a: null,
    });
    if (error) {
      if (/duplicate key|unique/i.test(error.message)) {
        result.skipped_duplicate++;
      } else {
        result.error = `insert at ${iso} failed: ${error.message}`;
        return result;
      }
    } else {
      result.inserted++;
    }
    running += stat.kwh;
  }

  return result;
}

/**
 * Backfill all energy-monitored devices in the system. "Energy-monitored"
 * = devices that have at least one snapshot with non-null total_energy_kwh
 * (locks, lights, etc. are excluded — they have no meter data anyway).
 */
export async function backfillAllDevices(
  months: number = 12,
): Promise<BackfillResult[]> {
  const admin = createAdminClient();
  // Find candidate devices: any property_device with a non-null
  // total_energy_kwh anchor.
  const { data: snaps } = await admin
    .from("energy_snapshots")
    .select("property_device_id")
    .not("total_energy_kwh", "is", null);
  const deviceIds = Array.from(
    new Set(
      (snaps ?? []).map((s) => (s as { property_device_id: string }).property_device_id),
    ),
  );
  if (deviceIds.length === 0) return [];

  const { data: devices } = await admin
    .from("property_devices")
    .select("id, tuya_device_id")
    .in("id", deviceIds);
  const list = (devices ?? []) as Array<{ id: string; tuya_device_id: string }>;

  // Serial, not parallel: we don't want to hammer Tuya's rate limits.
  const results: BackfillResult[] = [];
  for (const d of list) {
    results.push(await backfillDevice(d, months));
  }
  return results;
}
