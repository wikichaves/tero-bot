/**
 * WIK-204: amber data orchestration traces.
 *
 * Decorative SVG overlay que se monta como fondo de la sección de
 * módulos. Dos "rails" verticales corren por los costados (estilo
 * pista de PCB) y tres ramas curvadas se desprenden hacia el interior
 * para apuntar a cada ModuleCard. Suma el sentido de "orquestación
 * modular cableada" sin recargar el editorial.
 *
 * Decisiones:
 *
 * - `preserveAspectRatio="none"` + `vector-effect="non-scaling-stroke"`
 *   en cada path: la viewBox 1000x1000 se estira para llenar la
 *   sección (que puede medir ~1100x1800px en lg+), y el stroke queda
 *   en grosor real constante en lugar de "estirado".
 *
 * - Las ramas alternan lado (left → right → left) matching el orden
 *   de los ModuleCard hijos (Hospitality, Operations con reverse,
 *   Frictionless).
 *
 * - `hidden lg:block`: en mobile/tablet la lectura es lineal full-
 *   width y los rails generarían ruido visual. En lg+ las cards usan
 *   ~58% del ancho y queda espacio libre en el costado donde el rail
 *   "respira".
 *
 * - Color hardcoded #D4AF37 (amber dorado) con opacidades bajas (0.2
 *   rail, 0.35 ramas, 0.5 nodos). Reads en light cream y dark obsidian
 *   sin tunear por theme.
 *
 * - Las vías (`<circle>` chiquititas a lo largo del rail) imitan los
 *   through-holes de un PCB y rompen la monotonía del rail.
 */

const AMBER = "#D4AF37";

export function LandingOrchestrationTraces() {
  // Y-coords (en unidades de viewBox 0..1000) que aproximan los
  // centros verticales de cada ModuleCard dentro de la sección.
  // La sección tiene un block de title arriba (~10-12% del alto) y
  // 3 modules apilados con gap. Los anclajes se calibraron contra
  // el layout real con preserveAspectRatio=none.
  const branches: Array<{ side: "left" | "right"; y: number }> = [
    { side: "left", y: 250 }, // Hospitality (photo left)
    { side: "right", y: 520 }, // Operations (photo right, reverse)
    { side: "left", y: 790 }, // Frictionless (photo left)
  ];

  // Vías decorativas a lo largo de cada rail.
  const railVias = [50, 200, 400, 620, 850, 970];

  // Geometría de cada rail (x en unidades viewBox).
  const leftX = 24;
  const rightX = 976;

  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 hidden lg:block"
      preserveAspectRatio="none"
      viewBox="0 0 1000 1000"
      fill="none"
      stroke={AMBER}
    >
      {/* Rails verticales — corren todo el alto de la sección. */}
      <line
        x1={leftX}
        y1={0}
        x2={leftX}
        y2={1000}
        opacity={0.2}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1={rightX}
        y1={0}
        x2={rightX}
        y2={1000}
        opacity={0.2}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />

      {/* Vías decorativas (PCB through-holes). */}
      {railVias.map((y) => (
        <g key={`vias-${y}`}>
          <circle
            cx={leftX}
            cy={y}
            r={1.5}
            fill={AMBER}
            stroke="none"
            opacity={0.35}
          />
          <circle
            cx={rightX}
            cy={y}
            r={1.5}
            fill={AMBER}
            stroke="none"
            opacity={0.35}
          />
        </g>
      ))}

      {/* Ramas: salen del rail con un cuarto de arco (curva de 90°
          con esquina redondeada) y terminan en un nodo amber sobre
          el borde de la ModuleCard (~14% del ancho hacia adentro). */}
      {branches.map((b, i) => {
        const startX = b.side === "left" ? leftX : rightX;
        const endX = b.side === "left" ? 140 : 860;
        const cornerY = b.y;
        // Path: salimos vertical desde el rail, hacemos un fillet en
        // la esquina, luego corremos horizontal al nodo. Cuarto de
        // bezier para que la transición sea suave (radius ~16 units).
        const direction = b.side === "left" ? 1 : -1;
        const filletStartY = cornerY - 16;
        const filletEndX = startX + 16 * direction;
        const d = [
          `M ${startX} ${filletStartY}`,
          // Bezier corner (curva de 90°)
          `Q ${startX} ${cornerY}, ${filletEndX} ${cornerY}`,
          // Run horizontal al nodo
          `L ${endX} ${cornerY}`,
        ].join(" ");
        return (
          <g key={`branch-${i}`}>
            <path
              d={d}
              opacity={0.4}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            {/* Junction "tee" en el rail — chiquita y amber. */}
            <circle
              cx={startX}
              cy={cornerY}
              r={2}
              fill={AMBER}
              stroke="none"
              opacity={0.6}
            />
            {/* Nodo final apoyado sobre el borde de la card. */}
            <circle
              cx={endX}
              cy={cornerY}
              r={2.5}
              fill={AMBER}
              stroke="none"
              opacity={0.7}
            />
          </g>
        );
      })}
    </svg>
  );
}
