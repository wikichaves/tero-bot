import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Profile } from "@/lib/types";

import { parseExpense } from "./parse";
export { looksLikeCreateExpenseCommand } from "./parse";
export type { ExpenseCategory } from "./parse";

function uyToday(): string { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Montevideo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }

export async function createExpenseFromWhatsApp(input: { profile: Profile; text: string | null; mediaUrl: string | null; sourceMessageId: string | null }): Promise<{ ok: true; reply: string; id: string } | { ok: false; reply: string }> {
  if (input.profile.role !== "admin" && input.profile.role !== "gestor") return { ok: false, reply: "No tenés permiso para cargar gastos." };
  const parsed = parseExpense(input.text);
  const isComplete = !!parsed.vendor && parsed.amount !== null;
  const { data, error } = await createAdminClient().from("expenses").insert({ expense_date: uyToday(), vendor: parsed.vendor, amount: parsed.amount, currency: parsed.currency, category: parsed.category, description: parsed.description, receipt_url: input.mediaUrl, source: "whatsapp", source_message_id: input.sourceMessageId, recorded_by: input.profile.id, review_status: isComplete ? "pending_review" : "draft" }).select("id").single();
  if (error || !data) throw new Error("create expense failed: " + (error?.message ?? "no data"));
  if (!isComplete) return { ok: true, id: data.id, reply: input.mediaUrl ? "Ticket guardado como gasto. Quedó como borrador para completar o revisar en tero.bot/expenses." : "Gasto guardado como borrador. Mandame el ticket o los datos del importe para dejarlo listo para revisar." };
  return { ok: true, id: data.id, reply: "Gasto registrado: *" + parsed.vendor + "* · " + parsed.currency + " " + (parsed.amount as number).toLocaleString("es-UY", { minimumFractionDigits: 2 }) + " · " + parsed.category + ". Quedó pendiente de revisión." };
}
