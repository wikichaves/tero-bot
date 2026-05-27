import { NextRequest, NextResponse } from "next/server";
import {
  findDueAt2h,
  findStartedAtStage,
} from "@/lib/pre-checkin/find-due";
import {
  sendPreCheckinAlert,
  sendPreCheckinUpdate,
} from "@/lib/pre-checkin/send-alert";
import { withCronAlerts } from "@/lib/util/cron-alert";

/**
 * Cron `/api/cron/pre-checkin-conditioning` — corre cada 15min en Vercel
 * Pro (WIK-125). Tres responsabilidades por tick:
 *
 *   1. T-2h: detectar reservas confirmadas cuyo check-in cae en la
 *      ventana [now+1h50m, now+2h10m] y aún no tienen tracking row →
 *      evaluar temp vs target → si está fuera de rango, mandar alerta
 *      con buttons SI/NO al gestor.
 *
 *   2. T-1h: para rows en stage='started' cuyo check-in cae en la
 *      ventana de 1h restante → mandar update de progreso.
 *
 *   3. T-0h: para rows en stage='check_1h_done' cuyo check-in es ahora
 *      → mandar update final.
 *
 * Idempotencia: el cron NO re-procesa rows ya existentes en stage 2h
 * (tabla con unique por reservation_id). Para 1h/0h el cron filtra por
 * stage exacto, así una row solo avanza una vez por etapa.
 *
 * Quiet hours (22-08 UY): cualquier intento de send dentro del periodo
 * se marca como `quiet_hours_skipped` sin enviar — el próximo tick
 * post-08:00 puede actuar si todavía hay tiempo.
 *
 * Bearer-protected con CRON_SECRET, mismo patrón que los otros crons.
 */
export const GET = withCronAlerts("pre-checkin-conditioning", async (req: NextRequest) => {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const nowMs = Date.now();

  // Stage 1: 2h-before initial alerts
  let due2h: Awaited<ReturnType<typeof findDueAt2h>> = [];
  try {
    due2h = await findDueAt2h(nowMs);
  } catch (err) {
    console.error(`[cron pre-checkin] findDueAt2h threw:`, err);
  }

  let started1h: Awaited<ReturnType<typeof findStartedAtStage>> = [];
  try {
    started1h = await findStartedAtStage(nowMs, 1);
  } catch (err) {
    console.error(`[cron pre-checkin] findStartedAtStage(1) threw:`, err);
  }

  let started0h: Awaited<ReturnType<typeof findStartedAtStage>> = [];
  try {
    started0h = await findStartedAtStage(nowMs, 0);
  } catch (err) {
    console.error(`[cron pre-checkin] findStartedAtStage(0) threw:`, err);
  }

  const alertResults: Awaited<ReturnType<typeof sendPreCheckinAlert>>[] = [];
  for (const c of due2h) {
    try {
      const r = await sendPreCheckinAlert(c, nowMs);
      alertResults.push(r);
    } catch (err) {
      console.error(
        `[cron pre-checkin] alert threw for reservation ${c.reservation_id}:`,
        err,
      );
    }
  }

  const update1hResults: Awaited<ReturnType<typeof sendPreCheckinUpdate>>[] =
    [];
  for (const c of started1h) {
    try {
      const r = await sendPreCheckinUpdate(c, nowMs, "started");
      update1hResults.push(r);
    } catch (err) {
      console.error(
        `[cron pre-checkin] update(1h) threw for reservation ${c.reservation_id}:`,
        err,
      );
    }
  }

  const update0hResults: Awaited<ReturnType<typeof sendPreCheckinUpdate>>[] =
    [];
  for (const c of started0h) {
    try {
      const r = await sendPreCheckinUpdate(c, nowMs, "check_1h_done");
      update0hResults.push(r);
    } catch (err) {
      console.error(
        `[cron pre-checkin] update(0h) threw for reservation ${c.reservation_id}:`,
        err,
      );
    }
  }

  const summary = {
    alerts_2h: alertResults.length,
    updates_1h: update1hResults.length,
    updates_0h: update0hResults.length,
    alert_outcomes: alertResults.reduce<Record<string, number>>((acc, r) => {
      acc[r.outcome] = (acc[r.outcome] ?? 0) + 1;
      return acc;
    }, {}),
  };
  console.log(
    `[cron pre-checkin] ran @ ${new Date(nowMs).toISOString()} —`,
    summary,
  );
  return NextResponse.json({ ok: true, ...summary });
});
