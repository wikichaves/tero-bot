"use client";

import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
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
    {month > "2000-01" ? <Link className="rounded-md border px-3 py-2 text-sm" href={destination(adjacent(-1), selected, count, view)} scroll={false}>← {t("previousMonth")}</Link> : <span />}
    {count < 12 && adjacent(count) <= "2200-12" && <Link className="rounded-md border px-3 py-2 text-sm" href={destination(month, selected, count + 1, view)} scroll={false}>{t("loadMore")}</Link>}
  </nav>;
}

export function AvailabilityFilters({ month, selected, properties, count, view }: {
  month: string; selected: string; count: number; view: string; properties: { id: string; name: string; country: string }[];
}) {
  const t = useTranslations("availability");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [year, number] = month.split("-");
  const change = (nextMonth: string, property = selected, nextCount = count) => startTransition(() => router.push(destination(nextMonth, property, nextCount, property !== selected ? (property ? "calendar" : "compare") : view), { scroll: false }));
  const style = "block min-h-10 w-full max-w-full rounded-md border bg-background p-2 disabled:opacity-50";
  return <div className="grid grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap sm:gap-3" aria-busy={pending}>
    <label className="text-sm"><span className="sr-only">{t("month")}</span><select className={style} value={number} disabled={pending} onChange={e => change(`${year}-${e.target.value}`)}>
      {Array.from({length: 12}, (_, i) => <option key={i} value={String(i + 1).padStart(2, "0")}>{new Intl.DateTimeFormat(locale, {month: "long", timeZone: "UTC"}).format(new Date(Date.UTC(2026, i, 1)))}</option>)}
    </select></label>
    <label className="text-sm"><span className="sr-only">{t("year")}</span><select className={style} value={year} disabled={pending} onChange={e => change(`${e.target.value}-${number}`)}>
      {Array.from({length: 201}, (_, i) => <option key={2000 + i}>{2000 + i}</option>)}
    </select></label>
    <label className="min-w-0 text-sm"><span className="sr-only">{t("property")}</span><select className={style} value={selected} disabled={pending} onChange={e => change(month, e.target.value)}><option value="">{t("all")}</option>{properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <label className="text-sm"><span className="sr-only">{t("showMonths")}</span><select className={style} value={count} disabled={pending} onChange={e => change(month, selected, Number(e.target.value))}>
      {Array.from({length: 12}, (_, i) => i + 1).map(n => <option key={n} value={n}>{t("monthCount", {count:n})}</option>)}
    </select></label>
    <div className="col-span-2 flex items-center justify-end gap-3 sm:ml-auto">
      {pending && <span role="status" className="text-sm text-muted-foreground">{t("updating")}</span>}
      <Button type="button" variant="outline" disabled={pending} onClick={() => startTransition(() => router.refresh())}><RefreshCw aria-hidden="true" className={pending ? "animate-spin" : ""} />{t("refresh")}</Button>
    </div>
  </div>;
}
