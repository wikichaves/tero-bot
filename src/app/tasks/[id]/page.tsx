import Link from "next/link";
import { notFound } from "next/navigation";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth";
import { getAllowedPropertyIds } from "@/lib/auth/scope";
import { getScopedAssignees } from "../get-assignees";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Property, Task } from "@/lib/types";
import { extractPhotos } from "@/lib/whatsapp/create-task";
import { TaskRowActions } from "../task-row-actions";
import { PhotoThumb } from "./photo-thumb";

export const dynamic = "force-dynamic";

// WIK-163: STATUS_LABEL y KIND_LABEL se removieron a favor de
// getTranslations("tasks.{status,kind}") en el body. STATUS_BADGE queda
// porque controla la *variante visual* (no es texto).
const STATUS_BADGE: Record<Task["status"], "default" | "secondary" | "outline"> = {
  pending: "secondary",
  in_progress: "default",
  done: "outline",
};

type TaskDetail = Task & {
  property: Pick<Property, "id" | "name"> | null;
  assignee: { id: string; full_name: string | null; email: string } | null;
  reporter: { id: string; full_name: string | null; email: string } | null;
};

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await requireRole(["admin", "gestor"]);
  const { id } = await params;
  // WIK-251 follow-up: admin client. Los joins assignee/reporter están
  // sujetos a la RLS de `profiles` (`profiles_self_read` solo deja a un
  // no-admin leer su PROPIA fila) — con el RLS client un Manager veía
  // "Sin asignar" / reporter "—" en tareas de otra persona. El scope se
  // garantiza con el check de `allowedIds` de abajo + el requireRole.
  const adminDb = createAdminClient();
  // WIK-163: labels via next-intl. Reusamos `tasks.status` + `tasks.kind`
  // (definidos para esto desde WIK-151) y `tasks.overdue` para el badge
  // de vencimiento.
  const tStatus = await getTranslations("tasks.status");
  const tKind = await getTranslations("tasks.kind");
  const tCommon = await getTranslations("tasks");

  const allowedIds = await getAllowedPropertyIds(profile);
  let propsQuery = adminDb.from("properties").select("id, name").order("name");
  if (allowedIds !== null) {
    propsQuery = propsQuery.in("id", allowedIds);
  }

  const [taskRes, propertiesRes, assignees] = await Promise.all([
    adminDb
      .from("tasks")
      .select(
        "*, property:properties(id, name), assignee:profiles!tasks_assigned_to_fkey(id, full_name, email), reporter:profiles!tasks_reported_by_fkey(id, full_name, email)",
      )
      .eq("id", id)
      .maybeSingle(),
    propsQuery,
    getScopedAssignees(profile),
  ]);

  if (!taskRes.data) notFound();
  const task = taskRes.data as TaskDetail;

  // WIK-245: scope por propiedad. Un Manager solo puede abrir el detalle de
  // tareas de las properties que tiene asignadas; fuera de scope = 404
  // (admin = allowedIds null = sin corte).
  if (allowedIds !== null && !allowedIds.includes(task.property_id)) {
    notFound();
  }
  const properties = (propertiesRes.data ?? []) as Pick<
    Property,
    "id" | "name"
  >[];

  const { urls: photoUrls, cleaned: cleanedDescription } = extractPhotos(
    task.description,
  );

  const todayIso = new Date().toISOString().slice(0, 10);
  const isOverdue =
    task.status !== "done" &&
    !!task.due_date &&
    task.due_date < todayIso;

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/tasks"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Tareas
        </Link>
        <TaskRowActions
          task={task}
          properties={properties}
          assignees={assignees}
          role={profile.role}
          currentUserId={profile.id}
        />
      </div>

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{tKind(task.kind)}</Badge>
          <Badge variant={STATUS_BADGE[task.status]}>
            {tStatus(task.status)}
          </Badge>
          {isOverdue && (
            <Badge variant="destructive">{tCommon("overdue")}</Badge>
          )}
        </div>
        <h1 className="mt-2 text-4xl leading-tight">
          {task.title}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {task.property?.name ?? "Sin propiedad"}
          {task.due_date && (
            <>
              {" · "}
              <span className={isOverdue ? "text-destructive font-medium" : ""}>
                Vence{" "}
                {format(parseISO(task.due_date), "EEEE d 'de' MMMM", {
                  locale: es,
                })}
              </span>
            </>
          )}
        </p>
      </div>

      {photoUrls.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {photoUrls.length === 1
                ? "Foto adjunta"
                : `${photoUrls.length} fotos adjuntas`}
            </CardTitle>
            <CardDescription>
              Las fotos vienen de WhatsApp; el link puede caducar. Click para
              abrirlas en pestaña nueva.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              {photoUrls.map((url, i) => (
                <PhotoThumb key={`${url}-${i}`} url={url} index={i} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Detalles</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Asignado</dt>
            <dd>
              {task.assignee ? (
                task.assignee.full_name ?? task.assignee.email
              ) : (
                <span className="text-muted-foreground">Sin asignar</span>
              )}
            </dd>
            <dt className="text-muted-foreground">Reportado por</dt>
            <dd>
              {task.reporter ? (
                task.reporter.full_name ?? task.reporter.email
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </dd>
            <dt className="text-muted-foreground">Creada</dt>
            <dd>
              {format(parseISO(task.created_at), "d 'de' MMMM 'a las' HH:mm", {
                locale: es,
              })}
            </dd>
            {cleanedDescription && (
              <>
                <dt className="text-muted-foreground self-start">
                  Descripción
                </dt>
                <dd className="whitespace-pre-wrap">{cleanedDescription}</dd>
              </>
            )}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
