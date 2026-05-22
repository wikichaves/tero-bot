import type { MetadataRoute } from "next";
import { APP_NAME, OPERATOR_NAME } from "@/lib/brand";

/**
 * Manifest PWA (WIK-92). Cuando el usuario "Add to Home Screen" en iOS
 * o Android, el browser usa esto para:
 *   - El nombre y el icon de la app instalada.
 *   - El splash screen al abrir (background_color).
 *   - El color de la status bar (theme_color).
 *
 * Ambos colores hardcoded a #000000 para que el splash y la status bar
 * matcheen el fondo del icon (todo negro) — sin flash blanco al abrir.
 *
 * WIK-126: name + description now pull operator branding from env.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: "Tero",
    description: `${APP_NAME} — panel de administración para ${OPERATOR_NAME}.`,
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#000000",
    orientation: "portrait",
    icons: [
      // Chrome exige al menos un icon de 192×192 (criterio de PWA
      // installability). Sin esto, Chrome ofrece "Add to Home Screen"
      // (shortcut → icon decorado con container del launcher) en
      // vez de "Install app" (PWA real → icon as-is, BG negro).
      //
      // Ambas entries con `purpose: "any"` — `maskable` triggerea el
      // themed-icon path de Android Material You (bg blanco con bird
      // mint en launchers con light theme). Volviendo a `any` el PNG
      // se sirve "as-is".
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/apple-icon.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
