"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createManualReservation } from "./actions";

export type PropertyOption = { id: string; name: string; country: string };

export function CreateReservationForm({ properties, selectedProperty }: { properties: PropertyOption[]; selectedProperty: string }) {
  const t = useTranslations("reservationsPage");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState<{ id: string; duplicate?: boolean }>();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>;
    setError(undefined);
    startTransition(async () => {
      try {
        const result = await createManualReservation(input);
        if (result.error) { setError(result.error); return; }
        if (result.id) {
          setSaved({ id: result.id, duplicate: result.duplicate });
          setOpen(false);
          router.refresh();
        }
      } catch { setError(t("saveError")); }
    });
  }
  const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";
  return <div className="space-y-4">
    <Button disabled={properties.length === 0} onClick={() => { setOpen(!open); setError(undefined); setSaved(undefined); }}><Plus className="h-4 w-4" />{t("create")}</Button>
    {saved && <p role="status" className="text-sm">{t(saved.duplicate ? "alreadySaved" : "saved")} <Link className="underline" href={`/dashboard/reservations/${saved.id}`}>{t("view")}</Link></p>}
    {open && <form onSubmit={submit} className="space-y-4 rounded-xl border p-4 sm:p-6">
      <h2 className="text-lg font-semibold">{t("create")}</h2>
      <p className="text-sm text-muted-foreground">{t("manualHelp")}</p>
      <fieldset disabled={pending} className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-2 text-sm"><span>{t("property")}</span><select name="property_id" required defaultValue={selectedProperty || properties[0]?.id} className={selectClass}>{properties.map(p => <option key={p.id} value={p.id}>{p.name} · {p.country}</option>)}</select></label>
        <label className="space-y-2 text-sm"><span>{t("guest")}</span><Input name="guest_name" required maxLength={200} autoComplete="name" /></label>
        <label className="space-y-2 text-sm"><span>{t("checkIn")}</span><Input name="check_in" type="date" required /></label>
        <label className="space-y-2 text-sm"><span>{t("checkOut")}</span><Input name="check_out" type="date" required /></label>
        <label className="space-y-2 text-sm"><span>{t("phone")}</span><Input name="guest_phone" type="tel" maxLength={40} /></label>
        <label className="space-y-2 text-sm"><span>{t("guestCount")}</span><Input name="guest_count" type="number" min="1" max="100" step="1" /></label>
        <label className="space-y-2 text-sm"><span>{t("amount")}</span><Input name="payout_amount" type="number" min="0" max="10000000" step="0.01" /><span className="text-xs text-muted-foreground">{t("amountHelp")}</span></label>
        <label className="space-y-2 text-sm"><span>{t("currency")}</span><select name="payout_currency" defaultValue="USD" className={selectClass}><option>USD</option><option>UYU</option><option>ARS</option></select></label>
        <label className="space-y-2 text-sm sm:col-span-2"><span>{t("notes")}</span><textarea name="notes" maxLength={2000} rows={3} className="w-full rounded-md border border-input bg-background p-3" /></label>
      </fieldset>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2"><Button type="submit" disabled={pending}>{t(pending ? "saving" : "save")}</Button><Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>{t("close")}</Button></div>
    </form>}
  </div>;
}
