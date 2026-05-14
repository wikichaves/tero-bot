import "server-only";
import { tuyaFetch } from "./client";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Backfill historical `energy_snapshots` rows from Tuya's Device Logs API
 * (`/v1.0/devices/{id}/logs?type=7`). Each log entry is a real data-point
 * report, so we can store them directly as snapshots.
 *
 * Why not the Statistics API: that endpoint (`/statistics/days`) requires
 * the "Energy Management" paid add-on on the Tuya developer cloud project,
 * which most users don't have. The Logs API works on the free Smart Home
 * scope (proven by our hourly snapshot cron already reading device status
 * from the same account).
 *
 * Tradeoffs:
 *   - Tuya retains DP logs for 30 days on the free tier (90 with basic
 *     paid). So backfill realistically covers ~1 month, not a full year.
 *   - Logs come at the device's natural reporting cadence (every few
 *     minutes for active meters). The unique-per-hour DB index naturally
 *     downsamples to one snapshot per hour.
 *   - Some firmwares report cumulative energy as an integer in 0.01 kWh
 *     units (`853975` = 8539.75 kWh). We auto-detect the scale by comparing
 *     a recent log entry against the live anchor snapshot and applying
 *     the implied multiplier so backfilled rows match the existing pipeline.
 */

export type BackfillResult = {
  device_id: string;
  tuya_device_id: string;
  inserted: number;
  skipped_duplicate: number;
  logs_fetched: number;
  current_total_kwh: number | null;
  scale_applied: number | null;
  window_start: string | null;
  window_end: string | null;
  error?: string;
};

const ENERGY_CODES = [
  // Most common across TBCin / Smart Life / generic Tuya breakers.
  "forward_energy_total",
  "total_forward_energy",
  "energy_total",
  "total_energy",
  "add_ele",
  // Less common variants we've seen on assorted firmwares — when a
  // device's main meter doesn't surface logs under the common codes,
  // expand here (or run /api/admin/tuya/inspect-logs to discover the
  // actual code names this firmware emits).
  "forward_energy",
  "ele_total",
  "forward_active_total_energy",
  "total_active_energy",
  "kwh_total",
  "cur_total_energy",
  "total_consume",
  "elec_energy",
  "active_energy_total",
];

type LogEntry = {
  /** ISO timestamp (UTC). */
  taken_at: string;
  /** Raw value from the Tuya log — may need scaling. */
  raw_value: number;
  code: string;
};

/**
 * Fetch one energy log per UTC day for a Tuya device over the past `days`
 * days. We deliberately do NOT paginate through all logs because active
 * devices (e.g. a circuit breaker that reports every 15s) emit too many
 * events — pagination depth would cap us at the last few hours and miss
 * historical data.
 *
 * Strategy: one API call per day window with size=50, then keep the most
 * recent energy log within that window. 30 calls per device is cheap
 * and gives us exactly the per-day granularity the bill-comparison needs.
 */
export async function fetchEnergyLogs(
  tuyaDeviceId: string,
  endMs: number,
  days: number,
): Promise<LogEntry[]> {
  type LogsResponse = {
    logs?: Array<{
      code: string;
      value: string | number;
      event_time: number;
    }>;
  };

  const out: LogEntry[] = [];
  const energySet = new Set(ENERGY_CODES);

  for (let offset = 0; offset < days; offset++) {
    const dayEnd = endMs - offset * 86_400_000;
    const dayStart = dayEnd - 86_400_000;
    let r: LogsResponse;
    try {
      r = await tuyaFetch<LogsResponse>(
        "GET",
        `/v1.0/devices/${tuyaDeviceId}/logs`,
        {
          query: {
            type: 7,
            start_time: dayStart,
            end_time: dayEnd,
            size: 50,
          },
        },
      );
    } catch (err) {
      console.warn(
        `[tuya backfill] ${tuyaDeviceId} day -${offset}: ${(err as Error).message}`,
      );
      continue;
    }
    const logs = r.logs ?? [];
    // Logs come back newest-first within the window. First energy match
    // is the most recent reading of that day — perfect anchor for
    // start-of-(next-)day cumulative.
    const energy = logs.find(
      (l) => energySet.has(l.code) && Number.isFinite(Number(l.value)),
    );
    if (energy) {
      out.push({
        taken_at: new Date(energy.event_time).toISOString(),
        raw_value: Number(energy.value),
        code: energy.code,
      });
    }
  }
  return out;
}

