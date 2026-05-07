"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { generateCodeForReservation } from "@/lib/tuya/auto-code";

export async function generateAccessCode(reservationId: string) {
  const profile = await requireRole(["admin", "gestor"]);
  const result = await generateCodeForReservation(reservationId, {
    byUserId: profile.id,
  });
  if (result.ok) {
    revalidatePath(`/dashboard/reservations/${reservationId}`);
    revalidatePath("/dashboard");
    return {
      ok: true,
      code: result.code,
      already_existed: result.already_existed,
      effective_at: result.effective_at,
      invalid_at: result.invalid_at,
    };
  }
  return { error: result.reason };
}
