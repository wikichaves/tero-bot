import Link from "next/link";
import { PropertyThumb } from "@/components/property-thumb";
import { getLocale, getTranslations } from "next-intl/server";
import type { loadAvailability } from "@/lib/availability/data";
import { overlaps } from "@/lib/availability/core";
import { staySummary } from "./stay";

type Calendar = Awaited<ReturnType<typeof loadAvailability>>;
export async function AvailabilityComparison({ calendars, properties, month, arrival, departure }: {
  calendars: Calendar[]; properties: Calendar["properties"]; month: string; arrival: string; departure: string;
}) {
  const [t, locale] = await Promise.all([getTranslations("availability"), getLocale()]);
  const days = calendars.flatMap(c => c.days).filter(day => !arrival || !departure || (day >= arrival && day < departure));
  const monthLabel = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" });
  const monthBoundary = (day: string) => day !== days[0] && day.endsWith("-01");
  const busy = calendars.flatMap(c => c.busy);
  const rates = [...new Map(calendars.flatMap(c => c.rates).map(r => [r.id, r])).values()];
  const multipleCurrencies = new Set(rates.map(r => r.currency)).size > 1;
  const money = (amount: number, currency: string) => new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
  const summaries = properties.map(p => ({ p, summary: arrival && departure ? staySummary(p, days, busy, rates, arrival, departure) : null }));
  const availableSummaries = summaries.filter(({ summary }) => !summary || summary.status === "available");
  const visibleProperties = availableSummaries.map(({ p }) => p);
  return <section className="min-w-0 space-y-3">
    <p className="text-xs text-muted-foreground">{t("swipeHint")}</p>
    {visibleProperties.length > 0 && <div className="max-w-full overflow-x-auto overscroll-x-contain rounded-xl border focus-visible:outline-ring" tabIndex={0} role="region" aria-label={t("compare")}>
      <table className="w-max border-separate border-spacing-0 text-xs tabular-nums">
        <caption className="sr-only">{t("compare")}</caption>
        <thead><tr><th scope="col" className="sticky left-0 z-20 w-32 min-w-32 border-r border-b bg-card p-2 text-left sm:w-44 sm:min-w-44">{t("property")}</th>{days.map(day => <th scope="col" key={day} className={`min-w-10 border-b px-1 py-2 text-center sm:min-w-14 ${monthBoundary(day) ? "border-l-4 border-l-background" : ""} ${arrival && day >= arrival && day < departure ? "bg-accent" : "bg-card"}`}><span className="block font-normal text-muted-foreground">{new Intl.DateTimeFormat(locale, {weekday:"short", timeZone:"UTC"}).format(new Date(`${day}T00:00:00Z`))}</span><span className="block">{Number(day.slice(-2))}</span>{(day.endsWith("-01") || day === days[0]) && <span className="block font-normal">{monthLabel.format(new Date(`${day}T00:00:00Z`)).replace(/\.$/, "")}</span>}</th>)}</tr></thead>
        <tbody>{visibleProperties.map(p => <tr key={p.id}>
          <th scope="row" className="sticky left-0 z-10 border-r border-b bg-card p-2 text-left"><Link href={`/availability?month=${month}&property=${p.id}&view=calendar&months=${calendars.length}`} className="block min-h-14 w-28 space-y-2 break-words focus-visible:outline-ring sm:w-40"><span className="flex items-center gap-2"><PropertyThumb propertyId={p.id} size="xs" /><span className="min-w-0">{p.name}</span></span><span className="block space-y-0.5 text-[10px] font-normal leading-snug text-muted-foreground sm:text-xs">
            {p.max_guests != null && <span className="block">{t("propertyDetails.guests", {count: p.max_guests})}</span>}
            {p.bedrooms != null && <span className="block">{t("propertyDetails.bedrooms", {count: p.bedrooms})}</span>}
            {p.floors != null && <span className="block">{t(p.floors === 1 ? "propertyDetails.oneFloor" : "propertyDetails.twoFloors")}</span>}
            {p.pets_allowed != null && <span className="block">{t(p.pets_allowed ? "propertyDetails.petsAllowed" : "propertyDetails.noPets")}</span>}
          </span>{!p.known && <span className="block text-[10px] font-normal text-status-warning">{t("unknown")}</span>}</Link></th>
          {days.map((day, i) => {
            const statusFor = (d: string) => busy.find(e => e.property_id === p.id && overlaps(e.start_date, e.end_date, d))?.kind ?? (p.known ? "available" : "unknown");
            const status = statusFor(day);
            const occupied = status === "reservation" || status === "block";
            const previous = i > 0 && !monthBoundary(day) && ["reservation", "block"].includes(statusFor(days[i-1]));
            const next = i < days.length-1 && !monthBoundary(days[i+1]) && ["reservation", "block"].includes(statusFor(days[i+1]));
            const rate = rates.find(r => r.property_id === p.id && overlaps(r.start_date, r.end_date, day));
            const label = `${p.name} · ${day}: ${t(status)}${rate ? ` · ${money(Number(rate.amount),rate.currency)}` : ""}`;
            return <td key={day} aria-label={label} title={label} className={`h-20 border-b py-3 text-center ${monthBoundary(day) ? "border-l-4 border-l-background" : ""} ${arrival && day >= arrival && day < departure ? "bg-accent/40" : ""}`}><div className={`flex h-10 items-center justify-center px-0.5 ${occupied ? `bg-foreground text-background ${!previous ? "ml-0.5 rounded-l-md border-l" : ""} ${!next ? "mr-0.5 rounded-r-md border-r" : ""}` : status === "available" ? "mx-0.5 rounded-md bg-status-ok/15 text-foreground" : "mx-0.5 rounded-md border border-dashed border-status-warning/50 text-status-warning"}`}><span aria-hidden="true">{occupied ? (!previous ? "—" : "") : status === "unknown" ? "?" : rate ? <span>${Number(rate.amount).toLocaleString(locale)}{multipleCurrencies && <span className="block text-[9px]">{rate.currency}</span>}</span> : "·"}</span></div></td>;
          })}
        </tr>)}</tbody>
      </table>
    </div>}
    <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-xs text-muted-foreground">
      <div className="flex flex-wrap gap-x-4 gap-y-2">{(["available", "reservation", "unknown"] as const).map(status => <span key={status} className="flex items-center gap-1.5"><span className={`size-3 rounded-sm ${status === "available" ? "bg-status-ok/30" : status === "reservation" ? "bg-foreground" : "border border-dashed border-status-warning"}`} />{status === "reservation" ? `${t("reservation")} / ${t("block")}` : t(status)}</span>)}</div>
      <p>{t("gridRates", {currencies: [...new Set(rates.map(r => r.currency))].join(" / ") || "—"})} {t("petPolicy")}</p>
    </div>
    {arrival && departure && <div className="space-y-3 pt-3"><h2 className="text-xl">{t("stayResults")}</h2><p className="text-sm text-muted-foreground">{arrival} → {departure} · {t("nights", {count: Math.round((Date.parse(departure)-Date.parse(arrival))/86400000)})}</p>
      {!summaries.some(s => s.summary?.status === "available") && <p className="text-sm">{t("noStay")}</p>}
      {availableSummaries.map(({p,summary}) => <div key={p.id} className="flex flex-wrap justify-between gap-2 rounded-lg border p-3 text-sm"><span className="font-medium">{p.name}</span><span>{t(summary!.status)}{summary!.status === "available" && <> · {summary!.total !== null ? `${money(summary!.total, summary!.currency!)} ${t("stayTotal")}` : t("incompleteRates")}</>}</span></div>)}
      <p className="text-xs text-muted-foreground">{t("totalNote")}</p>
    </div>}
  </section>;
}
