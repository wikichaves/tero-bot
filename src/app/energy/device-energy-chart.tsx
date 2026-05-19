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
} from "recharts";

/**
 * Histórico de potencia (W) de un device dentro del rango seleccionado.
 *
 * Diseño igual al chart de /ambientes/[id]:
 *   - Eje X = tiempo, dominio fijo al rango (24h/7d/30d) — los huecos
 *     de data se ven como franja vacía en vez de "saltar".
 *   - Eje Y izquierdo en W con padding visual ±10W.
 *   - connectNulls=false: la curva se corta donde el device estuvo
 *     offline en vez de pretender continuidad.
 */

type Point = { ts: number; power_w: number | null };

export function DeviceEnergyChart({
  data,
  windowStartMs,
  windowEndMs,
}: {
  data: Point[];
  windowStartMs: number;
  windowEndMs: number;
}) {
  // Anchors en los extremos para forzar el eje X completo aunque la
  // data esté incompleta.
  const chartData = useMemo(() => {
    const byTs = new Map<number, { ts: number; power_w: number | null }>();
    byTs.set(windowStartMs, { ts: windowStartMs, power_w: null });
    if (!byTs.has(windowEndMs)) {
      byTs.set(windowEndMs, { ts: windowEndMs, power_w: null });
    }
    for (const p of data) {
      byTs.set(p.ts, { ts: p.ts, power_w: p.power_w });
    }
    return Array.from(byTs.values()).sort((a, b) => a.ts - b.ts);
  }, [data, windowStartMs, windowEndMs]);

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
            tickFormatter={(ms) =>
              format(new Date(ms as number), "d MMM HH:mm", { locale: es })
            }
            minTickGap={60}
          />
          <YAxis
            tick={{ fontSize: 11 }}
            tickFormatter={(v) => `${v}W`}
            // Padding dinámico ±10W de los extremos.
            domain={[
              (dataMin: number) =>
                Math.max(0, Math.floor((dataMin ?? 0) - 10)),
              (dataMax: number) => Math.ceil((dataMax ?? 0) + 10),
            ]}
            allowDecimals={false}
            width={52}
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
            formatter={(value) => [
              `${(value as number).toFixed(0)} W`,
              "Potencia",
            ]}
          />
          <Line
            type="monotone"
            dataKey="power_w"
            stroke="oklch(0.7 0.22 45)"
            strokeWidth={2.5}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
