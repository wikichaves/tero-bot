"use client";

import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { useTranslations } from "next-intl";
import { DeltaBadge } from "@/components/bills/delta-badge";
import type { BillRowDerived } from "@/lib/bills/enrich-period";
import type { DeltaLevel } from "@/lib/bills/tuya-comparison";

/**
 * Comparativa por device: facturas de luz vs consumo Tuya en el mismo
 * período. (WIK-75 — antes era una columna en /bills.)
 *
 * Movido a client component (separado de page.tsx) porque ahora vive
 * dentro de `DeviceEnergyCard` que es client (WIK-99 v6 — toggles
 * per-card).
 *
 * Si el snapshot Tuya cubre <70% del período facturado, mostramos un
 * pill gris "parcial XX%" en vez del Δ% para no transmitir un error
 * cuantitativo donde sólo tenemos una muestra parcial.
 *
 * (WIK-80) En mobile renderiza como card-list (cada factura una mini-card
 * con label/value pairs), porque la tabla de 4 columnas hacía scroll
 * horizontal y la columna "Δ" (donde está el badge importante) quedaba
 * oculta sin que se note. En sm+ vuelve a tabla normal.
 */

export type BillComparison = {
  bill: BillRowDerived;
  tuyaKwh: number;
  deltaPct: number;
  level: DeltaLevel;
  coverageFraction: number;
};

export function BillComparisonsTable({
  comparisons,
}: {
  comparisons: BillComparison[];
}) {
  const t = useTranslations("energyBillComparisons");
  return (
    <div className="mt-6 border-t pt-4">
      <p className="label-mono mb-2">
        {t("title")}
      </p>

      <ul className="flex flex-col gap-3 sm:hidden">
        {comparisons.map((c) => (
          <li
            key={c.bill.id}
            className="rounded-md border bg-muted/30 px-3 py-2 text-sm"
          >
            <div className="flex items-center justify-between gap-2">
              <span
                className={`whitespace-nowrap text-xs ${
                  c.bill.period_inferred
                    ? "italic text-muted-foreground"
                    : "text-muted-foreground"
                }`}
                title={
                  c.bill.period_inferred
                    ? t("inferredPeriodTooltip")
                    : undefined
                }
              >
                {c.bill.period_inferred ? "≈ " : ""}
                {formatBillPeriod(
                  c.bill.effective_period_from,
                  c.bill.effective_period_to,
                )}
              </span>
              <DeltaBadge
                tuyaKwh={c.tuyaKwh}
                deltaPct={c.deltaPct}
                level={c.level}
                coverageFraction={c.coverageFraction}
              />
            </div>
            <div className="mt-1 flex justify-between gap-4 text-xs">
              <span>
                <span className="text-muted-foreground">{t("billedLabel")} </span>
                <span className="tabular-nums">
                  {c.bill.kwh_billed!.toLocaleString("es-UY")} kWh
                </span>
              </span>
              <span>
                <span className="text-muted-foreground">{t("tuyaLabel")} </span>
                <span className="tabular-nums">
                  {c.tuyaKwh.toLocaleString("es-UY", {
                    maximumFractionDigits: 1,
                  })}{" "}
                  kWh
                </span>
              </span>
            </div>
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="pb-1 font-medium">{t("columnPeriod")}</th>
              <th className="pb-1 text-right font-medium">{t("columnBilled")}</th>
              <th className="pb-1 text-right font-medium">{t("columnTuya")}</th>
              <th className="pb-1 text-right font-medium">Δ</th>
            </tr>
          </thead>
          <tbody>
            {comparisons.map((c) => (
              <tr key={c.bill.id} className="border-t">
                <td
                  className={`py-1.5 pr-2 whitespace-nowrap ${
                    c.bill.period_inferred
                      ? "italic text-muted-foreground"
                      : ""
                  }`}
                  title={
                    c.bill.period_inferred
                      ? t("inferredPeriodTooltip")
                      : undefined
                  }
                >
                  {c.bill.period_inferred ? "≈ " : ""}
                  {formatBillPeriod(
                    c.bill.effective_period_from,
                    c.bill.effective_period_to,
                  )}
                </td>
                <td className="whitespace-nowrap py-1.5 pr-2 text-right tabular-nums">
                  {c.bill.kwh_billed!.toLocaleString("es-UY")} kWh
                </td>
                <td className="whitespace-nowrap py-1.5 pr-2 text-right tabular-nums text-muted-foreground">
                  {c.tuyaKwh.toLocaleString("es-UY", {
                    maximumFractionDigits: 1,
                  })}{" "}
                  kWh
                </td>
                <td className="whitespace-nowrap py-1.5 text-right">
                  <DeltaBadge
                    tuyaKwh={c.tuyaKwh}
                    deltaPct={c.deltaPct}
                    level={c.level}
                    coverageFraction={c.coverageFraction}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatBillPeriod(from: string | null, to: string | null): string {
  if (!from && !to) return "—";
  if (from && to) {
    const f = format(parseISO(from), "d MMM", { locale: es });
    const t = format(parseISO(to), "d MMM yy", { locale: es });
    return `${f} → ${t}`;
  }
  const single = (from ?? to) as string;
  return format(parseISO(single), "MMM yyyy", { locale: es });
}
