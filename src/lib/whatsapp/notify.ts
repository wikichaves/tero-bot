import "server-only";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { createAdminClient } from "@/lib/supabase/admin";
import { APP_HOST } from "@/lib/brand";
import { persistMessage, sendKapsoText, upsertConversation } from "./index";

/**
 * Best-effort WhatsApp notification helpers.
 *
 * IMPORTANT: every helper here is wrapped in try/catch and never throws —
 * notifications are a side-effect, they must NEVER block the operation that
 * triggered them (e.g. saving a task). Errors go to console.error so they're
 * visible in Vercel logs but the caller continues.
 *
 * Sandbox caveat: Kapso/Meta only allows free-form text within the 24h
 * conversation window. If the staff member hasn't messaged us recently, the
 * send will fail — that's expected and logged. To reach them outside that
 * window we need pre-approved templates (see WIK-44).
 */

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  kind: "limpieza" | "mantenimiento" | "insumos" | "otro";
  status: "pending" | "in_progress" | "done";
  due_date: string | null;
  reported_by: string | null;
  assigned_to: string | null;
  property: { name: string } | null;
  assignee: {
    id: string;
    full_name: string | null;
    email: string;
    whatsapp: string | null;
  } | null;
  reporter: {
    id: string;
    full_name: string | null;
    email: string;
    whatsapp: string | null;
  } | null;
};

const KIND_LABEL: Record<TaskRow["kind"], string> = {
  limpieza: "Limpieza",
  mantenimiento: "Mantenimiento",
  insumos: "Insumos",
  otro: "Tarea",
};

function buildAssignedMessage(t: TaskRow): string {
  const name = t.assignee?.full_name?.split(" ")[0] ?? null;
  const greeting = name ? `Hola ${name}, ` : "";
  const dueLine = t.due_date
    ? `\n📅 Vence: ${format(parseISO(t.due_date), "EEE d 'de' MMMM", {
        locale: es,
      })}`
    : "";
  const propertyLine = t.property?.name ? `\n🏠 ${t.property.name}` : "";
  const descLine = t.description ? `\n\n${t.description}` : "";
  return (
    `*${greeting}te asignaron una tarea*\n\n` +
    `*${t.title}*\n` +
    `🔧 ${KIND_LABEL[t.kind]}` +
    propertyLine +
    dueLine +
    descLine +
    `\n\n_Detalle: ${APP_HOST}/tasks/${t.id}_`
  );
}

/**
 * Notify the assignee of a task by WhatsApp. No-op if the assignee has no
 * `whatsapp` configured, or the WHATSAPP_PHONE_NUMBER_ID env var is missing.
 *
 * Persists the outbound message in the WhatsApp inbox so admin/gestor can
 * see what we sent.
 */
export async function notifyTaskAssigned(taskId: string): Promise<void> {
  try {
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!phoneNumberId) {
      console.log("[notifyTaskAssigned] WHATSAPP_PHONE_NUMBER_ID not set, skipping");
      return;
    }
    const apiKey = process.env.KAPSO_API_KEY;
    if (!apiKey) {
      console.log("[notifyTaskAssigned] KAPSO_API_KEY not set, skipping");
      return;
    }

    const admin = createAdminClient();
    const { data: task, error } = await admin
      .from("tasks")
      .select(
        "id, title, description, kind, status, due_date, reported_by, assigned_to, property:properties(name), assignee:profiles!tasks_assigned_to_fkey(id, full_name, email, whatsapp), reporter:profiles!tasks_reported_by_fkey(id, full_name, email, whatsapp)",
      )
      .eq("id", taskId)
      .single<TaskRow>();
    if (error || !task) {
      console.warn("[notifyTaskAssigned] task lookup failed", error?.message);
      return;
    }
    const peer = task.assignee?.whatsapp;
    if (!peer) {
      console.log(
        `[notifyTaskAssigned] assignee has no whatsapp configured (task=${taskId})`,
      );
      return;
    }

    const text = buildAssignedMessage(task);

    // Persist the outbound message into the WhatsApp inbox so admins can see
    // what we sent. Use the existing conversation pipeline.
    const { id: conversationId } = await upsertConversation({
      phone_number: peer,
      display_name: task.assignee?.full_name ?? null,
    });

    try {
      const { messageId } = await sendKapsoText(phoneNumberId, peer, text);
      await persistMessage({
        conversation_id: conversationId,
        external_id: messageId ?? null,
        direction: "outbound",
        type: "text",
        body: text,
        status: "sent",
      });
      console.log(
        `[notifyTaskAssigned] sent task=${taskId} to=${peer} msg=${messageId ?? "?"}`,
      );
    } catch (sendErr) {
      // Log the send failure but still persist the attempt with status=failed
      // so the inbox shows we tried (helpful in sandbox where 24h-window
      // failures are expected).
      const reason = (sendErr as Error).message;
      console.warn(
        `[notifyTaskAssigned] send failed task=${taskId} to=${peer}: ${reason}`,
      );
      try {
        await persistMessage({
          conversation_id: conversationId,
          direction: "outbound",
          type: "text",
          body: text,
          status: "failed",
        });
      } catch {
        // ignore — best effort
      }
    }
  } catch (err) {
    // Catch-all: notifications never throw to the caller.
    console.error("[notifyTaskAssigned] unexpected error", err);
  }
}

