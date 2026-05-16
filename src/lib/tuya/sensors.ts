import "server-only";
import { getDeviceStatus, type TuyaStatusValue } from "./energy";
import type { TuyaDevice } from "./devices";

/**
 * Lectura de sensores de temperatura y humedad Tuya.
 *
 * Tuya marca los sensores T/H con `category="wsdcg"` (温湿度感测器). Los DPs
 * típicos varían entre firmwares — los más comunes en cloud project:
 *
 *   - va_temperature        × 0.1 °C  (signed int — multiplicar por 0.1)
 *   - va_humidity           % (entero)
 *   - battery_percentage    %
 *   - battery_state         enum string: "low" | "middle" | "high"
 *
 * Variantes vistas en otros firmwares (algunos pasamuros chinos):
 *   - temp_current / temp_value
 *   - humidity_value
 *   - temp_unit_convert (c | f) — si está en F, convertir
 *
 * Si llega un wsdcg que no devuelve nada, usar /api/admin/tuya/inspect-sensors
 * para ver qué DPs publica y agregarlos al fallback.
 */

export type SensorReading = {
  temperature_c: number | null;
  humidity_pct: number | null;
  battery_pct: number | null;
};

/**
 * True si el device parece ser un sensor T/H. Match conservador: solo la
 * categoría oficial `wsdcg`. Si en el futuro aparecen variantes (sensores
 * de humedad solos, termómetros sin humedad), agregar las categorías acá.
 */
export function isSensorDevice(d: TuyaDevice): boolean {
  const cat = (d.category ?? "").toLowerCase();
  if (cat === "wsdcg") return true;
  // Fallback por nombre — algunos cloud projects omiten la categoría
  // o usan strings raros. "termo", "humid", "sensor" en el name del device
  // o product_name suele ser pista fuerte.
  const blob = `${d.name ?? ""} ${d.product_name ?? ""} ${
    d.category_name ?? ""
  }`.toLowerCase();
  return /temp.*hum|humid.*temp|t\/h sensor|temperatura.*humedad/.test(blob);
}

const TEMP_KEYS = [
  "va_temperature",
  "temp_current",
  "temp_value",
  "temperature",
];
const HUMIDITY_KEYS = [
  "va_humidity",
  "humidity_value",
  "humidity",
];
const BATTERY_KEYS = ["battery_percentage", "battery_pct", "battery"];

function pickNumeric(
  map: Map<string, TuyaStatusValue>,
  keys: string[],
): number | null {
  for (const k of keys) {
    const v = map.get(k);
    if (typeof v === "number") return v;
    if (typeof v === "string" && v && !Number.isNaN(Number(v)))
      return Number(v);
  }
  return null;
}

/**
 * Parse the device's `/status` payload into a {temp_c, humidity_pct,
 * battery_pct} reading. Returns nulls when a particular metric isn't
 * reported by this device.
 *
 * Tuya `va_temperature` viene en décimas de grado (175 = 17.5°C). Otros
 * códigos como `temp_current` pueden venir en grados enteros — no
 * dividimos en ese caso. La heurística: si el valor es absurdo
 * (>500 o <-500) asumimos décimas. Si es razonable (-50 a 100)
 * asumimos grados enteros.
 */
export function parseSensorReading(
  status: Array<{ code: string; value: TuyaStatusValue }>,
): SensorReading {
  const map = new Map(status.map((s) => [s.code, s.value]));

  const rawTemp = pickNumeric(map, TEMP_KEYS);
  const rawHum = pickNumeric(map, HUMIDITY_KEYS);
  let battery_pct = pickNumeric(map, BATTERY_KEYS);

  let temperature_c: number | null = null;
  if (rawTemp != null) {
    // Heurística unidades: si parece centésimas (rango fuera de -50..100), dividir.
    temperature_c =
      Math.abs(rawTemp) > 100 ? rawTemp / 10 : rawTemp;

    // Convertir Fahrenheit a Celsius si el device reporta `temp_unit_convert=f`.
    const unit = map.get("temp_unit_convert");
    if (typeof unit === "string" && unit.toLowerCase() === "f") {
      temperature_c = ((temperature_c - 32) * 5) / 9;
    }
  }

  let humidity_pct: number | null = null;
  if (rawHum != null) {
    // Tuya humidity normalmente en %, rango 0-100. Algunos firmwares
    // publican × 10 (e.g., 700 = 70%) — corregimos si parece OOR.
    humidity_pct = rawHum > 100 ? rawHum / 10 : rawHum;
  }

  // Si battery viene como enum (low/middle/high), mapeamos a aprox %.
  if (battery_pct == null) {
    const battState = map.get("battery_state");
    if (typeof battState === "string") {
      const m: Record<string, number> = { low: 10, middle: 50, high: 90 };
      battery_pct = m[battState.toLowerCase()] ?? null;
    }
  }

  return {
    temperature_c,
    humidity_pct,
    battery_pct: battery_pct != null ? Math.round(battery_pct) : null,
  };
}

/**
 * Convenience: pull device status from Tuya and parse it in one call.
 * Returns null if the API call fails — caller decides what to do.
 */
export async function readSensor(
  deviceId: string,
): Promise<SensorReading | null> {
  try {
    const status = await getDeviceStatus(deviceId);
    return parseSensorReading(status);
  } catch (e) {
    console.warn(
      `[readSensor] failed to read device ${deviceId}:`,
      (e as Error).message,
    );
    return null;
  }
}
