"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";

/**
 * Suscripción al display-mode vía `useSyncExternalStore` — la forma
 * idiomática de leer un valor "externo" (matchMedia) sin set-state en un
 * effect. En SSR devolvemos `false` (no sabemos el display-mode en el
 * server); hidrata al valor real en el cliente.
 */
const STANDALONE_QUERY = "(display-mode: standalone)";

function subscribeStandalone(onChange: () => void) {
  const mql = window.matchMedia(STANDALONE_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function getStandaloneSnapshot() {
  return (
    window.matchMedia(STANDALONE_QUERY).matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone ===
      true
  );
}

function getStandaloneServerSnapshot() {
  return false;
}

/**
 * Pull-to-refresh para la PWA instalada (WIK-247).
 *
 * Contexto: WIK-240 puso `overscroll-behavior: none` en `display-mode:
 * standalone` para sacar el rubber-band/pull-to-refresh nativo y que la
 * app shell se sienta nativa. El efecto colateral es que en la PWA
 * instalada NO queda ninguna forma de refrescar con un gesto. Este
 * componente reimplementa el gesto SOLO en standalone (en el browser
 * normal el pull-to-refresh nativo sigue andando, así que no lo tocamos).
 *
 * Cómo funciona:
 *   - Escucha touch globalmente. El gesto solo arranca con la página en
 *     el tope (`window.scrollY === 0`) y arrastrando hacia abajo.
 *   - Aplica resistencia al arrastre y muestra un spinner que baja desde
 *     arriba (debajo del safe-area-inset-top).
 *   - Al soltar pasado el umbral, dispara `router.refresh()` (re-fetch de
 *     los RSC) dentro de un transition para saber cuándo terminó.
 *
 * Montado una sola vez en `SiteHeader` → cubre todas las páginas
 * logged-in y ninguna del landing.
 */

const THRESHOLD = 70; // px de pull (post-resistencia) para disparar el refresh
const MAX_PULL = 110; // tope visual del arrastre
const RESISTANCE = 0.5; // factor de amortiguación (el dedo viaja 2x el spinner)

export function PullToRefresh() {
  const router = useRouter();
  const t = useTranslations("pullToRefresh");

  // Solo activo en la PWA instalada (standalone). En el browser normal el
  // pull-to-refresh nativo sigue andando, así que acá no hacemos nada.
  const enabled = useSyncExternalStore(
    subscribeStandalone,
    getStandaloneSnapshot,
    getStandaloneServerSnapshot,
  );

  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [animating, setAnimating] = useState(false); // CSS transition on/off
  const [isPending, startTransition] = useTransition();

  // Estado del gesto en refs (no dispara re-render por cada touchmove).
  const startY = useRef(0);
  const tracking = useRef(false);
  const pullRef = useRef(0);

  const reset = useCallback(() => {
    setAnimating(true);
    pullRef.current = 0;
    setPull(0);
  }, []);

  // 2) Refresh: snap del spinner al umbral, refetch de RSC vía transition.
  const doRefresh = useCallback(() => {
    setRefreshing(true);
    setAnimating(true);
    pullRef.current = THRESHOLD;
    setPull(THRESHOLD);
    startTransition(() => {
      router.refresh();
    });
  }, [router]);

  // 3) Cuando el transition del refresh termina (isPending → false), dejar
  //    girar un toque y resetear. Safety timeout por si algo cuelga.
  useEffect(() => {
    if (!refreshing) return;
    if (isPending) return;
    const done = setTimeout(() => {
      setRefreshing(false);
      reset();
    }, 300);
    return () => clearTimeout(done);
  }, [refreshing, isPending, reset]);

  // 4) Listeners de touch. `touchmove` es non-passive para poder
  //    preventDefault mientras arrastramos (y no scrollear el contenido).
  useEffect(() => {
    if (!enabled) return;

    function onTouchStart(e: TouchEvent) {
      if (refreshing) return;
      if (window.scrollY > 0) return; // solo desde el tope absoluto
      if (e.touches.length !== 1) return;
      startY.current = e.touches[0].clientY;
      tracking.current = true;
    }

    function onTouchMove(e: TouchEvent) {
      if (!tracking.current || refreshing) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0) {
        // Empujó hacia arriba antes de arrastrar → no es nuestro gesto.
        if (pullRef.current === 0) tracking.current = false;
        return;
      }
      const damped = Math.min(MAX_PULL, dy * RESISTANCE);
      pullRef.current = damped;
      setAnimating(false); // seguir el dedo sin transition
      setPull(damped);
      if (e.cancelable) e.preventDefault(); // bloquear overscroll nativo
    }

    function onTouchEnd() {
      if (!tracking.current) return;
      tracking.current = false;
      if (pullRef.current >= THRESHOLD) {
        doRefresh();
      } else if (pullRef.current > 0) {
        reset();
      }
    }

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [enabled, refreshing, doRefresh, reset]);

  if (!enabled) return null;

  const progress = Math.min(1, pull / THRESHOLD);
  const ready = pull >= THRESHOLD;
  const label = refreshing
    ? t("refreshing")
    : ready
      ? t("release")
      : t("pull");

  return (
    <div
      aria-hidden={pull === 0 && !refreshing}
      className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center"
      style={{
        transform: `translateY(${pull}px)`,
        transition: animating ? "transform 250ms ease-out" : "none",
        paddingTop: "calc(env(safe-area-inset-top, 0px) + 8px)",
      }}
    >
      {/* `-mt-12` esconde el círculo por encima del viewport en pull=0;
          el translateY del padre lo baja a medida que se arrastra. */}
      <div
        className="-mt-12 flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-background/90 shadow-sm backdrop-blur"
        style={{ opacity: refreshing ? 1 : progress }}
        role="status"
        aria-label={label}
      >
        <RefreshCw
          className={`h-4 w-4 text-foreground ${refreshing ? "animate-spin" : ""}`}
          style={
            refreshing
              ? undefined
              : {
                  transform: `rotate(${progress * 270}deg)`,
                  opacity: ready ? 1 : 0.6,
                }
          }
          aria-hidden
        />
      </div>
    </div>
  );
}
