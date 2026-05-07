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

const POWER_KEYS = ["cur_power", "active_power", "phase_a_power"];
const VOLTAGE_KEYS = ["cur_voltage", "voltage", "phase_a_voltage"];
const CURRENT_KEYS = ["cur_current", "current", "phase_a_current"];
const TOTAL_ENERGY_KEYS = [
  "forward_energy_total",
  "total_forward_energy",
  "energy_total",
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

export function parseEnergyReading(status: TuyaStatusItem[]): EnergyReading {
  const map = new Map(status.map((s) => [s.code, s.value]));

  const rawPower = pickNumeric(map, POWER_KEYS);
  const rawVoltage = pickNumeric(map, VOLTAGE_KEYS);
  const rawCurrent = pickNumeric(map, CURRENT_KEYS);
  const rawTotalEnergy = pickNumeric(map, TOTAL_ENERGY_KEYS);

  return {
    power_w: rawPower != null ? rawPower / 10 : null,
    voltage_v: rawVoltage != null ? rawVoltage / 10 : null,
    current_a: rawCurrent != null ? rawCurrent / 1000 : null,
    total_energy_kwh: rawTotalEnergy != null ? rawTotalEnergy / 100 : null,
  };
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
 * Format a money amount in the given ISO 4217 currency (e.g. UYU, ARS, USD).
 * Uses a per-currency cache so we don't re-instantiate the formatter on
 * every render.
 */
export function formatMoney(
  amount: number | null,
  currency: string = "UYU",
): string {
  if (amount == null) return "—";
  const key = currency;
  let fmt = formatterCache.get(key);
  if (!fmt) {
    try {
      fmt = new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      });
    } catch {
      // Invalid currency code — fall back to a generic decimal display.
      fmt = new Intl.NumberFormat(undefined, {
        maximumFractionDigits: 0,
      });
    }
    formatterCache.set(key, fmt);
  }
  return fmt.format(amount);
}

/** Backwards-compat alias for the old UYU-only formatter. */
export function formatUyu(amount: number | null): string {
  return formatMoney(amount, "UYU");
}
