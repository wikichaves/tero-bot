import Link from "next/link";
import { Bird, ChevronDown, Menu } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { getAllowedPropertyIds } from "@/lib/auth/scope";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { UserDropdown } from "@/components/user-dropdown";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";
import { getActiveCountry } from "@/lib/country";
import { CountrySwitcher } from "@/components/country-switcher";

/**
 * Navegación primaria: Tareas, Ambientes, Reservas y Cámaras quedan como
 * leaves; Dinero y Comercial agrupan destinos relacionados. Admin abre un
 * índice descriptivo de superficies de baja frecuencia. En mobile se conserva
 * la misma jerarquía dentro de un Sheet.
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
};

export async function SiteHeader({ profile }: { profile: Profile }) {
  const t = await getTranslations("nav");
  // WIK-74: "limpieza" se unificó en "mantenimiento". Antes el chequeo
  // era `role === "limpieza" || role === "mantenimiento"`.
  const isStaff = profile.role === "mantenimiento";
  const homeHref = isStaff ? "/my-tasks" : "/dashboard";
  const allowedCountryIds = await getAllowedPropertyIds(profile);
  const activeCountry = await getActiveCountry(allowedCountryIds);

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
          label: t("tasks"),
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
          //
          // WIK-162: las superficies de uso más frecuente quedan como
          // leaves directos, en este orden.
          {
            href: "/tasks",
            label: t("tasks"),
            badge: myOpen,
            urgent: myOverdue > 0,
          },
          {
            href: "/rooms",
            label: t("rooms"),
            badge: alarmsActive,
            urgent: alarmsActive > 0,
          },
          { href: "/reservations", label: t("reservations") },
          { href: "/cameras", label: t("cameras") },
        ]
      : [];

  const navGroups: NavGroup[] =
    profile.role === "admin" || profile.role === "gestor"
      ? [
          {
            label: t("money"),
            items: [
              { href: "/energy", label: t("energy") },
              { href: "/bills", label: t("bills") },
              { href: "/expenses", label: t("expenses") },
              { href: "/earnings", label: t("earnings") },
            ],
          },
          {
            label: t("commercial"),
            items: [
              { href: "/leads", label: t("leads") },
              { href: "/whatsapp", label: t("whatsappInbox") },
            ],
          },
        ]
      : [];

  const adminLeaf: NavLeaf | null =
    profile.role === "admin"
      ? { href: "/admin", label: t("admin") }
      : null;

  return (
    <>
      {/* WIK-247: pull-to-refresh para la PWA instalada (en standalone el
          gesto nativo está deshabilitado por WIK-240). Se monta una vez acá
          porque SiteHeader es el único componente compartido por todas las
          páginas logged-in. No hace nada fuera de standalone. */}
      <PullToRefresh />
      {/* WIK-152: matchear el header del landing — sticky top + backdrop
          blur + mismo padding (py-4 px-5/sm:px-8) para que la transición
          landing → dashboard se sienta sin saltos visuales.
          WIK-240: pt incluye env(safe-area-inset-top) para que en la PWA iOS
          (statusBarStyle black-translucent + viewport-fit cover) el contenido
          del header no quede bajo el notch/status bar. En browser el inset es
          0px (fallback), así que el padding queda en el py-4 de siempre. */}
      <header className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-border/60 bg-background/80 px-5 pb-4 pt-[calc(1rem+env(safe-area-inset-top,0px))] backdrop-blur-md supports-[backdrop-filter]:bg-background/60 sm:px-8">
      <div className="flex min-w-0 items-center gap-3 sm:gap-6">
        {/* Mobile sheet con la misma jerarquía del nav desktop. */}
        <Sheet>
          <SheetTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                aria-label={t("openMenu")}
              />
            }
          >
            <Menu className="h-5 w-5" />
          </SheetTrigger>
          <SheetContent side="left" className="w-80 max-w-[85vw] overflow-y-auto">
            <SheetHeader className="pt-[calc(1rem+env(safe-area-inset-top,0px))]">
              <SheetTitle>{t("openMenu")}</SheetTitle>
            </SheetHeader>
            <nav className="flex flex-col gap-5 px-4 pb-6">
              <div className="flex flex-col gap-1">
                {[...staffLeaves, ...operationalLeaves].map((it) => (
                  <MobileNavLink key={it.href} item={it} />
                ))}
              </div>
              {navGroups.map((group) => (
                <div key={group.label} className="flex flex-col gap-1">
                  <p className="px-3 py-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {group.label}
                  </p>
                  {group.items.map((it) => (
                    <MobileNavLink key={it.href} item={it} />
                  ))}
                </div>
              ))}
              {adminLeaf && (
                <div className="border-t border-border/60 pt-4">
                  <MobileNavLink item={adminLeaf} />
                </div>
              )}
            </nav>
          </SheetContent>
        </Sheet>

        {/* WIK-114: bird icon a la izquierda del título. Mismo color
            que el texto para que se sienta una sola unidad. */}
        <Link
          href={homeHref}
          className="flex shrink-0 items-center gap-2 text-base font-semibold tracking-tight"
        >
          <Bird className="h-5 w-5" />
          tero.bot
        </Link>

        {/* Desktop inline nav. */}
        <nav className="hidden min-w-0 items-center gap-5 overflow-x-auto text-sm font-medium text-muted-foreground md:flex">
          {staffLeaves.map((it) => (
            <NavLink key={it.href} {...it} overdueTooltip={t("overdueTooltip")} />
          ))}
          {operationalLeaves.map((it) => (
            <NavLink key={it.href} {...it} overdueTooltip={t("overdueTooltip")} />
          ))}
          {navGroups.map((group) => (
            <NavDropdown key={group.label} group={group} />
          ))}
          {adminLeaf && <NavLink {...adminLeaf} />}
        </nav>
      </div>
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        {!isStaff && <CountrySwitcher country={activeCountry} />}
        {/* WIK-151: ModeToggle se movió al footer global (junto con
            LanguageSelector). Acá queda solo el user dropdown. */}
        {/* WIK-112: el span con email + form Salir se reemplazó por un
            dropdown con info del user + Editar + Salir. */}
        <UserDropdown profile={profile} />
      </div>
    </header>
    </>
  );
}

function MobileNavLink({ item }: { item: NavLeaf }) {
  return (
    <SheetClose
      render={
        <Link
          href={item.href}
          className="flex min-h-10 items-center rounded-lg px-3 py-2 text-sm font-medium hover:bg-muted"
        />
      }
    >
      <NavRow {...item} />
    </SheetClose>
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
 *  match con el estilo previo.
 *
 *  El `overdueTooltip` viene como prop porque NavLink es una pure
 *  function (no async server component), así que no puede llamar a
 *  `getTranslations` directamente — el SiteHeader lo resuelve y se lo
 *  pasa. (WIK-151) */
function NavLink({
  href,
  label,
  badge,
  urgent = false,
  overdueTooltip,
}: NavLeaf & { overdueTooltip?: string }) {
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
          title={urgent ? overdueTooltip : undefined}
        >
          {badge}
        </span>
      )}
    </Link>
  );
}

/** Dropdown agrupador (Dinero / Comercial). El trigger es un botón
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
