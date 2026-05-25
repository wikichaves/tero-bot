import "server-only";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { percentile } from "@/lib/stats";
import { APP_HOST } from "@/lib/brand";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales";

/**
 * Build the "Ambientes" section of the daily report (WIK-82 F4).
 *
 * Pulls sensor_snapshots from the last 24h, groups by property, and
 * computes min/max for both temperature and humidity per property.
 *
 * Returns an array of message lines ready to append to the WhatsApp
 * report. Empty array if there are no sensors / no recent snapshots
 * (caller skips the section).
 */
export async function buildSensorSummary(
  propertyFilter?: string,
  /** WIK-94: scope opcional. null/undefined = sin restricción. */
  allowedPropertyIds?: string[] | null,
  /** WIK-151: locale del recipient. Default `en`. */
  locale: Locale = DEFAULT_LOCALE,
): Promise<string[]> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const t = await getTranslations({
    locale,
    namespace: "whatsapp.sensorSummary",
  });

  // Pull snapshots + device + property in one query for fast aggregation.
  let q = admin
    .from("sensor_snapshots")
    .select(
      "temperature_c, humidity_pct, taken_at, property_device:property_devices!inner(property_id, property:properties(name))",
    )
    .gte("taken_at", since);
  if (allowedPropertyIds != null) {
    q = q.in("property_device.property_id", allowedPropertyIds);
  }
  const { data, error } = await q;
  if (error || !data) return [];

  type Row = {
    temperature_c: number | null;
    humidity_pct: number | null;
    property_device: {
      property_id: string;
      property: { name: string } | null;
    } | null;
  };
  const rows = data as unknown as Row[];

  const byProperty = new Map<
    string,
    {
      name: string;
      temps: number[];
      hums: number[];
    }
  >();
  for (const r of rows) {
    const propName = r.property_device?.property?.name;
    const propId = r.property_device?.property_id;
    if (!propName || !propId) continue;
    // Filtro opcional por property name (substring case-insensitive).
    if (
      propertyFilter &&
      !propName.toLowerCase().includes(propertyFilter.toLowerCase())
    ) {
      continue;
    }
    let acc = byProperty.get(propId);
    if (!acc) {
      acc = { name: propName, temps: [], hums: [] };
      byProperty.set(propId, acc);
    }
    if (r.temperature_c != null) acc.temps.push(Number(r.temperature_c));
    if (r.humidity_pct != null) acc.hums.push(Number(r.humidity_pct));
  }

  if (byProperty.size === 0) return [];

  const lines: string[] = [];
  lines.push(t("title"));
  // Ordenado por nombre para consistency con el resto del report.
  const entries = Array.from(byProperty.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const p of entries) {
    // WIK-96: percentiles p5/p95 en vez de min/max raw. Filtra
    // outliers (lecturas erráticas, sensor frío al arrancar) y da
    // un rango representativo del día.
    const tMin = percentile(p.temps, 5);
    const tMax = percentile(p.temps, 95);
    const hMin = percentile(p.hums, 5);
    const hMax = percentile(p.hums, 95);
    const tPart =
      tMin != null && tMax != null
        ? `T ${tMin.toFixed(1)}–${tMax.toFixed(1)}°C`
        : null;
    const hPart =
      hMin != null && hMax != null
        ? `H ${Math.round(hMin)}–${Math.round(hMax)}%`
        : null;
    const parts = [tPart, hPart].filter(Boolean).join(" · ");
    lines.push(`• ${p.name}: ${parts || t("noData")}`);
  }
  return lines;
}


/**
 * Build the response for the WhatsApp `ambientes` command (WIK-90).
 *
 * A diferencia de `buildSensorSummary` (que agrupa por property con
 * min/max para el reporte diario), acá agrupamos por *room* y mostramos
 * el promedio de las últimas 24h. La idea es que el admin pueda
 * preguntar "ambientes" por chat y ver de un vistazo cómo está cada
 * habitación.
 *
 * Format:
 *   🌡️ Ambientes — últimas 24 h
 *
 *   📍 Property A
 *   • Living · 18.2°C · 65%
 *   • Kids · 19.5°C · 60%
 *
 *   📍 Property B
 *   • Master · ...
 *
 * Si no hay rooms con devices, mensaje guía. Si hay rooms pero ningún
 * snapshot reciente, los lista igual indicando "_sin lecturas_".
 */
