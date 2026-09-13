import type { DeltaLevel } from "@/lib/bills/tuya-comparison";

/**
 * Badge que muestra el delta entre el consumo facturado (UTE/UTE residencial)
 * y el consumo medido por Tuya en el mismo período.
 *
 * - Si el snapshot de Tuya cubre <70% del período (FULL_COVERAGE_THRESHOLD),
 *   mostramos un badge gris "Tuya parcial XX%" — el delta absoluto sería
 *   misleading porque nos faltan muestras.
 * - Si la cobertura es ≥70%, mostramos `Tuya ±X.X%` con verde / amber / rojo
 *   según el threshold de `deltaLevel()`.
 *
 * (WIK-75) Movido desde /bills/property-bills-table.tsx para poder
 * reusarlo desde /energy en la sección de comparativa por device.
 */
export type DeltaBadgeData = {
  tuyaKwh: number;
  deltaPct: number;
  level: DeltaLevel;
  coverageFraction: number;
};

const FULL_COVERAGE_THRESHOLD = 0.7;

export function DeltaBadge({
  tuyaKwh,
  deltaPct,
  level,
  coverageFraction,
}: DeltaBadgeData) {
  const tuyaLabel = `${tuyaKwh.toLocaleString("es-UY", {
    maximumFractionDigits: 1,
  })} kWh`;
  if (coverageFraction < FULL_COVERAGE_THRESHOLD) {
    const coveragePct = Math.round(coverageFraction * 100);
    return (
      <span
        className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-muted-foreground/40 bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
        title={`Tuya midió ${tuyaLabel} (cobertura ${coveragePct}% del período facturado). Δ% se mostrará cuando haya cobertura completa.`}
      >
        Tuya parcial {coveragePct}%
      </span>
    );
  }
  const sign = deltaPct > 0 ? "+" : "";
  const className =
    level === "ok"
      ? "border-status-ok/40 bg-status-ok/10 text-status-ok"
      : level === "warn"
        ? "border-status-warning/40 bg-status-warning/10 text-status-warning"
        : "border-status-critical/40 bg-status-critical/10 text-status-critical";
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}
      title={`Tuya midió ${tuyaLabel} en el período`}
    >
      Tuya {sign}
      {deltaPct.toLocaleString("es-UY", { maximumFractionDigits: 1 })}%
    </span>
  );
}
