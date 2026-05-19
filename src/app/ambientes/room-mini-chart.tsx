"use client";

import { LineChart, Line, ResponsiveContainer, YAxis } from "recharts";

/**
 * Mini gráfico de las últimas 24h para una card de room. Sin ejes
 * visibles ni grid — pura "sparkline" para dar hint visual de
 * tendencia. El detalle (eje, grid, tooltip, etc.) vive en
 * `/ambientes/[id]`.
 *
 * Dos líneas overlay: temperatura (orange) y humedad (azul).
 * Las escalas Y son independientes por línea (temp típica 10-35,
 * humedad típica 30-90).
 */
type Snapshot = {
  taken_at: string;
  temperature_c: number | null;
  humidity_pct: number | null;
};

export function RoomMiniChart({ series }: { series: Snapshot[] }) {
  // Recharts no permite ejes Y duales en un mini-chart sin reservar
  // ancho. Para mantenerlo limpio, normalizamos H a la misma escala de
  // T (visual relativo, no cuantitativo — el detalle se ve en el drill).
  const data = series.map((s) => ({
    t: s.temperature_c,
    h: s.humidity_pct,
  }));

  return (
    // ResponsiveContainer tira warnings "width(-1) and height(-1)"
    // durante el initial render si el parent no tiene dimensiones
    // explícitas. Fix: setear width/height en px en el contenedor
    // padre. minHeight como safeguard adicional.
    <div style={{ width: "100%", height: 48, minHeight: 48 }}>
      <ResponsiveContainer width="100%" height={48}>
        <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <YAxis yAxisId="t" hide domain={["dataMin - 1", "dataMax + 1"]} />
          <YAxis yAxisId="h" hide domain={["dataMin - 5", "dataMax + 5"]} />
          <Line
            yAxisId="t"
            type="monotone"
            dataKey="t"
            stroke="oklch(0.7 0.22 45)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            yAxisId="h"
            type="monotone"
            dataKey="h"
            stroke="oklch(0.62 0.22 245)"
            strokeWidth={2}
            // Dashed para mantener consistencia visual con el chart
            // grande del detalle (room-history-chart.tsx) — la línea
            // de humedad siempre es punteada.
            strokeDasharray="4 2"
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
