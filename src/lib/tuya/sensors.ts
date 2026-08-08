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
 * Tuya categories que sabemos que reportan temperatura y/o humedad:
 *   - wsdcg: 温湿度感测器 (sensor T+H standalone, más común)
 *   - wnykq: sensor T+H — variante usada en algunos modelos
 *            (WIK-82, descubierto en testing del proyecto Tuya original)
 *   - wkcz / wk: termostatos que también publican temp_current
 *   - ldcg:  sensor ambiental multi-métrica (CO2/TVOC/T/H, algunos modelos)
 *
 * Si aparece otra categoría, agregarla acá. Match por categoría es más
 * confiable que por nombre porque sobrevive a renombres en la app.
 */
const SENSOR_CATEGORIES = new Set([
  "wsdcg",
  "wnykq",
  "wkcz",
  "ldcg",
]);

/**
 * True si el device parece ser un sensor T/H. Match primero por categoría
 * Tuya (lo más confiable), después por nombre como fallback.
 */
export function isSensorDevice(d: TuyaDevice): boolean {
  const cat = (d.category ?? "").toLowerCase();
  if (SENSOR_CATEGORIES.has(cat)) return true;
  // Fallback por nombre — algunos cloud projects omiten la categoría
  // o usan strings raros.
  const blob = `${d.name ?? ""} ${d.product_name ?? ""} ${
    d.category_name ?? ""
  }`.toLowerCase();
  return /temp.*hum|humid.*temp|t\/h sensor|temperatura.*humedad|sensor/.test(
    blob,
  );
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
  return pickNumericWithCode(map, keys)?.value ?? null;
}

/**
 * Igual que `pickNumeric` pero devuelve también QUÉ código matcheó — lo
 * necesita el escalado de temperatura, que depende del DP (`va_temperature`
 * siempre viene en décimas de grado, otros códigos pueden venir en enteros).
 */
function pickNumericWithCode(
  map: Map<string, TuyaStatusValue>,
  keys: string[],
): { code: string; value: number } | null {
  for (const k of keys) {
    const v = map.get(k);
    if (typeof v === "number") return { code: k, value: v };
    if (typeof v === "string" && v && !Number.isNaN(Number(v)))
      return { code: k, value: Number(v) };
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

  const temp = pickNumericWithCode(map, TEMP_KEYS);
  const rawHum = pickNumeric(map, HUMIDITY_KEYS);
  let battery_pct = pickNumeric(map, BATTERY_KEYS);

  let temperature_c: number | null = null;
  if (temp != null) {
    // WIK-312: escalar por CÓDIGO de DP, no por magnitud. `va_temperature`
    // (el DP estándar de los wsdcg) SIEMPRE viene en décimas de grado, así
    // que dividimos por 10 siempre. La heurística vieja por magnitud
    // (`> 100 ? /10 : raw`) fallaba justo alrededor de ~10 °C: raw 96 (=9.6°C)
    // se quedaba en 96 y raw 102 (=10.2°C) sí se dividía → temperaturas
    // absurdas (96/100°C) cuando la casa estaba fría.
    if (temp.code === "va_temperature") {
      temperature_c = temp.value / 10;
    } else {
      // temp_current / temp_value / temperature: según firmware pueden venir
      // en grados enteros o en décimas. Sin un DP estándar, caemos a la
      // heurística por magnitud (imperfecta cerca de 10°C, pero son
      // firmwares raros y no tenemos mejor señal).
      temperature_c =
        Math.abs(temp.value) > 100 ? temp.value / 10 : temp.value;
    }

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
