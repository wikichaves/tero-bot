/**
 * Structured logging para cron handlers (WIK-161 v2).
 *
 * Vercel agrupa logs por function — leerlos manualmente cuesta cuando
 * cada snapshot run mete 10+ líneas separadas. Estos helpers emiten un
 * solo `console.log` por run con un JSON compacto que Vercel parsea como
 * estructurado y dejá filtrable en el dashboard:
 *
 *   {"event":"cron.snapshot.energy","ranAt":"…","totalMs":1842,
 *    "devices":{"total":10,"inserted":7,"skipped":2,"errored":1},
 *    "errors":[{"name":"Llave entrada","reason":"timeout"}]}
 *
 * Tip para usarlos desde Vercel: Logs → filter por `cron.snapshot.energy`
 * o `cron.snapshot.sensor` para ver solo las corridas del cron en cuestión.
 */

export type CronSnapshotResult = {
  ok: boolean;
  inserted?: boolean;
  reason?: string;
  device_name?: string | null;
  tuya_device_id?: string;
};

/**
 * Loguea un resumen de una corrida del snapshot cron. Lo escribe como JSON
 * stringified para que sea parseable en el dashboard de Vercel.
 *
 * @param event   identifier estable del cron, ej `cron.snapshot.energy`
 * @param ranAt   ISO timestamp del momento en que arrancó la corrida
 * @param results lista de resultados por device
 * @param totalMs duración total de la corrida en ms
 * @param extra   pares adicionales para meter en el log (ej. `alarmsFired`)
 */
export function logCronSnapshot(
  event: string,
  ranAt: string,
  results: CronSnapshotResult[],
  totalMs: number,
  extra: Record<string, unknown> = {},
): void {
  let inserted = 0;
  let skipped = 0;
  let errored = 0;
  const errors: Array<{ name: string | null; reason: string }> = [];
  for (const r of results) {
    if (!r.ok) {
      errored++;
      errors.push({
        name: r.device_name ?? null,
        reason: (r.reason ?? "unknown").slice(0, 200), // cap para no romper el log
      });
    } else if (r.inserted) {
      inserted++;
    } else {
      skipped++;
    }
  }
  const summary: Record<string, unknown> = {
    event,
    ranAt,
    totalMs,
    devices: {
      total: results.length,
      inserted,
      skipped,
      errored,
    },
    ...extra,
  };
  // Solo incluimos `errors` si hay alguno — ahorra ruido cuando todo OK.
  if (errors.length > 0) {
    summary.errors = errors;
  }
  // Una sola línea, JSON stringified — Vercel la parsea como structured log.
  console.log(JSON.stringify(summary));
}
