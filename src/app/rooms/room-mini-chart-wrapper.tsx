"use client";

import dynamic from "next/dynamic";

/**
 * Wrapper client component que carga `RoomMiniChart` con SSR deshabilitado
 * (WIK-315). Mismo patrón que `/rooms/[id]/room-history-chart-wrapper.tsx`
 * y `/energy/device-energy-card.tsx`.
 *
 * Dos motivos:
 *   1. Recharts mide el DOM via `ResponsiveContainer`, que en SSR retorna
 *      0×0 y genera un SVG distinto al del cliente al hidratar (React #418).
 *      Los otros dos charts ya lo evitaban así; este quedó sin wrapper.
 *   2. Peso: `/rooms` es la página más usada y arrastraba todo Recharts en
 *      el bundle inicial sólo para las sparklines. Con `dynamic` se carga
 *      después del primer paint.
 *
 * El skeleton tiene la misma altura del chart (48px) para evitar layout
 * shift al cargar.
 */
const RoomMiniChart = dynamic(
  () => import("./room-mini-chart").then((m) => m.RoomMiniChart),
  {
    ssr: false,
    loading: () => (
      <div
        className="w-full animate-pulse rounded-md bg-muted/40"
        style={{ height: 48 }}
      />
    ),
  },
);

// Re-export para que sea drop-in: el page.tsx importa este wrapper con el
// mismo nombre que importaba el chart directo.
export { RoomMiniChart };
