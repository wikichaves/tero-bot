import { NextResponse } from "next/server";
import { withCronAlerts } from "@/lib/util/cron-alert";

/**
 * Deadman switch — pingea un endpoint externo (healthchecks.io) cada hora.
 *
 * Cubre un failure mode distinto al wrapper `withCronAlerts`:
 *   - Wrapper: alerta cuando un cron CORRE Y FALLA (throw o 5xx) → Telegram
 *     a través de nuestro propio bot.
 *   - Deadman: alerta cuando un cron NO CORRE (Vercel cron caído, billing
 *     issue, account suspendido, incidente de plataforma). Como en ese
 *     escenario ningún cron tira excepción, el wrapper no se entera.
 *     healthchecks.io ve la ausencia del ping y dispara la alerta.
 *
 * Setup (one-time, manual):
 *   1. Crear cuenta gratis en https://healthchecks.io
 *   2. Crear un check: period=1h, grace=15min, schedule=cron
 *   3. Integrations → Telegram → seguir el flow (te conecta su bot al chat)
 *   4. Copiar la ping URL (formato https://hc-ping.com/<uuid>) en
 *      `HEALTHCHECKS_DEADMAN_URL` env var en Vercel production
 *
 * Sin la env var seteada, este cron loguea un warning y devuelve 200 OK
 * sin hacer nada. NO falla ni alerta — es opt-in.
 *
 * Si el fetch a HC falla (red caída, HC down), re-throw para que el
 * wrapper `withCronAlerts` mande un Telegram con nuestro propio bot.
 * Así sabés que el deadman MISMO está roto.
 */
export const GET = withCronAlerts(
  "deadman-ping",
  async (request: Request) => {
    const authHeader = request.headers.get("authorization");
    const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
    if (!process.env.CRON_SECRET || authHeader !== expected) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = process.env.HEALTHCHECKS_DEADMAN_URL;
    if (!url) {
      console.warn(
        "[deadman-ping] HEALTHCHECKS_DEADMAN_URL not set — skipping ping. Setup: https://healthchecks.io",
      );
      return NextResponse.json({ ok: true, skipped: "no URL" });
    }

    const start = Date.now();
    const res = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new Error(
        `healthchecks ping returned HTTP ${res.status} (latency=${Date.now() - start}ms)`,
      );
    }
    return NextResponse.json({
      ok: true,
      pinged: true,
      latency_ms: Date.now() - start,
    });
  },
);
