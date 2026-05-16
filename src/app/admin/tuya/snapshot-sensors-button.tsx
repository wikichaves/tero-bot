"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/**
 * Trigger manual de `snapshotAllSensors()` (WIK-82). Útil para forzar
 * captura inmediata sin esperar al cron diario. POST a
 * `/api/admin/tuya/snapshot-sensors`.
 *
 * Toast con:
 *   - Inserted: filas nuevas en sensor_snapshots
 *   - Skipped: devices que no devolvieron T/H (sensor mal marcado, batería
 *     muerta, firmware extraño)
 *   - Failed: errores de red / Tuya API
 */
export function SnapshotSensorsButton() {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onClick() {
    startTransition(async () => {
      try {
        const res = await fetch("/api/admin/tuya/snapshot-sensors", {
          method: "POST",
        });
        const json = await res.json();
        if (!res.ok) {
          toast.error(json.error ?? `Snapshot falló (${res.status})`);
          return;
        }
        type Result = {
          tuya_device_id: string;
          ok: boolean;
          inserted?: boolean;
          reason?: string;
          reading?: {
            temperature_c: number | null;
            humidity_pct: number | null;
            battery_pct: number | null;
          };
        };
        const results: Result[] = json.results ?? [];
        const inserted = results.filter((r) => r.inserted).length;
        const skipped = results.filter((r) => r.ok && !r.inserted).length;
        const failed = results.filter((r) => !r.ok).length;
        const okDetail = results
          .filter((r) => r.reading)
          .map((r) => {
            const t = r.reading!.temperature_c;
            const h = r.reading!.humidity_pct;
            const tStr = t != null ? `${t.toFixed(1)}°C` : "—";
            const hStr = h != null ? `${h.toFixed(0)}%` : "—";
            return `${r.tuya_device_id.slice(-6)}: ${tStr} · ${hStr}`;
          });
        const failedDetail = results
          .filter((r) => !r.ok || (r.ok && !r.inserted))
          .map(
            (r) =>
              `⚠ ${r.tuya_device_id.slice(-6)}: ${r.reason ?? "unknown"}`,
          );
        const detail = [...okDetail, ...failedDetail].join("\n");
        toast.success(
          `Capturado · ${inserted} insertados, ${skipped} omitidos, ${failed} errores`,
          detail ? { description: detail } : undefined,
        );
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={pending}>
      {pending ? "Capturando…" : "Capturar sensores"}
    </Button>
  );
}
