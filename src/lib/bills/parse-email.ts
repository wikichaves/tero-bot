import "server-only";
import type { ParsedBillEmail, BillProvider, UtilityType } from "@/lib/types";

/**
 * Best-effort parser for utility-bill emails forwarded via Postmark Inbound.
 *
 * We don't aim to extract everything — most providers attach the bill as a
 * PDF and the email body is mostly marketing. The MVP strategy is:
 *
 *   1. Identify the provider by sender domain (high confidence) → that
 *      gives us `provider`, `utility_type`, and a default `currency`.
 *   2. Try a handful of generic regex extractors against subject + body
 *      for amount, due date, invoice number, kWh/m³ — whatever the
 *      provider happens to expose in plain text.
 *   3. Whatever is left blank, the admin completes manually in /facturas.
 *
 * PDF parsing is deliberately out of scope here (Phase 2). The webhook
 * stores the PDF in Storage so the admin can open it from /facturas, and
 * once we sit down with real samples we'll add per-provider PDF extractors.
 */

type ProviderRule = {
  provider: BillProvider;
  utility_type: UtilityType;
  /** Default currency for bills from this provider. Properties.currency wins
   *  if we match a property by some other signal, but this is the fallback. */
  currency: string;
  /** Sender domains (substring match, lowercased). The first hit wins. */
  domains: string[];
  /** Optional From-name keywords as a secondary signal (some companies send
   *  from a generic provider like "no-reply@notificaciones.example.com"). */
  fromNameKeywords?: string[];
};

const PROVIDER_RULES: ProviderRule[] = [
  {
    provider: "UTE",
    utility_type: "luz",
    currency: "UYU",
    domains: ["ute.com.uy", "miute.com.uy"],
    fromNameKeywords: ["ute"],
  },
  {
    provider: "OSE",
    utility_type: "agua",
    currency: "UYU",
    domains: ["ose.com.uy", "oseusuarios.com.uy"],
    fromNameKeywords: ["ose"],
  },
  {
    provider: "Antel",
    utility_type: "internet",
    currency: "UYU",
    domains: ["antel.com.uy", "antelfactura.com.uy"],
    fromNameKeywords: ["antel"],
  },
  {
    provider: "Prosegur",
    utility_type: "alarma",
    currency: "UYU",
    domains: ["prosegur.com", "prosegur.com.uy"],
    fromNameKeywords: ["prosegur"],
  },
  {
    provider: "Edenor",
    utility_type: "luz",
    currency: "ARS",
    domains: ["edenor.com", "edenor.com.ar"],
    fromNameKeywords: ["edenor"],
  },
  {
    provider: "AySA",
    utility_type: "agua",
    currency: "ARS",
    domains: ["aysa.com.ar"],
    fromNameKeywords: ["aysa"],
  },
  {
    provider: "Telecentro",
    utility_type: "internet",
    currency: "ARS",
    domains: ["telecentro.com.ar", "telecentro.net.ar"],
    fromNameKeywords: ["telecentro"],
  },
];

function detectProvider(
  fromEmail: string | null,
  fromName: string | null,
  subject: string,
  body: string,
): ProviderRule | null {
  // Include the body in the haystack so we can still identify the provider
  // when the user forwards manually from Gmail — in that case the outer
  // `From` is the user's own address and the real sender (e.g.
  // `UTEFACTURACION@ute.com.uy`) is only visible inside the quoted
  // "---------- Forwarded message ----------" block.
  const haystack =
    `${fromEmail ?? ""} ${fromName ?? ""} ${subject}\n${body}`.toLowerCase();
  for (const rule of PROVIDER_RULES) {
    if (rule.domains.some((d) => haystack.includes(d))) return rule;
  }
  for (const rule of PROVIDER_RULES) {
    if (
      rule.fromNameKeywords?.some((kw) => haystack.includes(kw.toLowerCase()))
    ) {
      return rule;
    }
  }
  return null;
}

/** Strip basic HTML tags + decode the handful of entities we actually
 *  care about. Identical to the trick in src/lib/airbnb/parse-email.ts —
 *  we just need a regex-friendly text blob. */
