"use client";

import { useState, useTransition } from "react";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import type { Property } from "@/lib/types";
import { deleteProperty, syncProperty } from "./actions";
import { EditPropertyDialog } from "./property-form-dialog";

export function PropertyActions({ property }: { property: Property }) {
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);

  function sync() {
    if (!property.airbnb_ical_url) {
      toast.error("No hay URL de Airbnb configurada.");
      return;
    }
    startTransition(async () => {
      const r = await syncProperty(property.id);
      if ("error" in r) {
        toast.error(r.error);
        return;
      }
      const { reservations, blocks, codes_generated, errors } = r.result;
      const parts = [
        `${reservations} reserva${reservations === 1 ? "" : "s"}`,
        `${blocks} bloqueo${blocks === 1 ? "" : "s"}`,
      ];
      if (codes_generated > 0) {
        parts.push(
          `${codes_generated} código${codes_generated === 1 ? "" : "s"} generado${codes_generated === 1 ? "" : "s"}`,
        );
      }
      const summary = parts.join(", ");
      if (errors.length > 0) {
        toast.warning(`${summary} (${errors.length} errores)`);
      } else {
        toast.success(`Sincronizado: ${summary}.`);
      }
    });
  }

  function remove() {
    if (
      !confirm(`¿Eliminar la propiedad "${property.name}"? No se puede deshacer.`)
    ) {
      return;
    }
    startTransition(async () => {
      const r = await deleteProperty(property.id);
      if (r?.error) {
        toast.error(r.error);
        return;
      }
      toast.success("Propiedad eliminada.");
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon" disabled={pending} />}
        >
          <MoreHorizontal className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setEditOpen(true)}>
            Editar
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={sync}
            disabled={!property.airbnb_ical_url || pending}
          >
            Sincronizar Airbnb
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={remove}
            className="text-destructive focus:text-destructive"
          >
            Eliminar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <EditPropertyDialog
        property={property}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
    </>
  );
}
