/**
 * Iconos abstractos para las stats de la landing (WIK-203, WIK-210).
 *
 * Cuatro SVGs inline minimalistas pensados como "instrumentos de precisión"
 * en vez de iconos genéricos:
 *
 * 1. <CommitsFiberCount /> — nodal graph (filamentos de fibra óptica
 *    con nodos brillantes en ámbar)
 * 2. <HoursClockFace /> — dial chronograph minimalista con tick marks
 *    selectivos en ámbar
 * 3. <DaysStack /> — pilas de placas tipo titanio/obsidiana con un
 *    edge highlight en ámbar
 * 4. <StatusScaffold /> — torre de scaffolding con X-braces; el beam
 *    superior + un nodo "active" en ámbar comunican "work in progress"
 *
 * Todos usan `currentColor` para el stroke base (heredan del text-color
 * del contenedor) y un amber dorado `#D4AF37` para los acentos puntuales.
 * Stroke fino, sin fills, alineado con el lenguaje editorial del resto
 * de la landing. Renderizan en un cuadrado de 48x48 visualmente.
 */

const AMBER = "#D4AF37";

function IconBase({ children }: { children: React.ReactNode }) {
  return (
    <svg
      width="48"
      height="48"
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-muted-foreground/70"
      aria-hidden
    >
      {children}
    </svg>
  );
}

/**
 * Commits — fiber count. Grid 3x3 de nodos conectados por filamentos
 * finos. El nodo central es más grande y ámbar (representa el commit
 * más reciente / hot node). Dos diagonales rompen la simetría grid
 * para que se sienta orgánico, no robotizado.
 */
export function CommitsFiberCount() {
  // Coordenadas del grid 3x3 dentro del viewBox 64x64.
  const grid = [
    [16, 16], [32, 16], [48, 16],
    [16, 32], [32, 32], [48, 32],
    [16, 48], [32, 48], [48, 48],
  ];
  // Conexiones: orthogonal entre vecinos + 2 diagonales selectas.
  const lines: Array<[number, number]> = [
    [0, 1], [1, 2],          // top row
    [3, 4], [4, 5],          // mid row
    [6, 7], [7, 8],          // bot row
    [0, 3], [3, 6],          // left col
    [1, 4], [4, 7],          // mid col
    [2, 5], [5, 8],          // right col
    [0, 4], [4, 8],          // 2 diagonals breaking the grid
  ];
  return (
    <IconBase>
      {lines.map(([a, b], i) => (
        <line
          key={i}
          x1={grid[a][0]}
          y1={grid[a][1]}
          x2={grid[b][0]}
          y2={grid[b][1]}
          opacity={0.5}
        />
      ))}
      {grid.map(([x, y], i) => {
        const isCenter = i === 4;
        return (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={isCenter ? 2.5 : 1.3}
            fill={isCenter ? AMBER : "currentColor"}
            stroke="none"
            opacity={isCenter ? 1 : 0.6}
          />
        );
      })}
    </IconBase>
  );
}

/**
 * Active Hours — minimalist clock face. Anillo exterior con 12 tick
 * marks (4 largos en cardinales, 8 cortos). 2 ticks en ámbar (top +
 * 4-o'clock) sugieren la "hora activa" sin manecillas — abstracto,
 * no literal. Sin numerales, sin centro.
 */
export function HoursClockFace() {
  // 12 ticks alrededor del círculo. Los cardinales (0, 3, 6, 9) son
  // más largos. Los amber-highlighted son el 0 (top) y el 2 (~4
  // o'clock — sugiere "PM" running).
  const ticks = Array.from({ length: 12 }, (_, i) => {
    const angle = (i * 30 - 90) * (Math.PI / 180);
    const isCardinal = i % 3 === 0;
    const inner = isCardinal ? 22 : 25;
    const outer = 28;
    const x1 = 32 + Math.cos(angle) * inner;
    const y1 = 32 + Math.sin(angle) * inner;
    const x2 = 32 + Math.cos(angle) * outer;
    const y2 = 32 + Math.sin(angle) * outer;
    const isAmber = i === 0 || i === 2;
    return { x1, y1, x2, y2, isCardinal, isAmber };
  });
  return (
    <IconBase>
      <circle cx="32" cy="32" r="29" opacity={0.4} />
      {ticks.map((t, i) => (
        <line
          key={i}
          x1={t.x1}
          y1={t.y1}
          x2={t.x2}
          y2={t.y2}
          stroke={t.isAmber ? AMBER : "currentColor"}
          strokeWidth={t.isCardinal ? 1.5 : 1}
          opacity={t.isAmber ? 1 : t.isCardinal ? 0.8 : 0.5}
        />
      ))}
    </IconBase>
  );
}

