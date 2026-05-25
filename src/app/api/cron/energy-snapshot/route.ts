import { NextResponse } from "next/server";
import { snapshotAllDevices } from "@/lib/tuya/snapshots";
import { logCronSnapshot } from "@/lib/util/cron-log";

/**
 * Hourly cron — captures one snapshot per energy-capable property_device.
 * Configured in vercel.json. Vercel sends the CRON_SECRET as a Bearer token.
 *
 * WIK-161 v2: emite un structured log al final del run con el resumen
 * (devices total/inserted/skipped/errored + lista de errores con nombre
 * de device). Vercel parsea el JSON y queda filtrable en el dashboard
 * por `event=cron.snapshot.energy`. Si todo está OK aparece una sola
 * línea por hora; si hubo errores, el `errors` array lista exactamente
 * qué device falló.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = Date.now();
  try {
    const result = await snapshotAllDevices();
    logCronSnapshot(
      "cron.snapshot.energy",
      result.ranAt,
      result.results,
      Date.now() - start,
    );
    return NextResponse.json(result);
  } catch (e) {
    const msg = (e as Error).message;
    console.log(
      JSON.stringify({
        event: "cron.snapshot.energy.failed",
        ranAt: new Date().toISOString(),
        totalMs: Date.now() - start,
        error: msg.slice(0, 500),
      }),
    );
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
