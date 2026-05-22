import "server-only";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildConsumptionReport } from "@/lib/energy/reports";
import { buildRoomsReport } from "@/lib/sensors/reports";
import { getAllowedPropertyIds } from "@/lib/auth/scope";
import { APP_NAME, APP_HOST } from "@/lib/brand";
import type { Profile, Task } from "@/lib/types";
import { normalizePhone } from "./index";

export type ParsedCommand =
  | { type: "consumption"; propertyFilter: string | null }
  | { type: "my_tasks" }
  | { type: "rooms" }
  | { type: "help" }
  | null;

const HELP_TEXT_FULL = `🌲 *${APP_NAME} · Comandos*

📊 *Consumo* (admin/gestor)
• \`consumo\` — resumen total (hoy + 7 días)
• \`consumo <nombre>\` — filtrar por propiedad
   _ej:_ \`consumo merced\` o \`consumo 14 julio\`

🌡️ *Ambientes* (admin/gestor)
• \`ambientes\` — T/H promedio últimas 24 h por ambiente

📋 *Tareas*
• \`tareas\` — tus tareas pendientes
• \`tarea <descripción>\` — crear una tarea nueva
   _ej:_ \`tarea se rompió la canilla del baño\`
• 📸 mandá una *foto* (con o sin caption) → crea tarea automática

❓ *Ayuda*
• \`ayuda\` — esta lista

_Sandbox de Kapso. Más comandos próximamente._`;

const HELP_TEXT_STAFF = `🌲 *${APP_NAME} · Comandos*

📋 *Tareas*
• \`tareas\` — tus tareas pendientes
• \`tarea <descripción>\` — crear una tarea (te queda asignada)
   _ej:_ \`tarea se rompió la canilla del baño\`
• 📸 mandá una *foto* → crea tarea automática

❓ *Ayuda*
• \`ayuda\` — esta lista`;

/**
 * Parse a free-form WhatsApp text into a command. Returns null if it doesn't
 * look like a command — caller should fall through to default behavior.
 */
export function parseCommand(text: string | null | undefined): ParsedCommand {
  if (!text) return null;
  const lower = text.trim().toLowerCase();

  if (/^(ayuda|help|comandos|menu)\b/.test(lower)) {
    return { type: "help" };
  }

  // "tareas" / "mis tareas" / "pendientes"
  if (/^(mis\s+)?(tareas|pendientes|tasks?)\b/.test(lower)) {
    return { type: "my_tasks" };
  }

  // "consumo" or "consumo <name>" — match consumption query
  if (/^(consumo|energ[ií]a|electricidad|cu[aá]nto|kwh)\b/.test(lower)) {
    // Extract property filter (everything after the first keyword)
    const m = lower.match(/^[^\s]+\s+(.+)$/);
    const filter = m ? m[1].trim() : null;
    return { type: "consumption", propertyFilter: filter };
  }

  // "ambientes" / "ambiente" / "sensores" / "temperatura"
  if (/^(ambientes?|sensores?|temperatura|humedad)\b/.test(lower)) {
    return { type: "rooms" };
  }

  return null;
}

/**
 * Look up a profile by WhatsApp number. Returns null if no profile has the
 * normalized phone configured.
 */
async function getProfileByPhone(
  phoneNumber: string,
): Promise<Profile | null> {
  const normalized = normalizePhone(phoneNumber);
  if (!normalized) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("*")
    .eq("whatsapp", normalized)
    .maybeSingle();
  return (data as Profile) ?? null;
}

/**
 * Check whether a phone number belongs to a profile that's authorized to
 * issue admin-level commands (admin or gestor). Used by `consumption`/`help`
 * which expose business-wide data; `my_tasks` is open to any profile and
 * scopes results to that user.
 */
export async function isAuthorizedCommandSender(
  phoneNumber: string,
): Promise<boolean> {
  const profile = await getProfileByPhone(phoneNumber);
  if (!profile) return false;
  return profile.role === "admin" || profile.role === "gestor";
}

const KIND_EMOJI: Record<Task["kind"], string> = {
  limpieza: "🧹",
  mantenimiento: "🔧",
  insumos: "📦",
  otro: "📋",
};

const STATUS_EMOJI: Record<Task["status"], string> = {
  pending: "⏳",
  in_progress: "▶️",
  done: "✅",
};

