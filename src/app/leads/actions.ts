"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { getActiveCountry } from "@/lib/country";
import { createAdminClient } from "@/lib/supabase/admin";

const text = (fd: FormData, name: string) => String(fd.get(name) ?? "").trim() || null;

function leadValues(formData: FormData) {
  const firstName = text(formData, "first_name");
  if (!firstName) throw new Error("Falta el nombre.");
  const guests = text(formData, "guest_count");
  return {
    property_id: text(formData, "property_id"),
    first_name: firstName,
    last_name: text(formData, "last_name"),
    phone: text(formData, "phone"),
    email: text(formData, "email"),
    check_in: text(formData, "check_in"),
    check_out: text(formData, "check_out"),
    guest_count: guests ? Number(guests) : null,
    follow_up_at: text(formData, "follow_up_at"),
    notes: text(formData, "notes"),
    status: text(formData, "status") ?? "new",
  };
}

async function countryForLead(formData: FormData) {
  const activeCountry = await getActiveCountry();
  const propertyId = text(formData, "property_id");
  if (propertyId) {
    const { data } = await createAdminClient().from("properties").select("country").eq("id", propertyId).maybeSingle();
    if (data?.country === "AR" || data?.country === "UY") return data.country;
  }
  if (activeCountry === "AR" || activeCountry === "UY") return activeCountry;
  throw new Error("Elegí una propiedad para poder asignar el país del contacto.");
}

export async function createLead(formData: FormData) {
  await requireRole(["admin", "gestor"]);
  const { error } = await createAdminClient().from("leads").insert({
    country: await countryForLead(formData),
    ...leadValues(formData),
  });
  if (error) throw new Error("No se pudo guardar el lead.");
  revalidatePath("/leads");
}

export async function updateLead(id: string, formData: FormData) {
  await requireRole(["admin", "gestor"]);
  const { error } = await createAdminClient()
    .from("leads")
    .update({ ...leadValues(formData), country: await countryForLead(formData) }).eq("id", id);
  if (error) throw new Error("No se pudo actualizar el lead.");
  revalidatePath("/leads");
}

export async function deleteLead(id: string) {
  await requireRole(["admin", "gestor"]);
  const { error } = await createAdminClient()
    .from("leads")
    .delete().eq("id", id);
  if (error) throw new Error("No se pudo eliminar el lead.");
  revalidatePath("/leads");
}
