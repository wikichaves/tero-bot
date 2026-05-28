/**
 * Service worker mínimo (WIK-92).
 *
 * No hace caching ni offline — sólo network passthrough. Su único
 * propósito es satisfacer el criterio de PWA installability de Chrome
 * (manifest + service worker + icon 192+).
 *
 * Con esto el browser ofrece "Install app" en vez de "Add to Home
 * Screen" (shortcut), y el icon se renderiza sin el container
 * decorativo del launcher (círculo blanco/themed).
 */

self.addEventListener("install", () => {
  // Activar el SW inmediatamente en la primera install — sin esperar
  // a que se cierren todas las tabs viejas.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Tomar control de todas las páginas abiertas al activar.
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Network-only passthrough. Sin caching: cualquier offline strategy
  // tendría que ser muy cuidadosa con los server actions / auth /
  // Tuya/Kapso calls, y no nos interesa offline support en este admin.
  return;
});
