import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { Analytics } from "@vercel/analytics/next";
import { ThemeProvider } from "@/components/theme-provider";
import { ServiceWorkerRegister } from "@/components/sw-register";
import { SiteFooter } from "@/components/site-footer";
import { Toaster } from "@/components/ui/sonner";
import { APP_NAME, APP_TAGLINE, APP_URL } from "@/lib/brand";
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

/**
 * WIK-205: social share metadata (Open Graph + Twitter Card).
 *
 * Cubre los previews al pegar la URL en Twitter/X, LinkedIn, WhatsApp,
 * Slack, Telegram, Discord, iMessage, etc. — todos usan OG con algún
 * fallback a Twitter card.
 *
 * `metadataBase` es necesaria para que Next resuelva las URLs relativas
 * de `images` a absolutas (los scrapers de FB/Twitter no entienden
 * relativas). Sale de `APP_URL` para que dev (localhost) y producción
 * resuelvan al host correcto.
 *
 * La imagen `/og-image.jpg` es un crop 1200x630 de Tero-Atmosphere
 * (ratio 1.91:1 — el sweet spot para FB/LinkedIn/WhatsApp). 133KB,
 * bien debajo del cap de 8MB que tienen los scrapers.
 *
 * `locale: es_UY` porque el copy aprobado en el landing es Spanish-AR/UY.
 * `alternateLocale: en_US` declara el otro idioma soportado por la app
 * (next-intl resuelve EN al renderizar pero el OG es estático — single
 * preview en español aplicable a ambas variantes).
 */
const OG_IMAGE = "/og-image.jpg";
// WIK-205 polish: OG title/description decoupled del page <title> y
// <meta description> (que siguen cortos — "tero.bot" + tagline ES son
// para el browser tab y SEO básico). Los OG son los que ven los social
// previews — necesitan ser ricos:
//   - title 50-60 chars: brand + hero copy
//   - description 110-160 chars: pitch real del producto
// Hardcoded en EN porque OG es estático (no per-locale) y el copy EN
// del hero ya es el aprobado para share previews.
const OG_TITLE = `${APP_NAME} — Crafted software to dissolve complexity`;
const OG_DESCRIPTION =
  "Every business signal — IoT, sensors, WhatsApp — collapsed into a single interface. Thin, replaceable layers, operational entropy under control.";
const OG_IMAGE_ALT = OG_TITLE;

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: APP_NAME,
  description: APP_TAGLINE,
  openGraph: {
    title: OG_TITLE,
    description: OG_DESCRIPTION,
    url: APP_URL,
    siteName: APP_NAME,
    type: "website",
    locale: "es_UY",
    alternateLocale: ["en_US"],
    images: [
      {
        url: OG_IMAGE,
        width: 1200,
        height: 630,
        alt: OG_IMAGE_ALT,
        type: "image/jpeg",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: OG_TITLE,
    description: OG_DESCRIPTION,
    images: [{ url: OG_IMAGE, alt: OG_IMAGE_ALT }],
    creator: "@wikichaves",
    site: "@wikichaves",
  },
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
 * El splash de PWA (manifest.background_color) está HARDCODED a
 * #1A3E35 (mint oscuro) — se elige por branding, independiente del
 * theme_color del chrome del browser.
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
  // WIK-240: edge-to-edge en iOS PWA. Necesario para que `env(safe-area-
  // inset-*)` se popule (lo usa el header sticky para no quedar bajo el
  // notch/status bar con statusBarStyle=black-translucent) y para que el
  // bg llegue hasta los bordes físicos de la pantalla.
  viewportFit: "cover",
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
        {/* WIK-199/200/202: paper grain (light) / obsidian patina (dark).
            Misma SVG con `feTurbulence fractalNoise` para ambos themes —
            irregular orgánico, sin grid visible. Tile size 480px borra
            los seams en monitores grandes. WIK-202: opacity dark
            bajada de 0.08 → 0.025 (ticket pide "ultra baja 1-2%") para
            que la patina apenas quiebre el flat black sin distraer del
            amber de los assets. Light se queda en 0.05. */}
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 -z-10 opacity-[0.05] dark:opacity-[0.025]"
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
            <Analytics />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
