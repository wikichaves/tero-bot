"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import type { Reservation } from "@/lib/types";
import { updateReservation } from "./actions";

export function EditReservationDialog({
  reservation,
  open,
  onOpenChange,
}: {
  reservation: Reservation;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await updateReservation({
        id: reservation.id,
        guest_name: String(formData.get("guest_name") ?? ""),
        guest_phone: String(formData.get("guest_phone") ?? ""),
        notes: String(formData.get("notes") ?? ""),
      });
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Reserva actualizada.");
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Editar reserva</DialogTitle>
            <DialogDescription>
              {reservation.source === "airbnb" && "Reserva de Airbnb · "}
              {reservation.check_in} → {reservation.check_out}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="guest_name">Nombre del huésped</Label>
              <Input
                id="guest_name"
                name="guest_name"
                defaultValue={reservation.guest_name ?? ""}
                placeholder="ej. Juan Pérez"
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="guest_phone">WhatsApp del huésped</Label>
              <Input
                id="guest_phone"
                name="guest_phone"
                defaultValue={reservation.guest_phone ?? ""}
                placeholder="+598 99 123 456"
                inputMode="tel"
              />
              <p className="text-xs text-muted-foreground">
                Formato internacional (con prefijo de país). Necesario para
                enviar templates de WhatsApp al huésped.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="notes">Notas</Label>
              <textarea
                id="notes"
                name="notes"
                rows={3}
                defaultValue={reservation.notes ?? ""}
                placeholder="ej. Llega tarde, tiene mascota…"
                className="resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
