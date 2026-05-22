import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Source_Serif_4 } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { ServiceWorkerRegister } from "@/components/sw-register";
import { Toaster } from "@/components/ui/sonner";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";
import "./globals.css";

/**
 * Fonts del theme "tero.bot":
 *   - Geist Sans → sans (body / UI). WIK-128.
 *   - Source Serif 4 → serif (used as `--font-heading` for all h1..h3
 *     and any `font-heading` utility — pulls the project closer to the
 *     editorial / portfolio aesthetic). Was Lora pre-WIK-131.
 *   - Geist Mono → mono (code, IDs). WIK-128.
 */
const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const sourceSerif = Source_Serif_4({
  variable: "--font-serif",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_TAGLINE,
  appleWebApp: {
    capable: true,
    title: APP_NAME,
    statusBarStyle: "black-translucent",
  },
  // iOS PWA splash: usa el apple-touch-icon + background del manifest.
  // El theme-color de viewport (abajo) controla el chrome del browser.
  manifest: "/manifest.webmanifest",
};

/**
 * Viewport (WIK-92): themeColor dinámico según prefers-color-scheme.
 *
 * - Light mode: matchea el background del theme light (rgb 253,253,253
 *   = near-white). Status bar + chrome del browser quedan claros con
 *   texto oscuro.
 * - Dark mode: negro puro #000000. Status bar oscura con texto blanco.
 *
 * El splash de PWA (manifest.background_color) sí queda HARDCODED a
 * negro — ese se elige por la composición visual del icon (bird mint
 * sobre fondo negro). El fade icon→splash queda smooth solo si splash
 * también es negro.
 */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fdfdfd" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
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
      className={`${geistSans.variable} ${sourceSerif.variable} ${geistMono.variable} h-full antialiased`}
      // WIK-92: el BG inicial del <html> lo maneja globals.css via
      // `prefers-color-scheme` CSS media query — sin inline style.
      // Light OS → white-ish, Dark OS → black, antes que next-themes
      // hidrate. Cuando hidrata, la clase `dark` toma over y los
      // children usan `bg-background` del theme.
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
          <ServiceWorkerRegister />
        </ThemeProvider>
      </body>
    </html>
  );
}
