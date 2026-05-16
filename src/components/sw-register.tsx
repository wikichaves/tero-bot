"use client";

import { useEffect } from "react";

/**
 * Registra el service worker (WIK-92).
 *
 * Sin SW, Chrome trata la app como un site cualquiera y al "Add to
 * Home Screen" crea un *shortcut* (icon decorado con container
 * blanco del launcher). Con SW + manifest + icon 192+, Chrome la
 * detecta como PWA installable y ofrece "Install app" → el icon va
 * sin container.
 *
 * El registro es `no-op` en SSR (no hay `navigator`) y silencia
 * errores en browsers sin soporte. El SW vive en `/sw.js`.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    // Registrar en el next tick para no competir con el first paint.
    const id = window.setTimeout(() => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch((err) => {
          // No es crítico — el resto de la app funciona sin SW.
          console.warn("[sw] register failed:", err);
        });
    }, 0);

    return () => window.clearTimeout(id);
  }, []);

  return null;
}
