import { getRequestConfig } from "next-intl/server";
import { resolveLocale } from "./resolve-locale";
import { DEFAULT_LOCALE, isLocale } from "./locales";

/**
 * next-intl `getRequestConfig` (WIK-151, fix WIK-215).
 *
 * Se invoca una vez por request en el servidor. Decide qué locale usar
 * y carga el dictionary correspondiente.
 *
 * Priority:
 *   1. `requestLocale` explícito — cuando el caller pasa
 *      `getTranslations({ locale })` (ej. webhook handlers que ya saben
 *      el locale del perfil del usuario y no pueden depender del request
 *      context).
 *   2. `resolveLocale()` — cookie → profile → Accept-Language → default.
 *      Para todo el flow web normal.
 *
 * WIK-215: antes ignorábamos `requestLocale` y siempre re-resolvíamos.
 * En contextos webhook (sin cookie/profile/header) eso caía al
 * DEFAULT_LOCALE. Pero el caller pedía "es" via `{locale}`. next-intl
 * detectaba el mismatch y devolvía la key path literal como fallback
 * ("whatsapp.help.headerFull") en vez del texto traducido.
 *
 * Tip: si agregás nuevos locales, sumalos a `messages/<locale>.json`
 * y al array `LOCALES` en `./locales.ts`.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const explicit = await requestLocale;
  const locale = isLocale(explicit) ? explicit : await resolveLocale();
  let messages: Record<string, unknown>;
  try {
    messages = (await import(`../../messages/${locale}.json`)).default;
  } catch {
    // Fallback al default si el archivo no existe (no debería pasar).
    messages = (await import(`../../messages/${DEFAULT_LOCALE}.json`)).default;
  }
  return { locale, messages };
});
