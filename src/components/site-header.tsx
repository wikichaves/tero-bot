import Link from "next/link";
import { signOut } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { ModeToggle } from "@/components/mode-toggle";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

export async function SiteHeader({ profile }: { profile: Profile }) {
  const isStaff =
    profile.role === "limpieza" || profile.role === "mantenimiento";
  const homeHref = isStaff ? "/mis-tareas" : "/dashboard";

  // Counts for the nav badges. We track overdue separately so we can color
  // the badge red when something needs urgent attention.
  const supabase = await createClient();
  const todayIso = new Date().toISOString().slice(0, 10);

  const [myOpenRes, myOverdueRes] = await Promise.all([
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("assigned_to", profile.id)
      .in("status", ["pending", "in_progress"]),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("assigned_to", profile.id)
      .in("status", ["pending", "in_progress"])
      .lt("due_date", todayIso),
  ]);
  const myOpen = myOpenRes.count ?? 0;
  const myOverdue = myOverdueRes.count ?? 0;

  // For admin/gestor, also show the count of open tasks across all
  // properties — useful to spot stuff that needs triage.
  let teamOpen = 0;
  let teamOverdue = 0;
  if (profile.role === "admin" || profile.role === "gestor") {
    const [openRes, overdueRes] = await Promise.all([
      supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .in("status", ["pending", "in_progress"]),
      supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .in("status", ["pending", "in_progress"])
        .lt("due_date", todayIso),
    ]);
    teamOpen = openRes.count ?? 0;
    teamOverdue = overdueRes.count ?? 0;
  }

  return (
    <header className="flex items-center justify-between gap-4 border-b px-6 py-3">
      <div className="flex min-w-0 items-center gap-6">
        <Link href={homeHref} className="shrink-0 font-semibold">
          Acme Rentals
        </Link>
        {/* min-w-0 + overflow-x-auto so on narrow viewports the nav scrolls
            instead of squashing the user / theme toggle on the right. */}
        <nav className="flex min-w-0 items-center gap-4 overflow-x-auto text-sm text-muted-foreground">
          {/* Staff (limpieza/mantenimiento) only need their own task list. */}
          {isStaff && (
            <NavLink
              href="/mis-tareas"
              label="Mis tareas"
              badge={myOpen}
              urgent={myOverdue > 0}
            />
          )}
          {!isStaff && (
            <Link href="/dashboard" className="hover:text-foreground">
              Dashboard
            </Link>
          )}
          {(profile.role === "admin" || profile.role === "gestor") && (
            <>
              <NavLink
                href="/tasks"
                label="Tareas"
                badge={teamOpen}
                urgent={teamOverdue > 0}
              />
              <NavLink
                href="/mis-tareas"
                label="Mis tareas"
                badge={myOpen}
                urgent={myOverdue > 0}
              />
              <Link href="/whatsapp" className="hover:text-foreground">
                WhatsApp
              </Link>
              <Link href="/energy" className="hover:text-foreground">
                Energía
              </Link>
            </>
          )}
          {profile.role === "admin" && (
            <>
              <Link
                href="/admin/properties"
                className="hover:text-foreground"
              >
                Propiedades
              </Link>
              <Link href="/admin/users" className="hover:text-foreground">
                Usuarios
              </Link>
              <Link href="/admin/tuya" className="hover:text-foreground">
                Tuya
              </Link>
              <Link
                href="/admin/tuya/lock"
                className="hover:text-foreground"
              >
                Cerraduras
              </Link>
            </>
          )}
        </nav>
      </div>
      <div className="flex shrink-0 items-center gap-3 text-sm">
        <span className="hidden text-muted-foreground sm:inline">
          {profile.email}
        </span>
        <ModeToggle />
        <form action={signOut}>
          <Button type="submit" variant="ghost" size="sm">
            Salir
          </Button>
        </form>
      </div>
    </header>
  );
}

function NavLink({
  href,
  label,
  badge,
  urgent = false,
}: {
  href: string;
  label: string;
  badge: number | null;
  urgent?: boolean;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-1.5 hover:text-foreground"
    >
      <span>{label}</span>
      {badge != null && badge > 0 && (
        <span
          className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-medium ${
            urgent
              ? "bg-destructive text-destructive-foreground"
              : "bg-muted text-foreground"
          }`}
          title={urgent ? "Hay tareas vencidas" : undefined}
        >
          {badge}
        </span>
      )}
    </Link>
  );
}
