import Link from "next/link";
import { signOut } from "@/app/login/actions";
import { getLocale, getTranslations } from "next-intl/server";
import { loadAvailability } from "@/lib/availability/data";
import { monthDays, overlaps } from "@/lib/availability/core";
import { AvailabilityFilters, MonthNavigation } from "./filters";

export const dynamic = "force-dynamic";
export default async function AvailabilityPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const [params,t,locale]=await Promise.all([searchParams,getTranslations("availability"),getLocale()]);
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Montevideo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  let month=typeof params.month==="string"?params.month:today.slice(0,7);
  try { monthDays(month); } catch { month=today.slice(0,7); }
  const count = typeof params.months === "string" && /^[1-5]$/.test(params.months) ? Number(params.months) : 1;
  const months = Array.from({length:count},(_,i)=>{const d=new Date(`${month}-01T00:00:00Z`);d.setUTCMonth(d.getUTCMonth()+i);return d.toISOString().slice(0,7);}).filter(m=>m<="2200-12");
  const calendars = await Promise.all(months.map(loadAvailability));
  const {viewer,properties}=calendars[0];
  const selected=properties.some(p=>p.id===params.property)?String(params.property):"";
  const mobileProperty=selected || properties[0]?.id;
  const date=(value:string)=>new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeZone:"UTC"}).format(new Date(`${value}T00:00:00Z`));
  return <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 p-4 sm:p-6">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-4xl">{t("title")}</h1><p className="mt-2 text-sm text-muted-foreground">{t("description")}</p></div>{viewer.admin && <Link className="underline" href="/admin/agencies">{t("manage")}</Link>}<form action={signOut}><button className="text-sm underline" type="submit">{t("signOut")}</button></form></header>
    <AvailabilityFilters month={month} selected={selected} properties={properties} count={count} />
    {!properties.length && <p className="rounded-xl border p-6">{t("noAccess")}</p>}
    {properties.length>1 && !selected && <p className="text-sm text-muted-foreground md:hidden">{t("mobileHint")}</p>}
    <div className="flex flex-wrap gap-4 text-xs">{(["available","reservation","block","unknown"] as const).map(k=><span key={k}>{t(k)}</span>)}</div>
    {calendars.map(({properties,days,busy,rates},index)=><div key={months[index]} className="space-y-4">
    <h2 className="text-2xl capitalize">{new Intl.DateTimeFormat(locale,{month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(`${months[index]}-01T00:00:00Z`))}</h2>
    {(selected?properties.filter(p=>p.id===selected):properties).map(p=><section key={p.id} className={`space-y-4 rounded-xl border bg-card p-4 ${p.id!==mobileProperty?"hidden md:block":""}`}>
      <div><h2 className="text-2xl">{p.name}</h2><p className={`text-xs ${p.known?"text-muted-foreground":"text-status-warning"}`}>{p.known?t("current"):t("uncertain")}{p.lastSync && <> · {t("lastSync")}: {new Intl.DateTimeFormat(locale,{dateStyle:"short",timeStyle:"short",timeZone:p.country==="AR"?"America/Argentina/Buenos_Aires":"America/Montevideo"}).format(new Date(p.lastSync))}</>}</p></div>
      <div className="grid grid-cols-7 gap-1" aria-label={`${p.name} ${months[index]}`}>
        {Array.from({length:7},(_,i)=><span key={`weekday-${i}`} className="text-center text-xs text-muted-foreground">{new Intl.DateTimeFormat(locale,{weekday:"short",timeZone:"UTC"}).format(new Date(Date.UTC(2026,10,16+i)))}</span>)}
        {Array.from({length:(new Date(`${days[0]}T00:00:00Z`).getUTCDay()+6)%7},(_,i)=><div key={`spacer-${i}`}/>)}
        {days.map(day=>{ const event=busy.find(e=>e.property_id===p.id&&overlaps(e.start_date,e.end_date,day)); const status=event?.kind ?? (p.known?"available":"unknown"); const rate=rates.find(r=>r.property_id===p.id&&overlaps(r.start_date,r.end_date,day)); return <div key={day} aria-label={`${date(day)}: ${t(status)}`} className={`min-w-0 rounded-md border p-1.5 text-center sm:p-2 ${status==="available"?"bg-status-ok/10":status==="unknown"?"bg-status-warning/10":status==="block"?"bg-muted":"bg-status-info/10"}`}><span className="block text-sm font-medium">{Number(day.slice(-2))}</span><span className="block truncate text-[10px] sm:text-xs" title={t(status)}>{t(status)}</span>{rate && <span className="mt-1 hidden text-[10px] sm:block">{rate.currency} {Number(rate.amount)}</span>}</div>;})}
      </div>
      <div className="space-y-2"><h3 className="font-medium">{t("rates")}</h3>{rates.filter(r=>r.property_id===p.id).map(r=><p key={r.id} className="text-sm">{date(r.start_date)} → {date(r.end_date)} · {new Intl.NumberFormat(locale,{style:"currency",currency:r.currency}).format(Number(r.amount))} {t("perNight")}</p>)}{!rates.some(r=>r.property_id===p.id)&&<p className="text-sm text-muted-foreground">{t("noRates")}</p>}</div>
    </section>)}
    </div>)}
    <MonthNavigation month={month} selected={selected} count={count} />
    <p className="text-xs text-muted-foreground">{t("icalHelp")}</p>
  </main>;
}
