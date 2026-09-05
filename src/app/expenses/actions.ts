"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { getActiveCountry } from "@/lib/country";
import { createAdminClient } from "@/lib/supabase/admin";

const optional = (value: FormDataEntryValue | null) => {
  const text = String(value ?? "").trim();
  return text || null;
};

function expenseValues(formData: FormData) {
  const amount = optional(formData.get("amount"));
  const parsed = z.coerce.number().nonnegative().safeParse(amount);
  if (amount && !parsed.success) throw new Error("El importe no es válido.");
  return {
    property_id: optional(formData.get("property_id")),
    expense_date: optional(formData.get("expense_date")) ?? new Date().toISOString().slice(0, 10),
    vendor: optional(formData.get("vendor")),
    amount: amount ? parsed.data : null,
    currency: (optional(formData.get("currency")) ?? "UYU").toUpperCase(),
    category: optional(formData.get("category")) ?? "otro",
    payment_method: optional(formData.get("payment_method")),
    description: optional(formData.get("description")),
    receipt_url: optional(formData.get("receipt_url")),
  };
}

async function countryForExpense(formData: FormData) {
  const activeCountry = await getActiveCountry();
  const propertyId = optional(formData.get("property_id"));
  if (propertyId) {
    const { data } = await createAdminClient().from("properties").select("country").eq("id", propertyId).maybeSingle();
    if (data?.country === "AR" || data?.country === "UY") return data.country;
  }
  if (activeCountry === "AR" || activeCountry === "UY") return activeCountry;
  throw new Error("Elegí una propiedad para poder asignar el país del gasto.");
}

export async function createExpense(formData: FormData) {
  const profile = await requireRole(["admin", "gestor"]);
  const { error } = await createAdminClient().from("expenses").insert({
    country: await countryForExpense(formData),
    ...expenseValues(formData),
    source: "manual", recorded_by: profile.id, review_status: "pending_review",
  });
  if (error) throw new Error("No se pudo guardar el gasto.");
  revalidatePath("/expenses");
}

export async function updateExpense(id: string, formData: FormData) {
  await requireRole(["admin", "gestor"]);
  const { error } = await createAdminClient().from("expenses").update({ ...expenseValues(formData), country: await countryForExpense(formData) }).eq("id", id);
  if (error) throw new Error("No se pudo actualizar el gasto.");
  revalidatePath("/expenses");
}

export async function deleteExpense(id: string) {
  await requireRole(["admin", "gestor"]);
  const { error } = await createAdminClient().from("expenses").delete().eq("id", id);
  if (error) throw new Error("No se pudo eliminar el gasto.");
  revalidatePath("/expenses");
}
