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
 * Login con email O teléfono (WIK-113). Si el user ingresa un teléfono,
 * lo normalizamos y buscamos el email asociado en `profiles.whatsapp`,
 * después seguimos el flow estándar de email+password.
 *
 * Supabase auth tiene también `signInWithPhone` pero requiere SMS OTP
 * — el user pidió mantener el password, así que vamos por el lookup.
 */
export async function signIn(input: {
  identifier: string;
  password: string;
}) {
  const identifier = input.identifier.trim();
  if (!identifier) {
    return { error: "Ingresá email o teléfono." };
  }

  let email = identifier;

  if (looksLikePhone(identifier)) {
    const normalized = normalizePhone(identifier);
    if (!normalized) {
      return { error: "Teléfono inválido. Usá formato +598... o 099..." };
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
      return {
        error: "No encontré un usuario con ese teléfono.",
      };
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
    return { error: "Credenciales inválidas." };
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
