"use client";

import Link from "next/link";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { useLocale, useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GripVertical } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { reorderProperties } from "./actions";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PropertyThumb } from "@/components/property-thumb";
import { PropertyActions } from "./property-actions";
import type { Property } from "@/lib/types";

export function PropertiesTable({ properties }: { properties: Property[] }) {
 const t = useTranslations("adminPropertiesPage");
 const locale = useLocale();
 const router = useRouter();
 const [pending, startTransition] = useTransition();
 const [optimistic, setOptimistic] = useState<Property[] | null>(null);
 const [active, setActive] = useState<string | null>(null);
 const [over, setOver] = useState<string | null>(null);
 const drag = useRef<{ id: string; target: string; startY: number } | null>(null);
 const ordered = optimistic ?? properties;
 function move(id: string, target: string) {
   if (pending || id === target) return;
   const from = ordered.findIndex(p => p.id === id), to = ordered.findIndex(p => p.id === target);
   if (from < 0 || to < 0) return;
   const next = [...ordered]; next.splice(to, 0, next.splice(from, 1)[0]);
   setOptimistic(next);
   startTransition(async () => {
     try {
       const result = await reorderProperties(next.map(p => p.id));
       if (result.error) throw new Error(result.error);
       toast.success(t("sort.saved"));
     } catch { toast.error(t("sort.failed")); }
     finally { setOptimistic(null); router.refresh(); }
   });
 }
 function resetDrag() { drag.current = null; setActive(null); setOver(null); }
 function rowClass(id: string) { return active === id ? "opacity-50" : over === id ? "bg-accent outline outline-2 outline-primary" : undefined; }
 function handle(p: Property) {
   return <Button type="button" variant="ghost" size="icon" disabled={pending}
     className="size-10 shrink-0 touch-none cursor-grab active:cursor-grabbing"
     aria-label={t("sort.handle", { name: p.name })} aria-describedby="property-sort-help"
     onPointerDown={event => {
       if (event.button !== 0 || pending) return;
       event.currentTarget.setPointerCapture(event.pointerId);
       drag.current = { id: p.id, target: p.id, startY: event.clientY };
       setActive(p.id);
     }}
     onPointerMove={event => {
       if (!drag.current || Math.abs(event.clientY - drag.current.startY) < 5) return;
       const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-sort-id]");
       drag.current.target = row?.dataset.sortId ?? drag.current.id;
       setOver(row?.dataset.sortId ?? null);
       if (event.clientY < 80) window.scrollBy(0, -16);
       else if (event.clientY > window.innerHeight - 80) window.scrollBy(0, 16);
     }}
     onPointerUp={() => { if (drag.current) move(drag.current.id, drag.current.target); resetDrag(); }}
     onPointerCancel={resetDrag} onLostPointerCapture={resetDrag}
     onKeyDown={event => {
       if (event.key === "Escape") { resetDrag(); return; }
       if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
       event.preventDefault();
       const index = ordered.findIndex(row => row.id === p.id);
       const target = ordered[index + (event.key === "ArrowUp" ? -1 : 1)];
       if (target) move(p.id, target.id);
     }}><GripVertical aria-hidden className="size-4" /></Button>;
 }
 return <div aria-busy={pending}>
   <p id="property-sort-help" className="mb-3 text-sm text-muted-foreground">{t("sort.help")}</p>
      {/* Mobile: cards apiladas (sin scroll horizontal). Desktop: tabla. */}
      <div className="flex flex-col gap-2 md:hidden">
        {properties.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              {t.rich("emptyState", { em: (chunks) => <em>{chunks}</em> })}
            </CardContent>
          </Card>
        ) : (
          ordered.map((p) => (
            <Card key={p.id} data-sort-id={p.id} className={rowClass(p.id)}>
              <CardContent className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <PropertyThumb
                    propertyId={p.id}
                    cacheBuster={p.created_at}
                    size="sm"
                    alt={p.name}
                  />
                  <div className="flex min-w-0 flex-col gap-1">
                    <Link href={`/admin/properties/${p.id}`} className="font-medium hover:underline">{p.name}</Link>
                    <Badge variant="outline">{t(p.is_rental ? "badge.rental" : "badge.notRental")}</Badge>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {p.airbnb_ical_url ? (
                        <Badge variant="default">{t("badge.configured")}</Badge>
                      ) : (
                        <Badge variant="secondary">—</Badge>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {handle(p)}
                  <PropertyActions property={p} />
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Card className="hidden min-w-0 md:block">
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14">{t("table.order")}</TableHead>
                <TableHead>{t("table.name")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("table.airbnbIcal")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("table.created")}</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {properties.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center text-muted-foreground"
                  >
                    {t.rich("emptyState", {
                      em: (chunks) => <em>{chunks}</em>,
                    })}
                  </TableCell>
                </TableRow>
              ) : (
                ordered.map((p) => (
                  <TableRow key={p.id} data-sort-id={p.id} className={rowClass(p.id)}>
                    <TableCell>
                      {handle(p)}
                    </TableCell>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-3">
                        <PropertyThumb
                          propertyId={p.id}
                          cacheBuster={p.created_at}
                          size="sm"
                          alt={p.name}
                        />
                        <Link href={`/admin/properties/${p.id}`} className="hover:underline">{p.name}</Link>
                    <Badge variant="outline">{t(p.is_rental ? "badge.rental" : "badge.notRental")}</Badge>
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {p.airbnb_ical_url ? (
                        <Badge variant="default">{t("badge.configured")}</Badge>
                      ) : (
                        <Badge variant="secondary">—</Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {format(parseISO(p.created_at), "d MMM yyyy", {
                        locale: locale.startsWith("es") ? es : undefined,
                      })}
                    </TableCell>
                    <TableCell>
                      <PropertyActions property={p} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
 </div>;
}
