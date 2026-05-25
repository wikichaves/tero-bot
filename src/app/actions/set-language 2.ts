"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isLocale, LOCALE_COOKIE, type Locale } from "@/i18n/locales";

/**
 * Persiste la preferencia de idioma del usuario (WIK-151).
 *
 * Dual-write:
 *   1. Cookie `NEXT_LOCALE` — efecto inmediato, propaga a anónimos y
 *      sobrevive logout.
 *   2. `profiles.language` — autoritativa para logged-in users,
 *      permite que la pref persista cross-device.
 *
 * El layout root (que usa `useTranslations` via getRequestConfig)
 * re-resuelve el locale en el próximo render porque next-intl leyó
 * la cookie en el request. `revalidatePath("/")` fuerza el re-render.
 */
export async function setLanguageAction(locale: string): Promise<void> {
  if (!isLocale(locale)) {
    throw new Error(`Unsupported locale: ${locale}`);
  }
  const typed: Locale = locale;

  // 1. Cookie. 1 año de TTL, secure en prod.
  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, typed, {
    path: "/",
    maxAge: 365 * 24 * 60 * 60,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  // 2. profile.language (si hay user logueado). Best-effort — si falla,
  //    el cookie ya quedó seteado y la pref sigue funcionando en este
  //    device. Log para diagnosticar pero no romper la UX.
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { error } = await supabase
        .from("profiles")
        .update({ language: typed })
        .eq("id", user.id);
      if (error) {
        console.warn("[setLanguageAction] profile update failed", error.message);
      }
    }
  } catch (e) {
    console.warn("[setLanguageAction] auth/db error", (e as Error).message);
  }

  // Forzar re-render del current path con el nuevo locale.
  revalidatePath("/", "layout");
}
