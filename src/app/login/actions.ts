"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePhone } from "@/lib/whatsapp";

export async function signIn(input: {
  identifier: string;
  password: string;
}) {
  if (!input || typeof input.identifier !== "string" || typeof input.password !== "string" || !input.password || input.password.length > 1024 || input.identifier.length > 100) return { error: "errors.credentials" };
  const identifier = input.identifier.trim();
  if (!identifier) {
    // WIK-151: devolvemos error keys (no strings) para que el cliente
    // las traduzca en su idioma activo. El cliente las resuelve via
    // t("errors.empty") etc.
    return { error: "errors.empty" };
  }

  if (!/^[+\d\s().-]+$/.test(identifier)) return { error: "errors.invalidPhone" };
  const normalized = normalizePhone(identifier);
  if (!normalized || !/^\+[1-9]\d{7,14}$/.test(normalized)) return { error: "errors.invalidPhone" };
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("email")
    .eq("whatsapp", normalized).maybeSingle();
  // Same error as a wrong password; no account enumeration.
  if (!profile?.email) return { error: "errors.credentials" };
  const email = profile.email as string;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password: input.password,
  });
  if (error) {
    // No reveles si el problema fue email/phone vs password — devolver
    // un mensaje genérico para no facilitar enumeration attacks.
    return { error: "errors.credentials" };
  }

  // Todos los roles aterrizan en /dashboard (el page condiciona según
  // role). Antes había un lookup de `role` para alimentar `homeForRole`
  // — removido al colapsar los homes (WIK-74, WIK-109, WIK-119).
  redirect("/dashboard");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
