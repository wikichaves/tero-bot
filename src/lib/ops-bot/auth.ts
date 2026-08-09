import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/locales";

/**
 * Autorización del bot de OPERACIÓN (@tero_ops_bot, WIK-285).
 *
 * A diferencia del bot de dev (WIK-97, un único TELEGRAM_ADMIN_CHAT_ID),
 * este bot lo usan varias personas (admin/gestor) tanto en DM como en
 * grupos. Autorizamos por ROL: resolvemos el `profiles` cuyo
 * `telegram_chat_id` coincide con el `from.id` del mensaje.
 *
 * - DM:    chat.id === from.id. Autorizamos por from.id.
 * - Grupo: chat.id es el grupo; from.id es la persona. Autorizamos igual
 *          por from.id (cada mensaje trae quién lo mandó), así solo
 *          admin/gestor registrados pueden operar aunque el grupo tenga
 *          otros miembros.
 *
 * Solo roles operativos (admin, gestor) pueden usar el bot. limpieza/
 * mantenimiento/guest quedan afuera por ahora (se puede ampliar).
 */

export type OpsProfile = {
  id: string;
  full_name: string | null;
  role: string;
  language: string | null;
  telegram_chat_id: number | null;
};

const AUTHORIZED_ROLES = ["admin", "gestor"] as const;

export function opsLocaleOf(p: OpsProfile | null): Locale {
  const raw = p?.language;
  if (!raw) return DEFAULT_LOCALE;
  return isLocale(raw) ? raw : DEFAULT_LOCALE;
}

/**
 * Resuelve el profile autorizado para un `from.id` de Telegram.
 * Devuelve null si no hay match o el rol no es operativo.
 */
export async function resolveOpsProfile(
  fromId: number | undefined,
): Promise<OpsProfile | null> {
  if (!fromId) return null;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("id, full_name, role, language, telegram_chat_id")
    .eq("telegram_chat_id", fromId)
    .maybeSingle();
  if (error) {
    console.warn("[ops-bot] profile lookup failed:", error.message);
    return null;
  }
  if (!data) return null;
  const p = data as OpsProfile;
  if (!AUTHORIZED_ROLES.includes(p.role as (typeof AUTHORIZED_ROLES)[number])) {
    return null;
  }
  return p;
}
