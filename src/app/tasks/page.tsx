import Link from "next/link";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { getAllowedPropertyIds } from "@/lib/auth/scope";
import {
  Card,
  CardContent,
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
import { ImageIcon } from "lucide-react";
import type { Property, Task } from "@/lib/types";
import { extractPhotos } from "@/lib/whatsapp/create-task";
import { NewTaskDialog } from "./task-form-dialog";
import { TaskRowActions } from "./task-row-actions";

export const dynamic = "force-dynamic";

// WIK-104: simplificado a 2 estados visibles (pending/done). Las
// tareas con status="in_progress" en DB se renderizan como "Pendiente"
// en la UI — el campo no se eliminó del schema para no perder data,
// pero el dropdown de actions ya no permite ir a "en curso".
type StatusFilter = "all" | "pending" | "done";

const STATUS_LABEL: Record<Task["status"], string> = {
  pending: "Pendiente",
  in_progress: "Pendiente",
  done: "Hecha",
};

const STATUS_BADGE: Record<
  Task["status"],
  "default" | "secondary" | "outline"
> = {
  pending: "secondary",
  in_progress: "secondary",
  done: "outline",
};

type TaskWithJoins = Task & {
  property: Pick<Property, "id" | "name"> | null;
  assignee: { id: string; full_name: string | null; email: string } | null;
};

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    property?: string;
    assignee?: string;
  }>;
}) {
  // WIK-109: /tasks es ahora la ÚNICA vista de tareas — accesible a
  // los 3 roles. El filtro de qué se muestra depende del role:
  //   - admin: todas las tareas
  //   - gestor: las asignadas a mí + las que yo reporté/asigné a otros
  //   - mantenimiento: solo las asignadas a mí
  const profile = await requireProfile();
  // `allowedIds` aplica scope por property — admin tiene null y
  // no filtra. Gestor / mantenimiento solo ven properties asignadas.
  const allowedIds = await getAllowedPropertyIds(profile);
  const params = await searchParams;
  const rawStatus = params.status;
  const statusFilter: StatusFilter =
    rawStatus === "pending" || rawStatus === "done" ? rawStatus : "all";
  const propertyFilter = params.property ?? null;
  // assignee=unassigned → only tasks without an assignee
  // assignee=<uuid> → only that user's tasks
  // assignee absent / "all" → no filter
  const assigneeFilter = params.assignee ?? null;

  const supabase = await createClient();
  let query = supabase
    .from("tasks")
    .select(
      "*, property:properties(id, name), assignee:profiles!tasks_assigned_to_fkey(id, full_name, email)",
    )
    .order("status", { ascending: true })
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (statusFilter === "pending") {
    // WIK-104: "Pendiente" engloba pending + in_progress en la UI
    // simplificada — el user no debería ver dos estados distintos.
    query = query.in("status", ["pending", "in_progress"]);
  } else if (statusFilter === "done") {
    query = query.eq("status", "done");
  }
  if (propertyFilter) {
    query = query.eq("property_id", propertyFilter);
  }
  if (assigneeFilter === "unassigned") {
    query = query.is("assigned_to", null);
  } else if (assigneeFilter) {
    query = query.eq("assigned_to", assigneeFilter);
  }

  // WIK-109: filtro automático por role.
  //   - mantenimiento: solo tareas asignadas a él
  //   - gestor: tareas asignadas a él OR reportadas por él
  //   - admin: sin filtro (ve todo lo que el scope de property permita)
  if (profile.role === "mantenimiento") {
    query = query.eq("assigned_to", profile.id);
  } else if (profile.role === "gestor") {
    query = query.or(
      `assigned_to.eq.${profile.id},reported_by.eq.${profile.id}`,
    );
  }
  // WIK-94 scope: gestor solo SUS properties.
  if (allowedIds !== null) {
    query = query.in("property_id", allowedIds);
  }

  // El select de properties también se scopea — el filter UI no debería
  // mostrar properties a las que el gestor no tiene acceso.
  let propsQuery = supabase.from("properties").select("id, name").order("name");
  if (allowedIds !== null) {
    propsQuery = propsQuery.in("id", allowedIds);
  }

  const [tasksRes, propertiesRes, assigneesRes] = await Promise.all([
    query,
    propsQuery,
    supabase
      .from("profiles")
      .select("id, full_name, email, role")
      .order("full_name", { ascending: true }),
  ]);

  const tasks = (tasksRes.data ?? []) as TaskWithJoins[];
  const properties = (propertiesRes.data ?? []) as Pick<
    Property,
    "id" | "name"
  >[];
  const assignees = assigneesRes.data ?? [];
  const todayIso = new Date().toISOString().slice(0, 10);

  // (Counts removidos en WIK-104 — la UI ya no muestra contadores por
  // status, el filtro simple Pendientes/Hechas es suficiente para
  // entender el estado del backlog.)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-semibold">Tareas</h1>
          <p className="text-sm text-muted-foreground">
            {tasks.length} tarea{tasks.length === 1 ? "" : "s"}
            {statusFilter !== "all" && ` (filtrado: ${STATUS_LABEL[statusFilter]})`}
            .
          </p>
        </div>
        <NewTaskDialog
          properties={properties}
          assignees={assignees}
          defaultPropertyId={propertyFilter ?? undefined}
        />
      </div>

      <div className="flex flex-col gap-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <FilterPill
            href={buildTasksUrl({
              status: null,
              property: propertyFilter,
              assignee: assigneeFilter,
            })}
            label="Todas"
            active={statusFilter === "all"}
          />
          <FilterPill
            href={buildTasksUrl({
              status: "pending",
              property: propertyFilter,
              assignee: assigneeFilter,
            })}
            label="Pendientes"
            active={statusFilter === "pending"}
          />
          <FilterPill
            href={buildTasksUrl({
              status: "done",
              property: propertyFilter,
              assignee: assigneeFilter,
            })}
            label="Hechas"
            active={statusFilter === "done"}
          />

          {properties.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
              <span className="text-muted-foreground">Propiedad:</span>
              <Link
                href={buildTasksUrl({
                  status:
                    statusFilter === "all" ? null : statusFilter,
                  property: null,
                  assignee: assigneeFilter,
                })}
                className={`rounded-full px-3 py-1 ${propertyFilter ? "hover:bg-muted" : "bg-muted font-medium"}`}
              >
                Todas
              </Link>
              {properties.map((p) => (
                <Link
                  key={p.id}
                  href={buildTasksUrl({
                    status:
                      statusFilter === "all" ? null : statusFilter,
                    property: p.id,
                    assignee: assigneeFilter,
                  })}
                  className={`rounded-full px-3 py-1 ${propertyFilter === p.id ? "bg-muted font-medium" : "hover:bg-muted"}`}
                >
                  {p.name}
                </Link>
              ))}
            </div>
          )}
        </div>

        {assignees.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">Asignado:</span>
            <Link
              href={buildTasksUrl({
                status:
                  statusFilter === "all" ? null : statusFilter,
                property: propertyFilter,
                assignee: null,
              })}
              className={`rounded-full px-3 py-1 ${assigneeFilter ? "hover:bg-muted" : "bg-muted font-medium"}`}
            >
              Todos
            </Link>
            <Link
              href={buildTasksUrl({
                status:
                  statusFilter === "all" ? null : statusFilter,
                property: propertyFilter,
                assignee: "unassigned",
              })}
              className={`rounded-full px-3 py-1 ${assigneeFilter === "unassigned" ? "bg-muted font-medium" : "hover:bg-muted"}`}
            >
              Sin asignar
            </Link>
            {assignees.map((a) => (
              <Link
                key={a.id}
                href={buildTasksUrl({
                  status:
                    statusFilter === "all" ? null : statusFilter,
                  property: propertyFilter,
                  assignee: a.id,
                })}
                className={`rounded-full px-3 py-1 ${assigneeFilter === a.id ? "bg-muted font-medium" : "hover:bg-muted"}`}
              >
                {a.full_name?.split(" ")[0] ?? a.email.split("@")[0]}
              </Link>
            ))}
          </div>
        )}
      </div>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Título</TableHead>
                <TableHead className="hidden md:table-cell">
                  Propiedad
                </TableHead>
                <TableHead className="hidden lg:table-cell">
                  Asignado
                </TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="hidden sm:table-cell">Vence</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center text-muted-foreground"
                  >
                    Sin tareas. Creá una con el botón <em>Nueva tarea</em>.
                  </TableCell>
                </TableRow>
              ) : (
                tasks.map((t) => {
                  const { urls: photos, cleaned } = extractPhotos(
                    t.description,
                  );
                  return (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/tasks/${t.id}`}
                        className="flex items-center gap-2 hover:underline"
                      >
                        <span>{t.title}</span>
                        {photos.length > 0 && (
                          <span
                            className="inline-flex items-center gap-0.5 text-muted-foreground"
                            title={`${photos.length} foto${photos.length === 1 ? "" : "s"} adjunta${photos.length === 1 ? "" : "s"}`}
                          >
                            <ImageIcon className="h-3.5 w-3.5" />
                            {photos.length > 1 && (
                              <span className="text-xs">
                                ×{photos.length}
                              </span>
                            )}
                          </span>
                        )}
                      </Link>
                      {cleaned && (
                        <div className="text-xs text-muted-foreground line-clamp-1">
                          {cleaned}
                        </div>
                      )}
                      {/* On mobile we hide the Propiedad/Asignado columns;
                          surface them under the title so la info no se
                          pierde. */}
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground md:hidden">
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
                      {t.assignee ? (
                        t.assignee.full_name ?? t.assignee.email
                      ) : (
                        <span className="text-muted-foreground">
                          Sin asignar
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_BADGE[t.status]}>
                        {STATUS_LABEL[t.status]}
                      </Badge>
                      {/* Mobile-only: due date underneath the status badge
                          (the dedicated Vence column is hidden < sm). */}
                      {t.due_date && (
                        <div className="mt-1 text-xs sm:hidden">
                          <span
                            className={
                              t.status !== "done" && t.due_date < todayIso
                                ? "text-destructive font-medium"
                                : "text-muted-foreground"
                            }
                          >
                            {t.status !== "done" && t.due_date < todayIso
                              ? "Vencida "
                              : ""}
                            {format(parseISO(t.due_date), "d MMM", {
                              locale: es,
                            })}
                          </span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {t.due_date ? (
                        <span
                          className={
                            t.status !== "done" && t.due_date < todayIso
                              ? "text-destructive font-medium"
                              : ""
                          }
                        >
                          {t.status !== "done" && t.due_date < todayIso
                            ? "Vencida "
                            : ""}
                          {format(parseISO(t.due_date), "d MMM", {
                            locale: es,
                          })}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      <TaskRowActions
                        task={t}
                        properties={properties}
                        assignees={assignees}
                        isAdmin={profile.role === "admin"}
                      />
                    </TableCell>
                  </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function FilterPill({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-1 ${
        active ? "bg-foreground text-background font-medium" : "hover:bg-muted"
      }`}
    >
      {label}
    </Link>
  );
}

/**
 * Build a `/tasks` URL preserving the filters that aren't being changed. Each
 * filter accepts null to clear it.
 */
function buildTasksUrl(filters: {
  status: StatusFilter | null;
  property: string | null;
  assignee: string | null;
}): string {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.property) params.set("property", filters.property);
  if (filters.assignee) params.set("assignee", filters.assignee);
  const qs = params.toString();
  return qs ? `/tasks?${qs}` : "/tasks";
}
