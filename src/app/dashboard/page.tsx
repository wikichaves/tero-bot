import Link from "next/link";
import { parseISO } from "date-fns";
import { getLocale, getTranslations } from "next-intl/server";
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
import { maybeSnapshotIfStale } from "@/lib/tuya/snapshots";
import { maybeSnapshotSensorsIfStale } from "@/lib/sensors/snapshots";
import {
  formatDayShortDate,
  formatLongDate,
  formatShortDate,
} from "@/lib/i18n/date";
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

type ReservationWithProperty = Reservation & {
  property: { id: string; name: string } | null;
};

type DashboardProperty = { id: string; name: string };

type NextStay = {
  reservation: ReservationWithProperty;
  dateField: "check_in" | "check_out";
};

type DashTask = Task & {
  property: { name: string } | null;
  assignee: { full_name: string | null; email: string } | null;
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
  const t = await getTranslations("dashboard");
  const locale = await getLocale();

  // WIK-161: snapshot opportunistically si la última captura tiene
  // >60min. Históricamente esto solo corría en /energy y /rooms, pero
  // Vercel Hobby plan limita el total de cron invocations diarios
  // (~2/día) — con 7 crons declarados, el hourly de energy/sensores
  // termina firing una vez al día. Resultado: gaps de horas en los
  // charts. Añadir el trigger al dashboard (la página que admin/gestor
  // abren varias veces por día) eleva la frecuencia efectiva de
  // snapshots y reduce los gaps visibles. Best-effort, fire-and-
  // forget — errors no rompen el render.
  await Promise.all([
    maybeSnapshotIfStale(60).catch(() => null),
    maybeSnapshotSensorsIfStale(60).catch(() => null),
  ]);

  const supabase = await createClient();
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);

  // El Home muestra la próxima operación de cada propiedad: la salida si
  // ya está ocupada; si no, la próxima llegada. No usa una ventana fija.
  let reservationsQuery = supabase
    .from("reservations")
    .select("*, property:properties(id, name)")
    .neq("status", "cancelled")
    .gte("check_out", todayIso)
    .order("check_in", { ascending: true });
  if (allowedIds !== null) {
    reservationsQuery = reservationsQuery.in("property_id", allowedIds);
  }

  let propertiesQuery = supabase
    .from("properties")
    .select("id, name")
    .order("name");
  if (allowedIds !== null) {
    propertiesQuery = propertiesQuery.in("id", allowedIds);
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

  const [reservationsRes, propertiesRes, tasksRes] = await Promise.all([
    reservationsQuery,
    propertiesQuery,
    tasksQuery,
  ]);

  const { data, error } = reservationsRes;
  const tasks = (tasksRes.data ?? []) as DashTask[];

  const reservations = (data ?? []) as ReservationWithProperty[];
  const properties = (propertiesRes.data ?? []) as DashboardProperty[];
  const nextStaysByProperty = new Map<string, NextStay>();
  for (const property of properties) {
    const propertyReservations = reservations.filter(
      (reservation) => reservation.property_id === property.id,
    );
    const activeStay = propertyReservations.find(
      (reservation) =>
        reservation.check_in < todayIso && reservation.check_out >= todayIso,
    );
    const upcomingStay = propertyReservations.find(
      (reservation) => reservation.check_in >= todayIso,
    );
    const reservation = activeStay ?? upcomingStay;
    if (reservation) {
      nextStaysByProperty.set(property.id, {
        reservation,
        dateField: activeStay ? "check_out" : "check_in",
      });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-4xl">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">
          {formatLongDate(today, locale)}
        </p>
      </div>

      {error && (
        <Card>
          <CardContent className="pt-6 text-sm text-destructive">
            {t("errorLoadingReservations", { error: error.message })}
          </CardContent>
        </Card>
      )}

      <NextStaysCard
        properties={properties}
        nextStaysByProperty={nextStaysByProperty}
      />

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
  const t = await getTranslations("dashboard");
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
        <h1 className="text-4xl">{t("myTasksTitle")}</h1>
        <p className="text-sm text-muted-foreground">
          {tasks.length === 0
            ? t("myTasksEmpty")
            : t("myTasksCount", { n: tasks.length })}
        </p>
      </div>
      <TodayTasksCard tasks={tasks} todayIso={todayIso} />
    </div>
  );
}

async function TodayTasksCard({
  tasks,
  todayIso,
}: {
  tasks: DashTask[];
  todayIso: string;
}) {
  const t = await getTranslations("dashboard");
  const tKind = await getTranslations("tasks.kind");
  const locale = await getLocale();
  const overdue = tasks.filter(
    (task) => task.due_date && task.due_date < todayIso,
  );
  const dueToday = tasks.filter((task) => task.due_date === todayIso);
  const noDate = tasks.filter((task) => !task.due_date);
  const noDateSuffix =
    noDate.length > 0 ? t("tasksNoDateSuffix", { n: noDate.length }) : "";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>{t("tasksTitle")}</span>
          <Link
            href="/tasks?status=pending"
            className="text-sm font-normal text-muted-foreground hover:text-foreground"
          >
            {t("viewAll")}
          </Link>
        </CardTitle>
        <CardDescription>
          {overdue.length > 0
            ? t("tasksDescriptionOverdue", {
                overdue: overdue.length,
                s: overdue.length === 1 ? "" : "s",
                today: dueToday.length,
              })
            : t("tasksDescriptionNoOverdue", {
                today: dueToday.length,
                noDateSuffix,
              })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {tasks.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-500" />
            {t("tasksAllClear")}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("tableTask")}</TableHead>
                <TableHead className="hidden md:table-cell">
                  {t("tableProperty")}
                </TableHead>
                <TableHead className="hidden lg:table-cell">
                  {t("tableKind")}
                </TableHead>
                <TableHead className="hidden lg:table-cell">
                  {t("tableAssigned")}
                </TableHead>
                <TableHead>{t("tableDue")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...overdue, ...dueToday, ...noDate].map((task) => {
                const isOverdue = !!task.due_date && task.due_date < todayIso;
                return (
                  <TableRow key={task.id}>
                    {/* WIK-174: en mobile (370px) los títulos largos
                        ("Se marcó la pared. Llamar al pintor") se
                        clippeaban porque TableCell default tiene
                        `whitespace-nowrap`. `whitespace-normal break-words`
                        + min-w-0 dejan que el title wrapee en múltiples
                        líneas y los textos largos del summary mobile
                        (assignee name) tampoco corten. */}
                    <TableCell className="min-w-0 font-medium whitespace-normal break-words">
                      <div>{task.title}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground md:hidden">
                        <Badge variant="outline" className="text-xs">
                          {tKind(task.kind)}
                        </Badge>
                        <span>{task.property?.name ?? "—"}</span>
                        <span>·</span>
                        <span>
                          {task.assignee
                            ? (task.assignee.full_name ?? task.assignee.email)
                            : t("unassigned")}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {task.property?.name ?? "—"}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <Badge variant="outline">{tKind(task.kind)}</Badge>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {task.assignee ? (
                        task.assignee.full_name ?? task.assignee.email
                      ) : (
                        <span className="text-muted-foreground">
                          {t("unassigned")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {task.due_date ? (
                        <span
                          className={
                            isOverdue ? "text-destructive font-medium" : ""
                          }
                        >
                          {isOverdue ? `${t("overdueShort")} ` : ""}
                          {formatShortDate(parseISO(task.due_date), locale)}
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

async function NextStaysCard({
  properties,
  nextStaysByProperty,
}: {
  properties: DashboardProperty[];
  nextStaysByProperty: Map<string, NextStay>;
}) {
  const t = await getTranslations("dashboard");
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("nextStaysTitle")}</CardTitle>
        <CardDescription>{t("nextStaysDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        {properties.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noProperties")}</p>
        ) : (
          <div className="grid gap-5 md:grid-cols-2">
            {properties.map((property) => {
              const nextStay = nextStaysByProperty.get(property.id);
              return (
                <div key={property.id} className="min-w-0">
                  <div className="mb-3 flex items-center gap-2 border-b pb-2">
                    <PropertyThumb
                      propertyId={property.id}
                      size="xs"
                      alt={property.name}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                      {property.name}
                    </span>
                    {nextStay && (
                      <span className="text-xs text-muted-foreground">
                        {nextStay.dateField === "check_in"
                          ? t("checkInLabel")
                          : t("checkOutLabel")}
                      </span>
                    )}
                  </div>
                  {nextStay ? (
                    <ReservationRow
                      row={nextStay.reservation}
                      dateField={nextStay.dateField}
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {t("noUpcomingStay")}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

async function ReservationRow({
  row,
  dateField,
}: {
  row: ReservationWithProperty;
  dateField: "check_in" | "check_out";
}) {
  const t = await getTranslations("dashboard");
  const tSources = await getTranslations("reservations.sources");
  const locale = await getLocale();
  const dateStr = formatDayShortDate(parseISO(row[dateField]), locale);
  const timeStr =
    dateField === "check_in" ? row.check_in_time : row.check_out_time;
  const groupStr = await formatGuestGroup(row);
  return (
    <div className="flex items-start gap-3">
      {row.guest_photo_url ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={row.guest_photo_url}
          alt={row.guest_name ?? t("guest")}
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
              title={t("verifiedTooltip")}
            >
              <BadgeCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-500" />
              {t("verifiedLabel")}
            </span>
          )}
          {/* WIK-168: el tag de source antes mostraba el valor raw
              ("airbnb"). Ahora pasa por el namespace de traducciones
              que lo capitaliza apropiadamente ("Airbnb", "Booking",
              "Manual"). */}
          <Badge variant="secondary" className="text-xs">
            {tSources(row.source)}
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
 * Build the guest group composition string in the active locale.
 * - adults=1 → "1 adulto" / "1 adult"
 * - adults=2, children=1 → "2 adultos y 1 niño" / "2 adults and 1 child"
 * Falls back to "N huésped(es)" / "N guest(s)" when only `guest_count`
 * is set.
 */
async function formatGuestGroup(
  r: ReservationWithProperty,
): Promise<string | null> {
  const t = await getTranslations("guests");
  const parts: string[] = [];
  if (r.guest_adults && r.guest_adults > 0) {
    parts.push(
      r.guest_adults === 1
        ? t("adultsOne", { n: 1 })
        : t("adultsOther", { n: r.guest_adults }),
    );
  }
  if (r.guest_children && r.guest_children > 0) {
    parts.push(
      r.guest_children === 1
        ? t("childrenOne", { n: 1 })
        : t("childrenOther", { n: r.guest_children }),
    );
  }
  if (r.guest_infants && r.guest_infants > 0) {
    parts.push(
      r.guest_infants === 1
        ? t("infantsOne", { n: 1 })
        : t("infantsOther", { n: r.guest_infants }),
    );
  }
  if (parts.length > 0) {
    if (parts.length === 1) return parts[0];
    const and = t("and");
    if (parts.length === 2) return `${parts[0]} ${and} ${parts[1]}`;
    return `${parts.slice(0, -1).join(", ")} ${and} ${parts[parts.length - 1]}`;
  }
  if (r.guest_count && r.guest_count > 0) {
    return r.guest_count === 1
      ? t("guestsOne", { n: 1 })
      : t("guestsOther", { n: r.guest_count });
  }
  return null;
}
