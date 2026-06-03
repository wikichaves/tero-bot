"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  formatChartAxisTime,
  formatChartTooltipTime,
  formatMoney,
} from "@/lib/format";
import type { FxRate } from "@/lib/fx";

/**
 * Histórico del device (WIK-99 v6) — métrica seleccionable + línea de
 * gasto en moneda elegida.
 *
 *   - Línea principal (sólida, naranja): corriente (A) o consumo
 *     por hora (kWh/h), según el toggle del card.
 *   - Línea secundaria (punteada, azul): gasto por hora en la moneda
 *     elegida (USD o local). Comparable visualmente con humedad en
 *     /rooms — mismo styling dashed.
 *
 * Eje X = tiempo, dominio fijo al rango seleccionado para que los
 * huecos de data se vean como franja vacía y no como "salto".
 */

export type ChartMetric = "amperes" | "kwh";

type Point = {
  ts: number;
  power_w: number | null;
  current_a: number | null;
  total_energy_kwh: number | null;
};

export function DeviceEnergyChart({
  data,
  metric,
  windowStartMs,
  windowEndMs,
  tariff,
  localCurrency,
  displayCurrency,
  fxRates,
}: {
  data: Point[];
  metric: ChartMetric;
  windowStartMs: number;
  windowEndMs: number;
  tariff: number;
  localCurrency: string;
  displayCurrency: string;
  fxRates: Map<string, FxRate>;
}) {
  // Convierte un valor en `localCurrency` a `displayCurrency` via USD.
  // Memoizado afuera del useMemo de chartData para evitar churn.
  const convertCost = useMemo(() => {
    const fromFx = fxRates.get(localCurrency.toUpperCase());
    const toFx = fxRates.get(displayCurrency.toUpperCase());
    if (!fromFx || !toFx) return null;
    const factor = toFx.per_usd / fromFx.per_usd;
    return (amount: number): number => amount * factor;
  }, [fxRates, localCurrency, displayCurrency]);

  // Computar datos derivados para el chart:
  //   - `metricValue`: corriente (A) o consumo por hora (kWh delta).
  //   - `cost`: gasto por hora en la moneda mostrada.
  //
  // El kWh por hora se calcula como delta entre snapshots consecutivos
  // (no es total_energy_kwh, que es acumulado). Anchor al inicio y fin
  // del rango con nulls para forzar eje X completo.
  const chartData = useMemo(() => {
    const sorted = data
      .slice()
      .sort((a, b) => a.ts - b.ts);

    type Row = {
      ts: number;
      metricValue: number | null;
      cost: number | null;
    };
    const rows: Row[] = [];

    // (No initial null anchor: the XAxis `domain` already pins the
    // visible range to [windowStartMs, windowEndMs]. Snapshots fetched
    // from one hour BEFORE windowStart (see `fetchSinceIso` in
    // page.tsx) make the line enter from the axis edge naturally.)

    for (let i = 0; i < sorted.length; i++) {
      const p = sorted[i];
      let metricValue: number | null = null;
      let costLocal: number | null = null;

      if (metric === "amperes") {
        metricValue = p.current_a;
        // Costo horario al consumo actual = (W → kW) × tariff.
        if (p.power_w != null) {
          costLocal = (p.power_w / 1000) * tariff;
        }
      } else {
        // kWh por hora = delta con snapshot anterior, normalizado por
        // las horas transcurridas. Si no hay anterior o el delta es
        // negativo (reset del medidor), dejar null.
        const prev = sorted[i - 1];
        if (
          prev &&
          p.total_energy_kwh != null &&
          prev.total_energy_kwh != null
        ) {
          const deltaKwh = p.total_energy_kwh - prev.total_energy_kwh;
          const deltaHours = (p.ts - prev.ts) / (60 * 60 * 1000);
          if (deltaKwh >= 0 && deltaHours > 0) {
            metricValue = deltaKwh / deltaHours; // kWh/h
            costLocal = (deltaKwh / deltaHours) * tariff;
          }
        }
      }

      const cost =
        costLocal != null && convertCost ? convertCost(costLocal) : null;
      rows.push({ ts: p.ts, metricValue, cost });
    }

    // Trailing anchor: if the latest snapshot is still recent (within
    // the typical hourly cron cadence + slack), extend its value
    // forward to "now". That eliminates the cosmetic gap between the
    // last data point and the axis edge that confuses readers ("is
    // the chart broken?"). If the latest snapshot is older than ~90
    // min the device is likely offline / cron stalled — we deliberately
    // leave a gap there because it's real information.
    const last = rows[rows.length - 1];
    if (last && last.ts < windowEndMs) {
      const ageMs = windowEndMs - last.ts;
      const FRESH_THRESHOLD_MS = 90 * 60 * 1000;
      if (ageMs <= FRESH_THRESHOLD_MS) {
        // Carry the last known value forward — visually flat line to
        // "now", which matches the assumption that recent consumption
        // is unchanged.
        rows.push({
          ts: windowEndMs,
          metricValue: last.metricValue,
          cost: last.cost,
        });
      } else {
        // Old data: leave a real gap so the absence is visible.
        rows.push({ ts: windowEndMs, metricValue: null, cost: null });
      }
    }
    return rows;
  }, [data, metric, windowEndMs, tariff, convertCost]);

  const metricUnit = metric === "amperes" ? "A" : "kWh/h";
  const metricLabel = metric === "amperes" ? "Corriente" : "Consumo";

  return (
    <div style={{ width: "100%", height: 200, minHeight: 200 }}>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart
          data={chartData}
          margin={{ top: 8, right: 8, bottom: 8, left: 0 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--border)"
            opacity={0.5}
          />
          <XAxis
            dataKey="ts"
            type="number"
            scale="time"
            domain={[windowStartMs, windowEndMs]}
            tick={{ fontSize: 11 }}
            tickFormatter={(ms) => formatChartAxisTime(ms as number)}
            minTickGap={60}
          />
          {/* Eje izquierdo: métrica (A o kWh/h) */}
          <YAxis
            yAxisId="metric"
            orientation="left"
            tick={{ fontSize: 11 }}
            tickFormatter={(v) => {
              const n = Number(v);
              if (metricUnit === "A") {
                return `${n.toLocaleString("es-UY", { maximumFractionDigits: 1 })}A`;
              }
              // kWh/h con 2 decimales para que se distingan valores
              // chicos como 0.05 vs 0.10.
              return `${n.toLocaleString("es-UY", { maximumFractionDigits: 2 })}`;
            }}
            domain={[
              (dataMin: number) =>
                Math.max(0, Number(((dataMin ?? 0) * 0.9).toFixed(2))),
              (dataMax: number) =>
                Number(((dataMax ?? 0) * 1.1).toFixed(2)),
            ]}
            allowDecimals
            width={metric === "amperes" ? 48 : 56}
          />
          {/* Eje derecho: costo */}
          <YAxis
            yAxisId="cost"
            orientation="right"
            tick={{ fontSize: 11 }}
            tickFormatter={(v) =>
              `${displayCurrency === "USD" ? "$" : ""}${v}`
            }
            domain={[
              (dataMin: number) =>
                Math.max(0, Number(((dataMin ?? 0) * 0.9).toFixed(2))),
              (dataMax: number) =>
                Number(((dataMax ?? 0) * 1.1).toFixed(2)),
            ]}
            allowDecimals
            width={52}
          />
          <Tooltip
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              fontSize: 12,
            }}
            labelFormatter={(ms) => formatChartTooltipTime(ms as number)}
            formatter={(value, name) => {
              const v = value as number;
              if (name === "Costo") {
                return [formatMoney(v, displayCurrency), name];
              }
              if (metricUnit === "A") {
                return [`${v.toFixed(2)} A`, metricLabel];
              }
              return [`${v.toFixed(3)} kWh/h`, metricLabel];
            }}
          />
          <Line
            yAxisId="metric"
            type="monotone"
            dataKey="metricValue"
            name={metricLabel}
            stroke="oklch(0.7 0.22 45)"
            strokeWidth={2.5}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
          <Line
            yAxisId="cost"
            type="monotone"
            dataKey="cost"
            name="Costo"
            stroke="oklch(0.62 0.22 245)"
            strokeWidth={2.5}
            strokeDasharray="5 3"
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
