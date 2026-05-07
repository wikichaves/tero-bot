"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth";

const updateReservationSchema = z.object({
  id: z.string().uuid(),
  guest_name: z
    .string()
    .max(200)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  guest_phone: z
    .string()
    .max(40)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  notes: z
    .string()
    .max(2000)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
});

export async function updateReservation(input: {
  id: string;
  guest_name: string;
  guest_phone: string;
  notes: string;
}) {
  await requireRole(["admin", "gestor"]);
  const parsed = updateReservationSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const admin = createAdminClient();
  const { error } = await admin
    .from("reservations")
    .update({
      guest_name: parsed.data.guest_name,
      guest_phone: parsed.data.guest_phone,
      notes: parsed.data.notes,
    })
    .eq("id", parsed.data.id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/reservations/${parsed.data.id}`);
  return { ok: true };
}
