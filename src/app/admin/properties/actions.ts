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
const MAX_THUMBNAIL_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Lazily create the public Supabase Storage bucket where property
 * thumbnails live. Idempotent — does nothing if it already exists.
 */
async function ensureThumbnailBucket(
  admin: ReturnType<typeof createAdminClient>,
): Promise<void> {
  const config = {
    public: true,
    fileSizeLimit: MAX_THUMBNAIL_BYTES,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  };
  const { data: buckets, error } = await admin.storage.listBuckets();
  if (error) throw new Error(`Storage listBuckets failed: ${error.message}`);
  if (buckets?.some((b) => b.name === THUMBNAIL_BUCKET)) {
    // Bucket already exists — make sure its limits match current config
    // (an earlier deploy may have created it with a smaller fileSizeLimit).
    await admin.storage.updateBucket(THUMBNAIL_BUCKET, config);
    return;
  }
  const { error: createErr } = await admin.storage.createBucket(
    THUMBNAIL_BUCKET,
    config,
  );
  if (createErr && !/already exists/i.test(createErr.message)) {
    throw new Error(`Storage createBucket failed: ${createErr.message}`);
  }
}

/**
 * Issue a one-shot signed upload URL for a property's thumbnail. The
 * client uploads directly to Supabase Storage (PUT with the file as body),
 * bypassing Vercel's request body limit (~4.5 MB on Hobby).
 *
 * We do all auth + validation here, then hand back a short-lived URL +
 * token that the browser uses to do the actual file transfer.
 */
export async function getThumbnailUploadTicket(propertyId: string) {
  await requireRole(["admin"]);
  if (!propertyId || !/^[0-9a-f-]{36}$/i.test(propertyId)) {
    return { error: "ID de propiedad inválido." };
  }
  const admin = createAdminClient();
  await ensureThumbnailBucket(admin);
  const { data, error } = await admin.storage
    .from(THUMBNAIL_BUCKET)
    .createSignedUploadUrl(propertyId, { upsert: true });
  if (error || !data) {
    return { error: `No se pudo emitir URL de subida: ${error?.message}` };
  }
  return {
    ok: true as const,
    path: data.path,
    token: data.token,
    signedUrl: data.signedUrl,
    bucket: THUMBNAIL_BUCKET,
  };
}

/**
 * Server-side bookkeeping after a successful direct upload — invalidate the
 * pages that show the thumbnail. Optional but keeps caches fresh.
 */
export async function notifyPropertyThumbnailUploaded() {
  await requireRole(["admin"]);
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
