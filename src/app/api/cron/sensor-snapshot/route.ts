import { NextResponse } from "next/server";
import { snapshotAllSensors } from "@/lib/sensors/snapshots";
import { logCronSnapshot } from "@/lib/util/cron-log";
import { withCronAlerts } from "@/lib/util/cron-alert";

/**
 * Hourly cron — captures one snapshot per Tuya T/H sensor (devices marked
 * `device_kind='sensor'` in `property_devices`). Configured in
 * `vercel.json`. Vercel sends the `CRON_SECRET` as a Bearer token.
 *
 * Mirrors the energy-snapshot cron — same auth, same shape, same idempotency
 * by `(property_device_id, taken_at)` unique key. Each captura crea una
 * fila por sensor con `temperature_c / humidity_pct / battery_pct` + el
 * raw payload de Tuya en `raw_dps` (jsonb) para debug si después un
 * firmware empieza a publicar DPs nuevos.
 *
 * WIK-161 v2: emite un structured log con el resumen del run + alarmas
 * que se dispararon o resolvieron. Filtrable en Vercel por
 * `event=cron.snapshot.sensor`.
 */
export const GET = withCronAlerts("sensor-snapshot", async (request: Request) => {
  const authHeader = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = Date.now();
  try {
    const result = await snapshotAllSensors();
    logCronSnapshot(
      "cron.snapshot.sensor",
      result.ranAt,
      result.results,
      Date.now() - start,
      {
        alarmsFired: result.alarmsFired ?? 0,
        alarmsResolved: result.alarmsResolved ?? 0,
      },
    );
    return NextResponse.json(result);
  } catch (e) {
    const msg = (e as Error).message;
    console.log(
      JSON.stringify({
        event: "cron.snapshot.sensor.failed",
        ranAt: new Date().toISOString(),
        totalMs: Date.now() - start,
        error: msg.slice(0, 500),
      }),
    );
    return NextResponse.json({ error: msg }, { status: 500 });
  }
});
