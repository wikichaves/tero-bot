"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import {
  addOfflineTempPassword,
  clearAllOfflineTempPasswords,
  deleteOfflineTempPassword,
} from "@/lib/tuya/lock";

const generateSchema = z.object({
  device_id: z.string().min(1),
  name: z.string().min(1, "Falta el nombre.").max(50),
  effective_at: z.string().datetime({ offset: true }).or(z.string()),
  invalid_at: z.string().datetime({ offset: true }).or(z.string()),
});

function toUnixSeconds(value: string): number | null {
  const t = new Date(value).getTime();
  if (!Number.isFinite(t) || t <= 0) return null;
  return Math.floor(t / 1000);
}

export async function generateLockPassword(input: {
  device_id: string;
  name: string;
  effective_at: string;
  invalid_at: string;
}) {
  await requireRole(["admin", "gestor"]);
  const parsed = generateSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const rawEffective = toUnixSeconds(parsed.data.effective_at);
  const rawInvalid = toUnixSeconds(parsed.data.invalid_at);
  if (!rawEffective || !rawInvalid) {
    return { error: "Fechas inválidas." };
  }

  // Tuya requires offline temp password times to be aligned to hour
  // boundaries (minute=0, second=0). It also rejects effective_time values
  // that are in the past — "invalid offline time".
  // We round effective UP to the NEXT hour (always future), and invalid UP
  // to the next hour after that as a minimum.
  const HOUR = 3600;
  const nowSec = Math.floor(Date.now() / 1000);
  const nextHour = (Math.floor(nowSec / HOUR) + 1) * HOUR;

  const effective = Math.max(
    Math.ceil(rawEffective / HOUR) * HOUR,
    nextHour,
  );
  const invalid = Math.max(
    Math.ceil(rawInvalid / HOUR) * HOUR,
    effective + HOUR,
  );
  if (invalid <= effective) {
    return {
      error:
        "La duración mínima es 1 hora (Tuya solo acepta horarios redondeados a la hora completa).",
    };
  }

  try {
    const created = await addOfflineTempPassword(parsed.data.device_id, {
      name: parsed.data.name,
      effective_time: effective,
      invalid_time: invalid,
    });
    revalidatePath("/admin/tuya/lock");
    return { ok: true, created };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function revokeLockPassword(input: {
  device_id: string;
  password_id: string;
}) {
  await requireRole(["admin", "gestor"]);
  if (!input.device_id || !input.password_id) {
    return { error: "Faltan datos para revocar." };
  }
  try {
    await deleteOfflineTempPassword(input.device_id, input.password_id);
    revalidatePath("/admin/tuya/lock");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function clearAllPasswords(input: { device_id: string }) {
  await requireRole(["admin"]);
  if (!input.device_id) return { error: "Falta el ID del dispositivo." };
  try {
    await clearAllOfflineTempPasswords(input.device_id);
    revalidatePath("/admin/tuya/lock");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
