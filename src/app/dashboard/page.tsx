import Link from "next/link";
import { addDays, format, isSameDay, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import {
  BadgeCheck,
  CheckCircle2,
  Clock,
  MapPin,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { getAllowedPropertyIds } from "@/lib/auth/scope";
import { PropertyThumb } from "@/components/property-thumb";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { Reservation, Task } from "@/lib/types";
import { ReservationRowActions } from "./reservation-row-actions";
import { SensorAlarmsCard } from "./sensor-alarms-card";
import { EnergySummaryCard } from "./energy-summary-card";
import { PreCheckinCard } from "./pre-checkin-card";

const HORIZON_DAYS = 14;

type ReservationWithProperty = Reservation & {
  property: { id: string; name: string } | null;
};

type DashTask = Task & {
  property: { name: string } | null;
  assignee: { full_name: string | null; email: string } | null;
};

const TASK_KIND_LABEL: Record<Task["kind"], string> = {
  limpieza: "Limpieza",
  mantenimiento: "Mantenimiento",
  insumos: "Insumos",
  otro: "Otro",
};

export default async function DashboardPage() {
  // Scope por property (WIK-94): admin ve todo, gestor/mantenimiento
  // solo sus properties asignadas. Si gestor sin properties, queries
  // devuelven array vacío — correcto.
  const profile = await requireProfile();

  // WIK-119: rol mantenimiento ve un dashboard ultra-simplificado —
  // solo sus tareas. No accede a reservations/sensors/energy (data
  // business-wide que no le toca).
  if (profile.role === "mantenimiento") {
    return <MantenimientoDashboard profileId={profile.id} />;
  }

  const allowedIds = await getAllowedPropertyIds(profile);

  const supabase = await createClient();
  const today = new Date();
  const horizon = addDays(today, HORIZON_DAYS);
  const todayIso = today.toISOString().slice(0, 10);

  // Build queries con el scope aplicado condicional.
  let reservationsQuery = supabase
    .from("reservations")
    .select("*, property:properties(id, name)")
    .or(
      `and(check_in.gte.${todayIso},check_in.lte.${horizon.toISOString().slice(0, 10)}),and(check_out.gte.${todayIso},check_out.lte.${horizon.toISOString().slice(0, 10)})`,
    )
    .order("check_in", { ascending: true });
  if (allowedIds !== null) {
    reservationsQuery = reservationsQuery.in("property_id", allowedIds);
  }

  let tasksQuery = supabase
    .from("tasks")
    .select(
      "*, property:properties(name), assignee:profiles!tasks_assigned_to_fkey(full_name, email)",
    )
    .in("status", ["pending", "in_progress"])
    .or(`due_date.lte.${todayIso},due_date.is.null`)
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(20);
  if (allowedIds !== null) {
    tasksQuery = tasksQuery.in("property_id", allowedIds);
  }

  // WIK-117/119: cards "Insumos" y "Mantenimiento pendiente" eliminadas
  // del dashboard. Las tareas siguen accesibles desde /tasks.

  const [reservationsRes, tasksRes] = await Promise.all([
    reservationsQuery,
    tasksQuery,
  ]);

  const { data, error } = reservationsRes;
  const tasks = (tasksRes.data ?? []) as DashTask[];

  const reservations = (data ?? []) as ReservationWithProperty[];
  const checkIns = reservations.filter((r) =>
    isOnOrAfter(parseISO(r.check_in), today),
  );
  const checkOuts = reservations.filter((r) =>
    isOnOrAfter(parseISO(r.check_out), today),
  );

  // WIK-105: siempre mostrar el agrupamiento por propiedad en los
  // cards de check-in/out, incluso si solo hay 1 property visible
  // hoy. Cuando alguien tiene varias casas, conviene ver siempre
  // de cuál es cada llegada/salida — el "noise" de mostrarlo con
  // 1 sola es mínimo y simplifica el escaneo visual.
  const showProperty = reservations.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Próximos {HORIZON_DAYS} días</h1>
        <p className="text-sm text-muted-foreground">
          {format(today, "EEEE d 'de' MMMM", { locale: es })}
        </p>
      </div>

      {error && (
        <Card>
          <CardContent className="pt-6 text-sm text-destructive">
            No se pudo cargar reservas: {error.message}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <ReservationsCard
          title="Check-ins"
          description="Llegadas próximas"
          rows={checkIns}
          dateField="check_in"
          showProperty={showProperty}
        />
        <ReservationsCard
          title="Check-outs"
          description="Salidas próximas"
          rows={checkOuts}
          dateField="check_out"
          showProperty={showProperty}
        />
      </div>

      {/* WIK-117: cards de Ambientes + Energía con resumen y link.
          Antes: Ambientes solo (alarmas). Ahora: ambas en grid 2x para
          dar pulso rápido de las dos métricas críticas. */}
      <div className="grid gap-6 md:grid-cols-2">
        <SensorAlarmsCard />
        <EnergySummaryCard />
      </div>

      {/* WIK-125: card del pre-checkin conditioning. Solo aparece si hay
          reservas próximas (today/tomorrow) en properties con target temps
          configurados — sino el componente devuelve null. */}
      <PreCheckinCard />

      <TodayTasksCard tasks={tasks} todayIso={todayIso} />
    </div>
  );
}

/**
 * WIK-119: dashboard para rol mantenimiento. Mínimo necesario —
 * solo sus tareas asignadas pendientes. No accede a data
 * business-wide (reservas, sensors, energy).
 */
async function MantenimientoDashboard({ profileId }: { profileId: string }) {
  const supabase = await createClient();
  const todayIso = new Date().toISOString().slice(0, 10);

  const { data: rows } = await supabase
    .from("tasks")
    .select(
      "*, property:properties(name), assignee:profiles!tasks_assigned_to_fkey(full_name, email)",
    )
    .eq("assigned_to", profileId)
    .in("status", ["pending", "in_progress"])
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  const tasks = (rows ?? []) as DashTask[];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Mis tareas</h1>
        <p className="text-sm text-muted-foreground">
          {tasks.length === 0
            ? "No tenés tareas pendientes."
            : `${tasks.length} tarea${tasks.length === 1 ? "" : "s"} pendiente${tasks.length === 1 ? "" : "s"}.`}
        </p>
      </div>
      <TodayTasksCard tasks={tasks} todayIso={todayIso} />
    </div>
  );
}

function KindTasksCard({
  title,
  description,
  tasks,
  emptyText,
  filterHref,
  todayIso,
}: {
  title: string;
  description: string;
  tasks: DashTask[];
  emptyText: string;
  filterHref: string;
  todayIso: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>{title}</span>
          <Link
            href={filterHref}
            className="text-sm font-normal text-muted-foreground hover:text-foreground"
          >
            Ver todas →
          </Link>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {tasks.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-500" />
            {emptyText}
          </p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {tasks.map((t) => {
              const isOverdue = !!t.due_date && t.due_date < todayIso;
              return (
                <li
                  key={t.id}
                  className="flex items-start justify-between gap-3 border-b pb-2 last:border-0 last:pb-0"
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/tasks/${t.id}`}
                      className="font-medium hover:underline"
                    >
                      {t.title}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {t.property?.name ?? "—"}
                      {t.assignee && (
                        <>
                          {" · "}
                          {t.assignee.full_name ?? t.assignee.email}
                        </>
                      )}
                    </div>
                  </div>
                  {t.due_date && (
                    <span
                      className={`whitespace-nowrap text-xs ${isOverdue ? "text-destructive font-medium" : "text-muted-foreground"}`}
                    >
                      {isOverdue ? "Vencida " : ""}
                      {format(parseISO(t.due_date), "d MMM", { locale: es })}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function TodayTasksCard({
  tasks,
  todayIso,
}: {
  tasks: DashTask[];
  todayIso: string;
}) {
  const overdue = tasks.filter(
    (t) => t.due_date && t.due_date < todayIso,
  );
  const dueToday = tasks.filter((t) => t.due_date === todayIso);
  const noDate = tasks.filter((t) => !t.due_date);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Tareas para hoy</span>
          <Link
            href="/tasks?status=pending"
            className="text-sm font-normal text-muted-foreground hover:text-foreground"
          >
            Ver todas →
          </Link>
        </CardTitle>
        <CardDescription>
          {overdue.length > 0
            ? `${overdue.length} vencida${overdue.length === 1 ? "" : "s"}, ${dueToday.length} para hoy`
            : `${dueToday.length} para hoy${noDate.length > 0 ? `, ${noDate.length} sin fecha` : ""}`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {tasks.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-500" />
            Sin tareas vencidas ni para hoy.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tarea</TableHead>
                <TableHead className="hidden md:table-cell">
                  Propiedad
                </TableHead>
                <TableHead className="hidden lg:table-cell">Tipo</TableHead>
                <TableHead className="hidden lg:table-cell">
                  Asignado
                </TableHead>
                <TableHead>Vence</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...overdue, ...dueToday, ...noDate].map((t) => {
                const isOverdue = !!t.due_date && t.due_date < todayIso;
                return (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">
                      <div>{t.title}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground md:hidden">
                        <Badge variant="outline" className="text-xs">
                          {TASK_KIND_LABEL[t.kind]}
                        </Badge>
                        <span>{t.property?.name ?? "—"}</span>
                        <span>·</span>
                        <span>
                          {t.assignee
                            ? (t.assignee.full_name ?? t.assignee.email)
                            : "Sin asignar"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {t.property?.name ?? "—"}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <Badge variant="outline">
                        {TASK_KIND_LABEL[t.kind]}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {t.assignee ? (
                        t.assignee.full_name ?? t.assignee.email
                      ) : (
                        <span className="text-muted-foreground">
                          Sin asignar
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {t.due_date ? (
                        <span
                          className={
                            isOverdue ? "text-destructive font-medium" : ""
                          }
                        >
                          {isOverdue ? "Vencida " : ""}
                          {format(parseISO(t.due_date), "d MMM", {
                            locale: es,
                          })}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function ReservationsCard({
  title,
  description,
  rows,
  dateField,
  showProperty,
}: {
  title: string;
  description: string;
  rows: ReservationWithProperty[];
  dateField: "check_in" | "check_out";
  showProperty: boolean;
}) {
  // Group rows by property when there are multiple distinct properties so
  // the admin can scan check-ins/outs of each place at a glance.
  const grouped = new Map<
    string,
    {
      property: ReservationWithProperty["property"];
      rows: ReservationWithProperty[];
    }
  >();
  for (const r of rows) {
    const key = r.property?.id ?? "__none__";
    if (!grouped.has(key)) grouped.set(key, { property: r.property, rows: [] });
    grouped.get(key)!.rows.push(r);
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin reservas.</p>
        ) : (
          <div className="flex flex-col gap-5">
            {Array.from(grouped.values()).map((group, gi) => (
              <div key={group.property?.id ?? `none-${gi}`}>
                {showProperty && (
                  <div className="mb-2 flex items-center gap-2 border-b pb-1">
                    {group.property && (
                      <PropertyThumb
                        propertyId={group.property.id}
                        size="xs"
                        alt={group.property.name}
                      />
                    )}
                    <span className="text-sm font-semibold">
                      {group.property?.name ?? "Sin propiedad"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      ({group.rows.length})
                    </span>
                  </div>
                )}
                <ul className="flex flex-col divide-y">
                  {group.rows.map((r) => (
                    <li key={r.id} className="py-3 first:pt-0 last:pb-0">
                      <ReservationRow row={r} dateField={dateField} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ReservationRow({
  row,
  dateField,
}: {
  row: ReservationWithProperty;
  dateField: "check_in" | "check_out";
}) {
  const dateStr = format(parseISO(row[dateField]), "EEE d MMM", { locale: es });
  const timeStr =
    dateField === "check_in" ? row.check_in_time : row.check_out_time;
  const groupStr = formatGuestGroup(row);
  return (
    <div className="flex items-start gap-3">
      {row.guest_photo_url ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={row.guest_photo_url}
          alt={row.guest_name ?? "Huésped"}
          className="h-12 w-12 shrink-0 rounded-full border object-cover"
          loading="lazy"
        />
      ) : (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground">
          {row.guest_name?.[0]?.toUpperCase() ?? "?"}
        </div>
      )}
      <Link
        href={`/dashboard/reservations/${row.id}`}
        className="min-w-0 flex-1 hover:underline"
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium">{row.guest_name ?? "—"}</span>
          {row.guest_identity_verified && (
            <span
              className="inline-flex items-center gap-1 text-xs text-muted-foreground"
              title="Identity Verified por Airbnb"
            >
              <BadgeCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-500" />
              verificado
            </span>
          )}
          <Badge variant="secondary" className="text-xs">
            {row.source}
          </Badge>
        </div>
        {row.guest_location && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" aria-hidden />
            {row.guest_location}
          </div>
        )}
        {groupStr && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5" aria-hidden />
            {groupStr}
          </div>
        )}
        <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5" aria-hidden />
          {dateStr}
          {timeStr ? ` · ${timeStr} hs` : ""}
        </div>
      </Link>
      <ReservationRowActions reservation={row} />
    </div>
  );
}

/**
 * Build the Spanish string for the guest group composition.
 * - adults=1, children=0, infants=0 → "1 adulto"
 * - adults=2, children=1, infants=0 → "2 adultos y 1 niño"
 * - adults=2, children=1, infants=1 → "2 adultos, 1 niño y 1 bebé"
 * Falls back to "N huésped(es)" when only `guest_count` is set.
 */
function formatGuestGroup(r: ReservationWithProperty): string | null {
  const parts: string[] = [];
  if (r.guest_adults && r.guest_adults > 0) {
    parts.push(`${r.guest_adults} ${r.guest_adults === 1 ? "adulto" : "adultos"}`);
  }
  if (r.guest_children && r.guest_children > 0) {
    parts.push(
      `${r.guest_children} ${r.guest_children === 1 ? "niño" : "niños"}`,
    );
  }
  if (r.guest_infants && r.guest_infants > 0) {
    parts.push(`${r.guest_infants} ${r.guest_infants === 1 ? "bebé" : "bebés"}`);
  }
  if (parts.length > 0) {
    if (parts.length === 1) return parts[0];
    if (parts.length === 2) return `${parts[0]} y ${parts[1]}`;
    return `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
  }
  if (r.guest_count && r.guest_count > 0) {
    return `${r.guest_count} ${r.guest_count === 1 ? "huésped" : "huéspedes"}`;
  }
  return null;
}

function isOnOrAfter(date: Date, ref: Date) {
  return date >= ref || isSameDay(date, ref);
}
