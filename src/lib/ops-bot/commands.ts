import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildRoomsReport } from "@/lib/sensors/reports";
import { escapeHtml } from "@/lib/telegram";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales";
import type { OpsProfile } from "./auth";

/**
 * Comandos del bot de OPERACIÓN (@tero_ops_bot, WIK-285).
 *
 * Comandos:
 *   /estado           — temp/humedad/luz actual de las casas
 *   /incidente <txt>  — crea una tarea de mantenimiento (reporte de problema)
 *   /tareas           — lista tareas pendientes/en progreso
 *   /help             — esta lista
 *
 * NOTA de seguridad: este bot NO tiene comandos de código (/claude, /work,
 * /merge). Esos viven SOLO en el bot de dev privado (WIK-97). Meterlos acá
 * dejaría que cualquiera en un grupo tocara el repo.
 */

export type OpsCommand =
  | { type: "help" }
  | { type: "estado" }
  | { type: "incidente"; text: string }
  | { type: "tareas" }
  | null;

export function parseOpsCommand(text: string | null | undefined): OpsCommand {
  if (!text) return null;
  // Strip `@tero_ops_bot` que Telegram pega en grupos.
  const cleaned = text.replace(/^(\/[a-zA-Z_]+)@\S+/, "$1").trim();

  if (/^\/?(help|comandos|menu|start|ayuda)\b/i.test(cleaned)) {
    return { type: "help" };
  }
  if (/^\/?(estado|status|casas|rooms)\b/i.test(cleaned)) {
    return { type: "estado" };
  }
  {
    const m = cleaned.match(/^\/?(incidente|incident|problema|reporte)\s+([\s\S]+)$/i);
    if (m) return { type: "incidente", text: m[2].trim() };
    // sin texto → tratamos como ayuda del comando
    if (/^\/?(incidente|incident|problema|reporte)\b/i.test(cleaned)) {
      return { type: "incidente", text: "" };
    }
  }
  if (/^\/?(tareas|tasks|pendientes)\b/i.test(cleaned)) {
    return { type: "tareas" };
  }
  return null;
}

export function opsHelpText(locale: Locale): string {
  if (locale === "en") {
    return (
      "<b>Tero Ops</b> — house operations\n\n" +
      "/estado — current temp/humidity/power of the houses\n" +
      "/incidente &lt;text&gt; — report a problem (creates a maintenance task)\n" +
      "/tareas — list pending tasks\n" +
      "/help — this list\n\n" +
      "<i>Alarms arrive automatically. No code commands here.</i>"
    );
  }
  return (
    "<b>Tero Ops</b> — operación de las casas\n\n" +
    "/estado — temp/humedad/luz actual de las casas\n" +
    "/incidente &lt;texto&gt; — reportar un problema (crea tarea de mantenimiento)\n" +
    "/tareas — listar tareas pendientes\n" +
    "/help — esta lista\n\n" +
    "<i>Las alarmas llegan solas. Acá no hay comandos de código.</i>"
  );
}

/**
 * Scope de propiedades por rol. admin ve todo (null); gestor ve todo por
 * ahora también (no hay tabla de asignación gestor↔propiedad en este bot;
 * si más adelante se agrega, se restringe acá).
 */
function allowedPropertyIdsFor(): string[] | null {
  return null;
}

async function runEstado(p: OpsProfile, locale: Locale): Promise<string> {
  const scope = allowedPropertyIdsFor();
  try {
    return await buildRoomsReport(scope, locale);
  } catch (e) {
    console.error("[ops-bot] /estado failed:", (e as Error).message);
    return locale === "en"
      ? "Couldn't read house status right now. Try again in a bit."
      : "No pude leer el estado de las casas ahora. Probá de nuevo en un rato.";
  }
}

async function runIncidente(
  p: OpsProfile,
  locale: Locale,
  text: string,
): Promise<string> {
  if (!text) {
    return locale === "en"
      ? "Usage: <code>/incidente &lt;description&gt;</code>\nExample: <code>/incidente Casa B — pellet stove not turning on</code>"
      : "Uso: <code>/incidente &lt;descripción&gt;</code>\nEjemplo: <code>/incidente Casa B — la estufa a pellet no prende</code>";
  }
  const admin = createAdminClient();

  // Intentar detectar la propiedad por nombre mencionado al inicio del texto
  // (ej. "Casa B ..."). Si no matchea, queda sin propiedad → se asigna a la
  // primera propiedad por sort_order como fallback (property_id es NOT NULL).
  const { data: props } = await admin
    .from("properties")
    .select("id, name, sort_order")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  const properties = (props ?? []) as Array<{ id: string; name: string }>;
  if (properties.length === 0) {
    return locale === "en"
      ? "No properties configured yet — can't file the report."
      : "No hay propiedades cargadas todavía — no puedo registrar el reporte.";
  }
  const lower = text.toLowerCase();
  const matched =
    properties.find((pr) => lower.includes(pr.name.toLowerCase())) ??
    properties[0];

  const title = text.length > 120 ? text.slice(0, 117) + "…" : text;
  const { error } = await admin.from("tasks").insert({
    property_id: matched.id,
    kind: "mantenimiento",
    status: "pending",
    title,
    description: text,
    reported_by: p.id,
  });
  if (error) {
    console.error("[ops-bot] /incidente insert failed:", error.message);
    return locale === "en"
      ? "Couldn't save the report. Try again."
      : "No pude guardar el reporte. Probá de nuevo.";
  }
  return locale === "en"
    ? `✅ Report filed for <b>${escapeHtml(matched.name)}</b>:\n<i>${escapeHtml(title)}</i>\n\nIt's now a pending maintenance task.`
    : `✅ Reporte registrado para <b>${escapeHtml(matched.name)}</b>:\n<i>${escapeHtml(title)}</i>\n\nQuedó como tarea de mantenimiento pendiente.`;
}

async function runTareas(p: OpsProfile, locale: Locale): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tasks")
    .select("title, status, kind, created_at, property:properties(name)")
    .in("status", ["pending", "in_progress"])
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) {
    console.error("[ops-bot] /tareas failed:", error.message);
    return locale === "en"
      ? "Couldn't read tasks right now."
      : "No pude leer las tareas ahora.";
  }
  const rows = (data ?? []) as Array<{
    title: string;
    status: string;
    kind: string;
    property: { name: string } | { name: string }[] | null;
  }>;
  if (rows.length === 0) {
    return locale === "en"
      ? "✅ No pending tasks."
      : "✅ No hay tareas pendientes.";
  }
  const header = locale === "en" ? "<b>Pending tasks</b>" : "<b>Tareas pendientes</b>";
  const lines = rows.map((r) => {
    const prop = Array.isArray(r.property) ? r.property[0] : r.property;
    const propName = prop?.name ?? "—";
    const mark = r.status === "in_progress" ? "🔧" : "⏳";
    return `${mark} <b>${escapeHtml(propName)}</b> · ${escapeHtml(r.title)}`;
  });
  return `${header}\n\n${lines.join("\n")}`;
}

export async function runOpsCommand(
  cmd: NonNullable<OpsCommand>,
  p: OpsProfile,
  locale: Locale = DEFAULT_LOCALE,
): Promise<string> {
  switch (cmd.type) {
    case "help":
      return opsHelpText(locale);
    case "estado":
      return await runEstado(p, locale);
    case "incidente":
      return await runIncidente(p, locale, cmd.text);
    case "tareas":
      return await runTareas(p, locale);
  }
}
