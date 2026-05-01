"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth";

const ROLES = ["admin", "gestor", "limpieza", "mantenimiento"] as const;

const createSchema = z.object({
  email: z.string().email("Email inválido."),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres."),
  full_name: z.string().min(1, "Falta el nombre.").max(100),
  role: z.enum(ROLES),
  whatsapp: z
    .string()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
});

export async function createUser(formData: FormData) {
  await requireRole(["admin"]);

  const parsed = createSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    full_name: formData.get("full_name"),
    role: formData.get("role"),
    whatsapp: formData.get("whatsapp"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const { email, password, full_name, role, whatsapp } = parsed.data;
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name, role, whatsapp },
  });
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
