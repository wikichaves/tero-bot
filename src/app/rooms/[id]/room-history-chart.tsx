"use client";

import { useMemo } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";

/**
 * Gráfico histórico de un room. Eje X = tiempo, eje Y izq = T (°C),
 * eje Y der = humedad (%). Una línea por sensor por métrica.
 *
 * Si hay 1 solo sensor (caso típico), se ven dos líneas: temp + humedad.
 * Si hay 2+: cada uno tiene su par de líneas, distinguibles por color
 * (la temperatura siempre es tonos naranjas, la humedad siempre azules).
 */

type SensorSeries = {
  label: string;
  deviceId: string;
  points: Array<{ ts: number; t: number | null; h: number | null }>;
};

// WIK-98: colores más saturados (chroma 0.22 vs 0.18) y lightness más
// definida para que las curvas se distingan mejor del background del
// chart y del grid. Vivian más en pantallas OLED / dark mode también.
const TEMP_COLORS = [
  "oklch(0.7 0.22 45)",    // orange primary, más saturado
  "oklch(0.6 0.22 25)",    // deeper red-orange
  "oklch(0.78 0.2 75)",    // amber bright
];
const HUM_COLORS = [
  "oklch(0.62 0.22 245)",  // blue primary, más saturado
  "oklch(0.52 0.2 225)",   // deeper blue
  "oklch(0.7 0.16 200)",   // cyan
];

export function RoomHistoryChart({
  series,
  windowStartMs,
  windowEndMs,
}: {
  series: SensorSeries[];
  /** Inicio de la ventana del rango (24h/7d/30d). El eje X arranca acá
   *  aunque no haya data temprana — los huecos quedan visibles. */
  windowStartMs: number;
  /** Fin de la ventana (típicamente `Date.now()`). */
  windowEndMs: number;
}) {
  // Pivot: cada timestamp único es una fila con columnas por sensor.
  // Anchors (start/end) con todos los valores null fuerzan al chart a
  // renderizar el eje X completo aunque no haya data temprana.
  const data = useMemo(() => {
    const byTs = new Map<number, Record<string, number | null>>();
    // Anchor inicial del rango.
    const startRow: Record<string, number | null> = { ts: windowStartMs };
    for (const s of series) {
      startRow[`t_${s.deviceId}`] = null;
      startRow[`h_${s.deviceId}`] = null;
    }
    byTs.set(windowStartMs, startRow);
    // Anchor final.
    const endRow: Record<string, number | null> = { ts: windowEndMs };
    for (const s of series) {
      endRow[`t_${s.deviceId}`] = null;
      endRow[`h_${s.deviceId}`] = null;
    }
    if (!byTs.has(windowEndMs)) byTs.set(windowEndMs, endRow);

    for (const s of series) {
      for (const p of s.points) {
        const row = byTs.get(p.ts) ?? { ts: p.ts };
        row[`t_${s.deviceId}`] = p.t;
        row[`h_${s.deviceId}`] = p.h;
        byTs.set(p.ts, row);
      }
    }
    return Array.from(byTs.values()).sort(
      (a, b) => (a.ts as number) - (b.ts as number),
    );
  }, [series, windowStartMs, windowEndMs]);

  const showLegend = series.length > 1;

  return (
    <div style={{ width: "100%", height: 288, minHeight: 288 }}>
      <ResponsiveContainer width="100%" height={288}>
        <LineChart
          data={data}
          margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
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
            // Dominio fijo al rango seleccionado (24h/7d/30d). Si no hay
            // data en parte del rango, esa franja queda visible vacía —
            // el user percibe el "histórico parcial" directamente en
            // el chart, sin necesidad de leer el banner.
            domain={[windowStartMs, windowEndMs]}
            tick={{ fontSize: 11 }}
            tickFormatter={(ms) =>
              format(new Date(ms as number), "d MMM HH:mm", { locale: es })
            }
            minTickGap={60}
          />
          <YAxis
            yAxisId="t"
            orientation="left"
            tick={{ fontSize: 11 }}
            tickFormatter={(v) =>
              `${Number(v).toLocaleString("es-UY", {
                maximumFractionDigits: 1,
              })}°C`
            }
            // WIK-96: escala más pronunciada. Antes ±1°C, ahora padding
            // proporcional al rango real (10% del span) con mínimo 0.3°C
            // y máximo 1°C. Para data en 13-14°C ahora muestra 12.7-14.3
            // (span ~1.6°C) en vez de 12-15 (span 3°C). Cambios pequeños
            // de 0.2-0.5°C se ven con detalle.
            domain={[
              (dataMin: number) => {
                const min = dataMin ?? 0;
                return Number((min - 0.3).toFixed(1));
              },
              (dataMax: number) => {
                const max = dataMax ?? 0;
                return Number((max + 0.3).toFixed(1));
              },
            ]}
            allowDecimals
            width={52}
          />
          <YAxis
            yAxisId="h"
            orientation="right"
            tick={{ fontSize: 11 }}
            tickFormatter={(v) => `${v}%`}
            // Humedad: ±2% (antes ±5%). Es métrica con más ruido pero
            // los cambios significativos suelen ser de 3-5%, querés
            // verlos claros.
            domain={[
              (dataMin: number) => Math.max(0, Math.floor((dataMin ?? 0) - 2)),
              (dataMax: number) => Math.min(100, Math.ceil((dataMax ?? 0) + 2)),
            ]}
            allowDecimals={false}
            width={40}
          />
          <Tooltip
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              fontSize: 12,
            }}
            labelFormatter={(ms) =>
              format(new Date(ms as number), "EEE d MMM HH:mm", {
                locale: es,
              })
            }
            formatter={(value, name, item) => {
              // `name` puede ser "Temperatura"/"Humedad" (single sensor)
              // o `<label> · T`/`<label> · H` (multi). Usamos `dataKey`
              // que siempre arranca con `t_` o `h_` — único discriminador
              // confiable entre las dos métricas.
              const dataKey = String(
                (item as { dataKey?: string } | undefined)?.dataKey ?? "",
              );
              const isTemp = dataKey.startsWith("t_");
              return [
                isTemp
                  ? `${(value as number).toFixed(1)}°C`
                  : `${(value as number).toFixed(0)}%`,
                name as string,
              ];
            }}
          />
          {series.map((s, idx) => (
            <Line
              key={`t-${s.deviceId}`}
              yAxisId="t"
              type="monotone"
              dataKey={`t_${s.deviceId}`}
              name={series.length > 1 ? `${s.label} · T` : "Temperatura"}
              stroke={TEMP_COLORS[idx % TEMP_COLORS.length]}
              strokeWidth={2.5}
              dot={false}
              // connectNulls=false: si hay gaps de data dentro del rango
              // (sensor offline esa hora), la línea queda cortada en
              // vez de "saltar" sobre el hueco. Más honesto visualmente.
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
          {series.map((s, idx) => (
            <Line
              key={`h-${s.deviceId}`}
              yAxisId="h"
              type="monotone"
              dataKey={`h_${s.deviceId}`}
              name={series.length > 1 ? `${s.label} · H` : "Humedad"}
              stroke={HUM_COLORS[idx % HUM_COLORS.length]}
              strokeWidth={2.5}
              strokeDasharray="5 3"
              dot={false}
              // connectNulls=false: si hay gaps de data dentro del rango
              // (sensor offline esa hora), la línea queda cortada en
              // vez de "saltar" sobre el hueco. Más honesto visualmente.
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
          {showLegend && (
            <Legend wrapperStyle={{ fontSize: 11 }} iconSize={10} />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
