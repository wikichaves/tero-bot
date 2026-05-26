import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
 *   - Times New Roman → serif (system font, used as `--font-heading`
 *     for all h1..h3 and `<em>` inside headings). Definido directamente
 *     en globals.css ya que es font de sistema.
 *   - Geist Mono → mono (code, IDs, editorial labels). WIK-128.
 */
const geistSans = Geist({
  variable: "--font-sans",
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
    // WIK-196: dark gray neutro (era warm-near-black #0d0c0a) para dark mode.
    // Light mode mantiene el warm-paper. El default del browser/PWA chrome
    // sigue al OS hasta que el usuario elija manualmente — defaultTheme=dark
    // solo afecta la app shell post-hidratación.
    { media: "(prefers-color-scheme: light)", color: "#fcfaf5" },
    { media: "(prefers-color-scheme: dark)", color: "#262626" },
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // WIK-92: el BG inicial del <html> lo maneja globals.css via
      // `prefers-color-scheme` CSS media query — sin inline style.
      // Light OS → white-ish, Dark OS → black, antes que next-themes
      // hidrate. Cuando hidrata, la clase `dark` toma over y los
      // children usan `bg-background` del theme.
      suppressHydrationWarning
    >
      <body className="isolate min-h-full flex flex-col bg-background text-foreground">
        {/* WIK-192: global film-grain texture. Fixed, full viewport,
            pointer-events-none, low opacity — every page (dashboard,
            admin, login, landing) picks up the same subtle tactile
            grain so the UI escapes the flat-shadcn look. `isolate` on
            body creates the stacking context that lets `-z-10` sit
            above body's bg but below all child content. Landing layers
            an additional gradient + stronger noise on top of this for
            its hero treatment. */}
        {/* WIK-199/200: paper grain (light) / obsidian patina (dark).
            Misma SVG con `feTurbulence fractalNoise` para ambos themes —
            irregular orgánico, sin grid visible. Subimos tile size de
            240px → 480px para borrar los seams que en monitores grandes
            se notaban como repetición. Opacity light bajada a 0.05 para
            paper grain sutil; dark a 0.08 para que la patina apenas
            quiebre el flat black sin distraer. */}
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 -z-10 opacity-[0.05] dark:opacity-[0.08]"
          style={{
            backgroundImage: "url(/landing/noise.svg)",
            backgroundSize: "480px",
          }}
        />
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider
            attribute="class"
            defaultTheme="dark"
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
