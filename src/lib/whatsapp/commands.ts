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

// WIK-310: ayuda para el rol `guest` — sólo `ambientes` + `ayuda`.
async function helpTextGuest(locale: Locale): Promise<string> {
  return tr(locale, "whatsapp.help.headerGuest", { appName: APP_NAME });
}

/**
 * Texto de ayuda apropiado para el rol del profile. Centraliza el mapeo
 * rol → variante de help para que `runCommand` lo reuse tanto en el comando
 * `ayuda` explícito como en el fallback de "comando no permitido para tu
 * rol" (así el usuario descubre qué SÍ puede hacer).
 */
async function helpForRole(profile: Profile): Promise<string> {
  const locale = profileLocale(profile);
  if (profile.role === "admin" || profile.role === "gestor") {
    return await helpTextFull(locale);
  }
  if (profile.role === "guest") {
    return await helpTextGuest(locale);
  }
  // mantenimiento (Staff)
  return await helpTextStaff(locale);
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

/** Roles con acceso a datos business-wide (consumo). */
function isBusinessRole(role: Profile["role"]): boolean {
  return role === "admin" || role === "gestor";
}

/**
 * Roles que pueden consultar `ambientes` (T/H por ambiente). WIK-310: el
 * rol `guest` se suma a admin/gestor — su único dato accesible, scopeado a
 * las propiedades que el admin le asigne (igual que gestor/staff).
 */
function canUseRooms(role: Profile["role"]): boolean {
  return role === "admin" || role === "gestor" || role === "guest";
}

/**
 * Check whether a phone number belongs to a profile authorized to issue
 * admin-level (business-wide) commands. Kept as a thin wrapper for any
 * external caller; internally `runCommand` gates per-command by role.
 */
export async function isAuthorizedCommandSender(
  phoneNumber: string,
): Promise<boolean> {
  const profile = await getProfileByPhone(phoneNumber);
  if (!profile) return false;
  return isBusinessRole(profile.role);
}

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
  // `t` (translations) queda sombreado dentro del map por el param de la
  // tarea, así que capturamos el label de "vencida" antes.
  const overdueLabel = t("overdue");
  const lines = tasks.map((task, i) => {
    const overdue = !!task.due_date && task.due_date < todayIso;
    const dueLabel = task.due_date
      ? `${overdue ? `${overdueLabel} · ` : ""}${formatTaskDueDate(parseISO(task.due_date), locale)}`
      : "";
    const propertyBit = task.property?.name ? ` · ${task.property.name}` : "";
    return `${i + 1}. *${task.title}*${propertyBit}${dueLabel ? `\n   ${dueLabel}` : ""}`;
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
 * Authorization model (por rol):
 *  - `help`: cualquier profile — devuelve la variante de su rol
 *  - `my_tasks`: admin/gestor/staff (results scoped to them); guest → su help
 *  - `rooms` (ambientes): admin/gestor/guest, scopeado por property (WIK-310)
 *  - `consumption`: admin/gestor only (business-wide data)
 *  - sin profile: mensaje de "no autorizado"
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

  // WIK-278: la activación se maneja en el webhook route (necesita el
  // contexto del envío de sesión). No debería llegar acá; devolvemos null
  // para no romper el flujo si lo hiciera.
  if (command.type === "activate") return null;

  const profile = await getProfileByPhone(fromPhone);

  // Helper local: mensaje de "no autorizado" para números sin profile.
  const unauthorized = async () => {
    const normalized = normalizePhone(fromPhone) ?? fromPhone;
    const tAuth = await getTranslations({ locale, namespace: "whatsapp.auth" });
    return tAuth("notAuthorized", {
      phone: normalized,
      host: APP_HOST,
      appName: APP_NAME,
    });
  };

  // `ayuda` → variante de help según el rol (full / staff / guest). Sin
  // profile, mostramos el mensaje de "no autorizado".
  if (command.type === "help") {
    if (!profile) return await unauthorized();
    return await helpForRole(profile);
  }

  // `tareas` → cualquier profile operativo (admin/gestor/staff). El rol
  // `guest` no tiene tareas: le devolvemos su help para que descubra que
  // sólo puede usar `ambientes`/`ayuda`.
  if (command.type === "my_tasks") {
    if (!profile) {
      const normalized = normalizePhone(fromPhone) ?? fromPhone;
      const tAuth = await getTranslations({
        locale,
        namespace: "whatsapp.auth",
      });
      return tAuth("myTasksUnlinked", { phone: normalized, host: APP_HOST });
    }
    if (profile.role === "guest") return await helpForRole(profile);
    // Use the profile's own locale for its tasks report — overrides the
    // caller-supplied one (which may have been the default).
    return await buildMyTasksReport(profile.id, profileLocale(profile));
  }

  // `ambientes` → admin / gestor / guest (WIK-310). Scope por property.
  if (command.type === "rooms") {
    if (!profile) return await unauthorized();
    if (!canUseRooms(profile.role)) return await helpForRole(profile);
    try {
      // WIK-90 / WIK-94: scope igual que consumption. Para guest, el admin
      // le asigna propiedades vía profile_properties (igual que gestor/staff).
      const allowedIds = await getAllowedPropertyIds(profile);
      return await buildRoomsReport(allowedIds, profileLocale(profile));
    } catch (e) {
      const t = await getTranslations({ locale, namespace: "whatsapp.rooms" });
      return t("errorReport", { message: (e as Error).message });
    }
  }

  // `consumo` → sólo admin/gestor (datos business-wide). Profile no
  // business-role → su help; sin profile → no autorizado.
  if (command.type === "consumption") {
    if (!profile) return await unauthorized();
    if (!isBusinessRole(profile.role)) return await helpForRole(profile);
    try {
      // WIK-94: scope por property — gestor solo ve consumo de sus
      // properties asignadas. Admin → null (sin filtro).
      const allowedIds = await getAllowedPropertyIds(profile);
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
  }

  return null;
}
