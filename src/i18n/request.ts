import { getRequestConfig } from "next-intl/server";
import { resolveLocale } from "./resolve-locale";
import { DEFAULT_LOCALE } from "./locales";

/**
 * next-intl `getRequestConfig` (WIK-151).
 *
 * Se invoca una vez por request en el servidor. Resuelve el locale
 * (cookie → profile → Accept-Language → default) e importa el
 * dictionary correspondiente.
 *
 * Tip: si agregás nuevos locales, sumalos a `messages/<locale>.json`
 * y al array `LOCALES` en `./locales.ts`.
 */
export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  let messages: Record<string, unknown>;
  try {
    messages = (await import(`../../messages/${locale}.json`)).default;
  } catch {
    // Fallback al default si el archivo no existe (no debería pasar).
    messages = (await import(`../../messages/${DEFAULT_LOCALE}.json`)).default;
  }
  return { locale, messages };
});
