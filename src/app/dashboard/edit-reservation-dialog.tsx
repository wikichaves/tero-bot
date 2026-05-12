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
        guest_count: String(formData.get("guest_count") ?? ""),
        payout_amount: String(formData.get("payout_amount") ?? ""),
        payout_currency: String(formData.get("payout_currency") ?? ""),
        guest_message: String(formData.get("guest_message") ?? ""),
        guest_adults: String(formData.get("guest_adults") ?? ""),
        guest_children: String(formData.get("guest_children") ?? ""),
        guest_infants: String(formData.get("guest_infants") ?? ""),
        check_in_time: String(formData.get("check_in_time") ?? ""),
        check_out_time: String(formData.get("check_out_time") ?? ""),
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
            <div className="grid grid-cols-[1fr_1fr_1fr] gap-3">
              <div className="grid gap-2">
                <Label htmlFor="guest_adults">Adultos</Label>
                <Input
                  id="guest_adults"
                  name="guest_adults"
                  type="number"
                  min="0"
                  max="20"
                  defaultValue={reservation.guest_adults ?? ""}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="guest_children">Niños</Label>
                <Input
                  id="guest_children"
                  name="guest_children"
                  type="number"
                  min="0"
                  max="20"
                  defaultValue={reservation.guest_children ?? ""}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="guest_infants">Bebés</Label>
                <Input
                  id="guest_infants"
                  name="guest_infants"
                  type="number"
                  min="0"
                  max="10"
                  defaultValue={reservation.guest_infants ?? ""}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="check_in_time">Horario check-in</Label>
                <Input
                  id="check_in_time"
                  name="check_in_time"
                  type="time"
                  defaultValue={reservation.check_in_time ?? ""}
                />
                <p className="text-xs text-muted-foreground">
                  Default Airbnb. Editá si el huésped arregló otro horario.
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="check_out_time">Horario check-out</Label>
                <Input
                  id="check_out_time"
                  name="check_out_time"
                  type="time"
                  defaultValue={reservation.check_out_time ?? ""}
                />
              </div>
            </div>
            <div className="grid grid-cols-[1fr_1fr_1fr] gap-3">
              <div className="grid gap-2">
                <Label htmlFor="guest_count">Huéspedes (total)</Label>
                <Input
                  id="guest_count"
                  name="guest_count"
                  type="number"
                  min="1"
                  max="20"
                  defaultValue={reservation.guest_count ?? ""}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="payout_amount">Payout</Label>
                <Input
                  id="payout_amount"
                  name="payout_amount"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={
                    reservation.payout_amount != null
                      ? String(reservation.payout_amount)
                      : ""
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="payout_currency">Moneda</Label>
                <Input
                  id="payout_currency"
                  name="payout_currency"
                  maxLength={3}
                  defaultValue={reservation.payout_currency ?? ""}
                  placeholder="UYU"
                  className="uppercase"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="guest_message">Mensaje del huésped</Label>
              <textarea
                id="guest_message"
                name="guest_message"
                rows={2}
                defaultValue={reservation.guest_message ?? ""}
                placeholder="Nota que el huésped dejó al reservar"
                className="resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="notes">Notas internas</Label>
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
