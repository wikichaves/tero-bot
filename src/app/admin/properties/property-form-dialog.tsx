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
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
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

/** Country presets — drives the currency auto-derivation and which
 *  provider inputs we render. Internal DB still stores ISO currency,
 *  so the only place "country" lives is in this form's UX. */
type CountryKey = "UY" | "AR";

const COUNTRIES: Array<{
  key: CountryKey;
  label: string;
  currency: string;
}> = [
  { key: "UY", label: "🇺🇾 Uruguay", currency: "UYU" },
  { key: "AR", label: "🇦🇷 Argentina", currency: "ARS" },
];

/** Bill providers by country. The `key` is the internal name used by
 *  the inbound parser and stored as `provider` in utility_bills + as
 *  keys inside `provider_accounts`. The `label` is what we show in the
 *  form (e.g. "Antel Fijo" vs internal key "Antel" — keeping the key
 *  unchanged for backwards compat with existing parsed data). */
const PROVIDERS_BY_COUNTRY: Record<
  CountryKey,
  Array<{ key: string; label: string; placeholder: string }>
> = {
  UY: [
    { key: "UTE", label: "UTE", placeholder: "ej. 4131911000" },
    { key: "OSE", label: "OSE", placeholder: "ej. 5359041" },
    { key: "Antel", label: "Antel Fijo", placeholder: "ej. 25006163000108" },
    { key: "Prosegur", label: "Prosegur", placeholder: "ej. 3317403" },
  ],
  AR: [
    { key: "Edenor", label: "Edenor", placeholder: "ej. 2259142078" },
    { key: "AySA", label: "AySA", placeholder: "ej. 1234567" },
    {
      key: "Personal Flow",
      label: "Personal Flow",
      placeholder: "ej. 7654321",
    },
  ],
};

/** Map an existing currency (or default) to a country preset. Properties
 *  pre-dating the country selector still have `currency` set; we infer
 *  back the country so the form opens with the right radio + provider
 *  list. Falls back to Uruguay for the unknown case. */
function countryFromCurrency(currency: string | null | undefined): CountryKey {
  return currency === "ARS" ? "AR" : "UY";
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
  // Booking iCal: held in state so submit can round-trip the existing
  // value back to the DB without losing it (WIK-64 hid the UI input but
  // didn't drop the column).
  const [bookingUrl] = useState(property?.booking_ical_url ?? "");
  const [country, setCountry] = useState<CountryKey>(() =>
    countryFromCurrency(property?.currency),
  );
  const [tariff, setTariff] = useState<string>(
    property?.tariff_per_kwh != null ? String(property.tariff_per_kwh) : "",
  );
  const [airbnbListingId, setAirbnbListingId] = useState(
    property?.airbnb_listing_id ?? "",
  );
  // We keep ALL provider keys in state (even when the country is the
  // other one) so that switching country temporarily doesn't lose the
  // values typed for the previous country. On submit we filter to the
  // country's providers and drop the rest.
  const [providerAccounts, setProviderAccounts] = useState<
    Record<string, string>
  >(() => {
    const existing = property?.provider_accounts ?? {};
    const out: Record<string, string> = {};
    for (const list of Object.values(PROVIDERS_BY_COUNTRY)) {
      for (const p of list) {
        out[p.key] = existing[p.key] ?? "";
      }
    }
    return out;
  });
  const visibleProviders = PROVIDERS_BY_COUNTRY[country];
  const currency =
    COUNTRIES.find((c) => c.key === country)?.currency ?? "UYU";
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
      // Strip provider accounts that don't belong to the selected country
      // — keeping them around would let an Edenor account silently sit
      // on a UYU property and confuse the inbound matcher.
      const visibleKeys = new Set(visibleProviders.map((p) => p.key));
      const filteredAccounts: Record<string, string> = {};
      for (const [k, v] of Object.entries(providerAccounts)) {
        if (visibleKeys.has(k)) filteredAccounts[k] = v;
      }
      const result = await upsertProperty({
        id: property?.id,
        name,
        airbnb_ical_url: airbnbUrl,
        booking_ical_url: bookingUrl,
        currency,
        tariff_per_kwh: tariffNum,
        airbnb_listing_id: airbnbListingId.trim(),
        provider_accounts: filteredAccounts,
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
        {/* Booking iCal: oculto del UI por ahora (WIK-64) pero el campo
            sigue en la DB y los actions lo aceptan, por si hay rows
            existentes que ya lo tienen seteado. Reactivar el input cuando
            volvamos a usar Booking. */}
        <div className="grid grid-cols-[1fr_2fr] gap-3">
          <div className="grid gap-2">
            <Label htmlFor="country">País</Label>
            <select
              id="country"
              value={country}
              onChange={(e) => setCountry(e.target.value as CountryKey)}
              required
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
            >
              {COUNTRIES.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label} · {c.currency}
                </option>
              ))}
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
        <div className="grid gap-2">
          <Label>Números de cuenta por proveedor</Label>
          <p className="text-xs text-muted-foreground">
            Necesario cuando hay más de una propiedad con la misma moneda. La
            factura inbound se asigna a esta propiedad cuando el PDF dice esta
            cuenta. Dejá vacío lo que no aplique.
          </p>
          <div className="grid grid-cols-2 gap-3">
            {visibleProviders.map((p) => (
              <div key={p.key} className="grid gap-1">
                <Label
                  htmlFor={`provider_${p.key}`}
                  className="text-xs font-normal text-muted-foreground"
                >
                  {p.label}
                </Label>
                <Input
                  id={`provider_${p.key}`}
                  value={providerAccounts[p.key] ?? ""}
                  onChange={(e) =>
                    setProviderAccounts((s) => ({
                      ...s,
                      [p.key]: e.target.value,
                    }))
                  }
                  placeholder={p.placeholder}
                  inputMode="numeric"
                />
              </div>
            ))}
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
