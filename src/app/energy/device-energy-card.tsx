"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  formatKwh,
  formatMoney,
  formatNumeric,
  formatPower,
} from "@/lib/format";
// `estimateCost` se inlinea acá abajo: era una function pura en
// lib/tuya/energy.ts pero ese archivo es `server-only` y no se puede
// importar desde un client component.
import type { EnergyReading } from "./types";
import type { FxRate } from "@/lib/fx";

/**
 * Inlined formatRate desde lib/fx.ts (que es server-only). Format
 * con locale es-UY: entero sin decimales, fraccionario con `digits`.
 */
function formatRate(n: number, digits = 2): string {
  const hasDecimals =
    Math.abs(n - Math.round(n)) >= Math.pow(10, -digits) / 2;
  return n.toLocaleString("es-UY", {
    maximumFractionDigits: hasDecimals ? digits : 0,
    minimumFractionDigits: hasDecimals ? digits : 0,
  });
}
import type { ChartMetric } from "./device-energy-chart";
import {
  BillComparisonsTable,
  type BillComparison,
} from "./bill-comparisons-table";

/**
 * Lazy-load del chart con SSR deshabilitado.
 *
 * Recharts genera SVG durante el render y mide el DOM via
 * `ResponsiveContainer`. En SSR el ancho/alto inicial es 0; al hidratar
 * en cliente con dimensiones reales el HTML difiere y React tira #418
 * (hydration mismatch). Saltarse el SSR del chart elimina el problema
 * sin afectar la funcionalidad — durante el primer render se ve un
 * skeleton del mismo alto para evitar layout shift.
 */
const DeviceEnergyChart = dynamic(
  () => import("./device-energy-chart").then((m) => m.DeviceEnergyChart),
  {
    ssr: false,
    loading: () => (
      <div
        className="w-full animate-pulse rounded-md bg-muted/40"
        style={{ height: 200 }}
      />
    ),
  },
);

/**
 * Card client component que maneja los toggles per-device (WIK-99 v6):
 *
 *   1. **Métrica del chart**: Amperes (A, default) vs kWh consumido
 *      por hora. Amperes es lo que se reporta directo del breaker;
 *      kWh requiere derivar deltas entre snapshots consecutivos.
 *
 *   2. **Moneda del costo**: USD (default) vs moneda local de la
 *      property (UYU o ARS). El estado guarda la elección entre
 *      renders. El gasto aparece como segunda línea en el chart
 *      (azul punteada, igual estilo que humedad en /rooms).
 *
 * El switch de unidad global se sacó del header — cada device pelea
 * su propia moneda según la property a la que pertenece.
 */

export type DeviceCardCtx = {
  device: {
    id: string;
    name: string;
    online: boolean;
  };
  homeName: string | null;
  property: { id: string; name: string } | null;
  reading: EnergyReading | null;
  readError: string | null;
  tariff: number;
  currency: string;
  todayKwh: number | null;
  rangeKwh: number | null;
  rangeFirstSnapshotIso: string | null;
  rangeSnapshots: Array<{
    ts: number;
    power_w: number | null;
    current_a: number | null;
    total_energy_kwh: number | null;
  }>;
  billComparisons: BillComparison[];
  /** Si la property no tiene tariff seteada (usa default). */
  isDefaultTariff: boolean;
};

type Props = {
  ctx: DeviceCardCtx;
  fxRates: Map<string, FxRate>;
  /** Timestamp `Date.now()` capturado en el SERVER para evitar mismatch
   *  de hidratación (React #418). */
  nowMs: number;
  /** Inicio de la ventana del rango — también del server. */
  rangeStartMs: number;
  rangeLabel: string;
  rangeShortLabel: string;
};

