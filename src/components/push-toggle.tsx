"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * Toggle de notificaciones push de la PWA (WIK-311). Vive dentro de "Mi
 * perfil". Opt-in: el usuario habilita las push por dispositivo/navegador.
 *
 * Flujo de habilitación:
 *   1. Pide permiso de notificaciones al browser.
 *   2. `pushManager.subscribe()` con la VAPID public key.
 *   3. POST /api/push/subscribe para persistir la suscripción.
 *
 * Deshabilitar hace el camino inverso (unsubscribe + DELETE). El estado se
 * deriva en mount de la suscripción real del SW, así que es consistente
 * aunque el usuario haya habilitado en otro momento.
 *
 * Notas de soporte:
 *   - iOS: sólo funciona con la PWA instalada (Add to Home Screen) en
 *     iOS 16.4+. En Safari de escritorio/web no.
 *   - Si falta NEXT_PUBLIC_VAPID_PUBLIC_KEY, mostramos un aviso (el server
 *     no está configurado para push todavía).
 */

// WIK-313: `.trim()` defensivo. Un artefacto de pegado muy común al cargar
// la env var en Vercel es un espacio o salto de línea al final del valor.
// Sin esto, `urlBase64ToUint8Array` decodifica un largo incorrecto y el
// browser rechaza con "applicationServerKey is not valid".
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();

/** Convierte la VAPID public key (base64url) al Uint8Array que pide el browser. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

type Status = "loading" | "unsupported" | "off" | "on";

export function PushToggle() {
  const [status, setStatus] = useState<Status>("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      const supported =
        typeof window !== "undefined" &&
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window;
      if (!supported || !VAPID_PUBLIC_KEY) {
        if (!cancelled) setStatus("unsupported");
        return;
      }
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!cancelled) setStatus(sub ? "on" : "off");
      } catch {
        if (!cancelled) setStatus("off");
      }
    }
    init();
    return () => {
      cancelled = true;
    };
  }, []);

  async function enable() {
    if (!VAPID_PUBLIC_KEY) return;
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        toast.error("Permiso de notificaciones denegado.");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        // Cast a BufferSource: el Uint8Array que devolvemos es válido, pero
        // el tipo genérico (ArrayBufferLike) confunde a TS con SharedArrayBuffer.
        applicationServerKey: urlBase64ToUint8Array(
          VAPID_PUBLIC_KEY,
        ) as BufferSource,
      });
      const json = sub.toJSON();
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: json.keys,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setStatus("on");
      toast.success("Notificaciones push activadas.");
    } catch (e) {
      toast.error(`No se pudieron activar: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setStatus("off");
      toast.success("Notificaciones push desactivadas.");
    } catch (e) {
      toast.error(`No se pudieron desactivar: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (data.ok) toast.success("Push de prueba enviada.");
      else toast.error(data.error ?? "No se pudo enviar la prueba.");
    } catch (e) {
      toast.error(`Error al probar: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Notificaciones push</p>
          <p className="text-xs text-muted-foreground">
            Alarmas de sensores, cortes de luz y avisos de pre-checkin en este
            dispositivo.
          </p>
        </div>
        {status === "loading" && (
          <span className="text-xs text-muted-foreground">…</span>
        )}
        {status === "unsupported" && (
          <span className="text-xs text-muted-foreground">No disponible</span>
        )}
        {status === "off" && (
          <Button
            type="button"
            size="sm"
            onClick={enable}
            disabled={busy}
          >
            Activar
          </Button>
        )}
        {status === "on" && (
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={test}
              disabled={busy}
            >
              Probar
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={disable}
              disabled={busy}
            >
              Desactivar
            </Button>
          </div>
        )}
      </div>
      {status === "unsupported" && (
        <p className="mt-2 text-xs text-muted-foreground">
          Tu navegador no soporta push, o la app no está instalada. En iOS,
          agregá tero.bot a la pantalla de inicio primero.
        </p>
      )}
    </div>
  );
}