/**
 * Compare a recent log entry to the live anchor snapshot to figure out
 * the value scale Tuya is using for this firmware. We snap to the closest
 * common scale (1, 0.01, 0.1, 100) — anything else stays at 1 with a
 * warning logged so the operator can review.
 */
function detectScale(
  liveTotalKwh: number,
  logs: LogEntry[],
  liveTakenAtMs: number,
): number {
  if (logs.length === 0 || liveTotalKwh <= 0) return 1;
  // Use the log whose event_time is closest to the live snapshot — that's
  // the truest apples-to-apples comparison.
  let closest = logs[0];
  let bestDt = Infinity;
  for (const log of logs) {
    const dt = Math.abs(new Date(log.taken_at).getTime() - liveTakenAtMs);
    if (dt < bestDt) {
      bestDt = dt;
      closest = log;
    }
  }
  if (!closest || closest.raw_value <= 0) return 1;
  const ratio = liveTotalKwh / closest.raw_value;
  // Snap to a known scale if we're within ±20% of it.
  const candidates = [1, 0.01, 0.1, 10, 100];
  for (const c of candidates) {
    if (ratio >= c * 0.8 && ratio <= c * 1.2) return c;
  }
  console.warn(
    `[tuya backfill] unusual scale ratio ${ratio.toFixed(4)} (live=${liveTotalKwh}, log=${closest.raw_value}) — using 1`,
  );
  return 1;
}

async function backfillDevice(
  device: { id: string; tuya_device_id: string },
  months: number,
): Promise<BackfillResult> {
  const admin = createAdminClient();
  const endMs = Date.now();
  const startMs = endMs - months * 30 * 24 * 60 * 60 * 1000;
  const result: BackfillResult = {
    device_id: device.id,
    tuya_device_id: device.tuya_device_id,
    inserted: 0,
    skipped_duplicate: 0,
    logs_fetched: 0,
    current_total_kwh: null,
    scale_applied: null,
    window_start: new Date(startMs).toISOString(),
    window_end: new Date(endMs).toISOString(),
  };

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

  const days = Math.max(1, Math.round(months * 30));
  let logs: LogEntry[];
  try {
    logs = await fetchEnergyLogs(device.tuya_device_id, endMs, days);
  } catch (err) {
    result.error = `tuya logs failed: ${(err as Error).message}`;
    return result;
  }
  result.logs_fetched = logs.length;
  if (logs.length === 0) {
    result.error = "no energy logs in window";
    return result;
  }

  const liveMs = new Date(latest.taken_at).getTime();
  const scale = detectScale(result.current_total_kwh, logs, liveMs);
  result.scale_applied = scale;
  console.log(
    `[tuya backfill] ${device.tuya_device_id}: ${logs.length} logs, scale=${scale}`,
  );

  for (const log of logs) {
    const { error } = await admin.from("energy_snapshots").insert({
      property_device_id: device.id,
      total_energy_kwh: Number((log.raw_value * scale).toFixed(2)),
      taken_at: log.taken_at,
      power_w: null,
      voltage_v: null,
      current_a: null,
    });
    if (error) {
      if (/duplicate key|unique/i.test(error.message)) {
        result.skipped_duplicate++;
      } else {
        result.error = `insert at ${log.taken_at} failed: ${error.message}`;
        return result;
      }
    } else {
      result.inserted++;
    }
  }
  return result;
}

/**
 * Backfill every energy-monitored device. "Energy-monitored" means the
 * device already has at least one live snapshot with non-null
 * `total_energy_kwh` — locks/lights/etc. without meter data are skipped.
 */
export async function backfillAllDevices(
  months: number = 1,
): Promise<BackfillResult[]> {
  const admin = createAdminClient();
  const { data: snaps } = await admin
    .from("energy_snapshots")
    .select("property_device_id")
    .not("total_energy_kwh", "is", null);
  const deviceIds = Array.from(
    new Set(
      (snaps ?? []).map(
        (s) => (s as { property_device_id: string }).property_device_id,
      ),
    ),
  );
  if (deviceIds.length === 0) return [];

  const { data: devices } = await admin
    .from("property_devices")
    .select("id, tuya_device_id")
    .in("id", deviceIds);
  const list = (devices ?? []) as Array<{
    id: string;
    tuya_device_id: string;
  }>;

  const results: BackfillResult[] = [];
  for (const d of list) {
    results.push(await backfillDevice(d, months));
  }
  return results;
}
