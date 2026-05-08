import Link from "next/link";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
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

type StatusFilter = "all" | Task["status"];

const STATUS_LABEL: Record<Task["status"], string> = {
  pending: "Pendiente",
  in_progress: "En curso",
  done: "Hecha",
};

const KIND_LABEL: Record<Task["kind"], string> = {
  limpieza: "Limpieza",
  mantenimiento: "Mantenimiento",
  insumos: "Insumos",
  otro: "Otro",
};

const STATUS_BADGE: Record<Task["status"], "default" | "secondary" | "outline"> = {
  pending: "secondary",
  in_progress: "default",
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
  const profile = await requireRole(["admin", "gestor"]);
  const params = await searchParams;
  const statusFilter = (params.status as StatusFilter) ?? "all";
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
  if (statusFilter !== "all") {
    query = query.eq("status", statusFilter);
  }
  if (propertyFilter) {
    query = query.eq("property_id", propertyFilter);
  }
  if (assigneeFilter === "unassigned") {
    query = query.is("assigned_to", null);
  } else if (assigneeFilter) {
    query = query.eq("assigned_to", assigneeFilter);
  }

  const [tasksRes, propertiesRes, assigneesRes] = await Promise.all([
    query,
    supabase.from("properties").select("id, name").order("name"),
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

  const counts = {
    all: 0,
    pending: 0,
    in_progress: 0,
    done: 0,
  };
  // Count requires a separate query for accurate totals (the filter above
  // narrowed the result). For MVP, derive from current set if status=all,
  // otherwise show "(filtrado)".
  if (statusFilter === "all") {
    for (const t of tasks) {
      counts.all++;
      counts[t.status]++;
    }
  } else {
    counts[statusFilter] = tasks.length;
  }

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
              status: "in_progress",
              property: propertyFilter,
              assignee: assigneeFilter,
            })}
            label="En curso"
            active={statusFilter === "in_progress"}
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
                <TableHead className="hidden lg:table-cell">Tipo</TableHead>
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
                    colSpan={7}
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
                      {/* On mobile we hide the Propiedad/Tipo/Asignado
                          columns; surface them under the title so the info
                          isn't lost. */}
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground md:hidden">
                        <Badge variant="outline" className="text-xs">
                          {KIND_LABEL[t.kind]}
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
                      <Badge variant="outline">{KIND_LABEL[t.kind]}</Badge>
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
