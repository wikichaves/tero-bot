import "server-only";
import { tuyaFetch } from "./client";
import type { TuyaDevice } from "./devices";

/**
 * Energy / consumption helpers for Tuya circuit breakers.
 *
 * Circuit breakers (category "pc" → name "Circuit breaker") expose a set of
 * data points (DPs) that report instantaneous and cumulative consumption.
 *
 * The DP codes are NOT 100% standardized across firmware versions, so we
 * read the full status payload and look up the most common variants.
 *
 * Common DP codes & units:
 *   - cur_power            → 0.1 W   (active power, multiply by 0.1 to get W)
 *   - cur_voltage          → 0.1 V
 *   - cur_current          → 1 mA    (divide by 1000 → A)
 *   - forward_energy_total → 0.01 kWh (cumulative; some firmware uses
 *                                       `total_forward_energy` instead)
 *   - phase_a              → composite voltage/current/power (some breakers)
 */

export type TuyaStatusValue = number | string | boolean;

export type TuyaStatusItem = {
  code: string;
  value: TuyaStatusValue;
};

export async function getDeviceStatus(
  deviceId: string,
): Promise<TuyaStatusItem[]> {
  const r = await tuyaFetch<
    TuyaStatusItem[] | { status?: TuyaStatusItem[] }
  >("GET", `/v1.0/devices/${deviceId}/status`);
  if (Array.isArray(r)) return r;
  return r?.status ?? [];
}

export type EnergyReading = {
  power_w: number | null;
  voltage_v: number | null;
  current_a: number | null;
  total_energy_kwh: number | null;
};

const POWER_KEYS = [
  "cur_power",
  "active_power",
  "phase_a_power",
  "power_a",
  "total_power",
  "forward_power",
  "power",
];
const VOLTAGE_KEYS = [
  "cur_voltage",
  "voltage",
  "phase_a_voltage",
  "voltage_a",
];
const CURRENT_KEYS = [
  "cur_current",
  "current",
  "phase_a_current",
  "current_a",
];
const TOTAL_ENERGY_KEYS = [
  "forward_energy_total",
  "total_forward_energy",
  "energy_total",
  "add_ele",
  "total_energy",
];

function pickNumeric(
  status: Map<string, TuyaStatusValue>,
  keys: string[],
): number | null {
  for (const k of keys) {
    const v = status.get(k);
    if (typeof v === "number") return v;
    if (typeof v === "string" && v && !Number.isNaN(Number(v))) return Number(v);
  }
  return null;
}

/**
 * Parse Tuya's `phase_a` composite DP. Some firmwares pack voltage, current
 * and active power into a single base64-encoded byte string instead of
 * exposing them as separate codes.
 *
 * Common layout (8 bytes, big-endian):
 *   [0..1]  voltage in 0.1 V (uint16)
 *   [2..4]  current in mA    (uint24)
 *   [5..7]  power in 0.1 W   (uint24)
 *
 * Returns null if the value isn't decodable; tolerant of varying lengths.
 */
function parsePhaseA(value: TuyaStatusValue): {
  voltage_v: number | null;
  current_a: number | null;
  power_w: number | null;
} | null {
  if (typeof value !== "string" || value.length === 0) return null;
  let buf: Buffer;
  try {
    buf = Buffer.from(value, "base64");
  } catch {
    return null;
  }
  if (buf.length < 8) return null;
  try {
    const voltage = ((buf[0] << 8) | buf[1]) / 10;
    const current = ((buf[2] << 16) | (buf[3] << 8) | buf[4]) / 1000;
    const power = ((buf[5] << 16) | (buf[6] << 8) | buf[7]) / 10;
    // Sanity: residential breakers run 100-260V. If voltage looks wildly
    // off, give up — the layout might be different on this firmware.
    if (voltage < 50 || voltage > 400) return null;
    return { voltage_v: voltage, current_a: current, power_w: power };
  } catch {
    return null;
  }
}

export function parseEnergyReading(status: TuyaStatusItem[]): EnergyReading {
  const map = new Map(status.map((s) => [s.code, s.value]));

  const rawPower = pickNumeric(map, POWER_KEYS);
  const rawVoltage = pickNumeric(map, VOLTAGE_KEYS);
  const rawCurrent = pickNumeric(map, CURRENT_KEYS);
  const rawTotalEnergy = pickNumeric(map, TOTAL_ENERGY_KEYS);

  let power_w = rawPower != null ? rawPower / 10 : null;
  let voltage_v = rawVoltage != null ? rawVoltage / 10 : null;
  let current_a = rawCurrent != null ? rawCurrent / 1000 : null;
  const total_energy_kwh = rawTotalEnergy != null ? rawTotalEnergy / 100 : null;

  // Fallback: try to parse phase_a composite when individual codes are absent.
  if (power_w == null || voltage_v == null || current_a == null) {
    const phaseA =
      parsePhaseA(map.get("phase_a") as TuyaStatusValue) ??
      parsePhaseA(map.get("phase_a_data") as TuyaStatusValue);
    if (phaseA) {
      if (power_w == null && phaseA.power_w != null) power_w = phaseA.power_w;
      if (voltage_v == null && phaseA.voltage_v != null)
        voltage_v = phaseA.voltage_v;
      if (current_a == null && phaseA.current_a != null)
        current_a = phaseA.current_a;
    }
  }

  // Help diagnose missing-power devices: when we got total energy but no
  // power, log the keys that came back so we can add them next time.
  if (
    process.env.NODE_ENV !== "production" &&
    total_energy_kwh != null &&
    power_w == null
  ) {
    console.warn(
      "[parseEnergyReading] total_energy_kwh present but power_w missing. Status codes seen:",
      status.map((s) => s.code).join(", "),
    );
  }

  return { power_w, voltage_v, current_a, total_energy_kwh };
}

