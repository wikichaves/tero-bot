import { NextResponse } from "next/server";
import { snapshotAllSensors } from "@/lib/sensors/snapshots";

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
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await snapshotAllSensors();
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }
}
