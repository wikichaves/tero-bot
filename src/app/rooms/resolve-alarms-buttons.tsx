"use client";

import { useState, useTransition } from "react";
import { CheckCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { resolveAlarmEvents } from "./actions";

/**
 * WIK-316: botones para resolver alarmas activas en bloque desde la lista
 * de /rooms.
 *
 * - Variante por room (`roomId`): botón compacto que resuelve todas las
 *   alarmas activas de ese ambiente. Sin confirmación (scope acotado).
 * - Variante general (`all`): resuelve TODAS las alarmas activas visibles.
 *   Pide confirmación (dialog) porque es una acción amplia.
 */
export function ResolveRoomAlarmsButton({
  roomId,
  count,
}: {
  roomId: string;
  count: number;
}) {
  const t = useTranslations("rooms");
  const [pending, startTransition] = useTransition();

  function onResolve() {
    startTransition(async () => {
      const r = await resolveAlarmEvents({ roomId });
      if ("error" in r) toast.error(r.error);
      else toast.success(t("alarms.resolvedToast", { n: r.resolved }));
    });
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onResolve}
      disabled={pending}
      className="h-7 gap-1 text-xs"
    >
      <CheckCheck className="h-3.5 w-3.5" />
      {t("alarms.resolveRoom", { n: count })}
    </Button>
  );
}

export function ResolveAllAlarmsButton({ total }: { total: number }) {
  const t = useTranslations("rooms");
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onConfirm() {
    startTransition(async () => {
      const r = await resolveAlarmEvents({ all: true });
      if ("error" in r) {
        toast.error(r.error);
        return;
      }
      toast.success(t("alarms.resolvedToast", { n: r.resolved }));
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="destructive" size="sm" className="gap-1.5" />
        }
      >
        <CheckCheck className="h-4 w-4" />
        {t("alarms.resolveAll", { n: total })}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("alarms.resolveAllConfirmTitle")}</DialogTitle>
          <DialogDescription>
            {t("alarms.resolveAllConfirmBody", { n: total })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            {t("alarms.cancel")}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={pending}>
            {pending
              ? t("alarms.resolving")
              : t("alarms.resolveAllConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
