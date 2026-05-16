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

const TEMP_COLORS = [
  "oklch(0.72 0.18 55)",   // orange primary
  "oklch(0.65 0.18 35)",   // deeper orange
  "oklch(0.78 0.16 75)",   // amber
];
const HUM_COLORS = [
  "oklch(0.65 0.18 240)",  // blue
  "oklch(0.55 0.15 220)",  // deeper blue
  "oklch(0.7 0.12 200)",   // cyan
];

export function RoomHistoryChart({ series }: { series: SensorSeries[] }) {
  // Pivot: cada timestamp único es una fila con columnas por sensor.
  const data = useMemo(() => {
    const byTs = new Map<number, Record<string, number | null>>();
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
  }, [series]);

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
            domain={["dataMin", "dataMax"]}
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
            tickFormatter={(v) => `${v}°C`}
            width={48}
          />
          <YAxis
            yAxisId="h"
            orientation="right"
            tick={{ fontSize: 11 }}
            tickFormatter={(v) => `${v}%`}
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
            formatter={(value, name) => {
              const isTemp = String(name).startsWith("t_");
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
              strokeWidth={2}
              dot={false}
              connectNulls
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
              strokeWidth={2}
              strokeDasharray="4 2"
              dot={false}
              connectNulls
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
