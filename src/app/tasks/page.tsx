import Link from "next/link";
import { parseISO } from "date-fns";
import { getLocale, getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireProfile } from "@/lib/auth";
import { getAllowedPropertyIds } from "@/lib/auth/scope";
import { formatShortDate } from "@/lib/i18n/date";
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
import { FilterDropdown } from "./filter-dropdown";

export const dynamic = "force-dynamic";

// WIK-104: simplificado a 2 estados visibles (pending/done). Las
// tareas con status="in_progress" en DB se renderizan como "Pendiente"
// en la UI — el campo no se eliminó del schema para no perder data,
// pero el dropdown de actions ya no permite ir a "en curso".
type StatusFilter = "all" | "pending" | "done";

// WIK-151: el label se resuelve via t() — `in_progress` se mapea al
// mismo string que `pending` (UI simplificada de WIK-104).
function statusBadgeLabelKey(status: Task["status"]): "pending" | "done" {
  return status === "done" ? "done" : "pending";
}

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
  //   - gestor (Manager): TODAS las tareas de sus propiedades asignadas
  //     (incl. las de Staff) — WIK-245. Antes solo veía las asignadas a
  //     él + las que él reportó; ahora ve todo lo que pasa en su scope.
  //   - mantenimiento (Staff): solo las asignadas a él
  const profile = await requireProfile();
  const t = await getTranslations("tasksPage");
  const tFilters = await getTranslations("tasksPage.filters");
  const tTable = await getTranslations("tasksPage.table");
  const tBadge = await getTranslations("tasksPage.statusBadge");
  const locale = await getLocale();
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

  // WIK-109 / WIK-245: filtro automático por role.
  //   - mantenimiento (Staff): solo tareas asignadas a él
  //   - gestor (Manager): SIN filtro por assignee — ve todas las tareas
  //     de sus propiedades (el scope por property de abajo lo acota).
  //     WIK-245 removió el narrowing `assigned_to=me OR reported_by=me`
  //     que antes lo limitaba a "sus" tareas; un Manager debe ver todo
  //     lo que hace el Staff de sus propiedades.
  //   - admin: sin filtro (ve todo lo que el scope de property permita)
  if (profile.role === "mantenimiento") {
    query = query.eq("assigned_to", profile.id);
  }
  // WIK-94 scope: gestor/Manager solo SUS properties (admin = null = todas).
  if (allowedIds !== null) {
    query = query.in("property_id", allowedIds);
  }

  // El select de properties se scopea por allowedIds — el filter UI y el
  // diálogo "Nueva tarea" no deberían mostrar properties fuera del scope.
  // WIK-250: se usa el admin client (en vez del RLS client) porque
  // `properties_read` bloquea a Staff (mantenimiento) — sin esto, un Staff
  // veía la lista vacía y no podía elegir propiedad al crear una tarea. El
  // scope queda garantizado por el `.in("id", allowedIds)` de abajo.
  const adminDb = createAdminClient();
  let propsQuery = adminDb.from("properties").select("id, name").order("name");
  if (allowedIds !== null) {
    propsQuery = propsQuery.in("id", allowedIds);
  }

  // WIK-250: lista de "asignables" según rol — define a quién se le puede
  // asignar una tarea desde el diálogo (y por quién se puede filtrar).
  //   - admin: todos los perfiles.
  //   - gestor (Manager): el Staff/Managers de SUS propiedades + uno mismo,
  //     para poder crear y asignar tareas a su Staff.
  //   - mantenimiento (Staff): solo uno mismo (auto-asignación).
  // Va por admin client porque `profiles_self_read` (RLS) solo deja a un
  // no-admin leer su propia fila.
  async function loadAssignees() {
    if (profile.role === "admin") {
      const { data } = await adminDb
        .from("profiles")
        .select("id, full_name, email, role")
        .order("full_name", { ascending: true });
      return data ?? [];
    }
    if (profile.role === "gestor") {
      const ids = new Set<string>([profile.id]);
      if (allowedIds && allowedIds.length > 0) {
        const { data: links } = await adminDb
          .from("profile_properties")
          .select("profile_id")
          .in("property_id", allowedIds);
        for (const l of links ?? []) ids.add(l.profile_id as string);
      }
      const { data } = await adminDb
        .from("profiles")
        .select("id, full_name, email, role")
        .in("id", Array.from(ids))
        .order("full_name", { ascending: true });
      return data ?? [];
    }
    // Staff: solo uno mismo.
    return [
      {
        id: profile.id,
        full_name: profile.full_name,
        email: profile.email,
        role: profile.role,
      },
    ];
  }

  const [tasksRes, propertiesRes, assignees] = await Promise.all([
    query,
    propsQuery,
    loadAssignees(),
  ]);

  const tasks = (tasksRes.data ?? []) as TaskWithJoins[];
  const properties = (propertiesRes.data ?? []) as Pick<
    Property,
    "id" | "name"
  >[];
  const todayIso = new Date().toISOString().slice(0, 10);

  // Localized status label for the header pill (en/es).
  const statusFilterLabel =
    statusFilter === "pending"
      ? tFilters("pending")
      : statusFilter === "done"
        ? tFilters("done")
        : tFilters("all");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-4xl">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("count", { n: tasks.length })}
            {statusFilter !== "all" &&
              ` ${t("filteredBy", { status: statusFilterLabel })}`}
            .
          </p>
        </div>
        <NewTaskDialog
          properties={properties}
          assignees={assignees}
          defaultPropertyId={propertyFilter ?? undefined}
          currentUserId={profile.id}
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
            label={tFilters("all")}
            active={statusFilter === "all"}
          />
          <FilterPill
            href={buildTasksUrl({
              status: "pending",
              property: propertyFilter,
              assignee: assigneeFilter,
            })}
            label={tFilters("pending")}
            active={statusFilter === "pending"}
          />
          <FilterPill
            href={buildTasksUrl({
              status: "done",
              property: propertyFilter,
              assignee: assigneeFilter,
            })}
            label={tFilters("done")}
            active={statusFilter === "done"}
          />

          {/* WIK-116/244: dropdowns de filtro (Propiedad + Asignado) juntos
              a la derecha. Las options se pre-computan en el server (URLs
              con los demás filtros preservados) — Next no serializa
              funciones server → client. */}
          {(properties.length > 0 || assignees.length > 0) && (
            <div className="flex flex-wrap items-center gap-3 sm:ml-auto">
              {properties.length > 0 && (
                <FilterDropdown
                  label={tFilters("propertyLabel")}
                  currentId={propertyFilter}
                  options={[
                    {
                      id: null,
                      label: tFilters("all"),
                      href: buildTasksUrl({
                        status: statusFilter === "all" ? null : statusFilter,
                        property: null,
                        assignee: assigneeFilter,
                      }),
                    },
                    ...properties.map((p) => ({
                      id: p.id,
                      label: p.name,
                      href: buildTasksUrl({
                        status: statusFilter === "all" ? null : statusFilter,
                        property: p.id,
                        assignee: assigneeFilter,
                      }),
                    })),
                  ]}
                />
              )}
              {/* WIK-244: "Asignado" pasó de pills a dropdown (default Todos),
                  al lado del de Propiedad. */}
              {assignees.length > 0 && (
                <FilterDropdown
                  label={tFilters("assignedLabel")}
                  currentId={assigneeFilter}
                  options={[
                    {
                      id: null,
                      label: tFilters("assignedAll"),
                      href: buildTasksUrl({
                        status: statusFilter === "all" ? null : statusFilter,
                        property: propertyFilter,
                        assignee: null,
                      }),
                    },
                    {
                      id: "unassigned",
                      label: tFilters("unassigned"),
                      href: buildTasksUrl({
                        status: statusFilter === "all" ? null : statusFilter,
                        property: propertyFilter,
                        assignee: "unassigned",
                      }),
                    },
                    ...assignees.map((a) => ({
                      id: a.id,
                      label: a.full_name?.split(" ")[0] ?? a.email.split("@")[0],
                      href: buildTasksUrl({
                        status: statusFilter === "all" ? null : statusFilter,
                        property: propertyFilter,
                        assignee: a.id,
                      }),
                    })),
                  ]}
                />
              )}
            </div>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tTable("title")}</TableHead>
                <TableHead className="hidden md:table-cell">
                  {tTable("property")}
                </TableHead>
                <TableHead className="hidden lg:table-cell">
                  {tTable("assigned")}
                </TableHead>
                <TableHead>{tTable("status")}</TableHead>
                <TableHead className="hidden sm:table-cell">
                  {tTable("due")}
                </TableHead>
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
                    {t.rich("emptyHint", { em: (chunks) => <em>{chunks}</em> })}
                  </TableCell>
                </TableRow>
              ) : (
                tasks.map((task) => {
                  const { urls: photos, cleaned } = extractPhotos(
                    task.description,
                  );
                  const photosTooltip =
                    photos.length > 0
                      ? t("photosTooltip", { n: photos.length })
                      : undefined;
                  return (
                    <TableRow key={task.id}>
                      <TableCell className="font-medium">
                        <Link
                          href={`/tasks/${task.id}`}
                          className="flex items-center gap-2 hover:underline"
                        >
                          <span>{task.title}</span>
                          {photos.length > 0 && (
                            <span
                              className="inline-flex items-center gap-0.5 text-muted-foreground"
                              title={photosTooltip}
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
                        {/* On mobile we hide the Property/Assigned columns;
                            surface them under the title so la info no se
                            pierde. */}
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground md:hidden">
                          <span>{task.property?.name ?? "—"}</span>
                          <span>·</span>
                          <span>
                            {task.assignee
                              ? (task.assignee.full_name ?? task.assignee.email)
                              : tFilters("unassigned")}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {task.property?.name ?? "—"}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {task.assignee ? (
                          task.assignee.full_name ?? task.assignee.email
                        ) : (
                          <span className="text-muted-foreground">
                            {tFilters("unassigned")}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_BADGE[task.status]}>
                          {tBadge(statusBadgeLabelKey(task.status))}
                        </Badge>
                        {/* Mobile-only: due date underneath the status badge
                            (the dedicated Due column is hidden < sm). */}
                        {task.due_date && (
                          <div className="mt-1 text-xs sm:hidden">
                            <span
                              className={
                                task.status !== "done" &&
                                task.due_date < todayIso
                                  ? "text-destructive font-medium"
                                  : "text-muted-foreground"
                              }
                            >
                              {task.status !== "done" &&
                              task.due_date < todayIso
                                ? `${t("overdue")} `
                                : ""}
                              {formatShortDate(parseISO(task.due_date), locale)}
                            </span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {task.due_date ? (
                          <span
                            className={
                              task.status !== "done" &&
                              task.due_date < todayIso
                                ? "text-destructive font-medium"
                                : ""
                            }
                          >
                            {task.status !== "done" &&
                            task.due_date < todayIso
                              ? `${t("overdue")} `
                              : ""}
                            {formatShortDate(parseISO(task.due_date), locale)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        <TaskRowActions
                          task={task}
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
  // WIK-191: el pill activo ahora usa el deep-accent (verde bosque
  // profundo). Antes era `bg-foreground text-background` (near-black
  // sobre cream) — el deep-accent da el mismo peso visual pero con
  // el tono editorial del nuevo token, consistente con el ring y
  // el Sign in button.
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-1 ${
        active
          ? "bg-deep-accent text-deep-accent-foreground font-medium"
          : "hover:bg-muted"
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
