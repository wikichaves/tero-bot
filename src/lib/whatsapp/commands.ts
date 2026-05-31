import "server-only";
import { parseISO } from "date-fns";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildConsumptionReport } from "@/lib/energy/reports";
import { buildRoomsReport } from "@/lib/sensors/reports";
import { getAllowedPropertyIds } from "@/lib/auth/scope";
import { APP_NAME, APP_HOST } from "@/lib/brand";
import { formatTaskDueDate } from "@/lib/i18n/date";
import { tr } from "@/lib/i18n/messages";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/locales";
import type { Profile, Task } from "@/lib/types";
import { normalizePhone } from "./index";

export type ParsedCommand =
  | { type: "consumption"; propertyFilter: string | null }
  | { type: "my_tasks" }
  | { type: "rooms" }
  | { type: "help" }
  | { type: "activate" }
  | null;

// WIK-132: dropped the 🌲 emoji + " · " separator from the header so it
// reads as a clean `*tero.bot Comandos*`. Also removed the
// "Sandbox de Kapso" footer note — the bot's live, not a demo anymore.
// WIK-97: los cmds `linear` y `claude` se movieron al bot de Telegram
// (dev/admin channel — sin restricción de 24h window, code blocks,
// inline keyboards, etc.). Acá quedan solo los cmds operativos.
// WIK-151: HELP_TEXT_* dejaron de ser constantes — ahora son funciones
// de `locale` que arman el string desde el dictionary correspondiente.
// WIK-215 v3: bypasseamos `getTranslations` de next-intl porque en
// contexto webhook (sin request scope) devolvía el key path literal
// como fallback ("whatsapp.help.headerFull"). `tr()` lee el JSON
// directo + hace template substitution, sin magia.
async function helpTextFull(locale: Locale): Promise<string> {
  return tr(locale, "whatsapp.help.headerFull", { appName: APP_NAME });
}

async function helpTextStaff(locale: Locale): Promise<string> {
  return tr(locale, "whatsapp.help.headerStaff", { appName: APP_NAME });
}

/**
 * Parse a free-form WhatsApp text into a command. Returns null if it doesn't
 * look like a command — caller should fall through to default behavior.
 *
 * Note: keywords are intentionally bilingual-friendly (`tasks?`, `help`)
 * to accept English shortcuts even when the user's profile is set to
 * Spanish — the *response* will still come back in their locale.
 */
