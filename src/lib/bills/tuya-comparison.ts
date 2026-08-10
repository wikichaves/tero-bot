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
 * WIK-328: versión BATCHEADA de computeTuyaConsumption para /energy.
 *
 * El caller (/energy) compara hasta 6 facturas por property. La versión
 * per-bill hacía, por cada factura: 1 query de devices + 2 queries por device.
 * Con P properties × 6 bills × M devices eso explota en round-trips.
 *
 * Esta versión precarga TODO en 2 queries y computa en memoria:
 *   1. property_devices de todas las properties pedidas (1 query .in).
 *   2. energy_snapshots de esos devices en el rango GLOBAL
 *      [min(period_from), max(period_to)] (1 query .in + rango).
 * Luego, para cada (bill), replica la MISMA lógica que computeTuyaConsumption:
 *   - por device de la property de la bill: primer snapshot con
 *     taken_at ≥ from y último con taken_at ≤ to+fin-de-día; delta = end−start
 *     (skip si null o negativo). Suma deltas. coverageFraction idéntico.
 *
 * Devuelve un Map keyed por bill.id con el ComparisonResult (o ausente si
 * null, igual que la versión per-bill devolvía null).
 */
export type BatchBillInput = {
  id: string;
  property_id: string;
  /** YYYY-MM-DD */
  period_from: string;
  /** YYYY-MM-DD */
  period_to: string;
};

export async function computeTuyaConsumptionBatch(
  admin: SupabaseClient,
  bills: BatchBillInput[],
): Promise<Map<string, ComparisonResult>> {
  const out = new Map<string, ComparisonResult>();
  if (bills.length === 0) return out;

  const propertyIds = Array.from(new Set(bills.map((b) => b.property_id)));

  // 1. Todos los devices de esas properties (1 query).
  const { data: devs } = await admin
    .from("property_devices")
    .select("id, property_id")
    .in("property_id", propertyIds);
  const deviceList = (devs ?? []) as Array<{ id: string; property_id: string }>;
  const devicesByProperty = new Map<string, string[]>();
  for (const d of deviceList) {
    const arr = devicesByProperty.get(d.property_id) ?? [];
    arr.push(d.id);
    devicesByProperty.set(d.property_id, arr);
  }
  const allDeviceIds = deviceList.map((d) => d.id);
  if (allDeviceIds.length === 0) return out;

  // 2. Rango global [min from 00:00Z, max to 23:59:59Z] — mismos bounds
  //    inclusivos que la versión per-bill.
  let minFrom = Infinity;
  let maxTo = -Infinity;
  for (const b of bills) {
    const f = new Date(`${b.period_from}T00:00:00Z`).getTime();
    const t = new Date(`${b.period_to}T23:59:59Z`).getTime();
    if (f < minFrom) minFrom = f;
    if (t > maxTo) maxTo = t;
  }
  // OJO semántica (WIK-328): la versión per-bill busca start = primer snapshot
  // con taken_at ≥ from (SIN tope superior) y end = último con taken_at ≤ to
  // (SIN piso inferior). Para replicarlo EXACTO no ponemos piso `minFrom`: un
  // `end` válido puede ser anterior al from más chico del batch. Sí acotamos
  // por arriba a `maxTo` (nada usa snapshots > maxTo: end es ≤to, y un start
  // >to sin end ≤to se descarta). `minFrom` no se usa como filtro.
  void minFrom;
  const { data: snaps } = await admin
    .from("energy_snapshots")
    .select("property_device_id, total_energy_kwh, taken_at")
    .in("property_device_id", allDeviceIds)
    .lte("taken_at", new Date(maxTo).toISOString())
    .not("total_energy_kwh", "is", null)
    .order("taken_at", { ascending: true })
    .limit(200_000);
  // Agrupamos por device, ya ordenado asc por taken_at.
  const snapsByDevice = new Map<
    string,
    Array<{ ms: number; kwh: number }>
  >();
  for (const s of (snaps ?? []) as Array<{
    property_device_id: string;
    total_energy_kwh: number | null;
    taken_at: string;
  }>) {
    if (s.total_energy_kwh == null) continue;
    const arr = snapsByDevice.get(s.property_device_id) ?? [];
    arr.push({ ms: new Date(s.taken_at).getTime(), kwh: Number(s.total_energy_kwh) });
    snapsByDevice.set(s.property_device_id, arr);
  }

  // 3. Por bill: replicar computeTuyaConsumption en memoria.
  for (const bill of bills) {
    const fromMs = new Date(`${bill.period_from}T00:00:00Z`).getTime();
    const toMs = new Date(`${bill.period_to}T23:59:59Z`).getTime();
    const devIds = devicesByProperty.get(bill.property_id) ?? [];
    if (devIds.length === 0) continue; // == null en la versión per-bill

    let totalKwh = 0;
    let contributingDevices = 0;
    let earliestStartMs = Infinity;
    let latestEndMs = 0;
    for (const devId of devIds) {
      const series = snapsByDevice.get(devId);
      if (!series || series.length === 0) continue;
      // primer snapshot con ms ≥ fromMs (series ordenada asc).
      let start: { ms: number; kwh: number } | undefined;
      for (const x of series) {
        if (x.ms >= fromMs) { start = x; break; }
      }
      // último snapshot con ms ≤ toMs.
      let end: { ms: number; kwh: number } | undefined;
      for (let i = series.length - 1; i >= 0; i--) {
        if (series[i].ms <= toMs) { end = series[i]; break; }
      }
      if (!start || !end) continue;
      const delta = end.kwh - start.kwh;
      if (!Number.isFinite(delta) || delta < 0) continue;
      totalKwh += delta;
      contributingDevices++;
      if (start.ms < earliestStartMs) earliestStartMs = start.ms;
      if (end.ms > latestEndMs) latestEndMs = end.ms;
    }
    if (contributingDevices === 0) continue;

    const totalSpan = Math.max(1, toMs - fromMs);
    const coveredFrom = Math.max(earliestStartMs, fromMs);
    const coveredTo = Math.min(latestEndMs, toMs);
    const coverageFraction = Math.max(
      0,
      Math.min(1, (coveredTo - coveredFrom) / totalSpan),
    );
    out.set(bill.id, {
      kwh: totalKwh,
      deviceCount: contributingDevices,
      totalDevices: devIds.length,
      coverageFraction,
    });
  }
  return out;
}

/**
 * Categorize a delta (facturado vs. medido) into a UI level. Used by
 * /bills to color the badge. Thresholds chosen for residential
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
