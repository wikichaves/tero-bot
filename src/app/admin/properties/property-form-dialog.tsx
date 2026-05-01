"use client";

import { useEffect, useState, useTransition } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import type { Property } from "@/lib/types";
import { upsertProperty } from "./actions";

export function NewPropertyDialog() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={<Button />}>Nueva propiedad</DialogTrigger>
        <DialogContent>
          <PropertyForm onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

export function EditPropertyDialog({
  property,
  open,
  onOpenChange,
}: {
  property: Property;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <PropertyForm
          property={property}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function PropertyForm({
  property,
  onDone,
}: {
  property?: Property;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(property?.name ?? "");
  const [airbnbUrl, setAirbnbUrl] = useState(property?.airbnb_ical_url ?? "");
  const [bookingUrl, setBookingUrl] = useState(
    property?.booking_ical_url ?? "",
  );

  useEffect(() => {
    setName(property?.name ?? "");
    setAirbnbUrl(property?.airbnb_ical_url ?? "");
    setBookingUrl(property?.booking_ical_url ?? "");
  }, [property]);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    startTransition(async () => {
      const result = await upsertProperty({
        id: property?.id,
        name,
        airbnb_ical_url: airbnbUrl,
        booking_ical_url: bookingUrl,
      });
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(property ? "Propiedad actualizada." : "Propiedad creada.");
      onDone();
    });
  }

  return (
    <form onSubmit={onSubmit}>
      <DialogHeader>
        <DialogTitle>
          {property ? "Editar propiedad" : "Nueva propiedad"}
        </DialogTitle>
        <DialogDescription>
          La URL del iCal queda guardada en tu DB privada y se usa para
          sincronizar reservas. No se expone a usuarios sin rol admin/gestor.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-4">
        <div className="grid gap-2">
          <Label htmlFor="name">Nombre</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="airbnb_ical_url">URL iCal Airbnb</Label>
          <Input
            id="airbnb_ical_url"
            type="url"
            value={airbnbUrl}
            onChange={(e) => setAirbnbUrl(e.target.value)}
            placeholder="https://www.airbnb.com/calendar/ical/...ics?s=..."
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="booking_ical_url">URL iCal Booking (opcional)</Label>
          <Input
            id="booking_ical_url"
            type="url"
            value={bookingUrl}
            onChange={(e) => setBookingUrl(e.target.value)}
            placeholder="https://admin.booking.com/hotel/.../ical?..."
          />
        </div>
      </div>
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : "Guardar"}
        </Button>
      </DialogFooter>
    </form>
  );
}
