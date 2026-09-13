import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth";
import { getAllowedPropertyIds } from "@/lib/auth/scope";
import { getActiveCountry } from "@/lib/country";
import { createClient } from "@/lib/supabase/server";
import { reservationPeriod } from "@/lib/reservations/manual";
import { Button } from "@/components/ui/button";
import { CreateReservationForm, type PropertyOption } from "./create-form";

type Row = { id: string; property_id: string; guest_name: string | null; check_in: string; check_out: string; source: string; status: string; payout_amount: number | null; payout_currency: string | null };

export default async function ReservationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [profile, params, t, locale] = await Promise.all([requireRole(["admin", "gestor"]), searchParams, getTranslations("reservationsPage"), getLocale()]);
  const allowed = await getAllowedPropertyIds(profile);
  const country = await getActiveCountry(allowed);
  const db = await createClient();
  let propertyQuery = db.from("properties").select("id,name,country,is_rental").order("name");
  if (allowed !== null) propertyQuery = propertyQuery.in("id", allowed);
  if (country !== "ALL") propertyQuery = propertyQuery.eq("country", country);
  const { data: propertyData, error: propertyError } = await propertyQuery;
  if (propertyError) throw new Error(t("loadError"));
  const properties = (propertyData ?? []) as (PropertyOption & { is_rental: boolean })[];
  // Discard a previous country's property filter after switching the header.
  const selectedProperty = properties.some(p => p.id === params.property) ? String(params.property) : "";
  const period = typeof params.period === "string" && ["past", "current", "future", "cancelled"].includes(params.period) ? params.period : "all";
  const requestedPage = typeof params.page === "string" ? Number(params.page) : 1;
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 100000) : 1;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Montevideo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const size = 50;
  let query = db.from("reservations").select("id,property_id,guest_name,check_in,check_out,source,status,payout_amount,payout_currency", { count: "exact" }).in("property_id", selectedProperty ? [selectedProperty] : properties.map(p => p.id));
  if (period === "cancelled") query = query.eq("status", "cancelled");
  else query = query.neq("status", "cancelled");
  if (period === "past") query = query.lte("check_out", today);
  if (period === "current") query = query.lte("check_in", today).gt("check_out", today);
  if (period === "future") query = query.gt("check_in", today);
  const { data, count, error } = await query.order("check_in", { ascending: period === "future" || period === "current" }).order("id").range((page - 1) * size, page * size - 1);
  if (error) throw new Error(t("loadError"));
  const rows = (data ?? []) as Row[];
  const propertyMap = new Map(properties.map(p => [p.id, p]));
  const date = (value: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
  function href(nextPage: number, nextPeriod = period) {
    const query = new URLSearchParams({ period: nextPeriod, page: String(nextPage) });
    if (selectedProperty) query.set("property", selectedProperty);
    return `/reservations?${query}`;
  }
  return <div className="space-y-6">
    <div><h1 className="text-4xl">{t("title")}</h1><p className="text-sm text-muted-foreground">{t("description")}</p></div>
    <CreateReservationForm key={`${country}:${selectedProperty}`} properties={properties.filter(p => p.is_rental)} selectedProperty={selectedProperty} />
    <form className="flex flex-wrap items-end gap-3" action="/reservations">
      <input type="hidden" name="period" value={period} />
      <label className="space-y-2 text-sm"><span className="block">{t("property")}</span><select key={`${country}:${selectedProperty}`} name="property" defaultValue={selectedProperty} className="h-9 max-w-full rounded-md border bg-background px-3"><option value="">{t("allProperties")}</option>{properties.map(p => <option key={p.id} value={p.id}>{p.name} · {p.country}</option>)}</select></label>
      <Button type="submit" variant="outline">{t("filter")}</Button>
    </form>
    <nav aria-label={t("period")} className="flex flex-wrap gap-2">{(["all", "current", "future", "past", "cancelled"] as const).map(value => <Link key={value} href={href(1, value)} aria-current={period === value ? "page" : undefined} className={`rounded-full border px-4 py-2 text-sm ${period === value ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{t(value)}</Link>)}</nav>
    <p className="text-sm text-muted-foreground">{t("count", { count: count ?? 0 })}</p>
    <div className="grid gap-3">
      {rows.map(row => { const property = propertyMap.get(row.property_id); return <Link href={`/dashboard/reservations/${row.id}`} key={row.id} className="flex flex-col justify-between gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-muted/50 sm:flex-row sm:items-center">
        <div className="space-y-1"><p className="font-medium">{row.guest_name || t("unknownGuest")}</p><p className="text-sm text-muted-foreground">{property?.name} · {property?.country} · {row.source === "manual" ? t("manual") : row.source === "airbnb" ? "Airbnb" : "Booking.com"}</p><p className="text-sm">{date(row.check_in)} → {date(row.check_out)}</p></div>
        <div className="space-y-2 sm:text-right"><span className="inline-block rounded-full bg-muted px-3 py-1 text-xs">{t(row.status === "cancelled" ? "cancelled" : reservationPeriod(row.check_in, row.check_out, today))}</span><p className="text-sm font-medium">{row.payout_amount !== null && row.payout_currency ? new Intl.NumberFormat(locale, { style: "currency", currency: row.payout_currency }).format(row.payout_amount) : t("noAmount")}</p></div>
      </Link>; })}
      {!rows.length && <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">{t("empty")}</div>}
    </div>
    <div className="flex items-center justify-between text-sm">{page > 1 ? <Link className="underline" href={href(page - 1)}>{t("previous")}</Link> : <span />}{page * size < (count ?? 0) && <Link className="underline" href={href(page + 1)}>{t("next")}</Link>}</div>
    <p className="text-xs text-muted-foreground">{t("historyHelp")}</p>
  </div>;
}
