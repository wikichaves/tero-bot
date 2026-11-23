"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { monthDays } from "@/lib/availability/core";
import { shiftMonth } from "./period";
import { validStay } from "./stay";

export function StayPicker({month, count, selected, arrival, departure}: {month: string; count: number; selected: string; arrival: string; departure: string}) {
  const t = useTranslations("availability");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(month);
  const [start, setStart] = useState(arrival);
  const [end, setEnd] = useState(departure);
  const days = monthDays(visibleMonth);
  const padding = (new Date(`${days[0]}T00:00:00Z`).getUTCDay() + 6) % 7;
  const format = (day: string) => new Intl.DateTimeFormat(locale, {day:"numeric",month:"short",year:"numeric",timeZone:"UTC"}).format(new Date(`${day}T00:00:00Z`));
  function navigate(clear = false) {
    const query = new URLSearchParams({month, months:String(count), view:"compare"});
    if (selected) query.set("property",selected);
    if (!clear) { query.set("arrival",start); query.set("departure",end); }
    router.push(`/availability?${query}`,{scroll:false});
    setOpen(false);
  }
  function choose(day: string) {
    if (!start || end || day <= start) {setStart(day); setEnd("");}
    else setEnd(day);
  }
  return <div className="flex min-w-0 flex-wrap items-center gap-2">
    <Dialog open={open} onOpenChange={value => {setOpen(value); if(value) {setStart(arrival);setEnd(departure);setVisibleMonth(arrival.slice(0,7) || month);} }}>
      <DialogTrigger render={<Button variant="outline" size="lg" className="font-sans text-sm font-medium" />}>{arrival && departure ? `${format(arrival)} → ${format(departure)}` : t("searchStay")}</DialogTrigger>
      <DialogContent className="gap-3 p-4 sm:p-6">
        <DialogTitle>{t("searchStay")}</DialogTitle>
        <DialogDescription>{t("choosePeriod")}</DialogDescription>
        <p className="text-sm" aria-live="polite">{start ? `${t("checkIn")}: ${format(start)}` : t("chooseArrival")}{end ? ` · ${t("checkOut")}: ${format(end)}` : start ? ` · ${t("chooseDeparture")}` : ""}</p>
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="icon" aria-label={t("previousMonth")} disabled={visibleMonth <= "2000-01"} onClick={() => setVisibleMonth(shiftMonth(visibleMonth,-1))}><ChevronLeft /></Button>
          <span className="text-sm font-medium capitalize" aria-live="polite">{new Intl.DateTimeFormat(locale,{month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(`${visibleMonth}-01T00:00:00Z`))}</span>
          <Button variant="ghost" size="icon" aria-label={t("nextMonth")} disabled={visibleMonth >= "2200-12"} onClick={() => setVisibleMonth(shiftMonth(visibleMonth,1))}><ChevronRight /></Button>
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {Array.from({length:7},(_,i) => <span key={`weekday-${i}`} className="py-1 text-center text-xs text-muted-foreground">{new Intl.DateTimeFormat(locale,{weekday:"short",timeZone:"UTC"}).format(new Date(Date.UTC(2026,10,16+i)))}</span>)}
          {Array.from({length:padding},(_,i)=><span key={`blank-${i}`} />)}
          {days.map(day => <button key={day} type="button" aria-label={format(day)} aria-pressed={day===start || day===end} onClick={()=>choose(day)} className={`min-h-10 min-w-0 rounded-md text-sm tabular-nums focus-visible:outline-2 focus-visible:outline-ring ${day===start || day===end ? "bg-primary text-primary-foreground" : start && end && day>start && day<end ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}>{Number(day.slice(-2))}</button>)}
        </div>
        {start && end && !validStay(start,end) && <p role="alert" className="text-sm text-status-warning">{t("invalidStay")}</p>}
        <div className="flex justify-between gap-2">
          <Button variant="ghost" onClick={()=>{setStart("");setEnd("");navigate(true);}}>{t("clearStay")}</Button>
          <Button disabled={!validStay(start,end)} onClick={()=>navigate()}>{t("searchStay")}</Button>
        </div>
      </DialogContent>
    </Dialog>
    {(arrival || departure) && <Button variant="ghost" onClick={()=>navigate(true)}>{t("clearStay")}</Button>}
  </div>;
}
