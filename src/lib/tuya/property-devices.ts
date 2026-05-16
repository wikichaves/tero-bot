import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { DeviceKind, PropertyDevice } from "@/lib/types";
import type { TuyaDevice } from "./devices";

const KIND_VALUES: DeviceKind[] = [
  "lock",
  "thermostat",
  "light",
  "switch",
  "camera",
  "sensor",
  "breaker",
  "other",
];

export function isDeviceKind(value: string): value is DeviceKind {
  return (KIND_VALUES as string[]).includes(value);
}

/**
 * Best-effort mapping from a Tuya category (returned by `/v1.3/iot-03/devices`
 * or similar) to our internal DeviceKind. Used as a default suggestion when
 * the admin assigns a device — they can override.
 *
 * Categorías que reconocemos:
 *   - lock / mc → cerradura
 *   - dj / dc / dd / wgs (bulbs/lights) → light
 *   - kt / wk / qn / mzj (acondicionadores / termostatos) → thermostat
 *   - cz / kg / pc (sockets / switches) → switch
 *   - dlq / pc (circuit breakers que ya monitorean energía) → breaker
 *   - wsdcg / wnykq / wkcz / ldcg (sensores T+H) → sensor (WIK-82)
 *   - sp / camera → camera
 */
export function suggestDeviceKind(device: TuyaDevice): DeviceKind {
  const cat =
    device.category?.toLowerCase() ?? device.category_name?.toLowerCase() ?? "";
  const name = device.name?.toLowerCase() ?? "";
  // Sensor T/H: match por categoría conocida primero (más confiable que name).
  if (
    cat === "wsdcg" ||
    cat === "wnykq" ||
    cat === "wkcz" ||
    cat === "ldcg" ||
    /temp.*hum|humid.*temp|sensor/.test(`${cat} ${name}`)
  )
    return "sensor";
  if (cat.includes("lock") || name.includes("puerta")) return "lock";
  if (cat.includes("camera") || cat.includes("cam")) return "camera";
  if (
    cat.includes("light") ||
    cat.includes("dj") ||
    cat.includes("bulb")
  )
    return "light";
  if (
    cat.includes("air") ||
    cat.includes("heater") ||
    cat.includes("thermo") ||
    cat.includes("kt")
  )
    return "thermostat";
  // Circuit breakers que reportan energía (dlq, algunos pc) → breaker
  if (cat === "dlq" || /t[eé]rmica/.test(name)) return "breaker";
  if (
    cat.includes("socket") ||
    cat.includes("switch") ||
    cat.includes("breaker") ||
    cat === "cz" ||
    cat === "pc" ||
    cat === "kg"
  )
    return "switch";
  return "other";
}

/**
 * Fetch all property_devices keyed by tuya_device_id for fast joining
 * against the live Tuya device list in the admin UI.
 */
export async function listPropertyDeviceMap(): Promise<
  Map<string, PropertyDevice>
> {
  const admin = createAdminClient();
  const { data } = await admin.from("property_devices").select("*");
  const list = (data ?? []) as PropertyDevice[];
  return new Map(list.map((pd) => [pd.tuya_device_id, pd]));
}

export async function getPrimaryDeviceForProperty(
  propertyId: string,
  kind: DeviceKind,
): Promise<PropertyDevice | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("property_devices")
    .select("*")
    .eq("property_id", propertyId)
    .eq("device_kind", kind)
    .eq("is_primary", true)
    .maybeSingle();
  return data as PropertyDevice | null;
}
