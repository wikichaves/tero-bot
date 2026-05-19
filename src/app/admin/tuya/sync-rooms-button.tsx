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
          rooms_renamed: number;
          rooms_reordered: number;
          devices_assigned: number;
          devices_already_assigned: number;
          devices_not_in_db: number;
          tuya_sort_values: Array<{ name: string; sort: number | null }>;
        };
        type Skipped = { home: string; reason: string };

        const synced: Synced[] = json.synced ?? [];
        const skipped: Skipped[] = json.skipped ?? [];
        const newRooms = synced.reduce((sum, s) => sum + s.rooms_inserted, 0);
        const renamed = synced.reduce(
          (sum, s) => sum + (s.rooms_renamed ?? 0),
          0,
        );
        const reordered = synced.reduce(
          (sum, s) => sum + (s.rooms_reordered ?? 0),
          0,
        );
        const devicesAssigned = synced.reduce(
          (sum, s) => sum + s.devices_assigned,
          0,
        );

        // Log los sort values de Tuya en consola — útil para debug.
        // Si todos vienen `null`, sabemos que estamos usando el
        // fallback por índice y no hay nada que hacer del lado app.
        if (typeof window !== "undefined") {
          for (const s of synced) {
            // eslint-disable-next-line no-console
            console.info(
              `[sync-rooms] ${s.property} → Tuya sort values:`,
              s.tuya_sort_values,
            );
          }
        }

        // Detalle por property: incluye renames y reorders en el toast.
        const detail = [
          ...synced.map((s) => {
            const parts: string[] = [];
            if (s.rooms_inserted) parts.push(`+${s.rooms_inserted} amb`);
            if (s.rooms_renamed) parts.push(`${s.rooms_renamed} renombrados`);
            if (s.rooms_reordered) parts.push(`${s.rooms_reordered} reordenados`);
            if (s.devices_assigned)
              parts.push(`${s.devices_assigned} devs asignados`);
            return `${s.property}: ${parts.length ? parts.join(", ") : "sin cambios"}`;
          }),
          ...skipped.map((s) => `⚠ ${s.home}: ${s.reason}`),
        ].join("\n");

        const totalChanges =
          newRooms + renamed + reordered + devicesAssigned;
        if (totalChanges === 0 && skipped.length > 0) {
          toast.error("Sync sin cambios — revisar nombres de homes", {
            description: detail,
          });
        } else if (totalChanges === 0) {
          toast.success("Sync OK · sin cambios", {
            description: detail || "Todo ya estaba sincronizado.",
          });
        } else {
          const headline = [
            newRooms && `${newRooms} nuevos`,
            renamed && `${renamed} renombrados`,
            reordered && `${reordered} reordenados`,
            devicesAssigned && `${devicesAssigned} devices`,
          ]
            .filter(Boolean)
            .join(" · ");
          toast.success(`Sync OK · ${headline}`, {
            description: detail,
          });
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
