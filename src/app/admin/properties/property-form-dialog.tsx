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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { PropertyThumb } from "@/components/property-thumb";
import type { Property } from "@/lib/types";
import {
  getThumbnailUploadTicket,
  notifyPropertyThumbnailUploaded,
  upsertProperty,
} from "./actions";

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
        {/* key={property.id} re-mounts the form when switching between
            properties, so initial state can come from props in useState()
            without a useEffect sync. */}
        <PropertyForm
          key={property.id}
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
  const [currency, setCurrency] = useState(property?.currency ?? "UYU");
  const [tariff, setTariff] = useState<string>(
    property?.tariff_per_kwh != null ? String(property.tariff_per_kwh) : "",
  );
  const [airbnbListingId, setAirbnbListingId] = useState(
    property?.airbnb_listing_id ?? "",
  );
  const [thumbFile, setThumbFile] = useState<File | null>(null);
  // Bumps when the user picks a new file → forces <PropertyThumb> to re-fetch
  // so the local preview shows the new image after upload.
  const [thumbVersion, setThumbVersion] = useState(0);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const tariffNum = tariff.trim() ? Number(tariff) : null;
    if (tariff.trim() && (!Number.isFinite(tariffNum) || tariffNum! <= 0)) {
      toast.error("La tarifa debe ser un número positivo.");
      return;
    }
    startTransition(async () => {
      const result = await upsertProperty({
        id: property?.id,
        name,
        airbnb_ical_url: airbnbUrl,
        booking_ical_url: bookingUrl,
        currency: currency.toUpperCase(),
        tariff_per_kwh: tariffNum,
        airbnb_listing_id: airbnbListingId.trim(),
      });
      if (result?.error || !result.ok) {
        toast.error(result?.error ?? "No se pudo guardar.");
        return;
      }
      // Upload thumbnail (best-effort) if one was picked. We do a DIRECT
      // upload from the browser to Supabase Storage via a signed URL — that
      // way the file bytes never go through Vercel and we sidestep the
      // platform's ~4.5 MB body limit.
      if (thumbFile && result.id) {
        // Client-side size guard so we fail fast with a clear toast, even
        // before involving Storage (which would also reject).
        if (thumbFile.size > 10 * 1024 * 1024) {
          toast.warning(
            "Propiedad guardada, pero la foto supera 10 MB.",
          );
          onDone();
          return;
        }
        if (!/^image\/(jpeg|png|webp)$/i.test(thumbFile.type)) {
          toast.warning(
            "Propiedad guardada, pero el formato de la foto no es JPG/PNG/WebP.",
          );
          onDone();
          return;
        }
        const ticket = await getThumbnailUploadTicket(result.id);
        if ("error" in ticket || !ticket.signedUrl) {
          toast.warning(
            `Propiedad guardada, pero la foto falló: ${
              "error" in ticket ? ticket.error : "URL inválida"
            }`,
          );
          onDone();
          return;
        }
        const putRes = await fetch(ticket.signedUrl, {
          method: "PUT",
          headers: { "Content-Type": thumbFile.type },
          body: thumbFile,
        });
        if (!putRes.ok) {
          const text = await putRes.text().catch(() => "");
          toast.warning(
            `Propiedad guardada, pero la subida de la foto falló (HTTP ${putRes.status}). ${text.slice(0, 100)}`,
          );
          onDone();
          return;
        }
        await notifyPropertyThumbnailUploaded();
        setThumbVersion((v) => v + 1);
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
        <div className="flex items-center gap-3">
          {property?.id ? (
            <PropertyThumb
              propertyId={property.id}
              cacheBuster={String(thumbVersion)}
              size="md"
              alt={name}
            />
          ) : (
            <div className="h-14 w-14 shrink-0 rounded-md bg-muted" />
          )}
          <div className="flex-1">
            <Label htmlFor="thumb">Foto de portada</Label>
            <Input
              id="thumb"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) =>
                setThumbFile(e.target.files?.[0] ?? null)
              }
              className="mt-1 cursor-pointer"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              JPG, PNG o WebP. Hasta 10 MB. Se sube directo a Storage al
              guardar.
            </p>
          </div>
        </div>
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
          <Label htmlFor="airbnb_listing_id">ID de listing en Airbnb</Label>
          <Input
            id="airbnb_listing_id"
            value={airbnbListingId}
            onChange={(e) => setAirbnbListingId(e.target.value)}
            placeholder="ej. 1526467"
            inputMode="numeric"
            pattern="\d*"
          />
          <p className="text-xs text-muted-foreground">
            Número que aparece en la URL pública del listing
            (<code>airbnb.com/rooms/<strong>1526467</strong></code>). Permite
            matchear automáticamente las confirmaciones por email a esta
            propiedad.
          </p>
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
        <div className="grid grid-cols-[1fr_2fr] gap-3">
          <div className="grid gap-2">
            <Label htmlFor="currency">Moneda</Label>
            <select
              id="currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              required
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
            >
              <option value="UYU">UYU · Uruguay</option>
              <option value="ARS">ARS · Argentina</option>
              <option value="USD">USD · Dólar</option>
              <option value="BRL">BRL · Brasil</option>
              <option value="CLP">CLP · Chile</option>
              <option value="EUR">EUR · Euro</option>
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="tariff_per_kwh">Tarifa por kWh (opcional)</Label>
            <Input
              id="tariff_per_kwh"
              type="number"
              step="0.01"
              min="0"
              value={tariff}
              onChange={(e) => setTariff(e.target.value)}
              placeholder="ej. 8 (UTE UY), 204 (Edenor AR con impuestos)"
            />
            <p className="text-xs text-muted-foreground">
              Si lo dejás vacío, /energy usa el fallback global.
            </p>
          </div>
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
