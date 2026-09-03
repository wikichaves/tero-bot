"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { getActiveCountry } from "@/lib/country";
import { createAdminClient } from "@/lib/supabase/admin";

const text = (fd: FormData, name: string) => String(fd.get(name) ?? "").trim() || null;
export async function createLead(formData: FormData) {
  await requireRole(["admin", "gestor"]);
  const firstName = text(formData, "first_name");
  if (!firstName) throw new Error("Falta el nombre.");
  const guests = text(formData, "guest_count");
  const { error } = await createAdminClient().from("leads").insert({
    country: await getActiveCountry(), property_id: text(formData, "property_id"),
    first_name: firstName, last_name: text(formData, "last_name"), phone: text(formData, "phone"),
    email: text(formData, "email"), check_in: text(formData, "check_in"), check_out: text(formData, "check_out"),
    guest_count: guests ? Number(guests) : null, follow_up_at: text(formData, "follow_up_at"),
    notes: text(formData, "notes"), status: "new",
  });
  if (error) throw new Error("No se pudo guardar el lead.");
  revalidatePath("/leads");
}
