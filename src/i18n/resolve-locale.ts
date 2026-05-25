import "server-only";
import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  isLocale,
  pickLocaleFromAcceptLanguage,
  type Locale,
} from "./locales";

/**
 * Resolve el locale activo para la request actual (WIK-151).
 *
 * Priority (alta → baja):
 *   1. Cookie `NEXT_LOCALE` (la setea el LanguageSelector o el login).
 *   2. profile.language (si hay user logueado).
 *   3. Accept-Language del browser.
 *   4. DEFAULT_LOCALE (en).
 *
 * El return es siempre un Locale válido — never falla, default `en`.
 *
 * Note: hacer esto en cada request es barato (las cookies + un select
 * a Supabase ya cached). next-intl lo invoca una vez por request via
 * `getRequestConfig`.
 */
export async function resolveLocale(): Promise<Locale> {
  // 1. Cookie.
  try {
    const cookieStore = await cookies();
    const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
    if (isLocale(cookieLocale)) return cookieLocale;
  } catch {
    // En contextos sin cookies (ej. fully static routes) cookies()
    // tira — fall through al resto.
  }

  // 2. Profile.language. Solo si hay sesión activa.
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("language")
        .eq("id", user.id)
        .maybeSingle();
      const lang = profile?.language as string | undefined;
      if (isLocale(lang)) return lang;
    }
  } catch {
    // Supabase down o sin auth — fall through.
  }

  // 3. Accept-Language.
  try {
    const headerStore = await headers();
    const accept = headerStore.get("accept-language");
    return pickLocaleFromAcceptLanguage(accept);
  } catch {
    // No headers (ej. build time) — final fallback.
  }

  return DEFAULT_LOCALE;
}
