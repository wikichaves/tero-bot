/**
 * Locales soportados (WIK-151). Punto único de verdad — cambiar acá
 * propaga al middleware, al selector UI, al DB constraint, al WhatsApp,
 * todo.
 *
 * Empezamos con dos para no complicar. Si se suma un tercero más
 * adelante (ej. portugués), agregás "pt" acá + un archivo
 * `messages/pt.json` + el option en el selector + el check del DB.
 */

export const LOCALES = ["en", "es"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** Cookie name. Convención de next-intl. */
export const LOCALE_COOKIE = "NEXT_LOCALE";

/** Nombre legible del idioma — usado en el selector UI. */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  es: "Español",
};

/** ISO label corto — usado para mostrarlo en footer. */
export const LOCALE_SHORT: Record<Locale, string> = {
  en: "EN",
  es: "ES",
};

export function isLocale(value: string | undefined | null): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}

/**
 * Resolver la mejor opción a partir de un Accept-Language header.
 * Implementación liviana — no parsea q-values, solo busca el primer
 * locale soportado en la lista. Para nuestro use case alcanza.
 */
export function pickLocaleFromAcceptLanguage(
  acceptLanguage: string | null,
): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  // Split por coma, tomar el code de cada uno (ej. "es-AR" → "es").
  const candidates = acceptLanguage
    .split(",")
    .map((s) => s.trim().split(";")[0].split("-")[0].toLowerCase());
  for (const c of candidates) {
    if (isLocale(c)) return c;
  }
  return DEFAULT_LOCALE;
}
