import Link from "next/link";
import { ChevronDown, Menu } from "lucide-react";
import { signOut } from "@/app/login/actions";
import { getAllowedPropertyIds } from "@/lib/auth/scope";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
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
  // WIK-74: "limpieza" se unificó en "mantenimiento". Antes el chequeo
  // era `role === "limpieza" || role === "mantenimiento"`.
  const isStaff = profile.role === "mantenimiento";
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
  // properties — useful to spot stuff that needs triage. WIK-94: gestor
  // solo cuenta tasks/alarms de SUS properties.
  let teamOpen = 0;
  let teamOverdue = 0;
  let alarmsActive = 0;
  if (profile.role === "admin" || profile.role === "gestor") {
    const allowedIds = await getAllowedPropertyIds(profile);
    let openQ = supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending", "in_progress"]);
    let overdueQ = supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending", "in_progress"])
      .lt("due_date", todayIso);
    let alarmsQ = supabase
      .from("alarm_events")
      .select("id, property_device:property_devices!inner(property_id)", {
        count: "exact",
        head: true,
      })
      .is("resolved_at", null);
    if (allowedIds !== null) {
      openQ = openQ.in("property_id", allowedIds);
      overdueQ = overdueQ.in("property_id", allowedIds);
      alarmsQ = alarmsQ.in("property_device.property_id", allowedIds);
    }
    const [openRes, overdueRes, alarmsRes] = await Promise.all([
      openQ,
      overdueQ,
      alarmsQ,
    ]);
    teamOpen = openRes.count ?? 0;
    teamOverdue = overdueRes.count ?? 0;
    alarmsActive = alarmsRes.count ?? 0;
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

  // WIK-104: simplificación del menú.
  //   - Admin: dropdown "Tareas" con "Todas" + "Mis tareas".
  //   - Gestor: leaf único "Tareas" → /mis-tareas (sin dropdown,
  //     /tasks es admin-only ahora).
  const tareasGroup: NavGroup | null =
    profile.role === "admin"
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
  // Para gestor, sumamos un leaf "Tareas" directo en operationalLeaves
  // (definido más abajo). Renderiza como item normal con badge.

  const operationalLeaves: NavLeaf[] =
    profile.role === "admin" || profile.role === "gestor"
      ? [
          // WIK-104: gestor ve "Tareas" como leaf directo a /mis-tareas
          // (no dropdown). Admin no lo necesita acá porque tiene el
          // dropdown completo arriba.
          ...(profile.role === "gestor"
            ? [
                {
                  href: "/mis-tareas",
                  label: "Tareas",
                  badge: myOpen,
                  urgent: myOverdue > 0,
                },
              ]
            : []),
          { href: "/facturas", label: "Facturas" },
          { href: "/energy", label: "Energía" },
          {
            href: "/ambientes",
            label: "Ambientes",
            badge: alarmsActive,
            urgent: alarmsActive > 0,
          },
          // WIK-107: WhatsApp solo admin. Gestor no ve el inbox.
          ...(profile.role === "admin"
            ? [{ href: "/whatsapp", label: "WhatsApp" }]
            : []),
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
            { href: "/admin/alarmas", label: "Alarmas" },
            { href: "/admin/whatsapp", label: "WhatsApp Templates" },
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
            {/* Base UI exige que `DropdownMenuLabel` (Menu.GroupLabel) viva
                dentro de un `DropdownMenuGroup` (Menu.Group). Sin el wrapper
                tira "Base UI error #31: MenuGroupRootContext is missing" al
                abrir el dropdown. */}
            {tareasGroup && (
              <DropdownMenuGroup>
                <DropdownMenuLabel>{tareasGroup.label}</DropdownMenuLabel>
                {tareasGroup.items.map((it) => (
                  <DropdownMenuItem
                    key={it.href}
                    render={<Link href={it.href} />}
                  >
                    <NavRow {...it} />
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
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
                <DropdownMenuGroup>
                  <DropdownMenuLabel>{configGroup.label}</DropdownMenuLabel>
                  {configGroup.items.map((it) => (
                    <DropdownMenuItem
                      key={it.href}
                      render={<Link href={it.href} />}
                    >
                      <NavRow {...it} />
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <Link href={homeHref} className="shrink-0 font-semibold">
          Tero Admin
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
