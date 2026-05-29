"use client";

import { Fragment, useState } from "react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoney } from "@/lib/format";
import type { Property, UtilityType } from "@/lib/types";
import type { BillRowDerived } from "@/lib/bills/enrich-period";
import { BillRowActions } from "./bill-row-actions";

/**
 * Bills table inside each property card. Renders the bills of the first
 * VISIBLE_MONTHS months (mes en curso + mes anterior) by default and a
 * "Mostrar X más" button to expand the rest. The card itself stays a
 * server component — only this inner table needs state to toggle expand.
 *
 * (WIK-75) Antes mostrábamos una columna "Consumo" con el delta Tuya
 * en cada fila. Pero como solo aplicaba a facturas de luz con período,
 * la mayoría de las filas la dejaba vacía. La movimos a /energy, donde
 * cae naturalmente junto al device Tuya que mide el consumo.
 *
 * (WIK-230) Antes paginábamos por cantidad de filas (PAGE_SIZE = 5).
 * Ahora paginamos por mes: mostramos las facturas de los primeros dos
 * meses presentes (las facturas vienen ordenadas de más nueva a más
 * vieja, así que son el mes en curso y el anterior) y escondemos el
 * resto detrás del botón.
 */
const VISIBLE_MONTHS = 2;

const UTILITY_LABEL: Record<UtilityType, string> = {
  luz: "Luz",
  agua: "Agua",
  internet: "Internet",
  alarma: "Alarma",
  otro: "Otro",
};

function formatPeriod(from: string | null, to: string | null): string {
  if (!from && !to) return "—";
  if (from && to) {
    const f = format(parseISO(from), "d MMM", { locale: es });
    const t = format(parseISO(to), "d MMM yy", { locale: es });
    return `${f} → ${t}`;
  }
  const single = (from ?? to) as string;
  return format(parseISO(single), "MMM yyyy", { locale: es });
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return format(parseISO(iso), "d MMM yyyy", { locale: es });
}

// Fecha más representativa de cada factura, igual que el orden de page.tsx
// (WIK-227): fin de período efectivo → vencimiento → created_at. La usamos
// para agrupar por mes y dibujar un separador sutil entre meses.
function billMonthDate(b: BillRowDerived): string {
  return b.effective_period_to ?? b.due_date ?? b.created_at.slice(0, 10);
}

function monthKey(iso: string): string {
  return iso.slice(0, 7); // YYYY-MM
}

function monthLabel(iso: string): string {
  return format(parseISO(iso), "MMMM yyyy", { locale: es });
}

// Cantidad de facturas que caen en los primeros `n` meses distintos. Las
// facturas vienen ordenadas de más nueva a más vieja, así que recorremos
// hasta que aparece el (n+1)-ésimo mes y devolvemos ese índice de corte.
function firstMonthsCount(bills: BillRowDerived[], n: number): number {
  const months = new Set<string>();
  for (let i = 0; i < bills.length; i++) {
    const m = monthKey(billMonthDate(bills[i]));
    if (!months.has(m)) {
      if (months.size === n) return i;
      months.add(m);
    }
  }
  return bills.length;
}

export function PropertyBillsTable({
  bills,
  allProperties,
}: {
  bills: BillRowDerived[];
  allProperties: Pick<Property, "id" | "name" | "currency">[];
}) {
  const [expanded, setExpanded] = useState(false);
  // Índice donde arranca el (VISIBLE_MONTHS + 1)-ésimo mes distinto: todo lo
  // anterior pertenece a los primeros dos meses y se muestra por defecto.
  const defaultCount = firstMonthsCount(bills, VISIBLE_MONTHS);
  const visible = expanded ? bills : bills.slice(0, defaultCount);
  const hidden = bills.length - defaultCount;

  return (
    <>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tipo</TableHead>
              <TableHead>Proveedor</TableHead>
              <TableHead>Período</TableHead>
              <TableHead className="text-right">Importe</TableHead>
              <TableHead>Vencimiento</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((b, i) => {
              const periodFrom = b.effective_period_from;
              const periodTo = b.effective_period_to;
              const periodLabel = formatPeriod(periodFrom, periodTo);
              // Separador de mes sutil: lo insertamos cuando el mes de esta
              // factura difiere del de la anterior visible (la primera fila
              // nunca lleva separador, ya que el header de la card ya marca
              // el inicio del bloque).
              const thisMonth = monthKey(billMonthDate(b));
              const prevMonth =
                i > 0 ? monthKey(billMonthDate(visible[i - 1])) : thisMonth;
              const showSeparator = i > 0 && thisMonth !== prevMonth;
              return (
                <Fragment key={b.id}>
                  {showSeparator && (
                    <tr
                      data-slot="month-separator"
                      className="border-t border-border/60"
                    >
                      <td
                        colSpan={6}
                        className="px-3 pt-4 pb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70"
                      >
                        {monthLabel(billMonthDate(b))}
                      </td>
                    </tr>
                  )}
                  <TableRow>
                    <TableCell>{UTILITY_LABEL[b.utility_type]}</TableCell>
                    <TableCell>{b.provider}</TableCell>
                    <TableCell
                      className={`whitespace-nowrap ${
                        b.period_inferred
                          ? "italic text-muted-foreground"
                          : ""
                      }`}
                      title={
                        b.period_inferred
                          ? "Período inferido a partir del vencimiento de la factura anterior."
                          : undefined
                      }
                    >
                      {b.period_inferred ? `≈ ${periodLabel}` : periodLabel}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {b.amount != null
                        ? formatMoney(b.amount, b.currency ?? "UYU", {
                            alwaysDecimals: true,
                          })
                        : "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDate(b.due_date)}
                    </TableCell>
                    <TableCell>
                      <BillRowActions bill={b} properties={allProperties} />
                    </TableCell>
                  </TableRow>
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {hidden > 0 && (
        <div className="flex justify-center pt-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded((s) => !s)}
          >
            {expanded
              ? "Mostrar menos"
              : `Mostrar ${hidden} más`}
          </Button>
        </div>
      )}
    </>
  );
}
