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
        type Synced = {
          home: string;
          property: string;
          rooms_inserted: number;
          rooms_existing: number;
          devices_assigned: number;
          devices_already_assigned: number;
          devices_not_in_db: number;
        };
        type Skipped = { home: string; reason: string };

        const synced: Synced[] = json.synced ?? [];
        const skipped: Skipped[] = json.skipped ?? [];
        const newRooms = synced.reduce(
          (sum, s) => sum + s.rooms_inserted,
          0,
        );
        const devicesAssigned = synced.reduce(
          (sum, s) => sum + s.devices_assigned,
          0,
        );

        // Detalle por property en el description (truncado).
        const detail = [
          ...synced.map(
            (s) =>
              `${s.property}: +${s.rooms_inserted} amb, ${s.devices_assigned} devs asignados`,
          ),
          ...skipped.map((s) => `⚠ ${s.home}: ${s.reason}`),
        ].join("\n");

        if (newRooms === 0 && devicesAssigned === 0 && skipped.length > 0) {
          toast.error("Sync sin cambios — revisar nombres de homes", {
            description: detail,
          });
        } else {
          toast.success(
            `Sync OK · ${newRooms} ambientes nuevos · ${devicesAssigned} devices asignados`,
            detail ? { description: detail } : undefined,
          );
        }
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
