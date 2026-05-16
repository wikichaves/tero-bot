"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/**
 * Trigger manual del sync de rooms desde Smart Life (WIK-82). Pulla los
 * rooms configurados en la app móvil de Tuya y crea las filas faltantes
 * en `public.rooms`. Idempotente — correr varias veces no duplica.
 *
 * Después del sync el admin tiene que asignar cada device a su room
 * (eso se hace en el dialog de "Asignar device" via el dropdown room_id
 * que sumamos como parte de F2).
 */
export function SyncRoomsButton() {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onClick() {
    startTransition(async () => {
      try {
        const res = await fetch("/api/admin/tuya/sync-rooms", {
          method: "POST",
        });
        const json = await res.json();
        if (!res.ok) {
          toast.error(json.error ?? `Sync falló (${res.status})`);
          return;
        }
        const inserted =
          json.synced?.reduce(
            (sum: number, s: { inserted: number }) => sum + s.inserted,
            0,
          ) ?? 0;
        const skippedHomes = json.skipped?.length ?? 0;
        const skippedDetail =
          skippedHomes > 0
            ? json.skipped
                .map(
                  (s: { home: string; reason: string }) =>
                    `${s.home}: ${s.reason}`,
                )
                .join("; ")
            : "";
        toast.success(
          `Sync OK · ${inserted} ambientes nuevos${
            skippedHomes > 0 ? ` · ${skippedHomes} homes skip` : ""
          }`,
          skippedDetail ? { description: skippedDetail } : undefined,
        );
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={pending}>
      {pending ? "Sincronizando…" : "Sincronizar ambientes"}
    </Button>
  );
}