const STATUS_VERB: Record<TaskRow["status"], string> = {
  pending: "reabierta",
  in_progress: "en curso",
  done: "marcada como hecha",
};

const STATUS_EMOJI: Record<TaskRow["status"], string> = {
  pending: "🔄",
  in_progress: "▶️",
  done: "✅",
};

function buildStatusChangedMessage(t: TaskRow): string {
  const name = t.reporter?.full_name?.split(" ")[0] ?? null;
  const greeting = name ? `Hola ${name}, ` : "";
  const propertyLine = t.property?.name ? `\n🏠 ${t.property.name}` : "";
  return (
    `${STATUS_EMOJI[t.status]} *${greeting}una tarea que reportaste fue ${STATUS_VERB[t.status]}*\n\n` +
    `*${t.title}*\n` +
    `🔧 ${KIND_LABEL[t.kind]}` +
    propertyLine +
    `\n\n_Detalle: ${APP_HOST}/tasks/${t.id}_`
  );
}

/**
 * Notify the *reporter* of a task that its status changed. Useful when
 * someone reports a problem via WhatsApp/photo and an admin/gestor
 * triages it — they get a heads-up that their report is being addressed.
 *
 * Skipped when:
 *  - The reporter is the same person who triggered the change (no
 *    self-notifications).
 *  - The reporter has no whatsapp configured.
 *  - The reporter is also the assignee (they're already getting notified
 *    via /mis-tareas in real time).
 *  - The new status is `pending` (reopening — usually internal noise).
 */
export async function notifyTaskStatusChanged(
  taskId: string,
  newStatus: TaskRow["status"],
  changedByProfileId: string | null,
): Promise<void> {
  try {
    if (newStatus === "pending") return;

    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!phoneNumberId) return;
    const apiKey = process.env.KAPSO_API_KEY;
    if (!apiKey) return;

    const admin = createAdminClient();
    const { data: task, error } = await admin
      .from("tasks")
      .select(
        "id, title, description, kind, status, due_date, reported_by, assigned_to, property:properties(name), assignee:profiles!tasks_assigned_to_fkey(id, full_name, email, whatsapp), reporter:profiles!tasks_reported_by_fkey(id, full_name, email, whatsapp)",
      )
      .eq("id", taskId)
      .single<TaskRow>();
    if (error || !task) {
      console.warn(
        "[notifyTaskStatusChanged] task lookup failed",
        error?.message,
      );
      return;
    }

    const reporter = task.reporter;
    if (!reporter || !reporter.whatsapp) return;
    if (changedByProfileId && reporter.id === changedByProfileId) return;
    // Reporter == assignee → they already see updates in /mis-tareas.
    if (task.assigned_to && reporter.id === task.assigned_to) return;

    const peer = reporter.whatsapp;
    const text = buildStatusChangedMessage(task);

    const { id: conversationId } = await upsertConversation({
      phone_number: peer,
      display_name: reporter.full_name,
    });

    try {
      const { messageId } = await sendKapsoText(phoneNumberId, peer, text);
      await persistMessage({
        conversation_id: conversationId,
        external_id: messageId ?? null,
        direction: "outbound",
        type: "text",
        body: text,
        status: "sent",
      });
      console.log(
        `[notifyTaskStatusChanged] sent task=${taskId} to=${peer} status=${newStatus}`,
      );
    } catch (sendErr) {
      const reason = (sendErr as Error).message;
      console.warn(
        `[notifyTaskStatusChanged] send failed task=${taskId} to=${peer}: ${reason}`,
      );
      try {
        await persistMessage({
          conversation_id: conversationId,
          direction: "outbound",
          type: "text",
          body: text,
          status: "failed",
        });
      } catch {
        // ignore — best effort
      }
    }
  } catch (err) {
    console.error("[notifyTaskStatusChanged] unexpected error", err);
  }
}
