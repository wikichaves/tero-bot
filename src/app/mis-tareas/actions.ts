"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireProfile } from "@/lib/auth";
import { notifyTaskStatusChanged } from "@/lib/whatsapp/notify";

const STATUSES = ["pending", "in_progress", "done"] as const;
const KINDS = ["limpieza", "mantenimiento", "insumos", "otro"] as const;

const schema = z.object({
  id: z.string().uuid(),
  status: z.enum(STATUSES),
});

/**
 * Update the status of a task that's assigned to the current user.
 *
 * Authorization is enforced two ways:
 *  - We explicitly check `assigned_to = profile.id` in the WHERE clause,
 *    so an attacker can't update someone else's task even with a forged id.
 *  - The `tasks_update` RLS policy also requires it (defense in depth).
 *
 * Admin/gestor users use `/tasks` and the actions in `src/app/tasks/actions.ts`
 * which take the broader `setTaskStatus`/`updateTask` paths.
 */
export async function markOwnTaskStatus(input: {
  id: string;
  status: "pending" | "in_progress" | "done";
}) {
  const profile = await requireProfile();
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.id)
    .eq("assigned_to", profile.id)
    .select("id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Esa tarea no está asignada a vos." };
  revalidatePath("/mis-tareas");
  // Also revalidate /tasks for admin/gestor seeing the global list.
  revalidatePath("/tasks");

  // Best-effort notify the reporter (skipped if reporter == self, which is
  // the common case for staff completing their own self-reported tasks).
  await notifyTaskStatusChanged(parsed.data.id, parsed.data.status, profile.id);

  return { ok: true };
}

const reportSchema = z.object({
  title: z.string().min(1, "Falta el título.").max(200),
  description: z
    .string()
    .max(2000)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  kind: z.enum(KINDS),
  property_id: z.string().uuid("Falta la propiedad."),
});

/**
 * Report a new task from /mis-tareas. Available to any authenticated profile.
 * The task is auto-assigned to the reporter (so it shows up in their list)
 * and `reported_by` is set to them too.
 *
 * Uses the admin client because limpieza/mantenimiento profiles can't write
 * to `tasks` from any property (the RLS insert policy is admin/gestor or
 * `reported_by = auth.uid()`, but the `properties` join we'd need to validate
 * the property_id is also blocked for staff). Authorization is enforced in
 * this action: we verify the property exists and force `reported_by` and
 * `assigned_to` to the caller's id.
 */
export async function reportTask(input: {
  title: string;
  description: string;
  kind: string;
  property_id: string;
}) {
  const profile = await requireProfile();
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const admin = createAdminClient();
  // Validate the property exists (defense in depth; the form only offers
  // existing options, but a forged client request might pass any uuid).
  const { data: prop } = await admin
    .from("properties")
    .select("id")
    .eq("id", parsed.data.property_id)
    .maybeSingle();
  if (!prop) return { error: "Esa propiedad no existe." };

  const { error } = await admin.from("tasks").insert({
    property_id: parsed.data.property_id,
    kind: parsed.data.kind,
    title: parsed.data.title,
    description: parsed.data.description,
    status: "pending",
    reported_by: profile.id,
    assigned_to: profile.id,
  });
  if (error) return { error: error.message };
  revalidatePath("/mis-tareas");
  revalidatePath("/tasks");
  return { ok: true };
}
