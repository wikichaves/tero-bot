"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth";

const utilityType = z.enum(["luz", "agua", "internet", "alarma", "otro"]);
const billStatus = z.enum(["pending", "paid", "overdue", "cancelled"]);

/** Coerce an empty string ("" from FormData) to null; pass real values through. */
const emptyToNull = (v: unknown) =>
  v === "" || v == null ? null : v;

const numberFromString = z
  .preprocess(emptyToNull, z.string().nullable())
  .transform((v) => {
    if (v == null) return null;
    const n = Number(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : null;
  });

const dateFromString = z
  .preprocess(emptyToNull, z.string().nullable())
  .transform((v) => {
    if (v == null) return null;
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  });

const textFromString = (max: number) =>
  z
    .preprocess(emptyToNull, z.string().nullable())
    .transform((v) => (v ? v.slice(0, max) : null));

const billSchema = z.object({
  property_id: z.string().uuid("Elegí una propiedad."),
  utility_type: utilityType,
  provider: z
    .string()
    .min(1, "Falta el proveedor.")
    .max(40)
    .transform((v) => v.trim()),
  amount: numberFromString,
  currency: z
    .preprocess(emptyToNull, z.string().nullable())
    .transform((v) =>
      v && /^[A-Z]{3}$/i.test(v) ? v.toUpperCase() : null,
    ),
  period_from: dateFromString,
  period_to: dateFromString,
  issue_date: dateFromString,
  due_date: dateFromString,
  paid_at: dateFromString,
  status: billStatus.default("pending"),
  kwh_billed: numberFromString,
  m3_billed: numberFromString,
  account_number: textFromString(60),
  invoice_number: textFromString(60),
  notes: textFromString(2000),
});

type BillInput = z.input<typeof billSchema>;

export async function createBill(input: BillInput) {
  await requireRole(["admin", "gestor"]);
  const parsed = billSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const admin = createAdminClient();
  const { error, data } = await admin
    .from("utility_bills")
    .insert(parsed.data)
    .select("id")
    .single();
  if (error) return { error: error.message };
  revalidatePath("/bills");
  return { ok: true, id: data?.id };
}

export async function updateBill(id: string, input: BillInput) {
  await requireRole(["admin", "gestor"]);
  if (!z.string().uuid().safeParse(id).success) {
    return { error: "id inválido." };
  }
  const parsed = billSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const admin = createAdminClient();
  const { error } = await admin
    .from("utility_bills")
    .update(parsed.data)
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/bills");
  return { ok: true };
}

export async function deleteBill(id: string) {
  await requireRole(["admin", "gestor"]);
  if (!z.string().uuid().safeParse(id).success) {
    return { error: "id inválido." };
  }
  const admin = createAdminClient();
  const { error } = await admin.from("utility_bills").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/bills");
  return { ok: true };
}

export async function markBillPaid(id: string) {
  await requireRole(["admin", "gestor"]);
  if (!z.string().uuid().safeParse(id).success) {
    return { error: "id inválido." };
  }
  const today = new Date().toISOString().slice(0, 10);
  const admin = createAdminClient();
  const { error } = await admin
    .from("utility_bills")
    .update({ status: "paid", paid_at: today })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/bills");
  return { ok: true };
}

/**
 * Generate a short-lived signed URL for the PDF attached to a bill so the
 * admin can open it from the UI. We return null (not error) when there's
 * no PDF, so the row just hides the "Ver PDF" button.
 */
export async function getBillPdfUrl(id: string) {
  await requireRole(["admin", "gestor"]);
  if (!z.string().uuid().safeParse(id).success) {
    return { error: "id inválido." };
  }
  const admin = createAdminClient();
  const { data: bill, error } = await admin
    .from("utility_bills")
    .select("pdf_path")
    .eq("id", id)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!bill?.pdf_path) return { url: null };
  const { data, error: signErr } = await admin.storage
    .from("bill-attachments")
    .createSignedUrl(bill.pdf_path, 60 * 10); // 10 minutes
  if (signErr) return { error: signErr.message };
  return { url: data?.signedUrl ?? null };
}
