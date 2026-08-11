import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Tuya-measured kWh consumption for a property in a date range, medido por el
 * MEDIDOR PRINCIPAL de la property (WIK-340).
 *
 * Antes sumábamos TODOS los devices de la property. Eso rompía la comparación
 * contra la factura por dos motivos:
 *   1. Doble conteo: el breaker general ya incluye lo que consumen los switches
 *      aguas abajo (Toallero, Lucecitas...). Sumarlos de nuevo infla el total.
 *   2. No todo device es un medidor de la casa entera.
 *
 * Ahora: se usa SOLO el device marcado `is_primary=true` de la property (el
 * "medidor principal", típicamente el breaker general del tablero). Si la
 * property no tiene ninguno marcado → devolvemos `null` y la UI no muestra Δ%
 * (no tiene sentido comparar una factura de toda la casa contra un circuito
 * parcial). El admin marca el medidor principal en /admin/tuya.
 *
 * Algoritmo (sobre el medidor principal):
 *   start_kwh = primer energy_snapshots con taken_at ≥ period_from
 *   end_kwh   = último energy_snapshots con taken_at ≤ period_to + fin de día
 *   delta     = end_kwh − start_kwh   (skip si negativo — reset del contador)
 *
 * WIK-340 — filtro de saltos imposibles: los contadores de algunos breakers
 * traen saltos espurios (ej. +362 kWh en 1h26 al arrancar). Descartamos
 * incrementos entre lecturas consecutivas que superen MAX_KWH_PER_HOUR — son
 * físicamente imposibles para un medidor residencial. El delta del período se
 * computa sumando solo los incrementos "sanos" entre snapshots consecutivos,
 * en vez de un simple last−first (que arrastra los saltos corruptos).
 */

/** Techo físico de consumo por hora para un medidor residencial. Un breaker
 *  general típico de casa raramente pasa de ~15-20 kWh/h sostenido; 25 deja
 *  margen para picos reales (aire + estufa + horno juntos) y corta solo los
 *  saltos claramente corruptos del contador. */
const MAX_KWH_PER_HOUR = 25;

export type ComparisonResult = {
  /** Consumo medido por el medidor principal en el período, en kWh. */
  kwh: number;
  /** How many devices contributed (siempre 0 o 1 ahora: el principal). */
  deviceCount: number;
  totalDevices: number;
  /** Fraction of the bill's period that's actually covered by snapshots.
   *  1.0 = full coverage, 0.5 = half the bill window has data, etc. We
   *  use this to hide the misleading delta% when Tuya only has logs for
   *  the tail of a longer billing period. */
  coverageFraction: number;
};

/**
 * Consumo "sano" de una serie de snapshots [{ms,kwh}] (ordenada asc) dentro
 * de [fromMs,toMs]: suma incrementos entre lecturas consecutivas, descartando
 * los negativos (reset) y los que exceden el techo físico (salto corrupto).
 * Devuelve el kWh acumulado + los timestamps cubiertos, o null si no hay datos.
 */
function sanitizedConsumption(
  series: Array<{ ms: number; kwh: number }>,
  fromMs: number,
  toMs: number,
): { kwh: number; firstMs: number; lastMs: number } | null {
  const win = series.filter((x) => x.ms >= fromMs && x.ms <= toMs);
  if (win.length < 2) return null;
  let kwh = 0;
  let prev = win[0];
  for (let i = 1; i < win.length; i++) {
    const cur = win[i];
    const delta = cur.kwh - prev.kwh;
    const hours = Math.max((cur.ms - prev.ms) / 3_600_000, 1 / 60);
    // Descartar: reset (negativo) o salto físicamente imposible.
    if (Number.isFinite(delta) && delta >= 0 && delta / hours <= MAX_KWH_PER_HOUR) {
      kwh += delta;
    }
    prev = cur;
  }
  return { kwh, firstMs: win[0].ms, lastMs: win[win.length - 1].ms };
}

async function primaryMeter(
  admin: SupabaseClient,
  propertyId: string,
): Promise<{ id: string; factor: number } | null> {
  // El medidor principal = device is_primary=true de la property. Preferimos
  // el breaker; si el índice único (property_id, device_kind) permitiera más
  // de un is_primary por property, priorizamos breaker.
  const { data } = await admin
    .from("property_devices")
    .select("id, device_kind, calibration_factor")
    .eq("property_id", propertyId)
    .eq("is_primary", true);
  const rows = (data ?? []) as Array<{
    id: string;
    device_kind: string;
    calibration_factor: number | null;
  }>;
  if (rows.length === 0) return null;
  const chosen = rows.find((r) => r.device_kind === "breaker") ?? rows[0];
  return { id: chosen.id, factor: Number(chosen.calibration_factor ?? 1) || 1 };
}