export async function buildRoomsReport(
  /** WIK-94: scope. null = admin (sin filtro). */
  allowedPropertyIds: string[] | null,
  /** WIK-151: locale del recipient. Default `en`. */
  locale: Locale = DEFAULT_LOCALE,
): Promise<string> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const t = await getTranslations({ locale, namespace: "whatsapp.rooms" });

  // 1. Properties (respetando scope).
  let propsQuery = admin
    .from("properties")
    .select("id, name, sort_order")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (allowedPropertyIds != null) {
    propsQuery = propsQuery.in("id", allowedPropertyIds);
  }
  const { data: propertiesData } = await propsQuery;
  const properties = (propertiesData ?? []) as Array<{
    id: string;
    name: string;
    sort_order: number;
  }>;
  if (properties.length === 0) {
    return t("noVisibleProperties");
  }
  const propIds = properties.map((p) => p.id);

  // 2. Rooms de esas properties.
  const { data: roomsData } = await admin
    .from("rooms")
    .select("id, property_id, name, sort_order")
    .in("property_id", propIds)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  const rooms = (roomsData ?? []) as Array<{
    id: string;
    property_id: string;
    name: string;
    sort_order: number;
  }>;

  // 3. Sensor devices asignados a esos rooms.
  const { data: devicesData } = await admin
    .from("property_devices")
    .select("id, property_id, room_id")
    .eq("device_kind", "sensor")
    .in("property_id", propIds);
  const devices = (devicesData ?? []) as Array<{
    id: string;
    property_id: string;
    room_id: string | null;
  }>;

  if (devices.length === 0) {
    return t("noSensors", { host: APP_HOST });
  }

  // 4. Snapshots últimas 24h para esos devices.
  const sensorIds = devices.map((d) => d.id);
  const { data: snapsData } = await admin
    .from("sensor_snapshots")
    .select("property_device_id, temperature_c, humidity_pct")
    .in("property_device_id", sensorIds)
    .gte("taken_at", since)
    .limit(100_000);
  const snaps = (snapsData ?? []) as Array<{
    property_device_id: string;
    temperature_c: number | null;
    humidity_pct: number | null;
  }>;

  // Index snapshots por device_id.
  const snapsByDevice = new Map<
    string,
    { temps: number[]; hums: number[] }
  >();
  for (const s of snaps) {
    const acc = snapsByDevice.get(s.property_device_id) ?? {
      temps: [],
      hums: [],
    };
    if (s.temperature_c != null) acc.temps.push(Number(s.temperature_c));
    if (s.humidity_pct != null) acc.hums.push(Number(s.humidity_pct));
    snapsByDevice.set(s.property_device_id, acc);
  }

  // 5. Promediar por *room* (un room puede tener varios sensores; los
  //    juntamos en un solo bucket).
  const devicesByRoom = new Map<string, string[]>();
  for (const d of devices) {
    if (!d.room_id) continue;
    const list = devicesByRoom.get(d.room_id) ?? [];
    list.push(d.id);
    devicesByRoom.set(d.room_id, list);
  }

  const avg = (arr: number[]): number | null =>
    arr.length === 0 ? null : arr.reduce((a, b) => a + b, 0) / arr.length;

  const lines: string[] = [t("title"), ""];
  let totalLines = 0;
  for (const property of properties) {
    const propRooms = rooms.filter((r) => r.property_id === property.id);
    const roomsWithDevices = propRooms.filter(
      (r) => (devicesByRoom.get(r.id)?.length ?? 0) > 0,
    );
    if (roomsWithDevices.length === 0) continue;

    lines.push(`📍 *${property.name}*`);
    for (const room of roomsWithDevices) {
      const deviceIds = devicesByRoom.get(room.id) ?? [];
      const temps: number[] = [];
      const hums: number[] = [];
      for (const did of deviceIds) {
        const s = snapsByDevice.get(did);
        if (!s) continue;
        temps.push(...s.temps);
        hums.push(...s.hums);
      }
      const tAvg = avg(temps);
      const hAvg = avg(hums);
      if (tAvg == null && hAvg == null) {
        lines.push(`• ${room.name}: ${t("noReadings")}`);
      } else {
        const tPart = tAvg != null ? `${tAvg.toFixed(1)}°C` : "—";
        const hPart = hAvg != null ? `${Math.round(hAvg)}%` : "—";
        lines.push(`• ${room.name}: ${tPart} · ${hPart}`);
      }
      totalLines++;
    }
    lines.push("");
  }

  if (totalLines === 0) {
    return t("noRecent");
  }

  lines.push(t("footer", { host: APP_HOST }));
  return lines.join("\n").trim();
}
