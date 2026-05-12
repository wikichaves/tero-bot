"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth";
import { normalizePhone } from "@/lib/whatsapp";

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
  guest_count: z
    .string()
    .optional()
    .or(z.literal(""))
    .transform((v) => {
      if (!v) return null;
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : null;
    }),
  payout_amount: z
    .string()
    .optional()
    .or(z.literal(""))
    .transform((v) => {
      if (!v) return null;
      const n = Number(v.replace(",", "."));
      return Number.isFinite(n) && n >= 0 ? n : null;
    }),
  payout_currency: z
    .string()
    .max(3)
    .optional()
    .or(z.literal(""))
    .transform((v) =>
      v && /^[A-Z]{3}$/i.test(v) ? v.toUpperCase() : null,
    ),
  guest_message: z
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
  guest_count?: string;
  payout_amount?: string;
  payout_currency?: string;
  guest_message?: string;
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
      guest_phone: normalizePhone(parsed.data.guest_phone),
      notes: parsed.data.notes,
      guest_count: parsed.data.guest_count,
      payout_amount: parsed.data.payout_amount,
      payout_currency: parsed.data.payout_currency,
      guest_message: parsed.data.guest_message,
    })
    .eq("id", parsed.data.id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/reservations/${parsed.data.id}`);
  return { ok: true };
}
