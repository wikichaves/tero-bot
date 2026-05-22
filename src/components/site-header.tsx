import Link from "next/link";
import { Bird, ChevronDown, Menu } from "lucide-react";
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
import { UserDropdown } from "@/components/user-dropdown";
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

  // WIK-109: ya no contamos teamOpen/teamOverdue — el badge del item
  // "Tareas" en el nav ahora muestra solo `myOpen` (asignadas a mí).
  // Solo necesitamos el count de alarmas activas (badge de Ambientes).
  let alarmsActive = 0;
  if (profile.role === "admin" || profile.role === "gestor") {
    const allowedIds = await getAllowedPropertyIds(profile);
    let alarmsQ = supabase
      .from("alarm_events")
      .select("id, property_device:property_devices!inner(property_id)", {
        count: "exact",
        head: true,
      })
      .is("resolved_at", null);
    if (allowedIds !== null) {
      alarmsQ = alarmsQ.in("property_device.property_id", allowedIds);
    }
    const alarmsRes = await alarmsQ;
    alarmsActive = alarmsRes.count ?? 0;
  }

  // WIK-109: una sola sección "Tareas" → /tasks para los 3 roles.
  // El filtro de qué se muestra ahí depende del role (admin todas,
  // gestor suyas+las que asignó, mantenimiento solo suyas).
  //
  // Badge en el menú = SOLO tareas asignadas a mí (`myOpen`). Si un
  // admin ve N tareas pero ninguna le toca, no aparece badge — eso
  // es lo que pidió el ticket: "Si sos Admin y ves 2 tareas pero
  // ninguna está asignada a ti, no mostrar badge".
  const staffLeaves: NavLeaf[] = isStaff
    ? [
        {
          href: "/tasks",
          label: "Tareas",
          badge: myOpen,
          urgent: myOverdue > 0,
        },
      ]
    : [];

  // El dropdown "Tareas" desaparece — admin/gestor también usan un
  // leaf directo. (El JSX que lo renderizaba se eliminó abajo.)

  const operationalLeaves: NavLeaf[] =
    profile.role === "admin" || profile.role === "gestor"
      ? [
          // WIK-109: leaf "Tareas" para admin y gestor también
          // (mantenimiento ya lo tiene en `staffLeaves`). Badge =
          // tareas asignadas a mí — admin con 0 asignadas no ve badge.
          {
            href: "/tasks",
            label: "Tareas",
            badge: myOpen,
            urgent: myOverdue > 0,
          },
          { href: "/facturas", label: "Facturas" },
          { href: "/energy", label: "Energía" },
          {
            href: "/ambientes",
            label: "Ambientes",
            badge: alarmsActive,
            urgent: alarmsActive > 0,
          },
          // WIK-108: WhatsApp se movió al submenú Configuración (definido
          // abajo) — antes vivía como leaf operacional para admin.
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
            // WIK-108: WhatsApp inbox movido acá. Antes era un leaf
            // del nav principal — el admin usa /whatsapp con poca
            // frecuencia comparado con Energía/Ambientes, ubicación
            // en submenu refleja mejor la frecuencia de uso.
            { href: "/whatsapp", label: "WhatsApp Inbox" },
            { href: "/admin/whatsapp", label: "WhatsApp Templates" },
          ],
        }
      : null;

  return (
    <header className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3.5 sm:px-6">
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
            {/* WIK-110: link "Inicio" como primer item del menú.
                WIK-115: sin icono — solo texto. */}
            <DropdownMenuItem render={<Link href={homeHref} />}>
              <span className="flex-1">Inicio</span>
            </DropdownMenuItem>
            {staffLeaves.map((it) => (
              <DropdownMenuItem key={it.href} render={<Link href={it.href} />}>
                <NavRow {...it} />
              </DropdownMenuItem>
            ))}
            {/* WIK-109: el dropdown "Tareas" desapareció — ahora es
                un leaf directo en operationalLeaves (más abajo). */}
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

        {/* WIK-114: bird icon a la izquierda del título. Mismo color
            que el texto para que se sienta una sola unidad. */}
        <Link
          href={homeHref}
          className="flex shrink-0 items-center gap-2 text-base font-semibold tracking-tight"
        >
          <Bird className="h-5 w-5" />
          Tero Admin
        </Link>

        {/* Desktop inline nav. */}
        <nav className="hidden min-w-0 items-center gap-5 overflow-x-auto text-sm font-medium text-muted-foreground md:flex">
          {/* WIK-110: Inicio como primer item del nav.
              WIK-115: sin icono Home, solo el texto. */}
          <Link
            href={homeHref}
            className="hover:text-foreground"
            aria-label="Inicio"
          >
            Inicio
          </Link>
          {staffLeaves.map((it) => (
            <NavLink key={it.href} {...it} />
          ))}
          {operationalLeaves.map((it) => (
            <NavLink key={it.href} {...it} />
          ))}
          {configGroup && <NavDropdown group={configGroup} />}
        </nav>
      </div>
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <ModeToggle />
        {/* WIK-112: el span con email + form Salir se reemplazó por un
            dropdown con info del user + Editar + Salir. */}
        <UserDropdown profile={profile} />
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
