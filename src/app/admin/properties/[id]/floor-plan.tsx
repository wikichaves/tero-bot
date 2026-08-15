import Image from "next/image";

/**
 * Plano de la casa (floor plan) con los devices posicionados encima.
 *
 * El plano es una imagen real (recortada a la casa) subida al bucket
 * `property-thumbnails`. Cada device con `pin_x` / `pin_y` (en % 0-100) se
 * dibuja como un pin absoluto sobre la imagen. Los sensores muestran su
 * última lectura de temperatura/humedad en vivo; los accionadores
 * (aire/estufa/etc.) muestran un chip con su nombre.
 */

export type FloorPlanPin = {
  id: string;
  name: string;
  x: number; // %
  y: number; // %
  /** true → sensor T/H (muestra temp); false → accionador (chip). */
  isSensor: boolean;
  tempC: number | null;
  humidityPct: number | null;
};

function tempClass(t: number | null): string {
  if (t === null) return "border-muted-foreground/40 text-muted-foreground";
  if (t < 18) return "border-sky-400 text-sky-400";
  if (t <= 24) return "border-amber-400 text-amber-400";
  return "border-emerald-400 text-emerald-400";
}

export function FloorPlan({
  floorPlanUrl,
  pins,
}: {
  floorPlanUrl: string;
  pins: FloorPlanPin[];
}) {
  return (
    <div className="relative w-full overflow-hidden rounded-xl border border-border bg-muted/20">
      {/* Plano: filtro invert para que el plano (líneas negras sobre blanco)
          quede claro sobre el fondo oscuro de la app. */}
      <Image
        src={floorPlanUrl}
        alt="Plano de la casa"
        width={800}
        height={1000}
        unoptimized
        className="w-full opacity-60 dark:opacity-55 dark:[filter:invert(1)_hue-rotate(180deg)_brightness(1.05)_contrast(0.9)]"
      />
      {pins.map((p) =>
        p.isSensor ? (
          <div
            key={p.id}
            className="absolute -translate-x-1/2 -translate-y-1/2 text-center"
            style={{ left: `${p.x}%`, top: `${p.y}%` }}
          >
            <span
              className={`inline-block whitespace-nowrap rounded-lg border-[1.5px] bg-card/90 px-2 py-1 text-sm font-bold leading-none shadow-md ${tempClass(
                p.tempC,
              )}`}
            >
              {p.tempC === null ? "\u2014" : `${p.tempC.toFixed(1)}\u00b0`}
            </span>
            <span className="mt-1 block text-[10px] font-semibold text-foreground [text-shadow:0_1px_3px_#000]">
              {p.name}
              {p.humidityPct !== null && (
                <span className="font-medium text-muted-foreground">
                  {" "}
                  {p.humidityPct}%
                </span>
              )}
            </span>
          </div>
        ) : (
          <div
            key={p.id}
            className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-md border border-sky-800 bg-sky-950/80 px-1.5 py-0.5 text-[9px] font-semibold text-sky-200"
            style={{ left: `${p.x}%`, top: `${p.y}%` }}
          >
            {p.name}
          </div>
        ),
      )}
    </div>
  );
}
