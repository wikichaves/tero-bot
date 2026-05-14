"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { backfillSnapshots } from "./actions";

/**
 * One-shot historical backfill trigger. Pulls 12 months of daily kWh
 * from Tuya and seeds `energy_snapshots` so existing bills get the
 * Tuya-vs-facturado comparativa right away.
 *
 * Safe to click multiple times — duplicates are filtered by the unique
 * hourly index. Returns a toast with how many rows were inserted +
 * skipped + errored so the admin can see what happened at a glance.
 */
export function BackfillButton() {
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (
      !confirm(
        "Esto va a pedir 12 meses de histórico a Tuya y crear ~365 snapshots por medidor. ¿Continuar?",
      )
    )
      return;
    startTransition(async () => {
      const result = await backfillSnapshots(12);
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      if ("summary" in result && result.summary) {
        const s = result.summary;
        toast.success(
          `Backfill OK · ${s.inserted} insertados, ${s.skipped_duplicate} duplicados, ${s.errors} con error en ${s.devicesProcessed} dispositivos.`,
          { duration: 6000 },
        );
        if (s.errors > 0) {
          const errs = (result.results ?? [])
            .filter((r) => r.error)
            .map((r) => `${r.tuya_device_id.slice(0, 8)}: ${r.error}`)
            .join("\n");
          console.warn("[backfill] errores:\n" + errs);
          toast.message("Hay errores — ver consola del navegador para detalle.");
        }
      }
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={pending}>
      {pending ? "Cargando histórico…" : "Backfill 12 meses"}
    </Button>
  );
}
