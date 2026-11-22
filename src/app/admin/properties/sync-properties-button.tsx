"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { syncProperty } from "./actions";

export function SyncPropertiesButton({ properties }: {
  properties: { id: string; name: string }[];
}) {
  const t = useTranslations("adminPropertiesPage.sync");
  const router = useRouter();
  const running = useRef(false);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(0);

  async function sync() {
    if (running.current || !properties.length) return;
    running.current = true;
    setPending(true);
    setDone(0);
    const failures: string[] = [];
    try {
      // Separate requests keep a slow feed from consuming the whole batch's timeout.
      for (const [index, property] of properties.entries()) {
        try {
          const result = await syncProperty(property.id);
          if ("error" in result || result.result.errors.length > 0) {
            failures.push(property.name);
          }
        } catch {
          failures.push(property.name);
        }
        setDone(index + 1);
      }
      const success = properties.length - failures.length;
      if (!failures.length) {
        toast.success(t("success", { count: success }));
      } else {
        const message = t(success ? "partial" : "failed", {
          success, total: properties.length, names: failures.join(", "),
        });
        if (success) toast.warning(message);
        else toast.error(message);
      }
      router.refresh();
    } finally {
      running.current = false;
      setPending(false);
    }
  }

  return (
    <Button variant="outline" onClick={sync} disabled={pending || !properties.length}
      aria-busy={pending} title={t(properties.length ? "hint" : "empty")}>
      <RefreshCw aria-hidden="true" className={pending ? "size-4 animate-spin" : "size-4"} />
      <span aria-live="polite">{pending ? t("pending", { done, total: properties.length }) : t("label")}</span>
    </Button>
  );
}
