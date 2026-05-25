"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireProfile } from "@/lib/auth";
import { normalizePhone } from "@/lib/whatsapp";

/**
 * Permite a cualquier user editar SU PROPIO perfil (WIK-112).
 * Diferente de `updateProfile` en `/admin/users/actions.ts` que requiere
 * rol admin para editar el perfil de otros.
 *
 * Solo deja modificar `full_name` y `whatsapp` — campos cosméticos.
 * El email y el role son admin-only.
 */
const schema = z.object({
  full_name: z.string().min(1, "Falta el nombre.").max(100),
  whatsapp: z
    .string()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  // WIK-155: idioma preferido del usuario. Default `en` a nivel DB,
  // así que opcional acá — si no viene, no se toca.
  language: z.enum(["en", "es"]).optional(),
});

export async function updateOwnProfile(input: {
  full_name: string;
  whatsapp: string;
  language?: string;
}) {
  const profile = await requireProfile();
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({
      full_name: parsed.data.full_name,
      whatsapp: normalizePhone(parsed.data.whatsapp ?? ""),
      ...(parsed.data.language ? { language: parsed.data.language } : {}),
    })
    .eq("id", profile.id);
  if (error) return { error: error.message };
  // Revalidar paths donde el nombre aparece (header en todas las pages,
  // listados, etc).
  revalidatePath("/", "layout");
  return { ok: true };
}