function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalize a number string from the email body. Real-world formats:
 *   "1.234,56"  (es-UY / es-AR full)        → 1234.56
 *   "1,234.56"  (en-US-style some providers)→ 1234.56
 *   "7.819"     (es thousand separator)     → 7819
 *   "12,50"     (es decimal)                → 12.50
 *   "12.50"     (en decimal)                → 12.50
 *
 * The trap is `"7.819"` — naively "last separator wins as decimal" gives
 * 7.819, but utility bills in UYU don't have 3-decimal amounts. So when
 * there's exactly ONE separator we use a digits-after rule: 3 digits after
 * = thousands separator; 1–2 digits = decimal.
 */
function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.,]/g, "");
  if (!cleaned) return null;
  const lastDot = cleaned.lastIndexOf(".");
  const lastComma = cleaned.lastIndexOf(",");
  let normalized: string;
  if (lastDot === -1 && lastComma === -1) {
    normalized = cleaned;
  } else if (lastDot >= 0 && lastComma >= 0) {
    // Both separators present — the rightmost one is the decimal.
    if (lastComma > lastDot) {
      normalized = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = cleaned.replace(/,/g, "");
    }
  } else {
    // Only one kind of separator. Could be either thousands or decimal.
    const sepIdx = lastDot >= 0 ? lastDot : lastComma;
    const digitsAfter = cleaned.length - sepIdx - 1;
    if (digitsAfter === 3) {
      // Thousands separator — strip it ("7.819" → 7819).
      normalized = cleaned.replace(/[.,]/g, "");
    } else {
      // Decimal separator — normalize to dot ("12,50" → "12.50").
      normalized = cleaned.replace(",", ".");
    }
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

const ES_MONTHS: Record<string, number> = {
  ene: 1, enero: 1,
  feb: 2, febrero: 2,
  mar: 3, marzo: 3,
  abr: 4, abril: 4,
  may: 5, mayo: 5,
  jun: 6, junio: 6,
  jul: 7, julio: 7,
  ago: 8, agosto: 8,
  sep: 9, sept: 9, septiembre: 9, setiembre: 9, set: 9,
  oct: 10, octubre: 10,
  nov: 11, noviembre: 11,
  dic: 12, diciembre: 12,
};

/** Parse "12/05/2026" or "12-05-2026" or "12 de mayo de 2026" → ISO date.
 *  Returns null if we can't make sense of it. */
function parseDate(raw: string): string | null {
  const slash = raw.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (slash) {
    const d = Number(slash[1]);
    const m = Number(slash[2]);
    let y = Number(slash[3]);
    if (y < 100) y += 2000;
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  const written = raw.match(
    /(\d{1,2})\s+(?:de\s+)?([a-záé]+)\.?(?:\s+(?:de\s+)?(\d{2,4}))?/i,
  );
  if (written) {
    const d = Number(written[1]);
    const monthRaw = written[2].toLowerCase().replace(/\./g, "");
    const m = ES_MONTHS[monthRaw];
    let y = written[3] ? Number(written[3]) : new Date().getUTCFullYear();
    if (y < 100) y += 2000;
    if (m && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  return null;
}

function extractAmountAndCurrency(
  body: string,
  fallbackCurrency: string,
): { amount: number | null; currency: string | null } {
  // Patterns we've seen, most specific first:
  //   "Importe: $ 7.819"                 (UTE forwarded email body)
  //   "Importe a pagar: $ 1.234,56"
  //   "Total a pagar: ARS 1.234,56"
  //   "Total: $U 1.234"
  //   "Monto: $1234"
  const candidates = [
    /(?:importe(?:\s+a\s+pagar|\s+total)?|total(?:\s+a\s+pagar|\s+factura)?|monto(?:\s+a\s+pagar)?|saldo\s+a\s+pagar)\s*:?\s*(\$U|U\$S|US\$|ARS|UYU|\$)\s*([\d.,]+)/i,
    /(\$U|U\$S|US\$|ARS|UYU|\$)\s*([\d.,]+)\s*(?:de\s+)?(?:total|importe)/i,
  ];
  for (const rx of candidates) {
    const m = rx.exec(body);
    if (m) {
      const amount = parseAmount(m[2]);
      const symbol = m[1].toUpperCase();
      let currency = fallbackCurrency;
      if (symbol === "U$S" || symbol === "US$") currency = "USD";
      else if (symbol === "$U") currency = "UYU";
      else if (symbol === "ARS" || symbol === "UYU") currency = symbol;
      return { amount, currency };
    }
  }
  return { amount: null, currency: null };
}

function extractDueDate(body: string): string | null {
  const candidates = [
    /(?:fecha\s+de\s+)?vencimiento[^\n0-9]{0,30}(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i,
    /vence\s+el[^\n0-9]{0,10}(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i,
    /(?:fecha\s+de\s+)?vencimiento[^\n0-9]{0,30}(\d{1,2}\s+(?:de\s+)?[a-záé]+(?:\s+(?:de\s+)?\d{2,4})?)/i,
  ];
  for (const rx of candidates) {
    const m = rx.exec(body);
    if (m) {
      const parsed = parseDate(m[1]);
      if (parsed) return parsed;
    }
  }
  return null;
}

function extractInvoiceNumber(body: string): string | null {
  const candidates = [
    /(?:factura|comprobante|n[uú]mero\s+de\s+factura)\s*(?:n[ºo°.]?|#)?\s*[:\-]?\s*([A-Z0-9\-\.]{5,25})/i,
  ];
  for (const rx of candidates) {
    const m = rx.exec(body);
    if (m && /\d/.test(m[1])) return m[1];
  }
  return null;
}

function extractAccountNumber(body: string, subject: string): string | null {
  // "Cuenta n° 4131911000" (UTE), "Cuenta contrato 12345" (Edenor),
  // "Cuenta cliente: 1234567" (Antel). Also the subject often carries it:
  // "e-Ticket Crédito de la Cuenta 4131911000".
  const haystack = `${subject}\n${body}`;
  const candidates = [
    /cuenta(?:\s+(?:contrato|cliente|n[uú]mero))?\s*[:#°ºn.\-]*\s*(\d{5,15})/i,
    /n[ºo°.]?\s*de\s+cuenta\s*:?\s*(\d{5,15})/i,
  ];
  for (const rx of candidates) {
    const m = rx.exec(haystack);
    if (m) return m[1];
  }
  return null;
}

function extractKwh(body: string): number | null {
  const m = /(\d+(?:[.,]\d+)?)\s*kwh/i.exec(body);
  return m ? parseAmount(m[1]) : null;
}

function extractM3(body: string): number | null {
  const m = /(\d+(?:[.,]\d+)?)\s*m[³3]\b/i.exec(body);
  return m ? parseAmount(m[1]) : null;
}

export function parseBillEmail({
  fromEmail,
  fromName,
  subject,
  text,
  html,
  pdfText,
}: {
  fromEmail: string | null;
  fromName: string | null;
  subject: string;
  text: string;
  html?: string | null;
  /** Concatenated text content of attached PDF(s). Most utilities ship
   *  the actual numbers inside the PDF rather than in the email body —
   *  pass the PDF text in here when available so the same regex landmark
   *  extractors get a richer haystack to work on. */
  pdfText?: string | null;
}): ParsedBillEmail {
  const body = [text, stripHtml(html), pdfText ?? "", subject]
    .filter((s) => s && s.length > 0)
    .join("\n");
  const rule = detectProvider(fromEmail, fromName, subject, body);
  if (!rule) {
    return {
      kind: "unknown",
      reason: `provider not recognized (from="${fromEmail ?? "?"}", subject="${subject.slice(0, 60)}")`,
    };
  }

  const { amount, currency } = extractAmountAndCurrency(body, rule.currency);
  const due_date = extractDueDate(body);
  const invoice_number = extractInvoiceNumber(body);
  const account_number = extractAccountNumber(body, subject);
  const kwh_billed = rule.utility_type === "luz" ? extractKwh(body) : null;
  const m3_billed = rule.utility_type === "agua" ? extractM3(body) : null;

  // We consider the parse "matched" only when we got the amount + currency
  // out of the body. Otherwise it's "partial" — provider known, rest manual.
  const everythingGood = amount != null && currency != null;

  return {
    kind: everythingGood ? "matched" : "partial",
    provider: rule.provider,
    utility_type: rule.utility_type,
    amount,
    currency: currency ?? rule.currency,
    period_from: null,
    period_to: null,
    issue_date: null,
    due_date,
    kwh_billed,
    m3_billed,
    account_number,
    invoice_number,
    property_id: null,
  };
}
