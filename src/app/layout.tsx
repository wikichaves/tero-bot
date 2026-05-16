import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Lora, IBM_Plex_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

/**
 * Fonts del theme "Tero Admin" (WIK-84):
 *   - Plus Jakarta Sans → sans (text/UI)
 *   - Lora → serif (display opcional)
 *   - IBM Plex Mono → mono (code, IDs)
 */
const jakartaSans = Plus_Jakarta_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const lora = Lora({
  variable: "--font-serif",
  subsets: ["latin"],
  display: "swap",
});

const ibmMono = IBM_Plex_Mono({
  variable: "--font-mono",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Tero Admin",
  description: "Panel de administración.",
  appleWebApp: {
    capable: true,
    title: "Tero Admin",
    statusBarStyle: "black-translucent",
  },
  // iOS PWA splash: usa el apple-touch-icon + background del manifest.
  // El theme-color de viewport (abajo) controla el chrome del browser.
  manifest: "/manifest.webmanifest",
};

/**
 * Viewport con themeColor hardcoded a negro (WIK-92). Esto evita el
 * flash blanco cuando se abre la PWA en iOS / cuando un browser carga
 * la página por primera vez (mobile chrome / safari toolbar).
 *
 * También se aplica a status bar en Android / mobile browsers.
 */
export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning is required by next-themes — the provider
    // adds the `dark` class on the client to match system preference, and
    // we don't want React to warn about the resulting class mismatch.
    <html
      lang="es"
      className={`${jakartaSans.variable} ${lora.variable} ${ibmMono.variable} h-full antialiased`}
      // WIK-92: forzamos el <html> con BG negro hardcodeado para que
      // el splash de PWA y el primer paint no muestren flash blanco.
      // Una vez que next-themes hidrata, la clase `dark` (o light)
      // toma el control y bg-background del CSS theme actúa normal.
      style={{ backgroundColor: "#000000" }}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
