"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("adminPropertyForm");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={<Button />}>{t("newProperty")}</DialogTrigger>
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
  // WIK-77: sacamos los emojis de bandera 🇺🇾/🇦🇷 porque renderean
  // inconsistente entre OS (macOS los muestra como bandera, Windows como
  // texto "UY"/"AR"). El nombre del país solo es suficientemente claro.
  { key: "UY", label: "Uruguay", currency: "UYU" },
  { key: "AR", label: "Argentina", currency: "ARS" },
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
  const t = useTranslations("adminPropertyForm");
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
  // WIK-125 — climate conditioning per property. All optional.
  const [targetTempMin, setTargetTempMin] = useState<string>(
    property?.target_temp_min_c != null
      ? String(property.target_temp_min_c)
      : "",
  );
  const [targetTempMax, setTargetTempMax] = useState<string>(
    property?.target_temp_max_c != null
      ? String(property.target_temp_max_c)
      : "",
  );
  const [coolSceneId, setCoolSceneId] = useState(property?.cool_scene_id ?? "");
  const [heatSceneId, setHeatSceneId] = useState(property?.heat_scene_id ?? "");
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
      toast.error(t("toast.tariffPositive"));
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
      // WIK-125: validate climate config — both bounds set or none, and
      // min < max if both. Empty = "disabled for this property".
      const tMin = targetTempMin.trim() ? Number(targetTempMin) : null;
      const tMax = targetTempMax.trim() ? Number(targetTempMax) : null;
      if ((tMin == null) !== (tMax == null)) {
        toast.error(t("toast.bothBoundsOrNone"));
        return;
      }
      if (tMin != null && tMax != null && tMin >= tMax) {
        toast.error(t("toast.minLessThanMax"));
        return;
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
        target_temp_min_c: tMin,
        target_temp_max_c: tMax,
        cool_scene_id: coolSceneId.trim() || null,
        heat_scene_id: heatSceneId.trim() || null,
      });
      if (result?.error || !result.ok) {
        toast.error(result?.error ?? t("toast.saveFailed"));
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
          toast.warning(t("toast.photoTooLarge"));
          onDone();
          return;
        }
        if (!/^image\/(jpeg|png|webp)$/i.test(thumbFile.type)) {
          toast.warning(t("toast.photoBadFormat"));
          onDone();
          return;
        }
        const ticket = await getThumbnailUploadTicket(result.id);
        if ("error" in ticket || !ticket.signedUrl) {
          toast.warning(
            t("toast.photoFailed", {
              reason:
                ("error" in ticket ? ticket.error : undefined) ??
                t("toast.invalidUrl"),
            }),
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
            t("toast.photoUploadFailed", {
              status: putRes.status,
              detail: text.slice(0, 100),
            }),
          );
          onDone();
          return;
        }
        await notifyPropertyThumbnailUploaded();
        setThumbVersion((v) => v + 1);
      }
      toast.success(
        property ? t("toast.propertyUpdated") : t("toast.propertyCreated"),
      );
      onDone();
    });
  }

  return (
    <form onSubmit={onSubmit}>
      <DialogHeader>
        <DialogTitle>
          {property ? t("editProperty") : t("newProperty")}
        </DialogTitle>
        <DialogDescription>{t("dialogDescription")}</DialogDescription>
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
            <Label htmlFor="thumb">{t("fields.coverPhoto")}</Label>
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
              {t("fields.coverPhotoHint")}
            </p>
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="name">{t("fields.name")}</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="airbnb_ical_url">{t("fields.airbnbIcalUrl")}</Label>
          <Input
            id="airbnb_ical_url"
            type="url"
            value={airbnbUrl}
            onChange={(e) => setAirbnbUrl(e.target.value)}
            placeholder="https://www.airbnb.com/calendar/ical/...ics?s=..."
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="airbnb_listing_id">
            {t("fields.airbnbListingId")}
          </Label>
          <Input
            id="airbnb_listing_id"
            value={airbnbListingId}
            onChange={(e) => setAirbnbListingId(e.target.value)}
            placeholder={t("placeholders.airbnbListingId")}
            inputMode="numeric"
            pattern="\d*"
          />
          <p className="text-xs text-muted-foreground">
            {t("fields.airbnbListingIdHintBefore")}{" "}
            (<code>airbnb.com/rooms/<strong>1526467</strong></code>).{" "}
            {t("fields.airbnbListingIdHintAfter")}
          </p>
        </div>
        {/* Booking iCal: oculto del UI por ahora (WIK-64) pero el campo
            sigue en la DB y los actions lo aceptan, por si hay rows
            existentes que ya lo tienen seteado. Reactivar el input cuando
            volvamos a usar Booking. */}
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2">
            <Label htmlFor="country">{t("fields.country")}</Label>
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
            <Label htmlFor="tariff_per_kwh">{t("fields.tariffPerKwh")}</Label>
            <Input
              id="tariff_per_kwh"
              type="number"
              step="0.01"
              min="0"
              value={tariff}
              onChange={(e) => setTariff(e.target.value)}
              placeholder={t("placeholders.tariffPerKwh")}
            />
            <p className="text-xs text-muted-foreground">
              {t("fields.tariffPerKwhHint")}
            </p>
          </div>
        </div>
        {/* WIK-125 — Acondicionamiento pre check-in */}
        <div className="grid gap-3 rounded-md border border-input bg-muted/30 p-3">
          <div>
            <Label className="text-sm font-medium">
              {t("climate.title")}
            </Label>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("climate.description")}{" "}
              <a
                href="/admin/tuya/scenes"
                className="underline"
                target="_blank"
                rel="noreferrer"
              >
                /admin/tuya/scenes
              </a>
              .
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label
                htmlFor="target_temp_min_c"
                className="text-xs font-normal text-muted-foreground"
              >
                {t("climate.tempMin")}
              </Label>
              <Input
                id="target_temp_min_c"
                type="number"
                step="0.5"
                min="0"
                max="40"
                value={targetTempMin}
                onChange={(e) => setTargetTempMin(e.target.value)}
                placeholder="20"
              />
            </div>
            <div className="grid gap-1">
              <Label
                htmlFor="target_temp_max_c"
                className="text-xs font-normal text-muted-foreground"
              >
                {t("climate.tempMax")}
              </Label>
              <Input
                id="target_temp_max_c"
                type="number"
                step="0.5"
                min="0"
                max="40"
                value={targetTempMax}
                onChange={(e) => setTargetTempMax(e.target.value)}
                placeholder="25"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label
                htmlFor="heat_scene_id"
                className="text-xs font-normal text-muted-foreground"
              >
                {t("climate.heatScene")}
              </Label>
              <Input
                id="heat_scene_id"
                value={heatSceneId}
                onChange={(e) => setHeatSceneId(e.target.value)}
                placeholder={t("placeholders.sceneId")}
                className="font-mono text-xs"
              />
            </div>
            <div className="grid gap-1">
              <Label
                htmlFor="cool_scene_id"
                className="text-xs font-normal text-muted-foreground"
              >
                {t("climate.coolScene")}
              </Label>
              <Input
                id="cool_scene_id"
                value={coolSceneId}
                onChange={(e) => setCoolSceneId(e.target.value)}
                placeholder={t("placeholders.sceneId")}
                className="font-mono text-xs"
              />
            </div>
          </div>
        </div>
        <div className="grid gap-2">
          <Label>{t("providers.title")}</Label>
          <p className="text-xs text-muted-foreground">
            {t("providers.description")}
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
          {pending ? t("saving") : t("save")}
        </Button>
      </DialogFooter>
    </form>
  );
}
