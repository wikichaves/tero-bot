import Link from "next/link";
import { signOut } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

export async function SiteHeader({ profile }: { profile: Profile }) {
  const isStaff =
    profile.role === "limpieza" || profile.role === "mantenimiento";
  const homeHref = isStaff ? "/mis-tareas" : "/dashboard";

  // Count this user's open assigned tasks for the badge.
  const supabase = await createClient();
  const { count: myOpen } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("assigned_to", profile.id)
    .in("status", ["pending", "in_progress"]);

  // For admin/gestor, also show the count of unassigned + open tasks across
  // all properties — useful to spot stuff that needs triage.
  let teamOpen: number | null = null;
  if (profile.role === "admin" || profile.role === "gestor") {
    const { count } = await supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending", "in_progress"]);
    teamOpen = count ?? 0;
  }

  return (
    <header className="flex items-center justify-between border-b px-6 py-3">
      <div className="flex items-center gap-6">
        <Link href={homeHref} className="font-semibold">
          Acme Rentals
        </Link>
        <nav className="flex items-center gap-4 text-sm text-muted-foreground">
          {/* Staff (limpieza/mantenimiento) only need their own task list. */}
          {isStaff && (
            <NavLink href="/mis-tareas" label="Mis tareas" badge={myOpen} />
          )}
          {!isStaff && (
            <Link href="/dashboard" className="hover:text-foreground">
              Dashboard
            </Link>
          )}
          {(profile.role === "admin" || profile.role === "gestor") && (
            <>
              <NavLink href="/tasks" label="Tareas" badge={teamOpen} />
              <NavLink href="/mis-tareas" label="Mis tareas" badge={myOpen} />
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
      <div className="flex items-center gap-3 text-sm">
        <span className="text-muted-foreground">{profile.email}</span>
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
}: {
  href: string;
  label: string;
  badge: number | null;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-1.5 hover:text-foreground"
    >
      <span>{label}</span>
      {badge != null && badge > 0 && (
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-medium text-foreground">
          {badge}
        </span>
      )}
    </Link>
  );
}
