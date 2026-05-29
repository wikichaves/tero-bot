import type { MetadataRoute } from "next";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";

/**
 * Manifest PWA (WIK-92). Cuando el usuario "Add to Home Screen" en iOS
 * o Android, el browser usa esto para:
 *   - El nombre y el icon de la app instalada.
 *   - El splash screen al abrir (background_color).
 *   - El color de la status bar (theme_color).
 *
 * theme_color hardcoded a #000000 (status bar negra). background_color
 * en #1C4239 (mint oscuro) para el splash screen.
 *
 * WIK-131: collapsed product/operator branding into single APP_NAME.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    // `id` estable (WIK-240): identifica la PWA de forma única e
    // independiente del start_url. Sin esto el browser deriva el id del
    // start_url y un cambio futuro de start_url crearía una "app nueva"
    // (duplicado en el launcher). Pinearlo evita ese riesgo.
    id: "/dashboard",
    name: APP_NAME,
    short_name: APP_NAME,
    description: `${APP_NAME} — ${APP_TAGLINE}.`,
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#1C4239",
    theme_color: "#000000",
    orientation: "portrait",
    // WIK-240: re-enfocar la ventana ya abierta en vez de abrir una nueva
    // (desktop/Mac). Se siente más nativo — clickear el icono trae al
    // frente la instancia existente.
    launch_handler: { client_mode: "navigate-existing" },
    icons: [
      // ── `any`: el PNG "natural" (squircle con esquinas redondeadas).
      //    Lo usa el browser para la tab y contextos no-enmascarados.
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
      // ── `maskable` (WIK-240): full-bleed (#1C4239 edge-to-edge, bird en
      //    la safe-zone interior). Android/ChromeOS/Mac rellenan toda la
      //    forma del adaptive-icon con verde → SIN el anillo blanco que
      //    producía el squircle transparente con `purpose:any`. Separados
      //    de los `any` a propósito: el maskable tiene más padding y se
      //    vería "alejado" en contextos no-enmascarados.
      {
        src: "/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    // Quick actions al hacer long-press del icono (Android) / right-click
    // (desktop). Atajos a las secciones más usadas — muy native-feeling.
    shortcuts: [
      {
        name: "Tareas",
        url: "/tasks",
        icons: [{ src: "/icon-maskable-192.png", sizes: "192x192" }],
      },
      {
        name: "Energía",
        url: "/energy",
        icons: [{ src: "/icon-maskable-192.png", sizes: "192x192" }],
      },
      {
        name: "Ambientes",
        url: "/rooms",
        icons: [{ src: "/icon-maskable-192.png", sizes: "192x192" }],
      },
    ],
  };
}
