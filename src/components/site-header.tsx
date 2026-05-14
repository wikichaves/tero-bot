import Link from "next/link";
import { ChevronDown, Menu } from "lucide-react";
import { signOut } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ModeToggle } from "@/components/mode-toggle";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

/**
 * Estructura del header (WIK-72):
 *
 *   [Admin] ───  Tareas ▾   Facturas   Energía   WhatsApp   Configuración ▾   …
 *                 ├ Todas las tareas (con badge)               ├ Propiedades
 *                 └ Mis tareas (con badge)                     ├ Usuarios
 *                                                              ├ Tuya devices
 *                                                              └ Cerraduras
 *
 *   - "Admin" (logo) navega al home (= /dashboard para staff admin/gestor,
 *     /mis-tareas para limpieza/mantenimiento). Ya NO existe un item
 *     "Dashboard" en el nav: el logo cumple esa función.
 *   - "Tareas" pasó a ser un dropdown que agrupa /tasks y /mis-tareas con
 *     sus badges respectivos — antes ocupaban 2 items separados en la barra.
 *   - "Configuración" reemplaza la fila plana de Propiedades / Usuarios /
 *     Tuya / Cerraduras (solo para admin).
 *   - En mobile la jerarquía se aplana dentro del hamburger con separators
 *     y labels para que se entienda el agrupamiento.
 */

type NavLeaf = {
  href: string;
  label: string;
  badge?: number;
  urgent?: boolean;
};

type NavGroup = {
  label: string;
  items: NavLeaf[];
  /** Cuando se muestra como item plano (mobile/staff), `flatBadge` opcional
   *  fuerza badge agregado en el row principal. Hoy lo derivamos de items. */
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

  // Staff (limpieza/mantenimiento) ven solo "Mis tareas" como leaf,
  // sin agrupamiento — no tienen acceso al resto.
  const staffLeaves: NavLeaf[] = isStaff
    ? [
        {
          href: "/mis-tareas",
          label: "Mis tareas",
          badge: myOpen,
          urgent: myOverdue > 0,
        },
      ]
    : [];

  // Admin/gestor: agrupamos Tareas como dropdown, Facturas/Energía/WhatsApp
  // sueltos, y Configuración como dropdown final (solo admin).
  const tareasGroup: NavGroup | null =
    profile.role === "admin" || profile.role === "gestor"
      ? {
          label: "Tareas",
          items: [
            {
              href: "/tasks",
              label: "Todas las tareas",
              badge: teamOpen,
              urgent: teamOverdue > 0,
            },
            {
              href: "/mis-tareas",
              label: "Mis tareas",
              badge: myOpen,
              urgent: myOverdue > 0,
            },
          ],
        }
      : null;

  const operationalLeaves: NavLeaf[] =
    profile.role === "admin" || profile.role === "gestor"
      ? [
          { href: "/facturas", label: "Facturas" },
          { href: "/energy", label: "Energía" },
          { href: "/whatsapp", label: "WhatsApp" },
        ]
      : [];

  const configGroup: NavGroup | null =
    profile.role === "admin"
      ? {
          label: "Configuración",
          items: [
            { href: "/admin/properties", label: "Propiedades" },
            { href: "/admin/users", label: "Usuarios" },
            { href: "/admin/tuya", label: "Tuya devices" },
            { href: "/admin/tuya/lock", label: "Cerraduras" },
          ],
        }
      : null;

  return (
    <header className="flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-6">
      <div className="flex min-w-0 items-center gap-3 sm:gap-6">
        {/* Mobile hamburger — versión aplanada de los mismos items. Visible
            hasta md; en md+ se usa el nav inline. */}
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
          <DropdownMenuContent align="start" className="w-60">
            {staffLeaves.map((it) => (
              <DropdownMenuItem key={it.href} render={<Link href={it.href} />}>
                <NavRow {...it} />
              </DropdownMenuItem>
            ))}
            {tareasGroup && (
              <>
                <DropdownMenuLabel>{tareasGroup.label}</DropdownMenuLabel>
                {tareasGroup.items.map((it) => (
                  <DropdownMenuItem
                    key={it.href}
                    render={<Link href={it.href} />}
                  >
                    <NavRow {...it} />
                  </DropdownMenuItem>
                ))}
              </>
            )}
            {operationalLeaves.length > 0 && <DropdownMenuSeparator />}
            {operationalLeaves.map((it) => (
              <DropdownMenuItem key={it.href} render={<Link href={it.href} />}>
                <NavRow {...it} />
              </DropdownMenuItem>
            ))}
            {configGroup && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>{configGroup.label}</DropdownMenuLabel>
                {configGroup.items.map((it) => (
                  <DropdownMenuItem
                    key={it.href}
                    render={<Link href={it.href} />}
                  >
                    <NavRow {...it} />
                  </DropdownMenuItem>
                ))}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <Link href={homeHref} className="shrink-0 font-semibold">
          Admin
        </Link>

        {/* Desktop inline nav. */}
        <nav className="hidden min-w-0 items-center gap-4 overflow-x-auto text-sm text-muted-foreground md:flex">
          {staffLeaves.map((it) => (
            <NavLink key={it.href} {...it} />
          ))}
          {tareasGroup && <NavDropdown group={tareasGroup} />}
          {operationalLeaves.map((it) => (
            <NavLink key={it.href} {...it} />
          ))}
          {configGroup && <NavDropdown group={configGroup} />}
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

/** Row content reusada por dropdown items y por leafs — label izquierda,
 *  badge opcional a la derecha. */
function NavRow({
  label,
  badge,
  urgent = false,
}: {
  label: string;
  badge?: number;
  urgent?: boolean;
}) {
  return (
    <>
      <span className="flex-1">{label}</span>
      {badge != null && badge > 0 && (
        <span
          className={`ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-medium ${
            urgent
              ? "bg-destructive text-destructive-foreground"
              : "bg-muted text-foreground"
          }`}
        >
          {badge}
        </span>
      )}
    </>
  );
}

/** Item plano del nav inline (desktop). Usa hover:text-foreground para
 *  match con el estilo previo. */
function NavLink({
  href,
  label,
  badge,
  urgent = false,
}: NavLeaf) {
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

/** Dropdown agrupador (Tareas / Configuración). El trigger es un botón
 *  con look de link de nav (text-muted-foreground + hover) y un chevron.
 *  Si CUALQUIER sub-item está urgent, el chevron del padre también va rojo
 *  para no esconder el aviso detrás del menú cerrado. */
function NavDropdown({ group }: { group: NavGroup }) {
  const totalBadge = group.items.reduce(
    (sum, it) => sum + (it.badge ?? 0),
    0,
  );
  const anyUrgent = group.items.some((it) => it.urgent && (it.badge ?? 0) > 0);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
          />
        }
      >
        <span>{group.label}</span>
        {totalBadge > 0 && (
          <span
            className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-medium ${
              anyUrgent
                ? "bg-destructive text-destructive-foreground"
                : "bg-muted text-foreground"
            }`}
          >
            {totalBadge}
          </span>
        )}
        <ChevronDown className="h-3.5 w-3.5" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {group.items.map((it) => (
          <DropdownMenuItem key={it.href} render={<Link href={it.href} />}>
            <NavRow {...it} />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
