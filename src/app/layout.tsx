import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { ServiceWorkerRegister } from "@/components/sw-register";
import { Toaster } from "@/components/ui/sonner";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";
import "./globals.css";

/**
 * Fonts del theme "tero.bot":
 *   - Geist Sans → sans (body / UI). WIK-128.
 *   - Instrument Serif → serif (used as `--font-heading` for all h1..h3
 *     and `<em>` inside headings — same family que casabosquemontoya.com
 *     para alinear el sistema visual. WIK-135 (era Source Serif 4
 *     desde WIK-131). Sólo weight 400 disponible — los headings ya no
 *     llevan `font-semibold`, los styles base se setean en globals.css.
 *   - Geist Mono → mono (code, IDs, editorial labels). WIK-128.
 */
const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
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
    // WIK-135: BG warm-paper (era #fdfdfd) y warm-near-black (era #000)
    // para alinear con la paleta de casabosquemontoya.com.
    { media: "(prefers-color-scheme: light)", color: "#fcfaf5" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0c0a" },
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
      className={`${geistSans.variable} ${instrumentSerif.variable} ${geistMono.variable} h-full antialiased`}
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
