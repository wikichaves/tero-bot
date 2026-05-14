import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Tuya-measured kWh consumption for a property in a date range, summed
 * across all of its energy-monitored devices.
 *
 * Algorithm (per device):
 *   start_kwh = first energy_snapshots row with taken_at ≥ period_from
 *   end_kwh   = last  energy_snapshots row with taken_at ≤ period_to+1d
 *   delta     = end_kwh − start_kwh   (skip if negative — meter reset)
 *
 * Then we sum the deltas. Returns `null` when we don't have enough data
 * to compute reliably (no devices, no snapshots in range). Otherwise
 * returns `{ kwh, deviceCount }` so the UI can flag partial coverage.
 *
 * Caveats:
 *   - Counters are cumulative, so a device whose meter was reset mid-period
 *     under-reports. We skip negative deltas (the simpler / safer choice)
 *     instead of trying to detect the wrap point.
 *   - If a device started reporting mid-period, start_kwh is the first
 *     available snapshot — which means the delta covers a shorter window
 *     than the bill. We don't try to extrapolate; the comparison just
 *     reads "low" in that case (admin can spot it from device count).
 */

export type ComparisonResult = {
  /** Sum of (end − start) across all eligible devices, in kWh. */
  kwh: number;
  /** How many devices contributed (vs. how many exist for the property). */
  deviceCount: number;
  totalDevices: number;
  /** Fraction of the bill's period that's actually covered by snapshots.
   *  1.0 = full coverage, 0.5 = half the bill window has data, etc. We
   *  use this to hide the misleading delta% when Tuya only has logs for
   *  the tail of a longer billing period. */
  coverageFraction: number;
};

export async function computeTuyaConsumption(
  admin: SupabaseClient,
  propertyId: string,
  periodFrom: string,
  periodTo: string,
): Promise<ComparisonResult | null> {
  // Inclusive bounds: period_from is the *start* of the from-date (00:00Z),
  // period_to is the *end* of the to-date (23:59:59Z) so snapshots taken
  // anytime on that final day count.
  const fromTs = `${periodFrom}T00:00:00Z`;
  const toTs = `${periodTo}T23:59:59Z`;

  const { data: devices } = await admin
    .from("property_devices")
    .select("id")
    .eq("property_id", propertyId);
  const deviceList = (devices ?? []) as Array<{ id: string }>;
  if (deviceList.length === 0) return null;

  let totalKwh = 0;
  let contributingDevices = 0;
  let earliestStartMs = Infinity;
  let latestEndMs = 0;
  for (const device of deviceList) {
    const [startRes, endRes] = await Promise.all([
      admin
        .from("energy_snapshots")
        .select("total_energy_kwh, taken_at")
        .eq("property_device_id", device.id)
        .gte("taken_at", fromTs)
        .order("taken_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
      admin
        .from("energy_snapshots")
        .select("total_energy_kwh, taken_at")
        .eq("property_device_id", device.id)
        .lte("taken_at", toTs)
        .order("taken_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    const start = startRes.data?.total_energy_kwh;
    const end = endRes.data?.total_energy_kwh;
    const startTakenAt = startRes.data?.taken_at;
    const endTakenAt = endRes.data?.taken_at;
    if (start == null || end == null) continue;
    const delta = Number(end) - Number(start);
    if (!Number.isFinite(delta) || delta < 0) continue;
    totalKwh += delta;
    contributingDevices++;
    if (startTakenAt) {
      const ms = new Date(startTakenAt).getTime();
      if (ms < earliestStartMs) earliestStartMs = ms;
    }
    if (endTakenAt) {
      const ms = new Date(endTakenAt).getTime();
      if (ms > latestEndMs) latestEndMs = ms;
    }
  }

  if (contributingDevices === 0) return null;

  // Coverage: how much of [periodFrom, periodTo] is actually spanned by
  // our snapshots. 1.0 when our earliest snap ≤ periodFrom and latest
  // snap ≥ periodTo; smaller when Tuya only has data for part of the
  // window (typical for recently-paired devices or 30-day log retention).
  const periodFromMs = new Date(fromTs).getTime();
  const periodToMs = new Date(toTs).getTime();
  const totalSpan = Math.max(1, periodToMs - periodFromMs);
  const coveredFrom = Math.max(earliestStartMs, periodFromMs);
  const coveredTo = Math.min(latestEndMs, periodToMs);
  const coverageFraction = Math.max(
    0,
    Math.min(1, (coveredTo - coveredFrom) / totalSpan),
  );

  return {
    kwh: totalKwh,
    deviceCount: contributingDevices,
    totalDevices: deviceList.length,
    coverageFraction,
  };
}

/**
 * Categorize a delta (facturado vs. medido) into a UI level. Used by
 * /facturas to color the badge. Thresholds chosen for residential
 * electricity in AR/UY — refine when we see real data spread.
 *
 *   |Δ| ≤ 5 %   → "ok"      (verde):   medición coincide con la factura
 *   |Δ| ≤ 15 %  → "warn"    (amarillo): diferencia plausible (calibración,
 *                                       fechas de lectura desplazadas,
 *                                       consumos no medidos por Tuya)
 *   |Δ| >  15 % → "alert"   (rojo):    para revisar — sospecha de cobro
 *                                       indebido o medidor mal configurado
 */
export type DeltaLevel = "ok" | "warn" | "alert";

export function deltaLevel(deltaPct: number): DeltaLevel {
  const abs = Math.abs(deltaPct);
  if (abs <= 5) return "ok";
  if (abs <= 15) return "warn";
  return "alert";
}