/**
 * Active Days — stack of plates. Cuatro rectángulos horizontales
 * apilados con leve perspectiva (lado derecho más corto) para
 * sugerir 3D. El plate superior tiene su top edge en ámbar — el
 * "día más reciente" iluminado. Minimal, no over-engineered.
 */
export function DaysStack() {
  // 4 plates apiladas. Cada plate: rect izq con perspectiva derecha
  // (líneas oblicuas conectan los extremos).
  // Width plate-front = 32 (left side 16..48, oblique 4px to right).
  const plates = [
    { y: 18, ySide: 14 }, // top, amber-highlighted
    { y: 28, ySide: 24 },
    { y: 38, ySide: 34 },
    { y: 48, ySide: 44 },
  ];
  return (
    <IconBase>
      {plates.map((p, i) => {
        const isTop = i === 0;
        const color = isTop ? AMBER : "currentColor";
        const opacity = isTop ? 1 : 0.5 - i * 0.08;
        return (
          <g key={i}>
            {/* Front face — flat horizontal rect-line */}
            <line
              x1="14"
              y1={p.y}
              x2="46"
              y2={p.y}
              stroke={color}
              opacity={opacity}
              strokeWidth={isTop ? 1.4 : 1}
            />
            {/* Side perspective — oblique connecting to a virtual
                back-edge above. Top plate también lleva la oblicua en
                ámbar para reforzar el "iluminado" effect. */}
            <line
              x1="46"
              y1={p.y}
              x2="50"
              y2={p.ySide}
              stroke={color}
              opacity={opacity * 0.7}
            />
            <line
              x1="14"
              y1={p.y}
              x2="18"
              y2={p.ySide}
              stroke={color}
              opacity={opacity * 0.7}
            />
            {/* Back-edge horizontal */}
            <line
              x1="18"
              y1={p.ySide}
              x2="50"
              y2={p.ySide}
              stroke={color}
              opacity={opacity * 0.5}
            />
          </g>
        );
      })}
    </IconBase>
  );
}

/**
 * Status (WIP) — scaffolding tower. Dos postes verticales, tres
 * cross-beams y dos niveles de X-braces. El beam superior va en ámbar
 * y un pequeño nodo "active" arriba del todo (tipo crane hook) sugiere
 * el nivel donde se está trabajando. Metáfora directa de WIP: la torre
 * está parada pero sigue creciendo desde arriba (WIK-210).
 */
export function StatusScaffold() {
  return (
    <IconBase>
      {/* Postes verticales */}
      <line x1="18" y1="14" x2="18" y2="54" opacity={0.6} />
      <line x1="46" y1="14" x2="46" y2="54" opacity={0.6} />

      {/* Cross-beams */}
      <line
        x1="18"
        y1="14"
        x2="46"
        y2="14"
        stroke={AMBER}
        strokeWidth={1.4}
      />
      <line x1="18" y1="34" x2="46" y2="34" opacity={0.6} />
      <line x1="18" y1="54" x2="46" y2="54" opacity={0.5} />

      {/* X-braces — nivel superior */}
      <line x1="18" y1="14" x2="46" y2="34" opacity={0.4} />
      <line x1="46" y1="14" x2="18" y2="34" opacity={0.4} />

      {/* X-braces — nivel inferior */}
      <line x1="18" y1="34" x2="46" y2="54" opacity={0.3} />
      <line x1="46" y1="34" x2="18" y2="54" opacity={0.3} />

      {/* Active node — hook/indicador encima del beam superior */}
      <line x1="32" y1="8" x2="32" y2="14" stroke={AMBER} opacity={0.8} />
      <circle cx="32" cy="8" r="2" fill={AMBER} stroke="none" />
    </IconBase>
  );
}
