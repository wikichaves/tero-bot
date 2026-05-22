import Link from "next/link";
import { redirect } from "next/navigation";
import { Bird, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ModeToggle } from "@/components/mode-toggle";
import { createClient } from "@/lib/supabase/server";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";

/**
 * Public landing page (WIK-131).
 *
 * `/` is a public marketing page; logged-in users get auto-redirected
 * to /dashboard so the landing only shows up for new / anonymous
 * visitors. Middleware whitelists `/` so unauthenticated requests
 * don't bounce to /login.
 *
 * Content is in Spanish (rioplatense neutral) — the operator is in
 * Uruguay and most readers come from a Spanish-speaking referrer.
 * Some terms intentionally stay in English: product/tool names
 * (Linear, Claude Code, Vercel, Kapso), the "Pod-of-One" concept, and
 * a handful of dev jargon (loop, push, commit) that's standard in
 * tech-Spanish.
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

  return (
    <div className="relative flex min-h-screen flex-col">
      {/* Film-grain texture. Fixed position so it covers the whole
          viewport even when scrolling. Very low opacity so it reads
          as subtle paper/print noise, not actual visual data. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 opacity-[0.06] dark:opacity-[0.10]"
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
        <Button render={<Link href="/login" />}>Iniciar sesión</Button>
      </header>

      <main className="flex flex-1 flex-col">
        {/* Hero — copy + photo. */}
        <section className="px-5 pt-12 pb-16 sm:px-8 sm:pt-20 sm:pb-24">
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-8 text-center">
            <div className="flex flex-col gap-4">
              <h1 className="text-5xl font-semibold sm:text-6xl">
                {APP_NAME}
              </h1>
              <p className="text-balance text-lg text-muted-foreground sm:text-xl">
                {APP_TAGLINE}.
              </p>
            </div>
            <p className="max-w-xl text-balance text-base leading-relaxed text-muted-foreground">
              Un sistema modular construido para eliminar la fricción operativa
              de un complejo de alquiler temporario. IoT, integraciones
              invisibles, y un bot de WhatsApp — todas las señales del negocio
              colapsadas en una sola interfaz.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button size="lg" render={<Link href="/login" />}>
                Iniciar sesión <ArrowRight />
              </Button>
              <Button
                size="lg"
                variant="outline"
                render={
                  <a
                    href="https://github.com/wikichaves/tero-bot"
                    target="_blank"
                    rel="noopener"
                  />
                }
              >
                Ver código
              </Button>
            </div>
          </div>

          {/* Atmosphere shot — wide, centered, sits between hero copy
              and the next section. Establishes the "warm cabin" tone. */}
          <figure className="mx-auto mt-16 max-w-5xl sm:mt-20">
            <picture>
              <source
                srcSet="/landing/Tero-Atmosphere.avif"
                type="image/avif"
              />
              <source
                srcSet="/landing/Tero-Atmosphere.webp"
                type="image/webp"
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/landing/Tero-Atmosphere.jpg"
                alt="Una pareja recién llegada a una cabaña en el bosque sostiene tazas calientes junto a una estufa encendida; el termostato muestra 22°C."
                className="w-full rounded-2xl border border-border/60 object-cover shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:border-border/40 dark:shadow-[0_1px_2px_rgba(0,0,0,0.4)]"
                loading="eager"
              />
            </picture>
            <figcaption className="mt-3 text-center text-sm text-muted-foreground">
              El huésped llega y la casa ya está a 22°C — el clima se
              configuró horas antes.
            </figcaption>
          </figure>
        </section>

        {/* The problem. */}
        <section className="border-t border-border/60 px-5 py-16 sm:px-8 sm:py-20">
          <div className="mx-auto flex max-w-2xl flex-col gap-5">
            <h2 className="text-3xl font-semibold sm:text-4xl">
              El problema con los PMS.
            </h2>
            <p className="text-base leading-relaxed text-muted-foreground sm:text-lg">
              Pagar por un SaaS genérico es como alquilar un edificio de cinco
              pisos para un equipo de tres personas — pagás por features que
              nunca vas a usar y el sistema sigue siendo rígido frente a tu
              operativa real.
            </p>
            <p className="text-base leading-relaxed text-muted-foreground sm:text-lg">
              En lugar de adaptar mis operaciones a software de terceros,
              construí el mío.{" "}
              <span className="text-foreground">{APP_NAME}</span> no es una app
              &ldquo;a medida&rdquo; tradicional — es arquitectura modular de
              alta eficiencia. Operando bajo un modelo{" "}
              <a
                href="https://x.com/gokulr/status/2051683243934826773"
                target="_blank"
                rel="noopener"
                className="underline underline-offset-4 hover:text-foreground"
              >
                <em>&ldquo;Pod-of-One&rdquo;</em>
              </a>{" "}
              — un único operador apalancado con IA, automatizaciones, y
              principios de system design — ejecutando a la velocidad de un
              equipo completo y construyendo sólo los módulos que eliminan
              fricción concreta.
            </p>
          </div>
        </section>

        {/* The three modules. Cards now have a photo on top instead of
            an icon — the photo carries the meaning visually. */}
        <section className="border-t border-border/60 px-5 py-16 sm:px-8 sm:py-20">
          <div className="mx-auto flex max-w-5xl flex-col gap-12">
            <div className="mx-auto flex max-w-2xl flex-col gap-3 text-center">
              <h2 className="text-3xl font-semibold sm:text-4xl">
                Tres módulos. Un sistema.
              </h2>
              <p className="text-base text-muted-foreground sm:text-lg">
                Capas finas, composables, reemplazables. Cada una resuelve un
                problema real de la operativa diaria.
              </p>
            </div>

            <div className="grid gap-6 md:grid-cols-3">
              <ModuleCard
                photoBase="/landing/Tero-Hospitality"
                photoAlt="Tarjetas de temperatura y humedad en vivo por ambiente del complejo."
                title="Hospitalidad automática"
                challenge="La experiencia del huésped no empieza con las llaves — empieza con el confort térmico al cruzar la puerta."
                module="Control de temperatura y humedad integrado. Pre-acondicionamiento 2h antes del check-in."
                philosophy="A veces la mejor UI no es una pantalla — es el clima perfecto cuando alguien entra."
              />
              <ModuleCard
                photoBase="/landing/Tero-System-Overview"
                photoAlt="Dashboard mostrando consumo de energía en vivo y costo por propiedad."
                title="Operaciones invisibles"
                challenge="Trackear costos de energía manualmente y matchearlos contra ocupación real es un sumidero de tiempo administrativo."
                module="Un flow backend que intercepta facturas reenviadas por email, parsea los datos, y los matchea automáticamente contra el consumo real."
                philosophy="Las tareas burocráticas las resuelve el backend. Menos interfaces manuales, más integraciones invisibles."
              />
              <ModuleCard
                photoBase="/landing/Tero-Team-UI-Context"
                photoAlt="Una mano sostiene un celular mostrando el chat de WhatsApp con el bot de tero.bot creando una tarea."
                title="UI cero fricción"
                challenge="Forzar al personal a descargar otra app y aprender un sistema nuevo genera resistencia y errores."
                module="Reportes de incidentes, asignación de tareas, tracking y notificaciones — todo por WhatsApp."
                philosophy="La mejor interfaz es la que el usuario ya conoce. En vez de forzar a la gente a un sistema nuevo, traje el sistema a ellos."
              />
            </div>
          </div>
        </section>

        {/* Source-available. */}
        <section className="border-t border-border/60 px-5 py-16 sm:px-8 sm:py-20">
          <div className="mx-auto flex max-w-2xl flex-col gap-6">
            <h2 className="text-3xl font-semibold sm:text-4xl">
              Código disponible.
            </h2>
            <p className="text-base leading-relaxed text-muted-foreground sm:text-lg">
              Creo en el <em>context engineering</em> y en aprender en público.{" "}
              <span className="text-foreground">{APP_NAME}</span> es el motor
              operativo real de mi complejo — el código está abierto para
              compartir el system design y acelerar el aprendizaje colectivo.
            </p>
            <p className="text-base leading-relaxed text-muted-foreground sm:text-lg">
              No es un proyecto open-source mantenido por la comunidad. Está
              provisto &ldquo;tal cual&rdquo;, sin soporte de terceros y sin
              aceptar Pull Requests. Sentite libre de explorar el código,
              forkearlo, y usar los conceptos para construir tus propios
              sistemas.
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
                Ver código en GitHub <ArrowRight />
              </Button>
              <Button
                variant="outline"
                render={
                  <a
                    href="https://wikichaves.com/design/projects/tero"
                    target="_blank"
                    rel="noopener"
                  />
                }
              >
                Leer el case study
              </Button>
            </div>
          </div>
        </section>
      </main>

      {/* Footer — credits + repo link + theme toggle. WIK-131: moved
          ModeToggle out of the header so the top stays minimal (a la
          design portfolio); theme switching lives down here. */}
      <footer className="flex flex-col items-center justify-between gap-3 border-t border-border/60 px-5 py-6 text-xs text-muted-foreground sm:flex-row sm:gap-4 sm:px-8">
        <p className="text-center sm:text-left">
          Creado por{" "}
          <a
            href="https://wikichaves.com/"
            target="_blank"
            rel="noopener"
            className="underline-offset-4 hover:text-foreground hover:underline"
          >
            Wiki Chaves
          </a>
          {" · "}
          Código abierto bajo licencia MIT.{" "}
          <a
            href="https://github.com/wikichaves/tero-bot"
            target="_blank"
            rel="noopener"
            className="underline-offset-4 hover:text-foreground hover:underline"
          >
            github.com/wikichaves/tero-bot
          </a>
        </p>
        <ModeToggle />
      </footer>
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
}: {
  /** Path without extension — we attach `.avif`, `.webp`, `.jpg` for
   *  the `<picture>` srcset. */
  photoBase: string;
  photoAlt: string;
  title: string;
  challenge: string;
  module: string;
  philosophy: string;
}) {
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:border-border/40 dark:shadow-[0_1px_2px_rgba(0,0,0,0.4)]">
      <picture>
        <source srcSet={`${photoBase}.avif`} type="image/avif" />
        <source srcSet={`${photoBase}.webp`} type="image/webp" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`${photoBase}.jpg`}
          alt={photoAlt}
          className="aspect-video w-full object-cover"
          loading="lazy"
        />
      </picture>
      <div className="flex flex-col gap-4 p-6">
        <h3 className="text-xl font-semibold">{title}</h3>
        <dl className="flex flex-col gap-3 text-sm">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              El problema
            </dt>
            <dd className="mt-1 leading-relaxed">{challenge}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              El módulo
            </dt>
            <dd className="mt-1 leading-relaxed">{module}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              La filosofía
            </dt>
            <dd className="mt-1 leading-relaxed text-muted-foreground">
              {philosophy}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