export function DeviceEnergyCard({
  ctx,
  fxRates,
  nowMs,
  rangeStartMs,
  rangeLabel,
  rangeShortLabel,
}: Props) {
  const {
    device,
    homeName,
    property,
    reading,
    readError,
    tariff,
    currency,
    todayKwh,
    rangeKwh,
    rangeFirstSnapshotIso,
    rangeSnapshots,
    billComparisons,
    isDefaultTariff,
  } = ctx;

  // Toggle 1: métrica del chart. Default: amperes.
  const [metric, setMetric] = useState<ChartMetric>("amperes");

  // Toggle 2: moneda del costo. Default: USD. Opciones según el
  // currency de la property (UYU o ARS).
  const localCurrency = currency.toUpperCase();
  const supportsLocal = localCurrency === "UYU" || localCurrency === "ARS";
  const [costCurrency, setCostCurrency] = useState<string>("USD");

  // Convierte un monto en la moneda local del device a la unidad
  // seleccionada en el toggle. Si no hay rates disponibles, retorna null.
  function convertCost(localAmount: number | null): number | null {
    if (localAmount == null) return null;
    const fromFx = fxRates.get(localCurrency);
    const toFx = fxRates.get(costCurrency);
    if (!fromFx || !toFx) return null;
    const usd = localAmount / fromFx.per_usd;
    return usd * toFx.per_usd;
  }

  function formatCost(localAmount: number | null): string | null {
    const converted = convertCost(localAmount);
    if (converted == null) return null;
    return formatMoney(converted, costCurrency);
  }

  // Histórico parcial: threshold proporcional (10% del rango).
  const rangeMs = nowMs - rangeStartMs;
  const HISTORICAL_GAP_THRESHOLD_MS = Math.max(
    60 * 60 * 1000,
    rangeMs * 0.1,
  );
  const hasIncompleteHistory =
    rangeFirstSnapshotIso != null &&
    new Date(rangeFirstSnapshotIso).getTime() - rangeStartMs >
      HISTORICAL_GAP_THRESHOLD_MS;

  // Cost estimate inline (mismo cálculo que `estimateCost()` en
  // lib/tuya/energy.ts, pero acá porque ese módulo es server-only).
  const cost = {
    total_cost:
      reading?.total_energy_kwh != null
        ? reading.total_energy_kwh * tariff
        : null,
    hourly_cost_at_current:
      reading?.power_w != null ? (reading.power_w / 1000) * tariff : null,
    daily_cost_at_current:
      reading?.power_w != null ? (reading.power_w / 1000) * tariff * 24 : null,
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              {device.name}
              <Badge variant={device.online ? "default" : "secondary"}>
                {device.online ? "online" : "offline"}
              </Badge>
            </CardTitle>
            <CardDescription>
              {homeName && (
                <>
                  Home: <strong>{homeName}</strong>
                </>
              )}
              {homeName && property && " · "}
              {property && (
                <>
                  Propiedad: <strong>{property.name}</strong>
                </>
              )}
              {!homeName && !property && (
                <span className="text-muted-foreground">Sin asignar</span>
              )}
            </CardDescription>
          </div>
          <p className="text-xs text-muted-foreground text-right">
            Tarifa:
            <br />
            <span className="font-mono">
              {formatRate(tariff, 2)} {currency}/kWh
            </span>
            {isDefaultTariff && (
              <>
                <br />
                <span className="text-amber-700 dark:text-amber-300">
                  (default)
                </span>
              </>
            )}
          </p>
        </div>

        {/* Toggles per-card: métrica del chart + moneda del costo */}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-2">
            <Button
              variant={metric === "amperes" ? "default" : "outline"}
              size="sm"
              onClick={() => setMetric("amperes")}
            >
              Amperes
            </Button>
            <Button
              variant={metric === "kwh" ? "default" : "outline"}
              size="sm"
              onClick={() => setMetric("kwh")}
            >
              kWh
            </Button>
          </div>
          {supportsLocal && (
            <>
              <div className="h-5 w-px bg-border" aria-hidden />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={costCurrency === "USD" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setCostCurrency("USD")}
                >
                  USD
                </Button>
                <Button
                  variant={
                    costCurrency === localCurrency ? "default" : "outline"
                  }
                  size="sm"
                  onClick={() => setCostCurrency(localCurrency)}
                >
                  {localCurrency}
                </Button>
              </div>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {/* Stats en vivo — sólo cuando hay reading válida. */}
        {readError ? (
          <p className="text-sm text-destructive">
            No se pudo leer el estado en vivo: {readError}
          </p>
        ) : !device.online ? (
          <p className="text-sm text-muted-foreground">
            🔌 Device offline — sin lectura en vivo. Los datos históricos
            siguen abajo.
          </p>
        ) : !reading ||
          (reading.power_w == null && reading.total_energy_kwh == null) ? (
          <p className="text-sm text-muted-foreground">
            Tuya no devolvió datos de potencia/energía en vivo.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
            <Stat
              label="Potencia"
              value={formatPower(reading.power_w)}
              hint={
                reading.voltage_v != null && reading.current_a != null
                  ? `${formatNumeric(reading.voltage_v, "V", 0)} · ${formatNumeric(reading.current_a, "A", 1)}`
                  : undefined
              }
            />
            <Stat
              label={`Costo / hora · ${costCurrency}`}
              value={formatCost(cost.hourly_cost_at_current) ?? "—"}
            />
            <Stat
              label={`Proyección 24 h · ${costCurrency}`}
              value={formatCost(cost.daily_cost_at_current) ?? "—"}
              hint="si se mantiene este consumo"
            />
            <Stat
              label="Acumulado total"
              value={formatKwh(reading.total_energy_kwh)}
              hint={formatCost(cost.total_cost) ?? undefined}
            />
          </div>
        )}

        {/* Chart — métrica seleccionada (amperes / kwh) + costo en
            la moneda elegida como segunda línea (azul punteada). */}
        {rangeSnapshots.length >= 1 && (
          <div className="mt-6 border-t pt-4">
            <p className="label-mono mb-1">
              {metric === "amperes" ? "Corriente" : "Consumo"} ·{" "}
              {rangeLabel}
            </p>
            <DeviceEnergyChart
              data={rangeSnapshots}
              metric={metric}
              windowStartMs={rangeStartMs}
              windowEndMs={nowMs}
              tariff={tariff}
              localCurrency={localCurrency}
              displayCurrency={costCurrency}
              fxRates={fxRates}
            />
          </div>
        )}

        {(todayKwh != null || rangeKwh != null) && (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 border-t pt-4">
            <Stat
              label="Consumo hoy"
              value={formatKwh(todayKwh)}
              hint={
                todayKwh != null
                  ? (formatCost(todayKwh * tariff) ?? undefined)
                  : undefined
              }
            />
            <Stat
              label={`Consumo últim${rangeShortLabel === "24h" ? "as" : "os"} ${rangeLabel}`}
              value={formatKwh(rangeKwh)}
              hint={
                rangeKwh != null
                  ? (formatCost(rangeKwh * tariff) ?? undefined)
                  : undefined
              }
            />
          </div>
        )}

        {hasIncompleteHistory && rangeFirstSnapshotIso && (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div>
              <p className="font-medium">Histórico parcial</p>
              <p className="opacity-80">
                Sólo tenemos datos desde el{" "}
                {format(new Date(rangeFirstSnapshotIso), "d MMM HH:mm", {
                  locale: es,
                })}
                . Las capturas horarias arrancaron hace poco; el rango
                de {rangeLabel} se irá llenando.
              </p>
            </div>
          </div>
        )}

        {billComparisons.length > 0 && (
          <BillComparisonsTable comparisons={billComparisons} />
        )}
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
