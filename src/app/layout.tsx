import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Source_Serif_4 } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { ThemeProvider } from "@/components/theme-provider";
import { ServiceWorkerRegister } from "@/components/sw-register";
import { SiteFooter } from "@/components/site-footer";
import { Toaster } from "@/components/ui/sonner";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";
import "./globals.css";

/**
 * Fonts del theme "tero.bot":
 *   - Geist Sans → sans (body / UI). WIK-128.
 *   - Source Serif 4 → serif (used as `--font-heading` for all h1..h3
 *     and `<em>` inside headings). Vuelvo a esta fuente (WIK-165) tras
 *     probar Instrument Serif en WIK-135 — Instrument tiene x-height
 *     muy bajo y se veía chica al lado del sans. Source Serif 4 tiene
 *     mejor proporción óptica y multiple weights (acá uso 400 + 600
 *     para que los headings tengan algo de peso sin recurrir al italic
 *     synth). Aligned con wikichaves.com.
 *   - Geist Mono → mono (code, IDs, editorial labels). WIK-128.
 */
const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const sourceSerif = Source_Serif_4({
  variable: "--font-serif",
  subsets: ["latin"],
  // 300 (light) para los headings del landing — más editorial,
  // delicado. 400 (normal) para headings del admin app — más
  // legible a tamaños chicos. 600 (semibold) queda disponible
  // por si algún heading necesita más peso puntualmente.
  weight: ["300", "400", "600"],
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
    // para alinear con la paleta editorial del theme.
    { media: "(prefers-color-scheme: light)", color: "#fcfaf5" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0c0a" },
  ],
  colorScheme: "dark light",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // WIK-151: next-intl SSR setup. `getLocale()` resuelve via el
  // `getRequestConfig` que armamos (cookie → profile → Accept-Language).
  // `getMessages()` carga el dictionary correspondiente. Ambos se pasan
  // a `NextIntlClientProvider` para que `useTranslations` ande en client.
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    // suppressHydrationWarning is required by next-themes — the provider
    // adds the `dark` class on the client to match system preference, and
    // we don't want React to warn about the resulting class mismatch.
    <html
      lang={locale}
      className={`${geistSans.variable} ${sourceSerif.variable} ${geistMono.variable} h-full antialiased`}
      // WIK-92: el BG inicial del <html> lo maneja globals.css via
      // `prefers-color-scheme` CSS media query — sin inline style.
      // Light OS → white-ish, Dark OS → black, antes que next-themes
      // hidrate. Cuando hidrata, la clase `dark` toma over y los
      // children usan `bg-background` del theme.
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            {children}
            {/* WIK-151: footer global con ModeToggle + LanguageSelector.
                Reemplaza el footer que vivía dentro del landing y agrega
                el mismo a las pages logged-in. */}
            <SiteFooter />
            <Toaster />
            <ServiceWorkerRegister />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
