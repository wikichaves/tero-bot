import "server-only";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales";

/**
 * Helper standalone para leer mensajes traducidos desde el JSON sin
 * depender del request-config flow de next-intl (WIK-215 v3).
 *
 * Contexto: `getTranslations({locale})` en next-intl v4 a veces no
 * resuelve el texto cuando se invoca desde un webhook handler donde
 * no hay request-context propio (no [locale] segment, no cookies,
 * no profile). Aunque pases `locale` explícito, la chain interna se
 * confunde y devuelve la key literal ("whatsapp.help.headerFull") en
 * vez del texto.
 *
 * Esta función baja por el JSON directo + hace template substitution
 * estilo `{varName}`. Determinístico, sin magia. La usamos en
 * cualquier server-side flow donde `getTranslations` es overkill o
 * frágil — typically webhooks o jobs background.
 *
 * Es la mejor solución que encontramos: el bug original era que el
 * propio next-intl perdía el contexto del locale cuando se llamaba
 * desde un webhook handler. No es un bug nuestro — es una limitación
 * conocida de next-intl v4 en contextos sin request scope.
 */

// Tipo recursivo para los messages JSON (objeto anidado de strings).
type MessageDict = { [key: string]: string | MessageDict };

const cache = new Map<Locale, MessageDict>();

async function loadMessages(locale: Locale): Promise<MessageDict> {
  const cached = cache.get(locale);
  if (cached) return cached;
  let messages: MessageDict;
  try {
    messages = (await import(`../../../messages/${locale}.json`))
      .default as MessageDict;
  } catch {
    messages = (await import(`../../../messages/${DEFAULT_LOCALE}.json`))
      .default as MessageDict;
  }
  cache.set(locale, messages);
  return messages;
}

/**
 * Resuelve un path dotted (ej. "whatsapp.help.headerFull") contra el
 * dict de un locale. Devuelve el path mismo como fallback si no lo
 * encuentra — mismo comportamiento que next-intl. Permite además
 * sustituir variables `{name}` con el `vars` opcional.
 *
 * @example
 *   await tr("es", "whatsapp.help.headerFull", { appName: "tero.bot" })
 */
export async function tr(
  locale: Locale,
  path: string,
  vars: Record<string, string | number> = {},
): Promise<string> {
  const messages = await loadMessages(locale);
  const parts = path.split(".");
  let cur: string | MessageDict | undefined = messages;
  for (const p of parts) {
    if (typeof cur !== "object" || cur === null) {
      cur = undefined;
      break;
    }
    cur = cur[p];
  }
  if (typeof cur !== "string") {
    // Fallback: devolver el path mismo (como hace next-intl).
    return path;
  }
  let out = cur;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
  }
  return out;
}
