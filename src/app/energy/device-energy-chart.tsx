"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  formatChartAxisTime,
  formatChartTooltipTime,
} from "@/lib/format";

/**
 * Histórico del device (WIK-342 v2) — correlación consumo vs cortes.
 *
 *   - Línea principal (sólida, AZUL): corriente (A) o consumo por hora
 *     (kWh/h), según el toggle del card. Eje izquierdo.
 *   - Línea secundaria (sólida, NARANJA): voltaje (V). Eje derecho.
 *     Es donde se ven los cortes súbitos (caída de tensión) y sirve
 *     para buscar correlación con picos de amperaje.
 *   - Líneas verticales ROJAS: cada corte de luz registrado (fired_at)
 *     dentro de la ventana. Así se ve de un vistazo si justo antes del
 *     corte hubo un pico de consumo o una caída de tensión.
 *
 * Eje X = tiempo, dominio fijo al rango seleccionado para que los
 * huecos de data se vean como franja vacía y no como "salto".
 */

export type ChartMetric = "amperes" | "kwh";

type Point = {
  ts: number;
  power_w: number | null;
  current_a: number | null;
  voltage_v: number | null;
  total_energy_kwh: number | null;
};

/** Corte de luz a marcar como línea vertical. */
export type OutageMark = {
  /** epoch ms del inicio del corte (fired_at). */
  ts: number;
  /** true si fue micro-corte (< 1 min). */
  micro: boolean;
};

export function DeviceEnergyChart({
  data,
  metric,
  windowStartMs,
  windowEndMs,
  outages = [],
}: {
  data: Point[];
  metric: ChartMetric;
  windowStartMs: number;
  windowEndMs: number;
  /** Cortes de luz de la property dueña de este device (para marcarlos). */
  outages?: OutageMark[];
}) {
  // Computar datos derivados para el chart:
  //   - `metricValue`: corriente (A) o consumo por hora (kWh delta).
  //   - `voltage`: tensión (V) directa del snapshot.
  //
  // El kWh por hora se calcula como delta entre snapshots consecutivos
  // (no es total_energy_kwh, que es acumulado).
  const chartData = useMemo(() => {
    const sorted = data.slice().sort((a, b) => a.ts - b.ts);

    type Row = {
      ts: number;
      metricValue: number | null;
      voltage: number | null;
    };
    const rows: Row[] = [];

    for (let i = 0; i < sorted.length; i++) {
      const p = sorted[i];
      let metricValue: number | null = null;

      if (metric === "amperes") {
        metricValue = p.current_a;
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
          }
        }
      }

      rows.push({ ts: p.ts, metricValue, voltage: p.voltage_v });
    }

    // Trailing anchor: si el último snapshot es reciente (dentro de la
    // cadencia horaria del cron + slack), extender su valor hasta "ahora"
    // para eliminar el hueco cosmético al borde del eje. Si es más viejo
    // que ~90 min el device está offline / cron parado → dejamos hueco
    // real (es información).
    const last = rows[rows.length - 1];
    if (last && last.ts < windowEndMs) {
      const ageMs = windowEndMs - last.ts;
      const FRESH_THRESHOLD_MS = 90 * 60 * 1000;
      if (ageMs <= FRESH_THRESHOLD_MS) {
        rows.push({
          ts: windowEndMs,
          metricValue: last.metricValue,
          voltage: last.voltage,
        });
      } else {
        rows.push({ ts: windowEndMs, metricValue: null, voltage: null });
      }
    }
    return rows;
  }, [data, metric, windowEndMs]);

  const metricUnit = metric === "amperes" ? "A" : "kWh/h";
  const metricLabel = metric === "amperes" ? "Corriente" : "Consumo";

  // Sólo marcamos cortes dentro de la ventana visible.
  const visibleOutages = useMemo(
    () =>
      outages.filter((o) => o.ts >= windowStartMs && o.ts <= windowEndMs),
    [outages, windowStartMs, windowEndMs],
  );

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
          {/* Eje izquierdo: métrica (A o kWh/h) — AZUL */}
          <YAxis
            yAxisId="metric"
            orientation="left"
            tick={{ fontSize: 11 }}
            tickFormatter={(v) => {
              const n = Number(v);
              if (metricUnit === "A") {
                return `${n.toLocaleString("es-UY", { maximumFractionDigits: 1 })}A`;
              }
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
          {/* Eje derecho: voltaje (V) — NARANJA */}
          <YAxis
            yAxisId="voltage"
            orientation="right"
            tick={{ fontSize: 11 }}
            tickFormatter={(v) => `${Math.round(Number(v))}V`}
            domain={[
              // Piso en 0 para que las caídas súbitas (corte = ~0V) se
              // vean como desplome hasta abajo, no recortadas.
              0,
              (dataMax: number) =>
                Math.round(((dataMax ?? 240) * 1.05) / 5) * 5,
            ]}
            allowDecimals={false}
            width={44}
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
              if (name === "Voltaje") {
                return [`${v.toFixed(0)} V`, name];
              }
              if (metricUnit === "A") {
                return [`${v.toFixed(2)} A`, metricLabel];
              }
              return [`${v.toFixed(3)} kWh/h`, metricLabel];
            }}
          />
          {/* Marcas verticales de cortes de luz (rojas). */}
          {visibleOutages.map((o, i) => (
            <ReferenceLine
              key={`outage-${o.ts}-${i}`}
              yAxisId="metric"
              x={o.ts}
              stroke="oklch(0.6 0.24 25)"
              strokeWidth={o.micro ? 1 : 1.75}
              strokeDasharray={o.micro ? "2 3" : undefined}
              ifOverflow="extendDomain"
            />
          ))}
          <Line
            yAxisId="metric"
            type="monotone"
            dataKey="metricValue"
            name={metricLabel}
            stroke="oklch(0.62 0.22 245)"
            strokeWidth={2.5}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
          <Line
            yAxisId="voltage"
            type="monotone"
            dataKey="voltage"
            name="Voltaje"
            stroke="oklch(0.7 0.22 45)"
            strokeWidth={2}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
