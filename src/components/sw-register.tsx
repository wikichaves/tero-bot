"use client";

import { useEffect } from "react";
import { toast } from "sonner";

/**
 * Registra el service worker (WIK-92) + detecta nuevas versiones (WIK-324).
 *
 * Sin SW, Chrome trata la app como un site cualquiera y al "Add to Home
 * Screen" crea un *shortcut*. Con SW + manifest + icon 192+, Chrome la
 * detecta como PWA installable.
 *
 * WIK-324 — aviso de actualización:
 * El SW hace `skipWaiting()` + `clients.claim()`, así que un SW nuevo toma
 * control apenas se descarga. Pero una PWA instalada que queda abierta horas
 * NO recarga sola tras un deploy → la pestaña sigue con el JS viejo hasta un
 * refresh manual (riesgo de mismatch de build: RSC/action IDs viejos contra
 * server nuevo). Acá:
 *   1. Chequeamos updates al montar y cada 30 min (y al volver a foco).
 *   2. Cuando entra un SW nuevo y ya había uno controlando la página,
 *      mostramos un toast "Nueva versión — Recargar" (acción manual: no
 *      forzamos reload para no interrumpir al usuario a mitad de algo).
 *
 * El registro es no-op en SSR y silencia errores en browsers sin soporte.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    let reg: ServiceWorkerRegistration | null = null;
    let refreshing = false;
    let updateInterval: number | undefined;

    // Pasamos la VAPID key como query para que el SW pueda re-suscribir en
    // `pushsubscriptionchange` (WIK-324). Sin key el handler es no-op.
    const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
    const swUrl = vapid
      ? `/sw.js?vapid=${encodeURIComponent(vapid)}`
      : "/sw.js";

    function promptReload() {
      toast("Nueva versión disponible", {
        description: "Recargá para usar la última versión.",
        duration: Infinity,
        action: {
          label: "Recargar",
          onClick: () => window.location.reload(),
        },
      });
    }

    function watchInstalling(registration: ServiceWorkerRegistration) {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        // "installed" + ya hay un controller = es una ACTUALIZACIÓN
        // (no la primera instalación). Ahí avisamos.
        if (
          installing.state === "installed" &&
          navigator.serviceWorker.controller
        ) {
          promptReload();
        }
      });
    }

    const id = window.setTimeout(() => {
      navigator.serviceWorker
        .register(swUrl, { scope: "/" })
        .then((registration) => {
          reg = registration;

          // Si ya hay un SW esperando al registrar (update descargado
          // mientras la app estaba cerrada), avisamos de una.
          if (registration.waiting && navigator.serviceWorker.controller) {
            promptReload();
          }

          // Nuevos updates que empiecen a instalarse mientras la app corre.
          registration.addEventListener("updatefound", () =>
            watchInstalling(registration),
          );

          // Chequeo periódico (cada 30 min) + al volver a foco.
          updateInterval = window.setInterval(
            () => registration.update().catch(() => {}),
            30 * 60 * 1000,
          );
        })
        .catch((err) => {
          console.warn("[sw] register failed:", err);
        });
    }, 0);

    // Cuando el SW nuevo toma control (tras skipWaiting), recargamos una
    // sola vez para evitar servir una mezcla de builds. Solo si el usuario
    // ya aceptó el reload (controllerchange dispara tras su click) o si el
    // browser cambió el controller por su cuenta.
    const onControllerChange = () => {
      if (refreshing) return;
      refreshing = true;
      // No forzamos: el toast ya ofrece el reload manual. Este guard evita
      // loops si en el futuro se agrega reload automático.
    };
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      onControllerChange,
    );

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        reg?.update().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearTimeout(id);
      if (updateInterval) window.clearInterval(updateInterval);
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange,
      );
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
