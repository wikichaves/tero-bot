import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

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
): Promise<string[]> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Pull snapshots + device + property in one query for fast aggregation.
  const { data, error } = await admin
    .from("sensor_snapshots")
    .select(
      "temperature_c, humidity_pct, taken_at, property_device:property_devices!inner(property_id, property:properties(name))",
    )
    .gte("taken_at", since);
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
  lines.push("*Ambientes* (24h):");
  // Ordenado por nombre para consistency con el resto del report.
  const entries = Array.from(byProperty.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const p of entries) {
    const tPart =
      p.temps.length > 0
        ? `T ${Math.min(...p.temps).toFixed(1)}–${Math.max(...p.temps).toFixed(1)}°C`
        : null;
    const hPart =
      p.hums.length > 0
        ? `H ${Math.round(Math.min(...p.hums))}–${Math.round(Math.max(...p.hums))}%`
        : null;
    const parts = [tPart, hPart].filter(Boolean).join(" · ");
    lines.push(`• ${p.name}: ${parts || "_sin datos_"}`);
  }
  return lines;
}
