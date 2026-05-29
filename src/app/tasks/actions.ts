"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireProfile, requireRole } from "@/lib/auth";
import { getAllowedPropertyIds } from "@/lib/auth/scope";
import {
  notifyTaskAssigned,
  notifyTaskStatusChanged,
} from "@/lib/whatsapp/notify";

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
  // WIK-124: hora opcional para due_date. "HH:MM" (input HTML time).
  due_time: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/, "Hora inválida.")
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  // WIK-124: si está seteado, el cron manda WhatsApp X horas antes.
  // Cap a 168h (1 semana) para evitar typos del admin.
  alarm_hours_before: z
    .number()
    .int()
    .min(1)
    .max(168)
    .nullable()
    .optional()
    .transform((v) => (v == null ? null : v)),
});

export async function createTask(input: {
  property_id: string;
  kind: string;
  title: string;
  description: string;
  assigned_to: string;
  due_date: string;
  due_time?: string;
  alarm_hours_before?: number | null;
}) {
  // WIK-250: crear tareas desde /tasks ahora funciona para los 3 roles.
  // Antes era `requireRole(["admin","gestor"])` (→ redirect para Staff) y
  // el insert iba por el RLS client (→ properties_read bloquea a Staff, que
  // ni siquiera podía elegir propiedad). Ahora autorizamos en la action y
  // escribimos con el admin client, mismo patrón que `reportTask` en
  // my-tasks. La seguridad la da el chequeo de scope de abajo.
  const profile = await requireProfile();
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  if (parsed.data.alarm_hours_before != null && !parsed.data.due_date) {
    return {
      error: "Para activar la alarma necesitás una fecha de vencimiento.",
    };
  }
  // Scope (WIK-94): un no-admin solo puede crear tareas en las propiedades
  // que tiene asignadas. Admin → allowedIds null → sin límite.
  const allowedIds = await getAllowedPropertyIds(profile);
  if (allowedIds !== null && !allowedIds.includes(parsed.data.property_id)) {
    return { error: "No tenés acceso a esa propiedad." };
  }
  const admin = createAdminClient();
  const { data: inserted, error } = await admin
    .from("tasks")
    .insert({
      property_id: parsed.data.property_id,
      kind: parsed.data.kind,
      title: parsed.data.title,
      description: parsed.data.description,
      assigned_to: parsed.data.assigned_to,
      due_date: parsed.data.due_date,
      due_time: parsed.data.due_time,
      alarm_hours_before: parsed.data.alarm_hours_before,
      reported_by: profile.id,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  revalidatePath("/tasks");
  revalidatePath("/my-tasks");

  // Best-effort WhatsApp notification si la tarea quedó asignada a OTRO
  // (no a uno mismo). WIK-249 auto-asigna al creador por default — no tiene
  // sentido mandarte un WhatsApp a vos mismo. Corre vía after() para que la
  // UI responda ya; notifyTaskAssigned nunca tira.
  if (
    parsed.data.assigned_to &&
    parsed.data.assigned_to !== profile.id &&
    inserted?.id
  ) {
    after(() => notifyTaskAssigned(inserted.id));
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
  due_time: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/, "Hora inválida.")
    .optional()
    .or(z.literal(""))
    .transform((v) => (v == null ? undefined : v ? v : null)),
  alarm_hours_before: z
    .number()
    .int()
    .min(1)
    .max(168)
    .nullable()
    .optional(),
});

export async function updateTask(input: {
  id: string;
  title?: string;
  description?: string;
  kind?: string;
  status?: string;
  assigned_to?: string;
  due_date?: string;
  due_time?: string;
  alarm_hours_before?: number | null;
}) {
  const profile = await requireRole(["admin", "gestor"]);
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
  if (parsed.data.due_time !== undefined)
    patch.due_time = parsed.data.due_time;
  if (parsed.data.alarm_hours_before !== undefined)
    patch.alarm_hours_before = parsed.data.alarm_hours_before;
  // WIK-124: si el alarm cambió, invalidar el tracking row para que
  // el cron pueda re-disparar con los nuevos params (si el user editó
  // due_date/due_time/horas, debería re-evaluarse). Eliminar la row
  // de alarm_notifications_sent permite re-evaluación.
  if (
    parsed.data.alarm_hours_before !== undefined ||
    parsed.data.due_date !== undefined ||
    parsed.data.due_time !== undefined
  ) {
    const adminClient = createAdminClient();
    await adminClient
      .from("alarm_notifications_sent")
      .delete()
      .eq("task_id", parsed.data.id);
  }

  // If we're (re)assigning or changing status, peek at the current row so
  // we can compare and only notify on actual transitions (not on every save).
  let previousAssignedTo: string | null | undefined;
  let previousStatus: "pending" | "in_progress" | "done" | undefined;
  if (
    parsed.data.assigned_to !== undefined ||
    parsed.data.status !== undefined
  ) {
    const { data: existing } = await supabase
      .from("tasks")
      .select("assigned_to, status")
      .eq("id", parsed.data.id)
      .maybeSingle();
    previousAssignedTo = existing?.assigned_to ?? null;
    previousStatus = existing?.status as typeof previousStatus;
  }

  const { error } = await supabase
    .from("tasks")
    .update(patch)
    .eq("id", parsed.data.id);
  if (error) return { error: error.message };
  revalidatePath("/tasks");

  // Notify (fire-and-forget via after()) — the action returns immediately
  // and the WA sends happen in the background after the response.
  if (
    parsed.data.assigned_to &&
    parsed.data.assigned_to !== previousAssignedTo
  ) {
    const taskId = parsed.data.id;
    after(() => notifyTaskAssigned(taskId));
  }
  if (
    parsed.data.status &&
    parsed.data.status !== previousStatus
  ) {
    const taskId = parsed.data.id;
    const newStatus = parsed.data.status;
    const changerId = profile.id;
    after(() => notifyTaskStatusChanged(taskId, newStatus, changerId));
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
