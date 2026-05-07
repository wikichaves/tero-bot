"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import {
  addOfflineTempPassword,
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
  const effective = toUnixSeconds(parsed.data.effective_at);
  const invalid = toUnixSeconds(parsed.data.invalid_at);
  if (!effective || !invalid) {
    return { error: "Fechas inválidas." };
  }
  if (effective >= invalid) {
    return { error: "La fecha 'desde' debe ser anterior a 'hasta'." };
  }
  if (invalid - effective < 60) {
    return { error: "La duración mínima es 1 minuto." };
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
