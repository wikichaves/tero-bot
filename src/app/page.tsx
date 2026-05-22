import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Bird,
  ArrowRight,
  Thermometer,
  Mail,
  MessageCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ModeToggle } from "@/components/mode-toggle";
import { createClient } from "@/lib/supabase/server";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";

/**
 * Public landing page (WIK-131).
 *
 * Was a behind-auth redirect: `/` → /dashboard for logged-in users,
 * /login for anonymous. Now `/` is a public marketing page; logged-in
 * users get auto-redirected to /dashboard so the landing only shows up
 * for new/anonymous visitors.
 *
 * Middleware whitelists `/` in PUBLIC_PATHS so unauthenticated requests
 * don't bounce to /login.
 *
 * Content is in Spanish (rioplatense neutral) — the operator is in
 * Uruguay and most readers come from a Spanish-speaking referrer. EN
 * translation pending.
 */
export default async function LandingPage() {
  // Don't use `requireUser` — that redirects anonymous to /login, which
  // is exactly what we want to *avoid* on the public landing. Check the
  // session manually and only redirect if we have one.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  return (
    <div className="relative flex min-h-screen flex-col">
      {/* Header — minimal, just logo + theme toggle + sign-in. */}
      <header className="flex items-center justify-between px-5 py-4 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-2 text-base font-semibold tracking-tight"
        >
          <Bird className="h-5 w-5" />
          {APP_NAME}
        </Link>
        <div className="flex items-center gap-2">
          <ModeToggle />
          <Button render={<Link href="/login" />}>Iniciar sesión</Button>
        </div>
      </header>

      <main className="flex flex-1 flex-col">
        {/* Hero. */}
        <section className="flex flex-col items-center px-5 pt-12 pb-20 text-center sm:px-8 sm:pt-20 sm:pb-28">
          <div className="flex max-w-2xl flex-col items-center gap-8">
            <Bird
              className="h-16 w-16 text-primary"
              strokeWidth={1.5}
              aria-hidden
            />
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
        </section>

        {/* The problem. */}
        <section className="border-t border-border/60 px-5 py-16 sm:px-8 sm:py-20">
          <div className="mx-auto flex max-w-2xl flex-col gap-5">
            <h2 className="text-3xl font-semibold sm:text-4xl">
              El problema con la mayoría de los PMS.
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

        {/* The three modules. */}
        <section className="border-t border-border/60 px-5 py-16 sm:px-8 sm:py-20">
          <div className="mx-auto flex max-w-4xl flex-col gap-12">
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
                icon={Thermometer}
                title="Hospitalidad automática"
                challenge="La experiencia del huésped no empieza con las llaves — empieza con el confort térmico al cruzar la puerta."
                module="Control de temperatura y humedad integrado. Pre-acondicionamiento 2h antes del check-in."
                philosophy="A veces la mejor UI no es una pantalla — es el clima perfecto cuando alguien entra."
              />
              <ModuleCard
                icon={Mail}
                title="Operaciones invisibles"
                challenge="Trackear costos de energía manualmente y matchearlos contra ocupación real es un sumidero de tiempo administrativo."
                module="Un flow backend que intercepta facturas reenviadas por email, parsea los datos, y los matchea automáticamente contra el consumo real."
                philosophy="Las tareas burocráticas las resuelve el backend. Menos interfaces manuales, más integraciones invisibles."
              />
              <ModuleCard
                icon={MessageCircle}
                title="UI cero fricción"
                challenge="Forzar al personal a descargar otra app y aprender un sistema nuevo genera resistencia y errores."
                module="Reportes de incidentes, asignación de tareas, tracking y notificaciones — todo por WhatsApp."
                philosophy="La mejor interfaz es la que el usuario ya conoce. En vez de forzar a la gente a un sistema nuevo, traje el sistema a ellos."
              />
            </div>
          </div>
        </section>

        {/* The pipeline. */}
        <section className="border-t border-border/60 px-5 py-16 sm:px-8 sm:py-20">
          <div className="mx-auto flex max-w-2xl flex-col gap-6">
            <h2 className="text-3xl font-semibold sm:text-4xl">
              Idea → producción, en un loop.
            </h2>
            <p className="text-base leading-relaxed text-muted-foreground sm:text-lg">
              Todo el producto corre sobre un pipeline de tres pasos:
            </p>

            <div className="my-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-2xl border border-border/60 bg-card px-6 py-5 text-sm font-medium sm:text-base">
              <span>Linear</span>
              <span className="text-muted-foreground" aria-hidden>
                →
              </span>
              <span>Claude Code</span>
              <span className="text-muted-foreground" aria-hidden>
                →
              </span>
              <span>Vercel</span>
              <span className="text-muted-foreground" aria-hidden>
                →
              </span>
              <span>🚀 Boom</span>
            </div>

            <p className="text-base leading-relaxed text-muted-foreground sm:text-lg">
              <em>Linear</em> guarda el backlog. Cada bug o idea abre un issue.{" "}
              <em>Claude Code</em> lee el issue, escribe el patch, abre un
              commit referenciándolo, y pushea. <em>Vercel</em> deploya cada
              push en menos de un minuto — y Linear auto-cierra el issue vía el
              link del commit.
            </p>
            <p className="text-base leading-relaxed text-muted-foreground sm:text-lg">
              Lo que antes era un handoff multi-persona — grooming, dev, code
              review, QA, ticket de deploy — colapsa en una sola conversación.
              El costo por cambio shippeado baja lo suficiente como para que la
              micro-iteración sea el default, no la excepción.
            </p>
          </div>
        </section>

        {/* Source-available. */}
        <section className="border-t border-border/60 px-5 py-16 sm:px-8 sm:py-20">
          <div className="mx-auto flex max-w-2xl flex-col gap-6">
            <h2 className="text-3xl font-semibold sm:text-4xl">
              Source-available.
            </h2>
            <p className="text-base leading-relaxed text-muted-foreground sm:text-lg">
              Creo en el <em>context engineering</em> y en aprender en público.{" "}
              <span className="text-foreground">{APP_NAME}</span> es el motor
              operativo real de mi complejo — el código está abierto para
              compartir el system design y acelerar el aprendizaje colectivo.
            </p>
            <p className="text-base leading-relaxed text-muted-foreground sm:text-lg">
              No es un proyecto open-source mantenido por comunidad. Está
              provisto &ldquo;as is&rdquo;, sin soporte de terceros y sin
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

      <footer className="border-t border-border/60 px-5 py-6 text-center text-xs text-muted-foreground sm:px-8">
        Open source under MIT.{" "}
        <a
          href="https://github.com/wikichaves/tero-bot"
          target="_blank"
          rel="noopener"
          className="underline-offset-4 hover:text-foreground hover:underline"
        >
          github.com/wikichaves/tero-bot
        </a>
      </footer>
    </div>
  );
}

/** A single module card — used in the three-modules grid. */
function ModuleCard({
  icon: Icon,
  title,
  challenge,
  module,
  philosophy,
}: {
  icon: typeof Thermometer;
  title: string;
  challenge: string;
  module: string;
  philosophy: string;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border/60 bg-card p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:border-border/40 dark:shadow-[0_1px_2px_rgba(0,0,0,0.4)]">
      <Icon className="h-6 w-6 text-primary" strokeWidth={1.5} aria-hidden />
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
  );
}
