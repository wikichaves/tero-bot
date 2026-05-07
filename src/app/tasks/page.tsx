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
import type { Property, Task } from "@/lib/types";
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
  searchParams: Promise<{ status?: string; property?: string }>;
}) {
  const profile = await requireRole(["admin", "gestor"]);
  const params = await searchParams;
  const statusFilter = (params.status as StatusFilter) ?? "all";
  const propertyFilter = params.property ?? null;

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
      <div className="flex items-end justify-between">
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

      <div className="flex flex-wrap gap-2 text-sm">
        <FilterPill
          href={`/tasks${propertyFilter ? `?property=${propertyFilter}` : ""}`}
          label="Todas"
          active={statusFilter === "all"}
        />
        <FilterPill
          href={`/tasks?status=pending${propertyFilter ? `&property=${propertyFilter}` : ""}`}
          label="Pendientes"
          active={statusFilter === "pending"}
        />
        <FilterPill
          href={`/tasks?status=in_progress${propertyFilter ? `&property=${propertyFilter}` : ""}`}
          label="En curso"
          active={statusFilter === "in_progress"}
        />
        <FilterPill
          href={`/tasks?status=done${propertyFilter ? `&property=${propertyFilter}` : ""}`}
          label="Hechas"
          active={statusFilter === "done"}
        />

        {properties.length > 1 && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-muted-foreground">Propiedad:</span>
            <Link
              href={`/tasks${statusFilter !== "all" ? `?status=${statusFilter}` : ""}`}
              className={`rounded-full px-3 py-1 ${propertyFilter ? "hover:bg-muted" : "bg-muted font-medium"}`}
            >
              Todas
            </Link>
            {properties.map((p) => (
              <Link
                key={p.id}
                href={`/tasks?property=${p.id}${statusFilter !== "all" ? `&status=${statusFilter}` : ""}`}
                className={`rounded-full px-3 py-1 ${propertyFilter === p.id ? "bg-muted font-medium" : "hover:bg-muted"}`}
              >
                {p.name}
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
                <TableHead>Propiedad</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Asignado</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Vence</TableHead>
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
                tasks.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">
                      <div>{t.title}</div>
                      {t.description && (
                        <div className="text-xs text-muted-foreground line-clamp-1">
                          {t.description}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{t.property?.name ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{KIND_LABEL[t.kind]}</Badge>
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
                      <Badge variant={STATUS_BADGE[t.status]}>
                        {STATUS_LABEL[t.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {t.due_date
                        ? format(parseISO(t.due_date), "d MMM", {
                            locale: es,
                          })
                        : "—"}
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
                ))
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
