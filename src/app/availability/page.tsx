import Link from "next/link";
import { StayPicker } from "./stay-picker";

import { AvailabilityComparison } from "./comparison";
import { validStay, stayMonthCount } from "./stay";
import { PropertyThumb } from "@/components/property-thumb";
import { getActiveCountry } from "@/lib/country";
import { getLocale, getTranslations } from "next-intl/server";
import { loadAvailability } from "@/lib/availability/data";
import { monthDays, overlaps } from "@/lib/availability/core";
import { AvailabilityFilters, MonthNavigation } from "./filters";

export const dynamic = "force-dynamic";
export default async function AvailabilityPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const [params,t,locale]=await Promise.all([searchParams,getTranslations("availability"),getLocale()]);
  const defaultMonth = "2026-12";
  let month=typeof params.month==="string"?params.month:defaultMonth;
  try { monthDays(month); } catch { month=defaultMonth; }
  let count = typeof params.months === "string" && /^(?:1|3|6|9|12)$/.test(params.months) ? Number(params.months) : 3;
  const arrival = typeof params.arrival === "string" ? params.arrival : "";
  const departure = typeof params.departure === "string" ? params.departure : "";
  const hasStay = validStay(arrival, departure);
  const invalidStay = !!(arrival || departure) && !hasStay;
  if (hasStay) {
    month = arrival.slice(0,7);
    count = [1, 3, 6, 9, 12].find(n => n >= Math.max(count, stayMonthCount(arrival, departure))) ?? 12;
  }
  const months = Array.from({length:count},(_,i)=>{const d=new Date(`${month}-01T00:00:00Z`);d.setUTCMonth(d.getUTCMonth()+i);return d.toISOString().slice(0,7);}).filter(m=>m<="2200-12");
  const calendars = await Promise.all(months.map(loadAvailability));
  const {viewer}=calendars[0];
  const country = await getActiveCountry(viewer.ids);
  const properties = calendars[0].properties.filter(p => country === "ALL" || p.country === country);
  const selected=properties.some(p=>p.id===params.property)?String(params.property):"";
  const compare = params.view === "compare" || (!selected && params.view !== "calendar");
  const date=(value:string)=>new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeZone:"UTC"}).format(new Date(`${value}T00:00:00Z`));
  const money=(amount:number|string,currency:string)=>new Intl.NumberFormat(locale,{style:"currency",currency,maximumFractionDigits:2}).format(Number(amount));
  return <main className="mx-auto w-full max-w-6xl flex-1 min-w-0 space-y-3 p-4 sm:p-6">
    <header><h1 className="text-3xl">{t("title")}</h1><p className="mt-1 text-sm text-muted-foreground">{t("description")}</p></header>
    <div className="flex flex-wrap items-center gap-2">
    <AvailabilityFilters month={month} selected={selected} properties={properties} count={count} view={compare ? "compare" : "calendar"}>
      {compare && <StayPicker month={month} count={count} selected={selected} arrival={hasStay ? arrival : ""} departure={hasStay ? departure : ""} />}
    </AvailabilityFilters>
    <nav className="ml-auto grid w-fit grid-cols-2 gap-1 rounded-lg border border-border bg-muted p-1" aria-label={t("view")}>
      {(["compare", "calendar"] as const).map(view => <Link key={view} scroll={false} aria-current={(compare ? "compare" : "calendar") === view ? "page" : undefined} className={`rounded-md border px-4 py-2 text-center text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${(compare ? "compare" : "calendar") === view ? "border-border bg-background text-foreground shadow-sm" : "border-transparent text-muted-foreground hover:bg-background/60 hover:text-foreground"}`} href={`/availability?${new URLSearchParams({month, months:String(count), view, ...(selected ? {property:selected} : {}), ...(hasStay ? {arrival,departure} : {})})}`}>{t(view)}</Link>)}
    </nav>
    </div>
    {invalidStay && <p role="alert" className="text-sm text-status-warning">{t("invalidStay")}</p>}
    {!properties.length && <p className="rounded-xl border p-6">{t("noAccess")}</p>}
    {compare && properties.length > 0 && <AvailabilityComparison calendars={calendars} properties={selected ? properties.filter(p => p.id === selected) : properties} month={month} arrival={hasStay ? arrival : ""} departure={hasStay ? departure : ""} />}
    {!compare && calendars.map(({days,busy,rates},index)=><div key={months[index]} className="space-y-4">
    <h2 className="text-2xl capitalize">{new Intl.DateTimeFormat(locale,{month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(`${months[index]}-01T00:00:00Z`))}</h2>
    {(selected?properties.filter(p=>p.id===selected):properties).map(p=><section key={p.id} className="space-y-4 rounded-xl border bg-card p-4">
      <div className="flex items-center gap-3"><PropertyThumb propertyId={p.id} size="md" /><div className="min-w-0"><h2 className="text-2xl break-words">{p.name}</h2><p className={`text-xs ${p.known?"text-muted-foreground":"text-status-warning"}`}>{!p.known && t("uncertain")}{p.lastSync && <>{!p.known && " · "}{t("lastSync")}: {new Intl.DateTimeFormat(locale,{dateStyle:"short",timeStyle:"short",timeZone:p.country==="AR"?"America/Argentina/Buenos_Aires":"America/Montevideo"}).format(new Date(p.lastSync))}</>}</p></div></div>
      <div className="grid grid-cols-7 gap-1" aria-label={`${p.name} ${months[index]}`}>
        {Array.from({length:7},(_,i)=><span key={`weekday-${i}`} className="text-center text-xs text-muted-foreground">{new Intl.DateTimeFormat(locale,{weekday:"short",timeZone:"UTC"}).format(new Date(Date.UTC(2026,10,16+i)))}</span>)}
        {Array.from({length:(new Date(`${days[0]}T00:00:00Z`).getUTCDay()+6)%7},(_,i)=><div key={`spacer-${i}`}/>)}
        {days.map(day=>{ const event=busy.find(e=>e.property_id===p.id&&overlaps(e.start_date,e.end_date,day)); const status=event?.kind ?? (p.known?"available":"unknown"); const rate=rates.find(r=>r.property_id===p.id&&overlaps(r.start_date,r.end_date,day)); return <div key={day} aria-label={`${date(day)}: ${t(status)}`} className={`min-w-0 rounded-md border p-1.5 text-center sm:p-2 ${status==="available"?"border-status-ok/50 bg-status-ok/20":status==="unknown"?"border-dashed border-status-warning/60 bg-status-warning/10":"border-foreground/60 bg-foreground text-background"}`}><span className={`block text-sm font-medium ${status === "reservation" || status === "block" ? "line-through decoration-2" : ""}`}>{Number(day.slice(-2))}</span><span className="block truncate text-[10px] font-semibold sm:text-xs" title={t(status)}>{t(status)}</span>{rate ? <span className="mt-1 block truncate text-[10px] font-semibold leading-tight sm:text-xs" title={money(rate.amount,rate.currency)}>{money(rate.amount,rate.currency)}</span> : <span className="mt-1 block truncate text-[10px] font-medium leading-tight sm:text-xs" title={t("noRate")}>{t("noRate")}</span>}</div>;})}
      </div>
      <div className="space-y-2"><h3 className="font-medium">{t("rates")}</h3>{rates.filter(r=>r.property_id===p.id).map(r=><p key={r.id} className="text-sm">{date(r.start_date)} → {date(r.end_date)} · {money(r.amount,r.currency)} {t("perNight")}</p>)}{!rates.some(r=>r.property_id===p.id)&&<p className="text-sm text-muted-foreground">{t("noRates")}</p>}</div>
    </section>)}
    </div>)}
    <MonthNavigation month={month} selected={selected} count={count} view={compare ? "compare" : "calendar"} />
  </main>;
}
