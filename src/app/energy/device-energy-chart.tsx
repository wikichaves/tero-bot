"use client";

import { LineChart, Line, ResponsiveContainer, YAxis } from "recharts";

/**
 * Mini sparkline de potencia (W) dentro del rango seleccionado, para
 * mostrar tendencia rápida en cada card de /energy (WIK-99 F3). Pura
 * sparkline — sin ejes ni grid, igual que el mini chart de /ambientes.
 *
 * Datasource: array de snapshots `power_w` ordenados por timestamp.
 * No se hace conversión de unidad acá porque W es independiente del
 * switch kWh/UYU/ARS/USD (que es para costos, no para potencia).
 */
type Point = { ts: number; power_w: number | null };

export function DeviceEnergyChart({ data }: { data: Point[] }) {
  return (
    // El parent necesita dimensiones explícitas para que Recharts no
    // tire warnings "width(-1)" en el initial render.
    <div style={{ width: "100%", height: 48, minHeight: 48 }}>
      <ResponsiveContainer width="100%" height={48}>
        <LineChart
          data={data}
          margin={{ top: 2, right: 2, bottom: 2, left: 2 }}
        >
          <YAxis hide domain={["dataMin - 10", "dataMax + 10"]} />
          <Line
            type="monotone"
            dataKey="power_w"
            stroke="oklch(0.7 0.22 45)"
            strokeWidth={2}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
