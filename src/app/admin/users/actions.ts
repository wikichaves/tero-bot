"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth";
import {
  normalizePhone,
  sendKapsoTemplateWithFallback,
} from "@/lib/whatsapp";
import { formatPropertyList } from "@/lib/whatsapp/templates";
import { getAllowedPropertyIds } from "@/lib/auth/scope";

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

/**
 * WIK-177: manda el template de bienvenida por WhatsApp al profile
 * indicado. Pensado para el primer contacto con un gestor/mantenimiento
 * nuevo — abre la ventana de 24h sin requerir que ellos escriban primero.
 *
 * Estrategia (WIK-239): intenta `staff_welcome_v3` (UTILITY, "se activó
 * tu acceso de operador en {{2}}") con la lista de propiedades. Ante
 * CUALQUIER error (típico: v3 PENDING hasta que Meta lo apruebe) cae al
 * v1 (`staff_welcome`, APPROVED). Self-healing: cuando Meta apruebe v3,
 * el primer try gana solo. v2 quedó deprecado (Meta lo clasificó
 * MARKETING → no entregaba confiable).
 *
 * Variables v3:
 *   {{1}} = primer nombre del staff (extraído de profiles.full_name)
 *   {{2}} = lista natural de propiedades asignadas
 *
 * Para admin (sin scope explícito) usa **todas** las properties — el
 * UI igual esconde el botón para admin, pero por defensiva.
 *
 * Requiere: admin role, profile con `whatsapp` configurado, env vars
 * `WHATSAPP_PHONE_NUMBER_ID` + `KAPSO_API_KEY`.
 */
export async function sendStaffWelcome(profileId: string): Promise<
  | {
      ok: true;
      /** Template que Meta ACEPTÓ (no implica entrega). */
      templateUsed: "staff_welcome_v3" | "staff_welcome";
      /** wamid devuelto por Meta — confirma aceptación, no entrega. */
      messageId: string | null;
      /** true si cayó al idioma `es` por fallback de variante. */
      fellBack: boolean;
    }
  | { error: string }
> {
  await requireRole(["admin"]);

  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const apiKey = process.env.KAPSO_API_KEY;
  if (!phoneNumberId || !apiKey) {
    return { error: "WhatsApp no está configurado en este entorno." };
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("id, full_name, email, whatsapp, language, role")
    .eq("id", profileId)
    .maybeSingle();
  if (!profile) return { error: "Usuario no encontrado." };
  if (!profile.whatsapp) {
    return {
      error: "Este usuario no tiene teléfono de WhatsApp configurado.",
    };
  }

  // First name: primera palabra del full_name si existe; sino algo razonable
  // (la parte local del email, o el propio teléfono como último recurso).
  const firstName =
    profile.full_name?.trim().split(/\s+/)[0] ??
    profile.email?.split("@")[0] ??
    profile.whatsapp;

  const preferredLanguage: "es" | "en" =
    profile.language === "en" ? "en" : "es";

  // Fetch property names from scope. Admin = null = todas las properties.
  const allowedIds = await getAllowedPropertyIds({
    id: profile.id,
    role: profile.role as "admin" | "gestor" | "mantenimiento",
  });
  let propertyNames: string[] = [];
  if (allowedIds === null) {
    // admin → todas
    const { data } = await admin
      .from("properties")
      .select("name")
      .order("name", { ascending: true });
    propertyNames = (data ?? []).map((r) => r.name as string);
  } else if (allowedIds.length > 0) {
    const { data } = await admin
      .from("properties")
      .select("name")
      .in("id", allowedIds)
      .order("name", { ascending: true });
    propertyNames = (data ?? []).map((r) => r.name as string);
  }
  // Si está vacío después del fetch, `formatPropertyList` cae al fallback
  // genérico ("tus propiedades" / "your properties").
  const propertyList = formatPropertyList(propertyNames, preferredLanguage);

  // Intentar v2 (personalizado con propiedades). Si falla por CUALQUIER
  // motivo, caer a v1 (`staff_welcome`, APPROVED) — el template
  // conocido-bueno. Solo devolvemos error si v1 TAMBIÉN falla.
  //
  // WIK-239: antes el fallback solo disparaba si el error de v2 matcheaba
  // un regex angosto de "template not found". Pero v2 está PENDING en Meta
  // (esperando aprobación) y Meta devuelve un error distinto ("not
  // approved" / 132016) que NO matcheaba → el action devolvía error y NO
  // mandaba nada (la bienvenida no llegaba). Ahora el fallback es
  // incondicional: probamos lo lindo (v2), y ante cualquier problema
  // usamos v1. Self-healing: cuando Meta apruebe v2, el primer try gana
  // solo, sin más cambios.
  try {
    const r = await sendKapsoTemplateWithFallback({
      phoneNumberId,
      to: profile.whatsapp,
      templateName: "staff_welcome_v3",
      preferredLanguage,
      bodyVariables: [firstName, propertyList],
    });
    return {
      ok: true,
      templateUsed: "staff_welcome_v3",
      messageId: r.messageId ?? null,
      fellBack: r.fellBack,
    };
  } catch (e) {
    const msg = (e as Error).message;
    console.warn(
      `[sendStaffWelcome] staff_welcome_v3 falló (${msg.slice(
        0,
        150,
      )}). Fallback a v1 (staff_welcome).`,
    );
    try {
      const r = await sendKapsoTemplateWithFallback({
        phoneNumberId,
        to: profile.whatsapp,
        templateName: "staff_welcome",
        preferredLanguage,
        bodyVariables: [firstName],
      });
      return {
        ok: true,
        templateUsed: "staff_welcome",
        messageId: r.messageId ?? null,
        fellBack: r.fellBack,
      };
    } catch (e2) {
      return { error: (e2 as Error).message };
    }
  }
}
