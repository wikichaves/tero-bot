"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth";
import { normalizePhone } from "@/lib/whatsapp";

// WIK-74: "limpieza" deprecado, unificado en "mantenimiento".
const ROLES = ["admin", "gestor", "mantenimiento"] as const;

// WIK-118: teléfono obligatorio, email opcional. Si el user solo
// tiene phone, sintetizamos un email fake `<phone>@phone.tero.local`
// para satisfacer el requirement de Supabase Auth (que pide email
// or phone+OTP — y queremos mantener password auth, no OTP).
//
// El login con phone (WIK-113) hace lookup en `profiles.whatsapp`
// para resolver el email asociado, así que el user nunca ve ni usa
// el email sintetizado.
const createSchema = z.object({
  // Email ahora opcional: si viene vacío, lo sintetizamos.
  email: z
    .string()
    .email("Email inválido.")
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres."),
  full_name: z.string().min(1, "Falta el nombre.").max(100),
  role: z.enum(ROLES),
  // Teléfono ahora obligatorio.
  whatsapp: z.string().min(1, "El teléfono es obligatorio."),
  // WIK-155: idioma preferido. Default `en` a nivel DB; opcional acá.
  language: z
    .string()
    .optional()
    .or(z.literal(""))
    .transform((v) =>
      v === "en" || v === "es" ? (v as "en" | "es") : undefined,
    ),
});

/**
 * Genera un email sintético determinístico desde un phone normalizado.
 * Formato: `<phone-sin-+>@phone.tero.local`. El dominio `.local` no
 * existe en internet — útil para detectar emails sintéticos en logs
 * o en queries futuras.
 */
function synthesizeEmail(normalizedPhone: string): string {
  const digits = normalizedPhone.replace(/^\+/, "");
  return `${digits}@phone.tero.local`;
}

export async function createUser(formData: FormData) {
  await requireRole(["admin"]);

  const parsed = createSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    full_name: formData.get("full_name"),
    role: formData.get("role"),
    whatsapp: formData.get("whatsapp"),
    language: formData.get("language"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const { password, full_name, role } = parsed.data;
  const whatsapp = normalizePhone(parsed.data.whatsapp);
  if (!whatsapp) {
    return { error: "Teléfono inválido. Usá formato +598... o 099..." };
  }

  // Si el admin dio email lo usamos. Sino sintetizamos uno desde phone
  // para que Supabase pueda crear el auth user.
  const email = parsed.data.email ?? synthesizeEmail(whatsapp);

  const admin = createAdminClient();

  // SECURITY: do NOT pass `role` in user_metadata. The DB trigger ignores it
  // (always assigns 'gestor' on insert) — we explicitly assign the requested
  // role below using the service-role client.
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name, whatsapp },
  });
  if (error) return { error: error.message };
  if (!created.user) {
    return { error: "No se pudo crear el usuario." };
  }

  const { error: profileError } = await admin
    .from("profiles")
    .update({
      role,
      full_name,
      whatsapp,
      ...(parsed.data.language ? { language: parsed.data.language } : {}),
    })
    .eq("id", created.user.id);
  if (profileError) {
    // Roll back the auth user so we don't leave orphans with the default role.
    await admin.auth.admin.deleteUser(created.user.id);
    return { error: `No se pudo asignar el rol: ${profileError.message}` };
  }

  revalidatePath("/admin/users");
  return { ok: true };
}

const updateProfileSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string().min(1, "Falta el nombre.").max(100),
  whatsapp: z
    .string()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  // WIK-155: idioma preferido. Opcional — si no viene, no se toca.
  language: z
    .string()
    .optional()
    .or(z.literal(""))
    .transform((v) =>
      v === "en" || v === "es" ? (v as "en" | "es") : undefined,
    ),
});

export async function updateProfile(input: {
  id: string;
  full_name: string;
  whatsapp: string;
  language?: string;
}) {
  await requireRole(["admin"]);
  const parsed = updateProfileSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({
      full_name: parsed.data.full_name,
      whatsapp: normalizePhone(parsed.data.whatsapp),
      ...(parsed.data.language ? { language: parsed.data.language } : {}),
    })
    .eq("id", parsed.data.id);
  if (error) return { error: error.message };
  revalidatePath("/admin/users");
  return { ok: true };
}

const updateRoleSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(ROLES),
});

export async function updateRole(input: { id: string; role: string }) {
  const me = await requireRole(["admin"]);
  const parsed = updateRoleSchema.safeParse(input);
  if (!parsed.success) return { error: "Rol inválido." };
  if (parsed.data.id === me.id && parsed.data.role !== "admin") {
    return { error: "No podés quitarte el rol de admin a vos mismo." };
  }
  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ role: parsed.data.role })
    .eq("id", parsed.data.id);
  if (error) return { error: error.message };
  revalidatePath("/admin/users");
  return { ok: true };
}

/**
 * WIK-94: setear las property scopes de un profile. Admin-only.
 * Reemplaza el set completo (delete + insert) — no es incremental.
 */
const setPropertiesSchema = z.object({
  profileId: z.string().uuid(),
  propertyIds: z.array(z.string().uuid()),
});

export async function setProfileProperties(input: {
  profileId: string;
  propertyIds: string[];
}) {
  await requireRole(["admin"]);
  const parsed = setPropertiesSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Input inválido." };
  }
  const admin = createAdminClient();
  // Delete actuales del profile.
  const { error: delErr } = await admin
    .from("profile_properties")
    .delete()
    .eq("profile_id", parsed.data.profileId);
  if (delErr) return { error: `delete falló: ${delErr.message}` };
  if (parsed.data.propertyIds.length > 0) {
    const rows = parsed.data.propertyIds.map((pid) => ({
      profile_id: parsed.data.profileId,
      property_id: pid,
    }));
    const { error: insErr } = await admin
      .from("profile_properties")
      .insert(rows);
    if (insErr) return { error: `insert falló: ${insErr.message}` };
  }
  revalidatePath("/admin/users");
  return { ok: true };
}

export async function deleteUser(id: string) {
  const me = await requireRole(["admin"]);
  if (id === me.id) {
    return { error: "No podés eliminarte a vos mismo." };
  }
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) return { error: error.message };
  revalidatePath("/admin/users");
  return { ok: true };
}

/**
 * Resetear el password de cualquier usuario (WIK-106). Sólo admin.
 * El user recibe el nuevo password en el chat con el admin — no se
 * manda email automático ni nada (los users son staff conocido).
 *
 * Mínimo 8 chars (mismo schema que `createUser`). Para reset el
 * propio password el user puede hacerlo desde Supabase, este endpoint
 * está orientado al caso "se olvidó el password".
 */
const resetPasswordSchema = z.object({
  id: z.string().uuid("ID inválido."),
  password: z
    .string()
    .min(8, "La contraseña debe tener al menos 8 caracteres."),
});

export async function resetUserPassword(input: {
  id: string;
  password: string;
}) {
  await requireRole(["admin"]);
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(parsed.data.id, {
    password: parsed.data.password,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/users");
  return { ok: true };
}
