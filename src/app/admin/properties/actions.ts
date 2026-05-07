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
  if (parsed.data.id) {
    const { error } = await supabase
      .from("properties")
      .update(payload)
      .eq("id", parsed.data.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("properties").insert(payload);
    if (error) return { error: error.message };
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
