"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

/**
 * Toggle directo claro/oscuro (WIK-111). Antes era un dropdown con 3
 * opciones (claro / oscuro / sistema); ahora un solo icono que alterna
 * entre los dos modos con un click.
 *
 * Comportamiento:
 *   - Primer render (SSR) muestra Sun por convención — `resolvedTheme`
 *     no está disponible hasta después de mount, evita hydration mismatch
 *   - Después de mount: Sun si tema resuelto es light, Moon si dark
 *   - Click: alterna entre "light" y "dark" (sale del modo "system"
 *     explícitamente hacia el opuesto del actual)
 *
 * El modo "sistema" lo saqué — agregaba complejidad para una opción
 * que casi nadie usa. Si querés seguir al OS, configurás el browser/OS.
 *
 * Detección de "ya hidraté" via `useSyncExternalStore` con snapshots
 * server=false / client=true. El pattern previo (`useEffect(setMounted)`)
 * disparaba la regla `react-hooks/set-state-in-effect` de React 19 por
 * generar un cascading render.
 */
const subscribe = () => () => {};
const getServerSnapshot = () => false;
const getClientSnapshot = () => true;

export function ModeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    subscribe,
    getClientSnapshot,
    getServerSnapshot,
  );

  function toggle() {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  }

  const isDark = mounted && resolvedTheme === "dark";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={isDark ? "Cambiar a claro" : "Cambiar a oscuro"}
      title={isDark ? "Cambiar a claro" : "Cambiar a oscuro"}
      onClick={toggle}
    >
      {isDark ? (
        <Moon className="h-[1.2rem] w-[1.2rem]" />
      ) : (
        <Sun className="h-[1.2rem] w-[1.2rem]" />
      )}
      <span className="sr-only">Cambiar tema</span>
    </Button>
  );
}