/**
 * Fallback tariff (UYU/kWh) when a property has no `tariff_per_kwh` set.
 * 2026 reference (UTE residencial general Uruguay): ~9 UYU/kWh.
 */
export function getDefaultTariff(): number {
  const fromEnv = Number(process.env.ENERGY_TARIFF_UYU_PER_KWH);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return 9;
}

/** Backwards-compat: previous name. */
export const getEnergyTariff = getDefaultTariff;

export type EnergyCostEstimate = {
  /** Cost so far based on cumulative kWh × tariff. */
  total_cost: number | null;
  /** Cost projection if current power held for 24h. */
  daily_cost_at_current: number | null;
  /** Cost per hour at current power (instantaneous). */
  hourly_cost_at_current: number | null;
  tariff_per_kwh: number;
  currency: string;
};

export function estimateCost(
  reading: EnergyReading,
  tariff: number = getDefaultTariff(),
  currency: string = "UYU",
): EnergyCostEstimate {
  const total =
    reading.total_energy_kwh != null
      ? reading.total_energy_kwh * tariff
      : null;
  const hourly =
    reading.power_w != null ? (reading.power_w / 1000) * tariff : null;
  const daily = hourly != null ? hourly * 24 : null;

  return {
    total_cost: total,
    daily_cost_at_current: daily,
    hourly_cost_at_current: hourly,
    tariff_per_kwh: tariff,
    currency,
  };
}

/**
 * True if the device looks like a Tuya circuit breaker — the only kind that
 * reports whole-property energy consumption in our setup.
 *
 * Tuya category codes for circuit breakers vary by product line:
 *   - `dlq`  → smart circuit breaker (most common, Térmicas use this)
 *   - `pc`   → power strip / power meter
 *   - `znyk` → some industrial breakers
 * Also matches devices whose name or category_name contains "breaker".
 */
export function isEnergyDevice(d: TuyaDevice): boolean {
  const cat = (d.category ?? "").toLowerCase();
  const catName = (d.category_name ?? "").toLowerCase();
  if (cat === "dlq" || cat === "pc" || cat === "znyk") return true;
  return /breaker|t[eé]rmica/.test(catName) || /breaker/.test(cat);
}

const formatterCache = new Map<string, Intl.NumberFormat>();

/**
 * Locale used everywhere in the energy UI. `es-UY` and `es-AR` both produce
 * the conventional Spanish number format: `.` for thousands, `,` for
 * decimals (e.g. `1.234,56`).
 */
const LOCALE = "es-UY";

/**
 * Format a money amount in the given ISO 4217 currency (e.g. UYU, ARS, USD).
 * Uses a per-currency cache so we don't re-instantiate the formatter on
 * every render.
 */
export function formatMoney(
  amount: number | null,
  currency: string = "UYU",
): string {
  if (amount == null) return "—";
  let fmt = formatterCache.get(currency);
  if (!fmt) {
    try {
      fmt = new Intl.NumberFormat(LOCALE, {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      });
    } catch {
      fmt = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
    }
    formatterCache.set(currency, fmt);
  }
  return fmt.format(amount);
}

/** Backwards-compat alias for the old UYU-only formatter. */
export function formatUyu(amount: number | null): string {
  return formatMoney(amount, "UYU");
}

/**
 * Format a kWh value with Spanish thousands/decimals.
 */
export function formatKwh(kwh: number | null, digits = 1): string {
  if (kwh == null) return "—";
  return (
    kwh.toLocaleString(LOCALE, {
      maximumFractionDigits: digits,
      minimumFractionDigits: 0,
    }) + " kWh"
  );
}

/**
 * Format a numeric value with a unit and Spanish thousands/decimals.
 */
export function formatNumeric(
  n: number | null,
  unit: string,
  digits = 1,
): string {
  if (n == null) return "—";
  return (
    n.toLocaleString(LOCALE, {
      maximumFractionDigits: digits,
      minimumFractionDigits: 0,
    }) +
    " " +
    unit
  );
}

/**
 * Format watts as W or kW depending on size, Spanish locale.
 */
export function formatPower(w: number | null): string {
  if (w == null) return "—";
  if (w < 1000) {
    return (
      w.toLocaleString(LOCALE, { maximumFractionDigits: 0 }) + " W"
    );
  }
  return (
    (w / 1000).toLocaleString(LOCALE, { maximumFractionDigits: 2 }) +
    " kW"
  );
}
