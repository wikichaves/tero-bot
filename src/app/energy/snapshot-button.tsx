"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { snapshotNow } from "./actions";

export function SnapshotButton() {
  const [pending, startTransition] = useTransition();

  function onClick() {
    startTransition(async () => {
      const result = await snapshotNow();
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      if ("result" in result && result.result) {
        const inserted = result.result.results.filter((r) => r.inserted).length;
        const skipped = result.result.results.filter(
          (r) => r.ok && !r.inserted,
        ).length;
        const failed = result.result.results.filter((r) => !r.ok).length;
        toast.success(
          `Snapshot OK · ${inserted} insertados, ${skipped} omitidos, ${failed} con error.`,
        );
      }
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={pending}>
      {pending ? "Capturando…" : "Snapshot ahora"}
    </Button>
  );
}
