import Link from "next/link";
import { addDays, format, isSameDay, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { createClient } from "@/lib/supabase/server";
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

const HORIZON_DAYS = 14;

type ReservationWithProperty = Reservation & {
  property: { name: string } | null;
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
  const supabase = await createClient();
  const today = new Date();
  const horizon = addDays(today, HORIZON_DAYS);
  const todayIso = today.toISOString().slice(0, 10);

  const [reservationsRes, tasksRes] = await Promise.all([
    supabase
      .from("reservations")
      .select("*, property:properties(name)")
      .or(
        `and(check_in.gte.${todayIso},check_in.lte.${horizon.toISOString().slice(0, 10)}),and(check_out.gte.${todayIso},check_out.lte.${horizon.toISOString().slice(0, 10)})`,
      )
      .order("check_in", { ascending: true }),
    // Open tasks (pending or in_progress) due today or earlier (overdue) —
    // plus tasks with no due date so they stay visible.
    supabase
      .from("tasks")
      .select(
        "*, property:properties(name), assignee:profiles!tasks_assigned_to_fkey(full_name, email)",
      )
      .in("status", ["pending", "in_progress"])
      .or(`due_date.lte.${todayIso},due_date.is.null`)
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(20),
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

  // Show the "Propiedad" column only when there's more than one distinct
  // property in the visible window — for a single-property setup the column
  // is just noise.
  const distinctProperties = new Set(reservations.map((r) => r.property_id));
  const showProperty = distinctProperties.size > 1;

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

      <TodayTasksCard tasks={tasks} todayIso={todayIso} />
    </div>
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
          <p className="text-sm text-muted-foreground">
            Sin tareas vencidas ni para hoy. ✨
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tarea</TableHead>
                <TableHead>Propiedad</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Asignado</TableHead>
                <TableHead>Vence</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...overdue, ...dueToday, ...noDate].map((t) => {
                const isOverdue = !!t.due_date && t.due_date < todayIso;
                return (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.title}</TableCell>
                    <TableCell>{t.property?.name ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {TASK_KIND_LABEL[t.kind]}
                      </Badge>
                    </TableCell>
                    <TableCell>
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                {showProperty && <TableHead>Propiedad</TableHead>}
                <TableHead>Huésped</TableHead>
                <TableHead>Origen</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    {format(parseISO(r[dateField]), "EEE d MMM", {
                      locale: es,
                    })}
                  </TableCell>
                  {showProperty && (
                    <TableCell>{r.property?.name ?? "—"}</TableCell>
                  )}
                  <TableCell>{r.guest_name ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{r.source}</Badge>
                  </TableCell>
                  <TableCell>
                    <ReservationRowActions reservation={r} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function isOnOrAfter(date: Date, ref: Date) {
  return date >= ref || isSameDay(date, ref);
}
