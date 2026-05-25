"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { snapshotNow } from "./actions";

export function SnapshotButton() {
  const [pending, startTransition] = useTransition();
  const t = useTranslations("energyPage.snapshotButton");

  function onClick() {
    startTransition(async () => {
      const result = await snapshotNow();
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      if (!("result" in result) || !result.result) return;

      const inserted = result.result.results.filter((r) => r.inserted).length;
      const skipped = result.result.results.filter(
        (r) => r.ok && !r.inserted,
      ).length;
      const errors = result.result.results.filter((r) => !r.ok);
      const summary = t("summary", {
        inserted,
        skipped,
        errors: errors.length,
      });

      if (errors.length === 0) {
        toast.success(t("okToast", { summary }));
        return;
      }

      // Surface the failing devices in the toast description. Without
      // this the user had to dig through Vercel logs to find out which
      // device was failing — a frequent ask since some Tuya devices go
      // offline intermittently and that's exactly what we need to act on.
      // Group by reason so 4 timeouts collapse into 1 line.
      const byReason = new Map<string, string[]>();
      for (const e of errors) {
        const reason = (e.reason ?? "unknown").slice(0, 80);
        const name = e.device_name ?? e.tuya_device_id;
        const arr = byReason.get(reason) ?? [];
        arr.push(name);
        byReason.set(reason, arr);
      }
      const description = Array.from(byReason.entries())
        .map(([reason, names]) => `· ${names.join(", ")}: ${reason}`)
        .join("\n");

      toast.warning(t("partialToast", { summary }), {
        description,
        duration: 10000,
      });
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={pending}>
      {pending ? t("pending") : t("default")}
    </Button>
  );
}
