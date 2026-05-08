"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

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
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
