import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Average of the most recent sensor_snapshots for a property within the
 * last `withinMinutes` minutes. Returns null if the property has no
 * sensors or no recent readings.
 *
 * Used by the pre-checkin conditioning flow (WIK-125) to evaluate
 * whether the property is at the target temperature range.
 *
 * Why average and not most-recent: properties with multiple T/H sensors
 * (e.g. living + dormitorios) should reflect a holistic "is the place
 * comfortable" reading. A single sensor near a window could be
 * misleading.
 */
export async function getCurrentTempForProperty(
  propertyId: string,
  withinMinutes = 30,
): Promise<{ temp_c: number | null; humidity_pct: number | null; sensors_count: number }> {
  const admin = createAdminClient();
  const sinceIso = new Date(Date.now() - withinMinutes * 60 * 1000).toISOString();
  // Get all snapshots for sensors in this property within the window.
  const { data } = await admin
    .from("sensor_snapshots")
    .select(
      "temperature_c, humidity_pct, taken_at, property_device:property_devices!inner(property_id)",
    )
    .eq("property_device.property_id", propertyId)
    .gte("taken_at", sinceIso);

  type Row = {
    temperature_c: number | null;
    humidity_pct: number | null;
  };
  const rows = ((data ?? []) as unknown) as Row[];
  if (rows.length === 0) {
    return { temp_c: null, humidity_pct: null, sensors_count: 0 };
  }

  const temps = rows.map((r) => r.temperature_c).filter((t): t is number => t != null);
  const hums = rows.map((r) => r.humidity_pct).filter((h): h is number => h != null);

  const avgTemp =
    temps.length > 0 ? temps.reduce((s, n) => s + n, 0) / temps.length : null;
  const avgHum =
    hums.length > 0 ? hums.reduce((s, n) => s + n, 0) / hums.length : null;

  return {
    temp_c: avgTemp != null ? Math.round(avgTemp * 10) / 10 : null,
    humidity_pct: avgHum != null ? Math.round(avgHum) : null,
    sensors_count: rows.length,
  };
}
