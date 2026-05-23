import "server-only";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildConsumptionReport } from "@/lib/energy/reports";
import { buildRoomsReport } from "@/lib/sensors/reports";
import { getAllowedPropertyIds } from "@/lib/auth/scope";
import { APP_NAME, APP_HOST } from "@/lib/brand";
import { createLinearIssue } from "@/lib/linear/create-issue";
import type { Profile, Task } from "@/lib/types";
import { normalizePhone } from "./index";

export type ParsedCommand =
  | { type: "consumption"; propertyFilter: string | null }
  | { type: "my_tasks" }
  | { type: "rooms" }
  | { type: "help" }
  | {
      type: "linear_issue";
      title: string;
      description: string;
      /** "urgente" → 1, "alto"→2, default 3 (medium). */
      priority: 0 | 1 | 2 | 3 | 4;
    }
  | {
      type: "claude_queue";
      /** Prompt completo. Va al description del Linear issue. */
      prompt: string;
    }
  | null;

// WIK-132: dropped the 🌲 emoji + " · " separator from the header so it
// reads as a clean `*tero.bot Comandos*`. Also removed the
// "Sandbox de Kapso" footer note — the bot's live, not a demo anymore.
// WIK-97: agregados `linear` y `claude` (admin-only).
const HELP_TEXT_FULL = `*${APP_NAME} Comandos*

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

🎫 *Linear* (admin)
• \`linear <título>\` — crear ticket nuevo en Linear
• \`linear urgente <título>\` — prioridad urgent (1)
   _ej:_ \`linear urgente arreglar bug en /energy\`
• La segunda línea (si la hay) se usa como descripción.

🤖 *Claude autónomo* (admin)
• \`claude <prompt>\` — encolar trabajo para que Claude lo haga
   _ej:_ \`claude refactor el dashboard para usar grid\`
• Va a Linear con label \`claude:autonomous\`. El worker diario lo levanta.

❓ *Ayuda*
• \`ayuda\` — esta lista`;

const HELP_TEXT_STAFF = `*${APP_NAME} Comandos*

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

  // WIK-97: `linear <título>` o `ticket <título>` o `bug <título>` o
  // `feature <título>` → crear issue. Soporta:
  //   - "linear urgente arreglar X" → priority 1 (urgent)
  //   - "linear alto Y" → priority 2 (high)
  //   - "linear Z" → priority 3 (medium, default razonable)
  // La SEGUNDA línea (si hay \n) se pasa como description completa.
  {
    const m = text
      .trim()
      .match(/^(linear|ticket|bug|feature|issue)\s+([\s\S]+)$/i);
    if (m) {
      const rest = m[2];
      const [firstLine, ...descLines] = rest.split("\n");
      const description = descLines.join("\n").trim();
      let priority: 0 | 1 | 2 | 3 | 4 = 3;
      let titleSource = firstLine.trim();
      const prio = titleSource.match(/^(urgente|alto|medio|bajo)\s+(.+)$/i);
      if (prio) {
        const word = prio[1].toLowerCase();
        priority =
          word === "urgente" ? 1 : word === "alto" ? 2 : word === "bajo" ? 4 : 3;
        titleSource = prio[2].trim();
      }
      if (titleSource.length === 0) return null;
      return {
        type: "linear_issue",
        title: titleSource,
        description,
        priority,
      };
    }
  }

  // WIK-97: `claude <prompt>` → enqueue para el worker autónomo. Lo
  // guardamos como Linear issue con label `claude:autonomous` que el
  // GitHub Action diario (cuando esté armado) levanta y procesa.
  {
    const m = text.trim().match(/^claude\s+([\s\S]+)$/i);
    if (m) {
      const prompt = m[1].trim();
      if (prompt.length === 0) return null;
      return { type: "claude_queue", prompt };
    }
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
    `\n\n_Marcá hechas en: ${APP_HOST}/my-tasks_`
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
    case "linear_issue":
      // WIK-97: crear ticket en Linear. Solo admin/gestor llegan acá
      // (`allowed` ya pasó). Description vacío se omite.
      try {
        const issue = await createLinearIssue({
          title: command.title,
          description: command.description || undefined,
          priority: command.priority,
        });
        const prioLabel =
          command.priority === 1
            ? " (urgente)"
            : command.priority === 2
              ? " (alto)"
              : command.priority === 4
                ? " (bajo)"
                : "";
        return (
          `🎫 *Ticket creado${prioLabel}*\n\n` +
          `*${issue.identifier}*: ${issue.title}\n\n` +
          `_${issue.url}_`
        );
      } catch (e) {
        return `❌ No pude crear el ticket: ${(e as Error).message}`;
      }
    case "claude_queue":
      // WIK-97: encolar prompt para el worker autónomo. Va a Linear con
      // label `claude:autonomous` para que el GH Action diario lo
      // levante. Primera línea del prompt → title, resto → description.
      try {
        const [firstLine, ...rest] = command.prompt.split("\n");
        const title = firstLine.trim().slice(0, 120);
        const description = [
          rest.length > 0 ? rest.join("\n").trim() : "",
          "",
          "---",
          "_Encolado vía `claude` cmd de WhatsApp. El worker autónomo lo va a levantar._",
        ]
          .filter(Boolean)
          .join("\n");
        const issue = await createLinearIssue({
          title,
          description,
          priority: 3,
          labels: ["claude:autonomous"],
        });
        return (
          `🤖 *Trabajo encolado para Claude*\n\n` +
          `*${issue.identifier}*: ${issue.title}\n\n` +
          `_${issue.url}_\n\n` +
          `Cuando el worker corra (diario o on-demand) lo levanta.`
        );
      } catch (e) {
        return `❌ No pude encolar: ${(e as Error).message}`;
      }
  }
}
