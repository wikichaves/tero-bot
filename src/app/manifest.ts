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
      // `maskable` le dice a Android/Chrome que pueden usar el frame
      // completo del PNG sin agregar un container blanco. Requiere que
      // el contenido esté dentro del 80% central (safe zone) — nuestro
      // bird tiene padding negro suficiente para eso.
      {
        src: "/icon.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      // Duplicate entry con purpose=any para browsers/launchers que NO
      // soportan maskable (iOS Safari ignora maskable). En ese caso
      // usan este de fallback. El PNG es el mismo archivo.
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