type TaskWithProperty = Task & { property: { name: string } | null };

async function buildMyTasksReport(profileId: string): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tasks")
    .select("*, property:properties(name)")
    .eq("assigned_to", profileId)
    .in("status", ["pending", "in_progress"])
    .order("status", { ascending: true })
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) {
    return `❌ No pude consultar tus tareas: ${error.message}`;
  }
  const tasks = (data ?? []) as TaskWithProperty[];
  if (tasks.length === 0) {
    return "✨ ¡No tenés tareas pendientes!";
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const lines = tasks.map((t, i) => {
    const overdue = !!t.due_date && t.due_date < todayIso;
    const dueLabel = t.due_date
      ? `${overdue ? "⚠️ vencida " : "📅 "}${format(parseISO(t.due_date), "EEE d MMM", { locale: es })}`
      : "";
    const statusBit = STATUS_EMOJI[t.status];
    const propertyBit = t.property?.name ? ` · ${t.property.name}` : "";
    return `${i + 1}. ${KIND_EMOJI[t.kind]} ${statusBit} *${t.title}*${propertyBit}${dueLabel ? `\n   ${dueLabel}` : ""}`;
  });

  return (
    `📋 *Tus tareas pendientes* (${tasks.length})\n\n` +
    lines.join("\n\n") +
    `\n\n_Marcá hechas en: ${APP_HOST}/mis-tareas_`
  );
}

/**
 * Run a parsed command and return the response text. Returns null if the
 * input wasn't a command at all. If it was a command but the sender isn't
 * authorized, returns an explanatory message.
 *
 * Authorization model:
 *  - `my_tasks`: any profile with whatsapp configured (results scoped to them)
 *  - `consumption` / `help`: admin or gestor only (business-wide data)
 */
export async function runCommand(
  command: ParsedCommand,
  fromPhone: string,
): Promise<string | null> {
  if (!command) return null;

  // Per-user commands (no role gate, but profile must exist).
  if (command.type === "my_tasks") {
    const profile = await getProfileByPhone(fromPhone);
    if (!profile) {
      const normalized = normalizePhone(fromPhone) ?? fromPhone;
      return (
        `🔒 Tu número (\`${normalized}\`) no está vinculado a ningún usuario.\n\n` +
        `Pedile a un admin/gestor que te cargue ese número exacto en tu perfil ` +
        `(${APP_HOST} → Usuarios → editar) y reintentá.`
      );
    }
    return await buildMyTasksReport(profile.id);
  }

  // Admin-level commands.
  const allowed = await isAuthorizedCommandSender(fromPhone);
  if (!allowed) {
    const profile = await getProfileByPhone(fromPhone);
    if (profile) {
      // Profile exists but isn't admin/gestor — show staff help instead of
      // a flat "denied" so they discover the `tareas` command.
      return HELP_TEXT_STAFF;
    }
    const normalized = normalizePhone(fromPhone) ?? fromPhone;
    return `🔒 Tu número (\`${normalized}\`) no está autorizado para usar comandos.\n\nSi sos admin/gestor de ${APP_NAME}, cargá ese número exacto en tu profile (${APP_HOST} → Usuarios → editar) y reintentá.`;
  }

  switch (command.type) {
    case "help":
      return HELP_TEXT_FULL;
    case "consumption":
      try {
        // WIK-94: scope por property — gestor solo ve consumo de sus
        // properties asignadas. Admin → null (sin filtro).
        const profile = await getProfileByPhone(fromPhone);
        const allowedIds = profile
          ? await getAllowedPropertyIds(profile)
          : null;
        return await buildConsumptionReport({
          propertyFilter: command.propertyFilter,
          allowedPropertyIds: allowedIds,
        });
      } catch (e) {
        return `❌ No pude generar el reporte: ${(e as Error).message}`;
      }
    case "rooms":
      try {
        // WIK-90 / WIK-94: scope igual que consumption.
        const profile = await getProfileByPhone(fromPhone);
        const allowedIds = profile
          ? await getAllowedPropertyIds(profile)
          : null;
        return await buildRoomsReport(allowedIds);
      } catch (e) {
        return `❌ No pude generar el reporte de ambientes: ${(e as Error).message}`;
      }
  }
}
