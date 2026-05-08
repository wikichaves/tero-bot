"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth";
import { syncAirbnb, type SyncResult } from "@/lib/airbnb";

const upsertSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1, "Falta el nombre.").max(100),
  airbnb_ical_url: z
    .string()
    .url("URL inválida.")
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  booking_ical_url: z
    .string()
    .url("URL inválida.")
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, "Moneda inválida (usá ISO 4217: UYU, ARS, USD, ...)")
    .default("UYU"),
  tariff_per_kwh: z
    .number()
    .positive("La tarifa debe ser positiva.")
    .nullable()
    .optional(),
});

export async function upsertProperty(input: {
  id?: string;
  name: string;
  airbnb_ical_url: string;
  booking_ical_url: string;
  currency: string;
  tariff_per_kwh: number | null;
}) {
  await requireRole(["admin"]);
  const parsed = upsertSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const supabase = await createClient();
  const payload = {
    name: parsed.data.name,
    airbnb_ical_url: parsed.data.airbnb_ical_url,
    booking_ical_url: parsed.data.booking_ical_url,
    currency: parsed.data.currency,
    tariff_per_kwh: parsed.data.tariff_per_kwh ?? null,
  };
  let id: string | null = null;
  if (parsed.data.id) {
    const { error } = await supabase
      .from("properties")
      .update(payload)
      .eq("id", parsed.data.id);
    if (error) return { error: error.message };
    id = parsed.data.id;
  } else {
    const { data, error } = await supabase
      .from("properties")
      .insert(payload)
      .select("id")
      .single();
    if (error) return { error: error.message };
    id = data?.id ?? null;
  }
  revalidatePath("/admin/properties");
  revalidatePath("/dashboard");
  return { ok: true, id };
}

const THUMBNAIL_BUCKET = "property-thumbnails";
const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Lazily create the public Supabase Storage bucket where property
 * thumbnails live. Idempotent — does nothing if it already exists.
 */
async function ensureThumbnailBucket(
  admin: ReturnType<typeof createAdminClient>,
): Promise<void> {
  const { data: buckets, error } = await admin.storage.listBuckets();
  if (error) throw new Error(`Storage listBuckets failed: ${error.message}`);
  if (buckets?.some((b) => b.name === THUMBNAIL_BUCKET)) return;
  const { error: createErr } = await admin.storage.createBucket(
    THUMBNAIL_BUCKET,
    {
      public: true,
      fileSizeLimit: MAX_THUMBNAIL_BYTES,
      allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    },
  );
  if (createErr) {
    // Race: another concurrent call created it first — ignore.
    if (!/already exists/i.test(createErr.message)) {
      throw new Error(`Storage createBucket failed: ${createErr.message}`);
    }
  }
}

/**
 * Upload (or replace) a property thumbnail. The file is stored in the
 * public bucket under the property's id (no extension — content type lives
 * in object metadata). The public URL is therefore predictable and can be
 * rendered without a DB migration.
 */
export async function uploadPropertyThumbnail(formData: FormData) {
  await requireRole(["admin"]);
  const propertyId = String(formData.get("property_id") ?? "");
  const file = formData.get("file");
  if (!propertyId || !/^[0-9a-f-]{36}$/i.test(propertyId)) {
    return { error: "ID de propiedad inválido." };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { error: "No se recibió ningún archivo." };
  }
  if (file.size > MAX_THUMBNAIL_BYTES) {
    return { error: "La imagen supera los 5 MB." };
  }
  if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) {
    return { error: "Formato no soportado. Usá JPG, PNG o WebP." };
  }

  const admin = createAdminClient();
  await ensureThumbnailBucket(admin);
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error } = await admin.storage
    .from(THUMBNAIL_BUCKET)
    .upload(propertyId, buffer, {
      upsert: true,
      contentType: file.type,
      cacheControl: "300", // 5 min cache; we bust by adding ?v=<ts> on save
    });
  if (error) {
    return { error: `Subida falló: ${error.message}` };
  }
  revalidatePath("/admin/properties");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function deletePropertyThumbnail(propertyId: string) {
  await requireRole(["admin"]);
  const admin = createAdminClient();
  const { error } = await admin.storage
    .from(THUMBNAIL_BUCKET)
    .remove([propertyId]);
  if (error && !/not.*found/i.test(error.message)) {
    return { error: error.message };
  }
  revalidatePath("/admin/properties");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function deleteProperty(id: string) {
  await requireRole(["admin"]);
  const supabase = await createClient();
  const { error } = await supabase.from("properties").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/properties");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function syncProperty(id: string): Promise<
  | { ok: true; result: SyncResult }
  | { error: string }
> {
  await requireRole(["admin", "gestor"]);
  const admin = createAdminClient();
  const { data: property, error } = await admin
    .from("properties")
    .select("id, airbnb_ical_url")
    .eq("id", id)
    .single();
  if (error || !property) {
    return { error: error?.message ?? "Propiedad no encontrada." };
  }
  if (!property.airbnb_ical_url) {
    return { error: "Esta propiedad no tiene URL de iCal de Airbnb." };
  }
  try {
    const result = await syncAirbnb(property.id, property.airbnb_ical_url);
    revalidatePath("/admin/properties");
    revalidatePath("/dashboard");
    return { ok: true, result };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
