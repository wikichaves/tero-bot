import { NextRequest, NextResponse } from "next/server";
import { findDueAlarms } from "@/lib/alarm-reminders/find-due";
import { sendAlarmReminder } from "@/lib/alarm-reminders/send";
import { withCronAlerts } from "@/lib/util/cron-alert";

/**
 * Cron `/api/cron/alarm-reminders` — corre cada 15 minutos en Vercel Pro
 * (WIK-124). Para cada task / reserva con `alarm_hours_before` cuyo
 * timestamp objetivo cae dentro del próximo período, manda WhatsApp via
 * template aprobado y registra en `alarm_notifications_sent` para no
 * re-disparar.
 *
 * Bearer-protected con `CRON_SECRET` (mismo patrón que los otros crons).
 * Vercel Cron incluye automáticamente ese header al invocar.
 *
 * El window de búsqueda es **±10 min alrededor de "ahora"**: cubre el
 * gap normal de cron (15min) con buffer + permite re-tries si una corrida
 * falla totalmente. Anything older than 10min se considera "ya pasó" y se
 * deja sin disparar (no queremos un flood de alarmas viejas si el cron
 * estuvo caído por horas).
 */
export const GET = withCronAlerts("alarm-reminders", async (req: NextRequest) => {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const nowMs = Date.now();
  const WINDOW_MS = 10 * 60 * 1000; // ±10 min
  const windowStartMs = nowMs - WINDOW_MS;
  const windowEndMs = nowMs + WINDOW_MS;

  let candidates;
  try {
    candidates = await findDueAlarms({ windowStartMs, windowEndMs });
  } catch (err) {
    console.error(`[cron alarm-reminders] findDueAlarms threw:`, err);
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }

  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, failed: 0, window_ms: WINDOW_MS });
  }

  // Send sequentially — usually <5 candidates per window, Kapso doesn't
  // need parallelism here. Sequential también facilita logs lineales.
  let sent = 0;
  let failed = 0;
  const errors: Array<{ kind: string; id: string; error: string }> = [];
  for (const c of candidates) {
    const r = await sendAlarmReminder(c);
    if (r.ok) {
      sent++;
    } else {
      failed++;
      errors.push({
        kind: c.kind,
        id: c.kind === "task" ? c.task_id : c.reservation_id,
        error: r.error ?? "unknown",
      });
    }
  }

  console.log(
    `[cron alarm-reminders] ran @ ${new Date(nowMs).toISOString()} — sent=${sent} failed=${failed}`,
  );
  return NextResponse.json({
    ok: true,
    sent,
    failed,
    window_ms: WINDOW_MS,
    errors: errors.length > 0 ? errors : undefined,
  });
});
