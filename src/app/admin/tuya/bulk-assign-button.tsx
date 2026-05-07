"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import type { Property } from "@/lib/types";
import { bulkAssignDevicesToProperty } from "./actions";

type BulkDevice = {
  id: string;
  name: string;
  category?: string | null;
  category_name?: string | null;
};

export function BulkAssignButton({
  homeName,
  devices,
  properties,
}: {
  homeName: string;
  devices: BulkDevice[];
  properties: Pick<Property, "id" | "name">[];
}) {
  const [open, setOpen] = useState(false);
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? "");
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!propertyId) {
      toast.error("Elegí una propiedad.");
      return;
    }
    startTransition(async () => {
      const result = await bulkAssignDevicesToProperty({
        property_id: propertyId,
        devices: devices.map((d) => ({
          id: d.id,
          name: d.name,
          category: d.category ?? undefined,
          category_name: d.category_name ?? undefined,
        })),
      });
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      if ("assigned" in result) {
        toast.success(`${result.assigned} devices asignados.`);
        setOpen(false);
      }
    });
  }

  if (properties.length === 0) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" onClick={() => setOpen(true)}>
        Asignar todos a una propiedad
      </Button>
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Asignar home a propiedad</DialogTitle>
            <DialogDescription>
              {devices.length} device{devices.length === 1 ? "" : "s"} de la
              home <strong>{homeName}</strong>. El tipo se infiere de la
              categoría de cada device; podés ajustar después caso por caso.
              Los devices ya asignados se sobreescriben.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="bulk-property">Propiedad destino</Label>
              <select
                id="bulk-property"
                value={propertyId}
                onChange={(e) => setPropertyId(e.target.value)}
                required
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
              >
                <option value="">— elegí —</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-xs text-muted-foreground">
              Recordá marcar manualmente la cerradura como{" "}
              <em>primaria</em> después (desde la fila correspondiente),
              para que los códigos de huésped se generen sobre ese device.
            </p>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Asignando…" : `Asignar ${devices.length}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
