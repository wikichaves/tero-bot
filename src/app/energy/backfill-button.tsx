"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("energyPage.backfillButton");

  function onClick() {
    if (!confirm(t("confirm"))) return;
    startTransition(async () => {
      const result = await backfillSnapshots(1);
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      if ("summary" in result && result.summary) {
        const s = result.summary;
        toast.success(
          t("okToast", {
            inserted: s.inserted,
            duplicates: s.skipped_duplicate,
            errors: s.errors,
            devices: s.devicesProcessed,
          }),
          { duration: 6000 },
        );
        if (s.errors > 0) {
          const errs = (result.results ?? [])
            .filter((r) => r.error)
            .map((r) => `${r.tuya_device_id.slice(0, 8)}: ${r.error}`)
            .join("\n");
          console.warn("[backfill] errores:\n" + errs);
          toast.message(t("errorHint"));
        }
      }
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={pending}>
      {pending ? t("pending") : t("default")}
    </Button>
  );
}
