export type ExpenseCategory = "combustible" | "ferreteria" | "materiales" | "herramientas" | "transporte" | "comidas" | "servicios" | "honorarios" | "otro";
type ParsedExpense = { vendor: string | null; amount: number | null; currency: string; category: ExpenseCategory; description: string | null };

export function looksLikeCreateExpenseCommand(text: string | null | undefined): boolean {
  return !!text && /\b(gasto|expense|ticket|recibo|comprobante)\b/i.test(text.trim());
}
function categoryFor(text: string): ExpenseCategory {
  if (/\b(ancap|nafta|combustible|gasoil|diesel)\b/i.test(text)) return "combustible";
  if (/\b(ferreter[ií]a|barraca|tornillo|pintura)\b/i.test(text)) return "ferreteria";
  if (/\b(material(es)?|madera|cemento|hierro)\b/i.test(text)) return "materiales";
  if (/\b(flete|peaje|uber|taxi|transporte)\b/i.test(text)) return "transporte";
  if (/\b(honorario|arquitect|contador|saber|bare[nñ]o|felipe)\b/i.test(text)) return "honorarios";
  return "otro";
}
export function parseExpense(text: string | null): ParsedExpense {
  const body = (text ?? "").replace(/^(gasto|expense)\b[:\s]*/i, "").trim();
  const amountMatch = body.match(/(?:USD\s*|US\$\s*|UYU\s*|\$\s*)([0-9]+(?:[.,][0-9]+)*)/i);
  const raw = amountMatch?.[1] ?? null;
  // Last separator is decimal only when followed by one or two digits.
  const normalized = raw?.replace(/[.,](?=\d{3}(?:[.,]|$))/g, "").replace(",", ".");
  const amount = normalized ? Number(normalized) : null;
  const vendor = body.replace(amountMatch?.[0] ?? "", "").replace(/\b(usd|uyu|us\$)\b/ig, "").replace(/[|,;]+/g, " ").trim().slice(0, 120) || null;
  return { vendor, amount: Number.isFinite(amount) ? amount : null, currency: /(?:\busd\b|\bus\$)/i.test(body) ? "USD" : "UYU", category: categoryFor(body), description: body || null };
}
