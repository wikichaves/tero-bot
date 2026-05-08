import Link from "next/link";
import { Menu } from "lucide-react";
import { signOut } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ModeToggle } from "@/components/mode-toggle";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

type NavItem = {
  href: string;
  label: string;
  badge?: number;
  urgent?: boolean;
};

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

  // Single source of truth for nav items — used both by the inline desktop
  // nav and the mobile dropdown so they stay in sync.
  const navItems: NavItem[] = [];
  if (isStaff) {
    navItems.push({
      href: "/mis-tareas",
      label: "Mis tareas",
      badge: myOpen,
      urgent: myOverdue > 0,
    });
  } else {
    navItems.push({ href: "/dashboard", label: "Dashboard" });
  }
  if (profile.role === "admin" || profile.role === "gestor") {
    navItems.push(
      {
        href: "/tasks",
        label: "Tareas",
        badge: teamOpen,
        urgent: teamOverdue > 0,
      },
      {
        href: "/mis-tareas",
        label: "Mis tareas",
        badge: myOpen,
        urgent: myOverdue > 0,
      },
      { href: "/whatsapp", label: "WhatsApp" },
      { href: "/energy", label: "Energía" },
    );
  }
  const adminItems: NavItem[] =
    profile.role === "admin"
      ? [
          { href: "/admin/properties", label: "Propiedades" },
          { href: "/admin/users", label: "Usuarios" },
          { href: "/admin/tuya", label: "Tuya" },
          { href: "/admin/tuya/lock", label: "Cerraduras" },
        ]
      : [];

  return (
    <header className="flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-6">
      <div className="flex min-w-0 items-center gap-3 sm:gap-6">
        {/* Mobile hamburger — opens a DropdownMenu with all nav items.
            Visible up to md; hidden on md+ where the inline nav fits. */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                aria-label="Abrir menú"
              />
            }
          >
            <Menu className="h-5 w-5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {navItems.map((it) => (
              <DropdownMenuItem key={it.href} render={<Link href={it.href} />}>
                <span className="flex-1">{it.label}</span>
                {it.badge != null && it.badge > 0 && (
                  <span
                    className={`ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-medium ${
                      it.urgent
                        ? "bg-destructive text-destructive-foreground"
                        : "bg-muted text-foreground"
                    }`}
                  >
                    {it.badge}
                  </span>
                )}
              </DropdownMenuItem>
            ))}
            {adminItems.length > 0 && <DropdownMenuSeparator />}
            {adminItems.map((it) => (
              <DropdownMenuItem key={it.href} render={<Link href={it.href} />}>
                {it.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Link href={homeHref} className="shrink-0 font-semibold">
          <span className="sm:hidden">Casa Bosque</span>
          <span className="hidden sm:inline">Acme Rentals</span>
        </Link>

        {/* Desktop inline nav — hidden on mobile in favor of the dropdown. */}
        <nav className="hidden min-w-0 items-center gap-4 overflow-x-auto text-sm text-muted-foreground md:flex">
          {navItems.map((it) =>
            it.badge != null ? (
              <NavLink
                key={it.href}
                href={it.href}
                label={it.label}
                badge={it.badge}
                urgent={it.urgent ?? false}
              />
            ) : (
              <Link
                key={it.href}
                href={it.href}
                className="hover:text-foreground"
              >
                {it.label}
              </Link>
            ),
          )}
          {adminItems.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              className="hover:text-foreground"
            >
              {it.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="flex shrink-0 items-center gap-2 text-sm sm:gap-3">
        <span className="hidden text-muted-foreground lg:inline">
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
