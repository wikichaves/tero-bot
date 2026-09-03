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

export async function createExpense(formData: FormData) {
  const profile = await requireRole(["admin", "gestor"]);
  const amount = optional(formData.get("amount"));
  const parsed = z.coerce.number().nonnegative().safeParse(amount);
  if (amount && !parsed.success) throw new Error("El importe no es válido.");

  const { error } = await createAdminClient().from("expenses").insert({
    country: await getActiveCountry(), property_id: optional(formData.get("property_id")),
    expense_date: optional(formData.get("expense_date")) ?? new Date().toISOString().slice(0, 10),
    vendor: optional(formData.get("vendor")), amount: amount ? parsed.data : null,
    currency: (optional(formData.get("currency")) ?? "UYU").toUpperCase(),
    category: optional(formData.get("category")) ?? "otro", payment_method: optional(formData.get("payment_method")),
    description: optional(formData.get("description")), receipt_url: optional(formData.get("receipt_url")),
    source: "manual", recorded_by: profile.id, review_status: "pending_review",
  });
  if (error) throw new Error("No se pudo guardar el gasto.");
  revalidatePath("/expenses");
}
