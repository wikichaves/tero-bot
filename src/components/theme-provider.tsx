"use client";

import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { useEffect, type ComponentProps } from "react";

function ThemeShortcut() {
  const { resolvedTheme, setTheme } = useTheme();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "KeyL" || !event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey || event.repeat || event.isComposing) return;
      event.preventDefault();
      setTheme(resolvedTheme === "dark" ? "light" : "dark");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [resolvedTheme, setTheme]);
  return null;
}

/**
 * Thin wrapper around `next-themes`. Lives in a client component so the
 * server-rendered RootLayout can stay async/streaming. Toggles between
 * `light`, `dark`, and `system` (which follows OS preference) by adding/
 * removing the `dark` class on the <html> element.
 */
export function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}><ThemeShortcut />{children}</NextThemesProvider>;
}
