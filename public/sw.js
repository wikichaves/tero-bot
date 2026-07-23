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

// ── Web Push (WIK-311) ──────────────────────────────────────────────
// El server (lib/push) cifra y manda un payload JSON
// { title, body, url?, tag? }. Lo mostramos como notificación nativa.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // Payload no-JSON (raro) — lo tratamos como cuerpo de texto plano.
    data = { body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "tero.bot";
  const options = {
    body: data.body || "",
    // `icon`: imagen grande a color (a la derecha de la notificación).
    icon: "/icon-192.png",
    // `badge`: icono chico de la barra de estado (Android). DEBE ser una
    // silueta monocroma sobre transparente — Android usa solo el canal alfa
    // y lo pinta blanco. Antes apuntaba a `/icon-192.png` (opaco) → se veía
    // como un cuadrado blanco. `notification-badge.png` es la silueta del
    // pájaro de tero.bot.
    badge: "/notification-badge.png",
    // `tag` colapsa notificaciones del mismo tipo (ej. la misma alarma)
    // en vez de apilar duplicados.
    tag: data.tag || undefined,
    data: { url: data.url || "/dashboard" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url =
    (event.notification.data && event.notification.data.url) || "/dashboard";

  // Re-enfocar una ventana ya abierta de la app si existe; sino abrir una
  // nueva. Navega a la URL del payload (ej. /rooms para una alarma).
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) {
            client.navigate(url);
            return client.focus();
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(url);
      }),
  );
});
