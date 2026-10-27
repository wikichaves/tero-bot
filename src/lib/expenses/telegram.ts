import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseExpense } from "./parse";

export async function createExpenseFromTelegram(input: {
  profile: { id: string; role: string };
  text: string;
  sourceMessageId: string;
  receipt: { bytes: Buffer; mime: string } | null;
}): Promise<{ id: string; duplicate: boolean; draft: boolean }> {
  if (!["admin", "gestor"].includes(input.profile.role)) throw new Error("Unauthorized expense sender");
  const db = createAdminClient();
  const existing = await db.from("expenses").select("id, review_status")
    .eq("source_message_id", input.sourceMessageId).maybeSingle();
  if (existing.error) throw new Error("Expense lookup failed");
  if (existing.data) return { id: existing.data.id, duplicate: true, draft: existing.data.review_status === "draft" };
  const parsed = parseExpense(input.text);
  const draft = !parsed.vendor || parsed.amount === null;
  const path = `${input.profile.id}/${input.sourceMessageId.replaceAll(":", "-")}`;
  if (input.receipt) {
    const upload = await db.storage.from("expense-receipts").upload(path, input.receipt.bytes, {
      contentType: input.receipt.mime, upsert: true,
    });
    // Retries use the same immutable message and deterministic object key.
    if (upload.error) throw new Error("Receipt upload failed");
  }
  const { data, error } = await db.from("expenses").insert({
    expense_date: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Montevideo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()),
    ...parsed, source: "telegram", source_message_id: input.sourceMessageId,
    recorded_by: input.profile.id, review_status: draft ? "draft" : "pending_review",
    receipt_url: input.receipt ? `/api/expenses/receipt?path=${encodeURIComponent(path)}` : null,
  }).select("id").single();
  if (error?.code === "23505") {
    const retry = await db.from("expenses").select("id, review_status").eq("source_message_id", input.sourceMessageId).single();
    if (retry.error || !retry.data) throw new Error("Expense duplicate lookup failed");
    return { id: retry.data.id, duplicate: true, draft: retry.data.review_status === "draft" };
  }
  if (error || !data) throw new Error("Expense insert failed");
  return { id: data.id, duplicate: false, draft };
}