export async function computeTuyaConsumption(
  admin: SupabaseClient,
  propertyId: string,
  periodFrom: string,
  periodTo: string,
): Promise<ComparisonResult | null> {
  const meter = await primaryMeter(admin, propertyId);
  if (!meter) return null; // sin medidor principal → no comparamos
  const meterId = meter.id;

  const fromTs = `${periodFrom}T00:00:00Z`;
  const toTs = `${periodTo}T23:59:59Z`;
  const fromMs = new Date(fromTs).getTime();
  const toMs = new Date(toTs).getTime();

  const { data: snaps } = await admin
    .from("energy_snapshots")
    .select("total_energy_kwh, taken_at")
    .eq("property_device_id", meterId)
    .gte("taken_at", fromTs)
    .lte("taken_at", toTs)
    .not("total_energy_kwh", "is", null)
    .order("taken_at", { ascending: true })
    .limit(100_000);
  const series = ((snaps ?? []) as Array<{ total_energy_kwh: number | null; taken_at: string }>)
    .filter((s) => s.total_energy_kwh != null)
    .map((s) => ({ ms: new Date(s.taken_at).getTime(), kwh: Number(s.total_energy_kwh) }));

  const res = sanitizedConsumption(series, fromMs, toMs);
  if (!res) return null;

  const totalSpan = Math.max(1, toMs - fromMs);
  const coveredFrom = Math.max(res.firstMs, fromMs);
  const coveredTo = Math.min(res.lastMs, toMs);
  const coverageFraction = Math.max(0, Math.min(1, (coveredTo - coveredFrom) / totalSpan));

  return {
    // Calibración: kWh_real = kWh_tuya * factor (WIK-343).
    kwh: res.kwh * meter.factor,
    deviceCount: 1,
    totalDevices: 1,
    coverageFraction,
  };
}

/**
 * WIK-328/340: versión BATCHEADA para /energy. Precarga en 2 queries y computa
 * en memoria, usando SOLO el medidor principal de cada property (igual que la
 * versión per-bill). Properties sin medidor principal marcado quedan ausentes
 * del Map (la UI no muestra Δ%).
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

  // 1. Medidor principal por property (1 query). Solo is_primary=true.
  const { data: devs } = await admin
    .from("property_devices")
    .select("id, property_id, device_kind, calibration_factor")
    .in("property_id", propertyIds)
    .eq("is_primary", true);
  const primaryByProperty = new Map<string, string>();
  // Factor de calibración por medidor principal (WIK-343): kWh_real =
  // kWh_tuya * factor. Default 1 si no está seteado.
  const factorByMeter = new Map<string, number>();
  for (const d of (devs ?? []) as Array<{
    id: string;
    property_id: string;
    device_kind: string;
    calibration_factor: number | null;
  }>) {
    // Preferir breaker si hubiera más de un primary por property.
    const existing = primaryByProperty.get(d.property_id);
    if (!existing || d.device_kind === "breaker") {
      primaryByProperty.set(d.property_id, d.id);
    }
    factorByMeter.set(d.id, Number(d.calibration_factor ?? 1) || 1);
  }
  const meterIds = Array.from(new Set(primaryByProperty.values()));
  if (meterIds.length === 0) return out; // ninguna property tiene medidor principal

  // 2. Snapshots de esos medidores hasta maxTo (1 query). Sin piso: el
  //    filtro por período se hace en memoria.
  let maxTo = -Infinity;
  for (const b of bills) {
    const t = new Date(`${b.period_to}T23:59:59Z`).getTime();
    if (t > maxTo) maxTo = t;
  }
  const { data: snaps } = await admin
    .from("energy_snapshots")
    .select("property_device_id, total_energy_kwh, taken_at")
    .in("property_device_id", meterIds)
    .lte("taken_at", new Date(maxTo).toISOString())
    .not("total_energy_kwh", "is", null)
    .order("taken_at", { ascending: true })
    .limit(200_000);
  const snapsByMeter = new Map<string, Array<{ ms: number; kwh: number }>>();
  for (const s of (snaps ?? []) as Array<{
    property_device_id: string;
    total_energy_kwh: number | null;
    taken_at: string;
  }>) {
    if (s.total_energy_kwh == null) continue;
    const arr = snapsByMeter.get(s.property_device_id) ?? [];
    arr.push({ ms: new Date(s.taken_at).getTime(), kwh: Number(s.total_energy_kwh) });
    snapsByMeter.set(s.property_device_id, arr);
  }

  // 3. Por bill: consumo sano del medidor principal en su período.
  for (const bill of bills) {
    const meterId = primaryByProperty.get(bill.property_id);
    if (!meterId) continue; // property sin medidor principal
    const series = snapsByMeter.get(meterId);
    if (!series) continue;
    const fromMs = new Date(`${bill.period_from}T00:00:00Z`).getTime();
    const toMs = new Date(`${bill.period_to}T23:59:59Z`).getTime();
    const res = sanitizedConsumption(series, fromMs, toMs);
    if (!res) continue;
    const totalSpan = Math.max(1, toMs - fromMs);
    const coveredFrom = Math.max(res.firstMs, fromMs);
    const coveredTo = Math.min(res.lastMs, toMs);
    const coverageFraction = Math.max(0, Math.min(1, (coveredTo - coveredFrom) / totalSpan));
    const factor = factorByMeter.get(meterId) ?? 1;
    out.set(bill.id, {
      // Calibración: kWh_real = kWh_tuya * factor (WIK-343).
      kwh: res.kwh * factor,
      deviceCount: 1,
      totalDevices: 1,
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
