"use server";

import { requireRole } from "@/lib/auth";
import { triggerScene } from "@/lib/tuya/scenes";

/**
 * Ejecutar un Tap-to-Run scene de Tuya (WIK-103). Sólo admin —
 * los scenes pueden disparar acciones físicas reales (encender luces,
 * abrir cerraduras, prender estufas) y no queremos que gestor lo
 * triggeree sin querer.
 */
export async function runScene(sceneId: string) {
  await requireRole(["admin"]);
  if (!sceneId || typeof sceneId !== "string") {
    return { error: "ID de scene inválido." };
  }
  try {
    await triggerScene(sceneId);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
