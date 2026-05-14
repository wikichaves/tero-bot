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
import type { DeltaLevel } from "@/lib/bills/tuya-comparison";
import type { Property, UtilityBill, UtilityType } from "@/lib/types";
import { BillRowActions } from "./bill-row-actions";

/**
 * Bills table inside each property card. Renders the first PAGE_SIZE
 * rows by default and a "Mostrar X más" button to expand. The card
 * itself stays a server component — only this inner table needs state
 * to toggle expand.
 */
const PAGE_SIZE = 5;

const UTILITY_LABEL: Record<UtilityType, string> = {
  luz: "Luz",
  agua: "Agua",
  internet: "Internet",
  alarma: "Alarma",
  otro: "Otro",
};

/** When the Tuya snapshot range covers less than this fraction of the
 *  bill's period, we hide the colored ±% delta (it would be misleading)
 *  and show a gray "parcial XX%" pill instead. */
const FULL_COVERAGE_THRESHOLD = 0.7;

type BillRowDerived = UtilityBill & {
  property: Pick<Property, "id" | "name" | "currency"> | null;
  effective_period_from: string | null;
  effective_period_to: string | null;
  period_inferred: boolean;
};

type Comparison = {
  tuyaKwh: number;
  deltaPct: number;
  level: DeltaLevel;
  coverageFraction: number;
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
  comparisons,
  allProperties,
}: {
  bills: BillRowDerived[];
  comparisons: Record<string, Comparison>;
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
              <TableHead className="text-right">Consumo</TableHead>
              <TableHead>Vencimiento</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((b) => {
              const cmp = comparisons[b.id];
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
                  <TableCell className="text-right tabular-nums whitespace-nowrap">
                    <ConsumoCell bill={b} comparison={cmp} />
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

function ConsumoCell({
  bill,
  comparison,
}: {
  bill: {
    utility_type: UtilityType;
    kwh_billed: number | null;
    m3_billed: number | null;
  };
  comparison: Comparison | undefined;
}) {
  if (bill.utility_type === "luz" && bill.kwh_billed != null) {
    return (
      <div className="flex flex-col items-end gap-0.5">
        <span>{bill.kwh_billed.toLocaleString("es-UY")} kWh</span>
        {comparison && <DeltaBadge {...comparison} />}
      </div>
    );
  }
  if (bill.utility_type === "agua" && bill.m3_billed != null) {
    return <span>{bill.m3_billed.toLocaleString("es-UY")} m³</span>;
  }
  return <span className="text-muted-foreground">—</span>;
}

function DeltaBadge({
  tuyaKwh,
  deltaPct,
  level,
  coverageFraction,
}: Comparison) {
  const tuyaLabel = `${tuyaKwh.toLocaleString("es-UY", {
    maximumFractionDigits: 1,
  })} kWh`;
  if (coverageFraction < FULL_COVERAGE_THRESHOLD) {
    const coveragePct = Math.round(coverageFraction * 100);
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-muted-foreground/40 bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
        title={`Tuya midió ${tuyaLabel} (cobertura ${coveragePct}% del período facturado). Δ% se mostrará cuando haya cobertura completa.`}
      >
        Tuya parcial {coveragePct}%
      </span>
    );
  }
  const sign = deltaPct > 0 ? "+" : "";
  const className =
    level === "ok"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
      : level === "warn"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
        : "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${className}`}
      title={`Tuya midió ${tuyaLabel} en el período`}
    >
      Tuya {sign}
      {deltaPct.toLocaleString("es-UY", { maximumFractionDigits: 1 })}%
    </span>
  );
}
