/**
 * Plano vectorial de la casa (SVG inline) calcado sobre el plano real.
 *
 * A diferencia de una imagen, esto es 100% vectorial → nítido a cualquier
 * zoom/pantalla, liviano, y sin cotas ni texto CAD. Por ahora hardcodeado
 * para Casa Merced; a futuro se puede parametrizar por property.
 *
 * Los pins (temp en vivo) se dibujan encima con coordenadas en % del viewBox.
 */

export type FloorPin = {
  id: string;
  name: string;
  x: number; // % del ancho del viewBox
  y: number; // % del alto
  isSensor: boolean;
  tempC: number | null;
  humidityPct: number | null;
};

function tempColor(t: number | null): string {
  if (t === null) return "#8b93a1";
  if (t < 18) return "#5aa9e6";
  if (t <= 24) return "#e6a15a";
  return "#57c785";
}

// viewBox del dibujo
const VB_W = 380;
const VB_H = 600;

export function FloorPlanSvg({ pins }: { pins: FloorPin[] }) {
  return (
    <div className="w-full overflow-hidden rounded-xl border border-border bg-[#0e1116] p-2">
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        role="img"
        aria-label="Plano de la casa"
        className="h-auto w-full"
      >
        {/* ---- ambientes (relleno) ---- */}
        <g>
          <rect x="48" y="20" width="80" height="90" fill="#101419" />
          <rect x="128" y="20" width="115" height="90" fill="#14181f" />
          <rect x="243" y="20" width="52" height="70" fill="#101419" />
          <rect x="295" y="20" width="70" height="175" fill="#14181f" />
          <rect x="243" y="90" width="52" height="105" fill="#14181f" />
          <rect x="48" y="110" width="115" height="95" fill="#14181f" />
          <rect x="48" y="205" width="200" height="120" fill="#14181f" />
          <rect x="48" y="325" width="120" height="110" fill="#14181f" />
          <rect x="48" y="435" width="80" height="95" fill="#101419" />
          <rect x="128" y="435" width="115" height="95" fill="#14181f" />
        </g>

        {/* ---- paredes ---- */}
        <g
          fill="none"
          stroke="#7f8a9c"
          strokeWidth={3}
          strokeLinejoin="round"
          strokeLinecap="round"
        >
          <path d="M48 20 H365 V195 H295 V325 H243 V530 H48 Z" />
          <path d="M243 20 V195" />
          <path d="M295 20 V195" />
          <path d="M128 20 V205" />
          <path d="M48 110 H128" />
          <path d="M243 90 H295" />
          <path d="M243 195 H48" />
          <path d="M48 325 H243" />
          <path d="M168 325 V435" />
          <path d="M128 435 H243" />
          <path d="M128 435 V530" />
        </g>
        <g fill="none" stroke="#586072" strokeWidth={1.6}>
          <path d="M128 110 H243" />
        </g>

        {/* ---- rejillas de baños ---- */}
        <g fill="none" stroke="#586072" strokeWidth={1.2} opacity={0.7}>
          <line x1="60" y1="30" x2="60" y2="100" />
          <line x1="72" y1="30" x2="72" y2="100" />
          <line x1="84" y1="30" x2="84" y2="100" />
          <line x1="96" y1="30" x2="96" y2="100" />
          <line x1="108" y1="30" x2="108" y2="100" />
          <line x1="52" y1="42" x2="124" y2="42" />
          <line x1="52" y1="56" x2="124" y2="56" />
          <line x1="52" y1="70" x2="124" y2="70" />
          <line x1="52" y1="84" x2="124" y2="84" />
          <line x1="60" y1="445" x2="60" y2="525" />
          <line x1="72" y1="445" x2="72" y2="525" />
          <line x1="84" y1="445" x2="84" y2="525" />
          <line x1="96" y1="445" x2="96" y2="525" />
          <line x1="108" y1="445" x2="108" y2="525" />
          <line x1="52" y1="458" x2="124" y2="458" />
          <line x1="52" y1="475" x2="124" y2="475" />
          <line x1="52" y1="495" x2="124" y2="495" />
          <line x1="52" y1="512" x2="124" y2="512" />
        </g>

        {/* ---- pins (temp en vivo) ---- */}
        {pins.map((p) => {
          const cx = (p.x / 100) * VB_W;
          const cy = (p.y / 100) * VB_H;
          if (!p.isSensor) {
            return (
              <g key={p.id} transform={`translate(${cx} ${cy})`}>
                <rect
                  x={-p.name.length * 2.7 - 4}
                  y={-8}
                  width={p.name.length * 5.4 + 8}
                  height={16}
                  rx={4}
                  fill="#0f2536"
                  stroke="#2a5578"
                />
                <text
                  x={0}
                  y={3}
                  textAnchor="middle"
                  fontSize={9}
                  fontWeight={600}
                  fill="#9cc4e6"
                >
                  {p.name}
                </text>
              </g>
            );
          }
          const color = tempColor(p.tempC);
          const label =
            p.tempC === null ? "\u2014" : `${p.tempC.toFixed(1)}\u00b0`;
          return (
            <g key={p.id} transform={`translate(${cx} ${cy})`}>
              <rect
                x={-24}
                y={-13}
                width={48}
                height={22}
                rx={6}
                fill="#161a21"
                stroke={color}
                strokeWidth={1.5}
              />
              <text
                x={0}
                y={3}
                textAnchor="middle"
                fontSize={13}
                fontWeight={700}
                fill={color}
              >
                {label}
              </text>
              <text
                x={0}
                y={22}
                textAnchor="middle"
                fontSize={8.5}
                fontWeight={600}
                fill="#c3c9d2"
              >
                {p.name}
                {p.humidityPct !== null ? ` ${p.humidityPct}%` : ""}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
