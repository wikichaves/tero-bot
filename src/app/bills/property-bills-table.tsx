"use client";

import { useState } from "react";
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
 * Bills table inside each property card. Renders the first PAGE_SIZE
 * rows by default and a "Mostrar X más" button to expand. The card
 * itself stays a server component — only this inner table needs state
 * to toggle expand.
 *
 * (WIK-75) Antes mostrábamos una columna "Consumo" con el delta Tuya
 * en cada fila. Pero como solo aplicaba a facturas de luz con período,
 * la mayoría de las filas la dejaba vacía. La movimos a /energy, donde
 * cae naturalmente junto al device Tuya que mide el consumo.
 */
const PAGE_SIZE = 5;

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

export function PropertyBillsTable({
  bills,
  allProperties,
}: {
  bills: BillRowDerived[];
  allProperties: Pick<Property, "id" | "name" | "currency">[];
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? bills : bills.slice(0, PAGE_SIZE);
  const hidden = bills.length - PAGE_SIZE;

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
            {visible.map((b) => {
              const periodFrom = b.effective_period_from;
              const periodTo = b.effective_period_to;
              const periodLabel = formatPeriod(periodFrom, periodTo);
              return (
                <TableRow key={b.id}>
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
                  <TableCell className="text-right tabular-nums">
                    {b.amount != null
                      ? formatMoney(b.amount, b.currency ?? "UYU")
                      : "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDate(b.due_date)}
                  </TableCell>
                  <TableCell>
                    <BillRowActions bill={b} properties={allProperties} />
                  </TableCell>
                </TableRow>
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
