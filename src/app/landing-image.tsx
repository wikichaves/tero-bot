"use client";

import { Maximize2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Lightbox wrapper para las imágenes de la landing (WIK-137).
 *
 * Renderiza un `<picture>` clickable con avif/webp/jpg fallbacks. Al
 * hacer click se abre un Dialog (shadcn / base-ui) con la imagen en
 * tamaño grande (hasta 95vw × 85vh) y la `alt` como caption pequeño
 * debajo.
 *
 * El Dialog ya tiene close button (X), ESC keyboard support, y
 * click-outside built-in via base-ui. No hace falta state local.
 *
 * Decision deliberada: usamos el MISMO `<picture>` con sus tres
 * sources tanto en el thumbnail como en el lightbox view. El browser
 * elige el mismo asset óptimo en ambos contextos — no se vuelve a
 * descargar la imagen al abrir el lightbox.
 */
export function LandingImage({
  photoBase,
  alt,
  loading = "lazy",
  className,
  wrapperClassName,
  /** Caption opcional para mostrar en el lightbox (debajo de la
   *  imagen). Si no se pasa, se usa el `alt`. */
  caption,
}: {
  /** Path sin extensión — agregamos `.avif`, `.webp`, `.jpg` al srcSet. */
  photoBase: string;
  alt: string;
  loading?: "eager" | "lazy";
  /** Class extra para el `<img>` del thumbnail. */
  className?: string;
  /** Class extra para el `<button>` wrapper del trigger (controla
   *  layout: aspect ratio, rounded corners, etc.). */
  wrapperClassName?: string;
  caption?: string;
}) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <button
            type="button"
            aria-label={`Ampliar imagen: ${alt}`}
            className={cn(
              "group relative block cursor-zoom-in overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              wrapperClassName,
            )}
          />
        }
      >
        <picture>
          <source srcSet={`${photoBase}.avif`} type="image/avif" />
          <source srcSet={`${photoBase}.webp`} type="image/webp" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${photoBase}.jpg`}
            alt={alt}
            className={cn(
              "transition-transform duration-500 ease-out group-hover:scale-[1.02]",
              className,
            )}
            loading={loading}
          />
        </picture>
        {/* Zoom icon en hover — bottom-right corner, muy discreto.
            Comunica "click para ampliar" sin invadir la imagen. */}
        <span
          aria-hidden
          className="pointer-events-none absolute right-3 bottom-3 flex h-8 w-8 items-center justify-center rounded-full bg-background/80 text-foreground opacity-0 backdrop-blur-md transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100"
        >
          <Maximize2 className="h-4 w-4" />
        </span>
      </DialogTrigger>
      <DialogContent
        // WIK-137: lightbox-grade sizing. Sobreescribe el max-w-md
        // default del Dialog primitive y deja la imagen llenar casi
        // todo el viewport. Padding mínimo para que la imagen sea la
        // protagonista. `bg-popover/95` + backdrop-blur (vía overlay)
        // da el feel "lightbox" sin reaccionar el resto del page.
        className="!w-auto !max-w-[95vw] gap-2 border-border/40 bg-popover/95 p-2 sm:!max-w-7xl sm:p-3"
      >
        <picture>
          <source srcSet={`${photoBase}.avif`} type="image/avif" />
          <source srcSet={`${photoBase}.webp`} type="image/webp" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${photoBase}.jpg`}
            alt={alt}
            // object-contain + max-h-[85vh] preserva aspect ratio y
            // evita overflow vertical en pantallas low-height.
            className="max-h-[85vh] w-full rounded-lg object-contain"
            loading="eager"
          />
        </picture>
        <p className="px-2 pt-1 pb-2 text-center text-xs text-muted-foreground sm:text-sm">
          {caption ?? alt}
        </p>
      </DialogContent>
    </Dialog>
  );
}
