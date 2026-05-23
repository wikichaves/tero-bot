"use client";

import dynamic from "next/dynamic";

/**
 * Wrapper client component que carga `RoomHistoryChart` con SSR
 * deshabilitado. Misma razón que en `/energy/device-energy-card.tsx`
 * (React #418 hydration mismatch): Recharts mide el DOM via
 * `ResponsiveContainer` que en SSR retorna 0×0 y genera SVG distinto
 * al de cliente cuando se hidrata.
 *
 * El skeleton tiene la misma altura del chart (288px) para evitar
 * layout shift al cargar.
 */
const RoomHistoryChart = dynamic(
  () => import("./room-history-chart").then((m) => m.RoomHistoryChart),
  {
    ssr: false,
    loading: () => (
      <div
        className="w-full animate-pulse rounded-md bg-muted/40"
        style={{ height: 288 }}
      />
    ),
  },
);

// Re-export para que sea drop-in: el page.tsx importa este wrapper
// con el mismo nombre que importaba el chart directo.
export { RoomHistoryChart };