export function parseCommand(text: string | null | undefined): ParsedCommand {
  if (!text) return null;
  const lower = text.trim().toLowerCase();

  if (/^(ayuda|help|comandos|menu)\b/.test(lower)) {
    return { type: "help" };
  }

  // WIK-278: "activar" / "activá" / "activate" — el operador nuevo abre la
  // ventana de 24h con el link click-to-chat; el webhook responde con la
  // bienvenida como mensaje de sesión (entrega confiable, sin throttling de
  // templates business-initiated).
  if (/^(activ[aá]r?|activate)\b/.test(lower)) {
    return { type: "activate" };
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

  // WIK-97: `linear` y `claude` cmds movidos a /api/telegram. WhatsApp
  // mantiene los cmds operativos (staff-facing); Telegram es el canal
  // dev/admin del developer único.

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
 * Coerce `profile.language` (a free-form text in the DB) to a supported
 * Locale, falling back to DEFAULT_LOCALE (en).
 */
function profileLocale(profile: Profile | null): Locale {
  if (!profile?.language) return DEFAULT_LOCALE;
  return isLocale(profile.language) ? profile.language : DEFAULT_LOCALE;
}

/**
 * Resolve the preferred locale for a WhatsApp phone number. If there's no
 * matching profile (guest / unknown), default to `en`. Exposed so the
 * webhook can resolve the locale once and pass it into `runCommand`.
 */
export async function resolveLocaleForPhone(
  phoneNumber: string,
): Promise<Locale> {
  const profile = await getProfileByPhone(phoneNumber);
  return profileLocale(profile);
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

async function buildMyTasksReport(
  profileId: string,
  locale: Locale,
): Promise<string> {
  const admin = createAdminClient();
  const t = await getTranslations({ locale, namespace: "whatsapp.myTasks" });
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
    return t("errorQuery", { message: error.message });
  }
  const tasks = (data ?? []) as TaskWithProperty[];
  if (tasks.length === 0) {
    return t("empty");
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const lines = tasks.map((t, i) => {
    const overdue = !!t.due_date && t.due_date < todayIso;
    const dueLabel = t.due_date
      ? `${overdue ? "⚠️ " : "📅 "}${formatTaskDueDate(parseISO(t.due_date), locale)}`
      : "";
    const statusBit = STATUS_EMOJI[t.status];
    const propertyBit = t.property?.name ? ` · ${t.property.name}` : "";
    return `${i + 1}. ${KIND_EMOJI[t.kind]} ${statusBit} *${t.title}*${propertyBit}${dueLabel ? `\n   ${dueLabel}` : ""}`;
  });

  return (
    `${t("header", { n: tasks.length })}\n\n` +
    lines.join("\n\n") +
    `\n\n${t("footer", { host: APP_HOST })}`
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
 *
 * `locale` controls the response language — caller should resolve it from
 * the sender's profile (via `resolveLocaleForPhone`) before invoking. If
 * the caller omits it, defaults to `en`.
 */
export async function runCommand(
  command: ParsedCommand,
  fromPhone: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<string | null> {
  if (!command) return null;

  // Per-user commands (no role gate, but profile must exist).
  if (command.type === "my_tasks") {
    const profile = await getProfileByPhone(fromPhone);
    if (!profile) {
      const normalized = normalizePhone(fromPhone) ?? fromPhone;
      const tAuth = await getTranslations({
        locale,
        namespace: "whatsapp.auth",
      });
      return tAuth("myTasksUnlinked", {
        phone: normalized,
        host: APP_HOST,
      });
    }
    // Use the profile's own locale for its tasks report — overrides the
    // caller-supplied one (which may have been the default).
    return await buildMyTasksReport(profile.id, profileLocale(profile));
  }

  // Admin-level commands.
  const allowed = await isAuthorizedCommandSender(fromPhone);
  if (!allowed) {
    const profile = await getProfileByPhone(fromPhone);
    if (profile) {
      // Profile exists but isn't admin/gestor — show staff help instead of
      // a flat "denied" so they discover the `tareas` command.
      return await helpTextStaff(profileLocale(profile));
    }
    const normalized = normalizePhone(fromPhone) ?? fromPhone;
    const tAuth = await getTranslations({
      locale,
      namespace: "whatsapp.auth",
    });
    return tAuth("notAuthorized", {
      phone: normalized,
      host: APP_HOST,
      appName: APP_NAME,
    });
  }

  switch (command.type) {
    case "help": {
      const profile = await getProfileByPhone(fromPhone);
      return await helpTextFull(profileLocale(profile));
    }
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
          locale: profileLocale(profile),
        });
      } catch (e) {
        const t = await getTranslations({
          locale,
          namespace: "whatsapp.consumption",
        });
        return t("errorReport", { message: (e as Error).message });
      }
    case "rooms":
      try {
        // WIK-90 / WIK-94: scope igual que consumption.
        const profile = await getProfileByPhone(fromPhone);
        const allowedIds = profile
          ? await getAllowedPropertyIds(profile)
          : null;
        return await buildRoomsReport(allowedIds, profileLocale(profile));
      } catch (e) {
        const t = await getTranslations({
          locale,
          namespace: "whatsapp.rooms",
        });
        return t("errorReport", { message: (e as Error).message });
      }
    case "activate":
      // WIK-278: la activación se maneja en el webhook route (necesita el
      // contexto del envío de sesión). No debería llegar acá; devolvemos
      // null para no romper el flujo si lo hiciera.
      return null;
  }
}
