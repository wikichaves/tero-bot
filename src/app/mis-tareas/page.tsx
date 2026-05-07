import Link from "next/link";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireProfile } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import type { Task } from "@/lib/types";
import { MyTaskCard } from "./task-card";

export const dynamic = "force-dynamic";

type Filter = "open" | "done" | "all";

type MyTask = Task & {
  property: { id: string; name: string } | null;
};

export default async function MisTareasPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const profile = await requireProfile();
  const params = await searchParams;
  const filter: Filter =
    params.filter === "done" || params.filter === "all" ? params.filter : "open";

  // Use admin client because:
  //  1. limpieza/mantenimiento profiles can't read `properties` directly per
  //     RLS (the table holds iCal URLs we don't want to leak), and we need
  //     the property name for the join.
  //  2. The query is explicitly scoped to `assigned_to = profile.id` so the
  //     admin client doesn't widen what the user can see — they still only
  //     get their own tasks.
  const supabase = createAdminClient();
  let query = supabase
    .from("tasks")
    .select("*, property:properties(id, name)")
    .eq("assigned_to", profile.id)
    .order("status", { ascending: true })
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (filter === "open") {
    query = query.in("status", ["pending", "in_progress"]);
  } else if (filter === "done") {
    query = query.eq("status", "done");
  }

  const { data, error } = await query;
  const tasks = (data ?? []) as MyTask[];

  const today = new Date();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Mis tareas</h1>
        <p className="text-sm text-muted-foreground">
          {format(today, "EEEE d 'de' MMMM", { locale: es })} ·{" "}
          {profile.full_name ?? profile.email}
        </p>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        <FilterPill href="/mis-tareas" label="Pendientes" active={filter === "open"} />
        <FilterPill
          href="/mis-tareas?filter=done"
          label="Hechas"
          active={filter === "done"}
        />
        <FilterPill
          href="/mis-tareas?filter=all"
          label="Todas"
          active={filter === "all"}
        />
      </div>

      {error && (
        <Card>
          <CardContent className="pt-6 text-sm text-destructive">
            No se pudo cargar las tareas: {error.message}
          </CardContent>
        </Card>
      )}

      {tasks.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground">
            {filter === "open"
              ? "No tenés tareas pendientes. ¡Buen trabajo!"
              : "Sin tareas para mostrar."}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {tasks.map((t) => (
            <MyTaskCard key={t.id} task={t} />
          ))}
        </div>
      )}
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
