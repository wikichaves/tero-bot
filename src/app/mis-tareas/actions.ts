"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";

const STATUSES = ["pending", "in_progress", "done"] as const;

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
  return { ok: true };
}
