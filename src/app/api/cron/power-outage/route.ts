import { NextResponse } from "next/server";
import { evaluatePowerOutages } from "@/lib/sensors/power-outage";
import { withCronAlerts } from "@/lib/util/cron-alert";

/**
 * WIK-280 — cron de detección de corte de luz. Cada ~10 min revisa el estado
 * online de los breakers (dlq) de cada propiedad con una regla `power_outage`
 * habilitada, y dispara / resuelve alarmas con debounce. Configurado en
 * `vercel.json`. Vercel manda el `CRON_SECRET` como Bearer token.
 *
 * Emite un structured log filtrable por `event=cron.power_outage`
 * (logCronSnapshot no aplica — su shape es por-device para snapshots T/H).
 */
export const GET = withCronAlerts("power-outage", async (request: Request) => {
  const authHeader = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = Date.now();
  try {
    const result = await evaluatePowerOutages();
    console.log(
      JSON.stringify({
        event: "cron.power_outage",
        ranAt: new Date().toISOString(),
        totalMs: Date.now() - start,
        ...result,
      }),
    );
    return NextResponse.json(result);
  } catch (e) {
    const msg = (e as Error).message;
    console.log(
      JSON.stringify({
        event: "cron.power_outage.failed",
        ranAt: new Date().toISOString(),
        totalMs: Date.now() - start,
        error: msg.slice(0, 500),
      }),
    );
    return NextResponse.json({ error: msg }, { status: 500 });
  }
});
