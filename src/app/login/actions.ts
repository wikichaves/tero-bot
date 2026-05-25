"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { homeForRole } from "@/lib/auth";
import { normalizePhone } from "@/lib/whatsapp";
import type { UserRole } from "@/lib/types";

/**
 * Detecta si la entrada del user parece teléfono (vs email). Tolera
 * formatos varios — el helper `normalizePhone` después lo lleva a
 * forma canónica `+598...`. Cualquier string con al menos un dígito
 * y SIN `@` se considera phone candidate (más permisivo que parsear
 * estrictamente).
 */
function looksLikePhone(value: string): boolean {
  if (value.includes("@")) return false;
  return /\d/.test(value);
}

/**
 * Login con teléfono (WIK-134, antes WIK-113 aceptaba ambos).
 *
 * El UI solo pide teléfono pero el server sigue aceptando email como
 * fallback defensivo — si un password manager autofill pone un email
 * o un usuario legacy intenta entrar con el suyo, no se rompe. La
 * detección se mantiene por presencia de `@`.
 *
 * Supabase auth tiene también `signInWithPhone` pero requiere SMS OTP
 * — el user pidió mantener el password, así que vamos por el lookup
 * de `profiles.whatsapp` → email asociado.
 */
export async function signIn(input: {
  identifier: string;
  password: string;
}) {
  const identifier = input.identifier.trim();
  if (!identifier) {
    // WIK-151: devolvemos error keys (no strings) para que el cliente
    // las traduzca en su idioma activo. El cliente las resuelve via
    // t("errors.empty") etc.
    return { error: "errors.empty" };
  }

  let email = identifier;

  if (looksLikePhone(identifier)) {
    const normalized = normalizePhone(identifier);
    if (!normalized) {
      return { error: "errors.invalidPhone" };
    }
    // Lookup del email asociado. Service role porque el user todavía
    // no está autenticado y RLS bloquea read de profiles.
    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("email")
      .eq("whatsapp", normalized)
      .maybeSingle();
    if (!profile?.email) {
      return { error: "errors.notFound" };
    }
    email = profile.email as string;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: input.password,
  });
  if (error) {
    // No reveles si el problema fue email/phone vs password — devolver
    // un mensaje genérico para no facilitar enumeration attacks.
    return { error: "errors.credentials" };
  }

  // Look up role to send each user to their natural landing page.
  let role: UserRole | null = null;
  if (data?.user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", data.user.id)
      .maybeSingle();
    role = (profile?.role as UserRole | undefined) ?? null;
  }
  redirect(role ? homeForRole(role) : "/dashboard");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
