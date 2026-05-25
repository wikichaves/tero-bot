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
  guest_adults: z
    .string()
    .optional()
    .or(z.literal(""))
    .transform((v) => {
      if (!v) return null;
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? n : null;
    }),
  guest_children: z
    .string()
    .optional()
    .or(z.literal(""))
    .transform((v) => {
      if (!v) return null;
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? n : null;
    }),
  guest_infants: z
    .string()
    .optional()
    .or(z.literal(""))
    .transform((v) => {
      if (!v) return null;
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? n : null;
    }),
  check_in_time: z
    .string()
    .regex(
      /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/,
      "Horario inválido (HH:MM 24h).",
    )
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v.padStart(5, "0") : null)),
  check_out_time: z
    .string()
    .regex(
      /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/,
      "Horario inválido (HH:MM 24h).",
    )
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v.padStart(5, "0") : null)),
  // WIK-124: alarma WhatsApp X horas antes del check-in. Vacío/0 = sin
  // alarma. Cap a 168h (1 semana) para evitar typos del admin.
  alarm_hours_before: z
    .string()
    .optional()
    .or(z.literal(""))
    .transform((v): number | null => {
      if (!v) return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0 || n > 168) return null;
      return Math.round(n);
    }),
  // WIK-155: idioma del huésped (en | es). Default `en` a nivel DB.
  // Opcional acá — si no viene, no se toca.
  guest_language: z
    .string()
    .optional()
    .or(z.literal(""))
    .transform((v) =>
      v === "en" || v === "es" ? (v as "en" | "es") : undefined,
    ),
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
  guest_adults?: string;
  guest_children?: string;
  guest_infants?: string;
  check_in_time?: string;
  check_out_time?: string;
  alarm_hours_before?: string;
  guest_language?: string;
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
      guest_adults: parsed.data.guest_adults,
      guest_children: parsed.data.guest_children,
      guest_infants: parsed.data.guest_infants,
      check_in_time: parsed.data.check_in_time,
      check_out_time: parsed.data.check_out_time,
      alarm_hours_before: parsed.data.alarm_hours_before,
      ...(parsed.data.guest_language
        ? { guest_language: parsed.data.guest_language }
        : {}),
    })
    .eq("id", parsed.data.id);
  if (error) return { error: error.message };
  // WIK-124: invalidar el tracking row para que el cron re-evalúe si
  // cambiaron check_in_time o alarm_hours_before. Eliminar la row de
  // alarm_notifications_sent permite re-disparar con los nuevos params.
  await admin
    .from("alarm_notifications_sent")
    .delete()
    .eq("reservation_id", parsed.data.id);
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/reservations/${parsed.data.id}`);
  return { ok: true };
}
