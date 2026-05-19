import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Read-only diagnostic endpoint para entender cuándo se capturan los
 * snapshots (WIK-98 debug). Devuelve los últimos 100 timestamps por
 * sensor + energy device, junto con el gap entre cada uno.
 *
 * Si los gaps son ~60min consistente: el cron horario está andando.
 * Si los gaps son ~24h o irregulares: el cron diario o solo se
 * dispara on-demand vía maybeSnapshotIfStale.
 *
 * Llamar:
 *   https://admin.example.com/api/admin/tuya/inspect-snapshot-timestamps
 */
export async function GET() {
  await requireRole(["admin"]);
  const admin = createAdminClient();

  const [sensorRes, energyRes] = await Promise.all([
    admin
      .from("sensor_snapshots")
      .select(
        "property_device_id, taken_at, property_device:property_devices(tuya_device_name)",
      )
      .order("taken_at", { ascending: false })
      .limit(200),
    admin
      .from("energy_snapshots")
      .select(
        "property_device_id, taken_at, property_device:property_devices(tuya_device_name)",
      )
      .order("taken_at", { ascending: false })
      .limit(200),
  ]);

  function summarize(
    rows: Array<{
      property_device_id: string;
      taken_at: string;
      property_device: { tuya_device_name: string | null } | null;
    }>,
  ) {
    const byDevice = new Map<
      string,
      { name: string | null; timestamps: string[] }
    >();
    for (const r of rows) {
      const id = r.property_device_id;
      const entry = byDevice.get(id) ?? {
        name: r.property_device?.tuya_device_name ?? null,
        timestamps: [],
      };
      entry.timestamps.push(r.taken_at);
      byDevice.set(id, entry);
    }
    return Array.from(byDevice.entries()).map(([id, info]) => {
      // Ordenar ascendente para calcular gaps.
      const ts = info.timestamps.slice().sort();
      const gaps: number[] = [];
      for (let i = 1; i < ts.length; i++) {
        const dt =
          (new Date(ts[i]).getTime() - new Date(ts[i - 1]).getTime()) /
          60000;
        gaps.push(Math.round(dt));
      }
      // Stats
      const minGap = gaps.length > 0 ? Math.min(...gaps) : null;
      const maxGap = gaps.length > 0 ? Math.max(...gaps) : null;
      const avgGap =
        gaps.length > 0
          ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length)
          : null;
      return {
        property_device_id: id,
        name: info.name,
        snapshot_count: ts.length,
        first: ts[0] ?? null,
        last: ts[ts.length - 1] ?? null,
        gap_minutes: { min: minGap, avg: avgGap, max: maxGap },
        // Últimos 20 timestamps con sus gaps
        recent: ts
          .slice(-20)
          .reverse()
          .map((t, i, arr) => {
            const next = arr[i + 1];
            const gapMin = next
              ? Math.round(
                  (new Date(t).getTime() - new Date(next).getTime()) /
                    60000,
                )
              : null;
            return { taken_at: t, gap_to_previous_min: gapMin };
          }),
      };
    });
  }

  return NextResponse.json(
    {
      inspected_at: new Date().toISOString(),
      sensor_snapshots: summarize((sensorRes.data ?? []) as never),
      energy_snapshots: summarize((energyRes.data ?? []) as never),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
