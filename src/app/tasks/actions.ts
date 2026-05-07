"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth";
import { notifyTaskAssigned } from "@/lib/whatsapp/notify";

const KINDS = ["limpieza", "mantenimiento", "insumos", "otro"] as const;
const STATUSES = ["pending", "in_progress", "done"] as const;

const createSchema = z.object({
  property_id: z.string().uuid(),
  kind: z.enum(KINDS),
  title: z.string().min(1, "Falta el título.").max(200),
  description: z
    .string()
    .max(2000)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  assigned_to: z
    .string()
    .uuid()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  due_date: z
    .string()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
});

export async function createTask(input: {
  property_id: string;
  kind: string;
  title: string;
  description: string;
  assigned_to: string;
  due_date: string;
}) {
  const profile = await requireRole(["admin", "gestor"]);
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const supabase = await createClient();
  const { data: inserted, error } = await supabase
    .from("tasks")
    .insert({
      property_id: parsed.data.property_id,
      kind: parsed.data.kind,
      title: parsed.data.title,
      description: parsed.data.description,
      assigned_to: parsed.data.assigned_to,
      due_date: parsed.data.due_date,
      reported_by: profile.id,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  revalidatePath("/tasks");

  // Best-effort WhatsApp notification if the task was created already
  // assigned to someone with whatsapp configured. notifyTaskAssigned never
  // throws — it logs and continues.
  if (parsed.data.assigned_to && inserted?.id) {
    await notifyTaskAssigned(inserted.id);
  }

  return { ok: true };
}

const updateSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(200).optional(),
  description: z
    .string()
    .max(2000)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v == null ? undefined : v ? v : null)),
  kind: z.enum(KINDS).optional(),
  status: z.enum(STATUSES).optional(),
  assigned_to: z
    .string()
    .uuid()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v == null ? undefined : v ? v : null)),
  due_date: z
    .string()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v == null ? undefined : v ? v : null)),
});

export async function updateTask(input: {
  id: string;
  title?: string;
  description?: string;
  kind?: string;
  status?: string;
  assigned_to?: string;
  due_date?: string;
}) {
  await requireRole(["admin", "gestor"]);
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const supabase = await createClient();
  // Build patch with only the fields that came through (so we don't blank
  // out fields the caller didn't intend to touch).
  const patch: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.description !== undefined)
    patch.description = parsed.data.description;
  if (parsed.data.kind !== undefined) patch.kind = parsed.data.kind;
  if (parsed.data.status !== undefined) patch.status = parsed.data.status;
  if (parsed.data.assigned_to !== undefined)
    patch.assigned_to = parsed.data.assigned_to;
  if (parsed.data.due_date !== undefined)
    patch.due_date = parsed.data.due_date;

  // If we're (re)assigning, fetch the previous assignee first so we only
  // notify on actual changes (not on every status flip).
  let previousAssignedTo: string | null | undefined;
  if (parsed.data.assigned_to !== undefined) {
    const { data: existing } = await supabase
      .from("tasks")
      .select("assigned_to")
      .eq("id", parsed.data.id)
      .maybeSingle();
    previousAssignedTo = existing?.assigned_to ?? null;
  }

  const { error } = await supabase
    .from("tasks")
    .update(patch)
    .eq("id", parsed.data.id);
  if (error) return { error: error.message };
  revalidatePath("/tasks");

  // Notify if the assignee changed to a non-null value.
  if (
    parsed.data.assigned_to &&
    parsed.data.assigned_to !== previousAssignedTo
  ) {
    await notifyTaskAssigned(parsed.data.id);
  }

  return { ok: true };
}

export async function setTaskStatus(input: {
  id: string;
  status: "pending" | "in_progress" | "done";
}) {
  return updateTask({ id: input.id, status: input.status });
}

export async function deleteTask(id: string) {
  await requireRole(["admin"]);
  const admin = createAdminClient();
  const { error } = await admin.from("tasks").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/tasks");
  return { ok: true };
}
