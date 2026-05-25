import Link from "next/link";
import { redirect } from "next/navigation";
import { Bird, ArrowRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { APP_NAME } from "@/lib/brand";
import { getLandingStats } from "@/lib/landing/stats";
import { LandingImage } from "./landing-image";

/**
 * Public landing page (WIK-131 → WIK-151 i18n).
 *
 * `/` is a public marketing page; logged-in users get auto-redirected
 * to /dashboard so the landing only shows up for new / anonymous
 * visitors. Middleware whitelists `/` so unauthenticated requests
 * don't bounce to /login.
 *
 * Strings come from `messages/{locale}.json` via next-intl. The locale
 * is resolved per-request (cookie → profile → Accept-Language → 'en'
 * default). Some terms intentionally stay in English in both locales:
 * product/tool names (Linear, Claude Code, Vercel, Kapso), "Pod-of-One"
 * concept, and a handful of dev jargon.
 *
 * Visual layering:
 *   1. Background color from theme (`--background`).
 *   2. Fixed full-viewport noise overlay (public/landing/noise.svg)
 *      at very low opacity — adds film-grain texture so the page
 *      doesn't read as flat. Sits behind content via -z-10.
 *   3. Page content with section dividers.
 */
export default async function LandingPage() {
  // Don't use `requireUser` — that redirects anonymous to /login, which
  // is exactly what we want to avoid on the public landing.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  const t = await getTranslations("landing");
  const tCommon = await getTranslations("common");
  const tStats = await getTranslations("landing.stats");
  const stats = await getLandingStats();

  return (
    <div className="relative flex min-h-screen flex-col">
      {/* WIK-135: gradient paper → background. Fixed full viewport para
          que se vea constante mientras scrolleas. Light: warm-cream
          (#f3eddb) → bg-paper. Dark: warm-near-black tint → bg. La
          opacity asimétrica deja el efecto fuerte en el hero y se
          desvanece en las secciones de abajo. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-20 bg-gradient-to-b from-[rgb(243,237,219)] via-background to-background dark:from-[rgb(24,21,16)] dark:via-background dark:to-background"
      />
      {/* Film-grain texture. Fixed position so it covers the whole
          viewport even when scrolling. Opacity is asymmetric: dark
          mode needs more grain to read on near-black, light mode
          stays subtler so it doesn't muddy near-white. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 opacity-[0.12] dark:opacity-[0.22]"
        style={{
          backgroundImage: "url(/landing/noise.svg)",
          backgroundSize: "240px",
        }}
      />

      {/* Header — logo + sign-in. WIK-131: ModeToggle moved to footer
          so the header stays minimal. Sticky + backdrop-blur a la
          linear.app — semi-transparent background sees the noise/
          content scroll underneath. */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-border/60 bg-background/80 px-5 py-4 backdrop-blur-md supports-[backdrop-filter]:bg-background/60 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-2 text-base font-semibold tracking-tight"
        >
          <Bird className="h-5 w-5" />
          {APP_NAME}
        </Link>
        <Button render={<Link href="/login" />}>{tCommon("signIn")}</Button>
      </header>

      <main className="flex flex-1 flex-col">
        {/* Hero — copy + photo. */}
        <section className="px-5 pt-12 pb-16 sm:px-8 sm:pt-20 sm:pb-24">
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-8 text-center">
            {/* WIK-134/135: el nombre "tero.bot" ya vive en el header
                sticky — evitamos repetirlo. El tagline es el descriptor
                real, así que sube a h1 (semántico + visual). `<em>`
                aplica el italic-accent (verde profundo) — gesto editorial
                directo de casabosque. */}
            <h1 className="text-balance text-5xl sm:text-7xl">
              {t("hero.titlePre")} <em>{t("hero.titleEm")}</em>
              {t("hero.titlePost")}
            </h1>
            <p className="max-w-xl text-balance text-base leading-relaxed text-muted-foreground">
              {t("hero.intro")}
            </p>
          </div>

          {/* Atmosphere shot — wide, centered, sits between hero copy
              and the next section. Establishes the "warm cabin" tone.
              WIK-137: clickable → abre lightbox. */}
          <figure className="mx-auto mt-16 max-w-5xl sm:mt-20">
            <LandingImage
              photoBase="/landing/Tero-Atmosphere"
              alt={t("hero.atmosphereAlt")}
              loading="eager"
              wrapperClassName="block w-full rounded-2xl border border-border/60 shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:border-border/40 dark:shadow-[0_1px_2px_rgba(0,0,0,0.4)]"
              className="w-full rounded-2xl object-cover"
              caption={t("hero.atmosphereCaption")}
            />
            <figcaption className="mt-3 text-center text-sm text-muted-foreground">
              {t("hero.atmosphereCaption")}
            </figcaption>
          </figure>
        </section>

        {/* WIK-154 / WIK-165 refresh: Stats minimalistas. Mismas dimensiones
            que el case study en wikichaves.com — números grandes serif +
            label mono uppercase. Stats actualizadas: Commits, Active
            hours, Active days, Status. El Status va en accent color
            para que destaque visualmente. */}
        <section className="border-t border-border/60 px-5 py-12 sm:px-8 sm:py-16">
          <div className="mx-auto grid max-w-5xl grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4 sm:gap-x-10">
            {stats.map((s) => (
              <div
                key={s.labelKey}
                className="flex flex-col items-start gap-2"
              >
                <span
                  className={`font-heading text-4xl leading-none tracking-tight sm:text-5xl ${
                    s.accent ? "text-[var(--heading-accent)]" : ""
                  }`}
                >
                  {s.value}
                </span>
                <span className="label-mono">{tStats(s.labelKey)}</span>
              </div>
            ))}
          </div>
        </section>

        {/* The problem. */}
        <section className="border-t border-border/60 px-5 py-20 sm:px-8 sm:py-28">
          <div className="mx-auto flex max-w-2xl flex-col gap-5">
            <span className="label-mono-with-rule">{t("problem.eyebrow")}</span>
            <h2 className="text-3xl sm:text-5xl">{t("problem.title")}</h2>
            <p className="text-base leading-relaxed text-muted-foreground sm:text-lg">
              {t("problem.p1")}
            </p>
            <p className="text-base leading-relaxed text-muted-foreground sm:text-lg">
              {t.rich("problem.p2", {
                appLink: (chunks) => (
                  <a
                    href="https://github.com/wikichaves/tero-bot"
                    target="_blank"
                    rel="noopener"
                    className="text-foreground underline-offset-4 hover:underline"
                  >
                    {chunks}
                  </a>
                ),
                podLink: (chunks) => (
                  <a
                    href="https://x.com/gokulr/status/2051683243934826773"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-4 hover:text-foreground"
                  >
                    {chunks}
                  </a>
                ),
                em: (chunks) => <em>{chunks}</em>,
              })}
            </p>
          </div>
        </section>

        {/* The three modules. Cards now have a photo on top instead of
            an icon — the photo carries the meaning visually. */}
        <section className="border-t border-border/60 px-5 py-20 sm:px-8 sm:py-28">
          <div className="mx-auto flex max-w-5xl flex-col gap-12">
            <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 text-center">
              <span className="label-mono-with-rule">
                {t("modules.eyebrow")}
              </span>
              <h2 className="text-3xl sm:text-5xl">
                {t("modules.titlePre")} <em>{t("modules.titleEm")}</em>
              </h2>
              <p className="text-base text-muted-foreground sm:text-lg">
                {t("modules.subtitle")}
              </p>
            </div>

            <div className="grid gap-6 md:grid-cols-3">
              <ModuleCard
                photoBase="/landing/Tero-Hospitality"
                photoAlt={t("modules.hospitality.alt")}
                title={t("modules.hospitality.title")}
                challenge={t("modules.hospitality.challenge")}
                module={t("modules.hospitality.module")}
                philosophy={t("modules.hospitality.philosophy")}
                labels={{
                  challenge: t("modules.labels.challenge"),
                  module: t("modules.labels.module"),
                  philosophy: t("modules.labels.philosophy"),
                }}
              />
              <ModuleCard
                photoBase="/landing/Tero-System-Overview"
                photoAlt={t("modules.operations.alt")}
                title={t("modules.operations.title")}
                challenge={t("modules.operations.challenge")}
                module={t("modules.operations.module")}
                philosophy={t("modules.operations.philosophy")}
                labels={{
                  challenge: t("modules.labels.challenge"),
                  module: t("modules.labels.module"),
                  philosophy: t("modules.labels.philosophy"),
                }}
              />
              <ModuleCard
                photoBase="/landing/Tero-Team-UI-Context"
                photoAlt={t("modules.frictionless.alt")}
                title={t("modules.frictionless.title")}
                challenge={t("modules.frictionless.challenge")}
                module={t("modules.frictionless.module")}
                philosophy={t("modules.frictionless.philosophy")}
                labels={{
                  challenge: t("modules.labels.challenge"),
                  module: t("modules.labels.module"),
                  philosophy: t("modules.labels.philosophy"),
                }}
              />
            </div>
          </div>
        </section>

        {/* Source-available. */}
        <section className="border-t border-border/60 px-5 py-20 sm:px-8 sm:py-28">
          <div className="mx-auto flex max-w-2xl flex-col gap-6">
            <span className="label-mono-with-rule">{t("source.eyebrow")}</span>
            <h2 className="text-3xl sm:text-5xl">
              {t("source.titlePre")} <em>{t("source.titleEm")}</em>
              {t("source.titlePost")}
            </h2>
            <p className="text-base leading-relaxed text-muted-foreground sm:text-lg">
              {t.rich("source.p1", {
                em: (chunks) => <em>{chunks}</em>,
                // next-intl v4: tags self-closing (`<appName/>`) no se
                // renderean, hay que usar la forma paired. El nombre
                // vive en la traducción (igual a APP_NAME), acá solo
                // le aplicamos el text-foreground accent.
                appName: (chunks) => (
                  <span className="text-foreground">{chunks}</span>
                ),
              })}
            </p>
            <p className="text-base leading-relaxed text-muted-foreground sm:text-lg">
              {t("source.p2")}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                render={
                  <a
                    href="https://github.com/wikichaves/tero-bot"
                    target="_blank"
                    rel="noopener"
                  />
                }
              >
                {t("source.ctaCode")} <ArrowRight />
              </Button>
              {/* WIK-153: removí el segundo "Leer case study" — ya está
                  como CTA primario en el hero. Acá queda solo "Ver
                  código en GitHub" que es coherente con el header de
                  esta sección (source-available). */}
            </div>
          </div>
        </section>
      </main>
      {/* WIK-151: footer movido al root layout (`SiteFooter` global). */}
    </div>
  );
}

/** A single module card. Image-on-top, then the problem/module/philosophy
 *  trio. The image is responsive across avif/webp/jpg and crops to a
 *  16:9 box via `aspect-video` + object-cover. */
function ModuleCard({
  photoBase,
  photoAlt,
  title,
  challenge,
  module,
  philosophy,
  labels,
}: {
  /** Path without extension — we attach `.avif`, `.webp`, `.jpg` for
   *  the `<picture>` srcset. */
  photoBase: string;
  photoAlt: string;
  title: string;
  challenge: string;
  module: string;
  philosophy: string;
  /** Translated section labels (problem/module/philosophy). Passed
   *  down by the parent so each card uses the active locale. */
  labels: { challenge: string; module: string; philosophy: string };
}) {
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:border-border/40 dark:shadow-[0_1px_2px_rgba(0,0,0,0.4)]">
      {/* WIK-137: imagen clickable → abre lightbox con la versión grande. */}
      <LandingImage
        photoBase={photoBase}
        alt={photoAlt}
        wrapperClassName="aspect-video w-full"
        className="aspect-video w-full object-cover"
      />
      <div className="flex flex-col gap-4 p-6">
        <h3 className="text-xl">{title}</h3>
        <dl className="flex flex-col gap-3 text-sm">
          <div>
            <dt className="label-mono">{labels.challenge}</dt>
            <dd className="mt-1 leading-relaxed">{challenge}</dd>
          </div>
          <div>
            <dt className="label-mono">{labels.module}</dt>
            <dd className="mt-1 leading-relaxed">{module}</dd>
          </div>
          <div>
            <dt className="label-mono">{labels.philosophy}</dt>
            {/* WIK-158: el body de la philosophy row antes usaba
                text-muted-foreground, lo que hacía que el texto se
                viera notablemente más light que el de challenge/module.
                Por consistencia entre las 3 rows de la card, ahora
                comparten el color del foreground. El "label" del row
                (label-mono) ya provee la jerarquía visual — el
                contenido va igual de contrastado en las 3. */}
            <dd className="mt-1 leading-relaxed">{philosophy}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
