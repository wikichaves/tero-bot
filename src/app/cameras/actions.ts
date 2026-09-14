"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { getAllowedPropertyIds } from "@/lib/auth/scope";
import { createAdminClient } from "@/lib/supabase/admin";

const value = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim() || null;

async function allowedProperty(propertyId: string) {
  const profile = await requireRole(["admin", "gestor"]);
  const allowed = await getAllowedPropertyIds(profile);
  if (allowed !== null && !allowed.includes(propertyId)) throw new Error("No tenés acceso a esta propiedad.");
}

export async function saveCamera(formData: FormData) {
  const propertyId = value(formData, "property_id");
  const name = value(formData, "name");
  if (!propertyId || !name) throw new Error("Faltan la propiedad o el nombre.");
  await allowedProperty(propertyId);
  const payload = {
    property_id: propertyId,
    name,
    location: value(formData, "location"),
    provider: value(formData, "provider") ?? "Cloud Plus",
    access_url: value(formData, "access_url"),
    stream_url: value(formData, "stream_url"),
    snapshot_url: value(formData, "snapshot_url"),
    notes: value(formData, "notes"),
    is_active: formData.get("is_active") === "on",
  };
  const id = value(formData, "id");
  const db = createAdminClient();
  if (id) {
    const { data: camera, error } = await db.from("property_cameras").select("property_id").eq("id", id).single();
    if (error || !camera) throw new Error("No se pudo guardar la cámara.");
    await allowedProperty(camera.property_id);
  }
  const result = id
    ? await db.from("property_cameras").update(payload).eq("id", id).select("id").single()
    : await db.from("property_cameras").insert(payload).select("id").single();
  if (result.error) throw new Error("No se pudo guardar la cámara.");
  revalidatePath("/cameras");
}

export async function deleteCamera(formData: FormData) {
  const id = value(formData, "id");
  const propertyId = value(formData, "property_id");
  if (!id || !propertyId) throw new Error("Cámara inválida.");
  await allowedProperty(propertyId);
  const { error } = await createAdminClient().from("property_cameras").delete().eq("id", id).eq("property_id", propertyId);
  if (error) throw new Error("No se pudo eliminar la cámara.");
  revalidatePath("/cameras");
}

const captureRequestSchema = z.object({
  cameraId: z.string().uuid(),
});

export async function requestCameraCapture(input: unknown) {
  const parsed = captureRequestSchema.safeParse(input);
  if (!parsed.success) return { error: "Cámara inválida." };

  const db = createAdminClient();
  const { data: camera, error: cameraError } = await db
    .from("property_cameras")
    .select("property_id")
    .eq("id", parsed.data.cameraId)
    .single();
  if (cameraError || !camera) return { error: "No se encontró la cámara." };

  await allowedProperty(camera.property_id);
  const { error } = await db
    .from("property_cameras")
    .update({ capture_requested_at: new Date().toISOString() })
    .eq("id", parsed.data.cameraId);
  if (error) return { error: "No se pudo pedir la captura." };

  revalidatePath("/cameras");
  return { ok: true };
}
