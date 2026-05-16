import type { MetadataRoute } from "next";

/**
 * Manifest PWA (WIK-92). Cuando el usuario "Add to Home Screen" en iOS
 * o Android, el browser usa esto para:
 *   - El nombre y el icon de la app instalada.
 *   - El splash screen al abrir (background_color).
 *   - El color de la status bar (theme_color).
 *
 * Ambos colores hardcoded a #000000 para que el splash y la status bar
 * matcheen el fondo del icon (todo negro) — sin flash blanco al abrir.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tero Admin",
    short_name: "Tero",
    description: "Panel de administración Acme Rentals.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#000000",
    orientation: "portrait",
    icons: [
      // Solo `any` por ahora. El intento previo con `maskable` hizo que
      // Android Material You aplicara themed icons (bg blanco con bird
      // mint en launchers con light theme). Volviendo a `any` el PNG
      // se sirve "as-is" — el container que aplique el launcher es
      // legacy / no-themed.
      //
      // Trade-off: en algunos launchers el icon va a aparecer dentro
      // de un círculo blanco (legacy container). Para evitar ese círculo
      // y mantener BG negro, el user puede deshabilitar "Themed icons"
      // en la configuración del launcher (Pixel Launcher → long-press
      // home → Wallpaper & Style → Themed icons OFF).
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
