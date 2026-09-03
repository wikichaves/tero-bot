import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Profile } from "@/lib/types";

export type ExpenseCategory = "combustible" | "ferreteria" | "materiales" | "herramientas" | "transporte" | "comidas" | "servicios" | "honorarios" | "otro";
type ParsedExpense = { vendor: string | null; amount: number | null; currency: string; category: ExpenseCategory; description: string | null };

export function looksLikeCreateExpenseCommand(text: string | null | undefined): boolean {
  return !!text && /^(gasto|expense)\b/i.test(text.trim());
}
function categoryFor(text: string): ExpenseCategory {
  if (/\b(ancap|nafta|combustible|gasoil|diesel)\b/i.test(text)) return "combustible";
  if (/\b(ferreter[ií]a|barraca|tornillo|pintura)\b/i.test(text)) return "ferreteria";
  if (/\b(material(es)?|madera|cemento|hierro)\b/i.test(text)) return "materiales";
  if (/\b(flete|peaje|uber|taxi|transporte)\b/i.test(text)) return "transporte";
  if (/\b(honorario|arquitect|contador|saber|bare[nñ]o|felipe)\b/i.test(text)) return "honorarios";
  return "otro";
}
function parseExpense(text: string | null): ParsedExpense {
  const body = (text ?? "").replace(/^(gasto|expense)\b[:\s]*/i, "").trim();
  const amountMatch = body.match(/(?:USD\s*|US\$\s*|UYU\s*|\$\s*)([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{1,2})?|[0-9]+(?:[.,][0-9]{1,2})?)/i);
  const raw = amountMatch?.[1] ?? null;
  const amount = raw ? Number(raw.replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".")) : null;
  const vendor = body.replace(amountMatch?.[0] ?? "", "").replace(/\b(usd|uyu|us\$)\b/ig, "").replace(/[|,;]+/g, " ").trim().slice(0, 120) || null;
  return { vendor, amount: Number.isFinite(amount) ? amount : null, currency: /\b(usd|us\$)\b/i.test(body) ? "USD" : "UYU", category: categoryFor(body), description: body || null };
}
function uyToday(): string { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Montevideo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }

export async function createExpenseFromWhatsApp(input: { profile: Profile; text: string | null; mediaUrl: string | null; sourceMessageId: string | null }): Promise<{ ok: true; reply: string; id: string } | { ok: false; reply: string }> {
  if (input.profile.role !== "admin" && input.profile.role !== "gestor") return { ok: false, reply: "No tenés permiso para cargar gastos." };
  const parsed = parseExpense(input.text);
  const isComplete = !!parsed.vendor && parsed.amount !== null;
  const { data, error } = await createAdminClient().from("expenses").insert({ expense_date: uyToday(), vendor: parsed.vendor, amount: parsed.amount, currency: parsed.currency, category: parsed.category, description: parsed.description, receipt_url: input.mediaUrl, source: "whatsapp", source_message_id: input.sourceMessageId, recorded_by: input.profile.id, review_status: isComplete ? "pending_review" : "draft" }).select("id").single();
  if (error || !data) throw new Error("create expense failed: " + (error?.message ?? "no data"));
  if (!isComplete) return { ok: true, id: data.id, reply: "Comprobante guardado como borrador. Mandame gasto Proveedor $ 1.234,56 para dejarlo listo para revisar." };
  return { ok: true, id: data.id, reply: "Gasto registrado: *" + parsed.vendor + "* · " + parsed.currency + " " + (parsed.amount as number).toLocaleString("es-UY", { minimumFractionDigits: 2 }) + " · " + parsed.category + ". Quedó pendiente de revisión." };
}
