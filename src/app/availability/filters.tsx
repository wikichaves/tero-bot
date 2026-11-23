"use client";

import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useTransition, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";

function destination(month: string, property: string, count: number, view: string) {
  const query = new URLSearchParams({ month, months: String(count), view });
  if (property) query.set("property", property);
  return `/availability?${query}`;
}

export function MonthNavigation({ month, selected, count, view }: { month: string; selected: string; count: number; view: string }) {
  const t = useTranslations("availability");
  function adjacent(delta: number) {
    const date = new Date(`${month}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + delta);
    return date.toISOString().slice(0, 7);
  }
  return <nav className="flex justify-between gap-3" aria-label={t("month")}>
    {adjacent(-count) >= "2000-01" ? <Link className="rounded-md border px-3 py-2 text-sm" href={destination(adjacent(-count), selected, count, view)} scroll={false}>← {t("previousPeriod")}</Link> : <span />}
    {adjacent(count) <= "2200-12" && <Link className="rounded-md border px-3 py-2 text-sm" href={destination(adjacent(count), selected, count, view)} scroll={false}>{t("nextPeriod")} →</Link>}
  </nav>;
}

export function AvailabilityFilters({ month, selected, properties, count, view, children }: {
  children?: ReactNode; month: string; selected: string; count: number; view: string; properties: { id: string; name: string; country: string }[];
}) {
  const t = useTranslations("availability");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const monthFormat = new Intl.DateTimeFormat(locale, {month: "long", year: "numeric", timeZone: "UTC"});
  const change = (nextMonth: string, property = selected, nextCount = count) => startTransition(() => router.push(destination(nextMonth, property, nextCount, property !== selected ? (property ? "calendar" : "compare") : view), { scroll: false }));
  const style = "block h-10 w-full max-w-full rounded-md border border-border bg-background px-3 py-0 font-sans text-sm font-medium disabled:opacity-50";
  return <div className="grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap" aria-busy={pending}>
    <label className="min-w-0 text-sm"><span className="sr-only">{t("monthYear")}</span><select className={style} value={month} disabled={pending} onChange={e => change(e.target.value)}>
      {Array.from({length: 12}, (_, i) => {
        const date = new Date(Date.UTC(2026, 11 + i, 1));
        const value = date.toISOString().slice(0, 7);
        return <option key={value} value={value}>{monthFormat.format(date)}</option>;
      })}
    </select></label>
    <label className="text-sm"><span className="sr-only">{t("showMonths")}</span><select className={style} value={count} disabled={pending} onChange={e => change(month, selected, Number(e.target.value))}>
      {[1, 3, 6, 9, 12].map(n => <option key={n} value={n}>{t("monthCount", {count:n})}</option>)}
    </select></label>
    <label className="min-w-0 text-sm"><span className="sr-only">{t("property")}</span><select className={style} value={selected} disabled={pending} onChange={e => change(month, e.target.value)}><option value="">{t("all")}</option>{properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <div className="col-span-2 flex min-w-0 flex-wrap items-center gap-2">
      {pending && <span role="status" className="text-sm text-muted-foreground">{t("updating")}</span>}
      <Button type="button" variant="outline" size="icon-lg" aria-label={t("refresh")} title={t("refresh")} disabled={pending} onClick={() => startTransition(() => router.refresh())}><RefreshCw aria-hidden="true" className={pending ? "animate-spin" : ""} /></Button>
      {children}
    </div>
  </div>;
}
