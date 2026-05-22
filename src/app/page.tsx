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
 * Was a behind-auth redirect: `/` → /dashboard for logged-in users,
 * /login for anonymous. Now `/` is a public marketing page; logged-in
 * users get auto-redirected to /dashboard so the landing only shows up
 * for new/anonymous visitors.
 *
 * Middleware whitelists `/` in PUBLIC_PATHS so unauthenticated requests
 * don't bounce to /login.
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
          <Button render={<Link href="/login" />}>Sign in</Button>
        </div>
      </header>

      {/* Hero. Single-column, big type, mint accent. */}
      <main className="flex flex-1 flex-col items-center justify-center px-5 pb-16 text-center sm:px-8">
        <div className="flex max-w-2xl flex-col items-center gap-8">
          <Bird
            className="h-16 w-16 text-primary"
            strokeWidth={1.5}
            aria-hidden
          />
          <div className="flex flex-col gap-4">
            <h1 className="text-5xl font-semibold tracking-tight sm:text-6xl">
              {APP_NAME}
            </h1>
            <p className="text-balance text-lg text-muted-foreground sm:text-xl">
              {APP_TAGLINE}.
            </p>
          </div>
          <p className="max-w-xl text-balance text-base leading-relaxed text-muted-foreground">
            Reservations, cleaning tasks, smart locks, energy meters, T/H
            sensors, utility bills, and WhatsApp comms — every signal collapsed
            into one operating surface. Built as a Pod-of-One.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button size="lg" render={<Link href="/login" />}>
              Sign in <ArrowRight />
            </Button>
            <Button
              size="lg"
              variant="outline"
              render={
                <a
                  href="https://github.com/wikichaves/tero-admin"
                  target="_blank"
                  rel="noopener"
                />
              }
            >
              View source
            </Button>
          </div>
        </div>
      </main>

      <footer className="border-t border-border/60 px-5 py-6 text-center text-xs text-muted-foreground sm:px-8">
        Open source under MIT.{" "}
        <a
          href="https://github.com/wikichaves/tero-admin"
          target="_blank"
          rel="noopener"
          className="underline-offset-4 hover:text-foreground hover:underline"
        >
          github.com/wikichaves/tero-admin
        </a>
      </footer>
    </div>
  );
}
