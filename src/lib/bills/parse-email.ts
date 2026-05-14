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

export type ProviderRule = {
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
    provider: "Personal Flow",
    utility_type: "internet",
    currency: "ARS",
    // Personal Flow es el provider AR (rebrand de Cablevisión Flow tras la
    // fusión con Telecom). Los emails de facturación suelen venir de
    // personal.com.ar / flow.com.ar / telecom.com.ar (corporativo).
    domains: [
      "personal.com.ar",
      "flow.com.ar",
      "telecom.com.ar",
      "cablevisionflow.com.ar",
      "cablevision.com.ar",
    ],
    fromNameKeywords: ["personal flow", "flow"],
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

/**
 * pdf-parse occasionally loses inter-token whitespace, producing strings
 * like "FechadeVencimiento:14/01/2026" or "TOTALA PAGAR$ 164.356,36".
 * That breaks our landmark regex (which uses `\b` word boundaries —
 * those don't fire between two adjacent word chars).
 *
 * We restore probable boundaries by inserting a space at three transitions
 * that almost always indicate a token boundary in Spanish utility bills:
 *
 *   1. lowercase → uppercase   "FechadeVencimiento" → "Fechade Vencimiento"
 *   2. letter → digit          "Cuenta2"            → "Cuenta 2"
 *   3. digit → letter          "14/01/2026Cuenta"   → "14/01/2026 Cuenta"
 *
 * Unit abbreviations like `kWh` would be incorrectly split by rule (1),
 * so we re-glue them at the end. We deliberately don't try to split
 * lowercase-only stuck words ("Fechade" → "Fecha de") — that needs a
 * dictionary; the existing regex catalog tolerates it because every
 * landmark we care about has a leading capital.
 */
function normalizePdfWhitespace(s: string): string {
  return s
    .replace(/([a-záéíóúñü])([A-ZÁÉÍÓÚÑÜ])/g, "$1 $2")
    .replace(/([a-záéíóúñüA-ZÁÉÍÓÚÑÜ])(\d)/g, "$1 $2")
    .replace(/(\d)([a-záéíóúñüA-ZÁÉÍÓÚÑÜ])/g, "$1 $2")
    // Re-glue split unit abbreviations.
    .replace(/\bk\s+Wh\b/g, "kWh")
    .replace(/\bk\s+VA\b/g, "kVA");
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

function symbolToCurrency(
  symbol: string | null,
  fallback: string,
): string {
  if (!symbol) return fallback;
  const s = symbol.toUpperCase();
  if (s === "U$S" || s === "US$") return "USD";
  if (s === "$U") return "UYU";
  if (s === "ARS" || s === "UYU" || s === "USD") return s;
  return fallback;
}

function extractAmountAndCurrency(
  body: string,
  fallbackCurrency: string,
): { amount: number | null; currency: string | null } {
  // Strategy: anchor on a *strong* "amount label" landmark (one of the
  // phrases listed below), then read up to 80 chars of trailing text and
  // pull the first amount. The trailing chunk lets us tolerate:
  //   - colon + spaces           "Total a pagar: $ 1.234,56"
  //   - nothing at all (glued)   "Total a pagar2,813.75"   (Prosegur PDF)
  //   - newline before number    "Fecha de vencimiento\n20/2/2026" pattern
  //   - currency embedded as     "Moneda UYU\n…Total a pagar 2.813,75"
  //   - asterisks                "$***7.770,00"           (OSE PDF)
  //   - uppercase                "TOTAL2.800,00"          (Antel PDF)
  const strongLandmarks = [
    // `\s*` (zero-or-more) instead of `\s+` so we also catch the stuck
    // form "Totala pagar" / "TOTALA PAGAR" that survives normalization
    // when both letters are uppercase (TOTAL+A) or share lowercase.
    /total\s*a\s*pagar/i,
    /importe\s*a\s*pagar/i,
    /saldo\s*a\s*pagar/i,
    /monto\s*a\s*pagar/i,
    /importe\s+total/i,
    /total\s+factura(?:do)?/i,
    /\bimporte\b(?!\s+(?:no\s+gravado|gravado|imponible))/i, // "Importe: $7.819" UTE
    /\btotal\b(?!\s+(?:iva|gravado|no\s+gravado|imponible|monto))/i, // bare "TOTAL 2.800"
  ];
  const trailRx =
    /[\s:]*(?:moneda\s+(UYU|ARS|USD)\s*)?(\$U|U\$S|US\$|ARS|UYU|\$)?\s*\*{0,5}\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/i;

  for (const landmark of strongLandmarks) {
    const m = landmark.exec(body);
    if (!m) continue;
    const tail = body.slice(
      m.index + m[0].length,
      m.index + m[0].length + 80,
    );
    const num = trailRx.exec(tail);
    if (num) {
      const amount = parseAmount(num[3]);
      if (amount == null) continue;
      // Currency priority: explicit "Moneda XXX" > symbol > nearby "$U/$" > fallback.
      let currency = symbolToCurrency(num[2] ?? null, fallbackCurrency);
      if (num[1]) currency = num[1].toUpperCase();
      // Also scan a wider window around the landmark for "Moneda XXX".
      const window = body.slice(
        Math.max(0, m.index - 120),
        m.index + m[0].length + 120,
      );
      const moneda = /moneda\s+(UYU|ARS|USD)\b/i.exec(window);
      if (moneda) currency = moneda[1].toUpperCase();
      return { amount, currency };
    }
  }

  // Last-resort: bare "$ 1.234,56" / "UYU 1.234" anywhere.
  const bare =
    /(\$U|U\$S|US\$|ARS|UYU|\$)\s*\*{0,5}\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/i.exec(
      body,
    );
  if (bare) {
    return {
      amount: parseAmount(bare[2]),
      currency: symbolToCurrency(bare[1], fallbackCurrency),
    };
  }
  return { amount: null, currency: null };
}

function extractDueDate(body: string): string | null {
  // Cases we want to catch:
  //   "Vencimiento: 06/05/2026"            (UTE body)
  //   "Fecha de Vencimiento25/05/2026"     (Prosegur PDF — no space)
  //   "Fecha de vencimiento\n20/2/2026"    (Antel PDF — newline)
  //   "VENCE: 19/05/2026"                  (OSE PDF — no "el")
  //   "vence el 05/05/2026"                (Personal Flow subject)
  //   "Vto. 15/05/2026" / "Vto: 15/05/2026"
  //   "vence el 5 de mayo de 2026"         (written date)
  //
  // We use `[\s\S]{0,30}?` (non-greedy, includes newlines) between the
  // landmark and the date so glued / newline-separated values both work.
  const candidates = [
    // "VTO PROXIMA FACTURA" or other VTO variants we explicitly DON'T want
    // to catch (they're for the next bill, not this one) — order matters:
    // we test specific positive patterns first.

    // Edenor uses an inverted construction: "el 27/04/2026 vence tu factura"
    // — date comes BEFORE the verb. Match before any of the forward-order
    // patterns so we don't accidentally pick up a different date downstream.
    /\bel\s+(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})\s+vence\b/i,

    // Standard forward-order patterns.
    /\bvencimiento\b(?!\s+pr[oó]xim)[\s\S]{0,30}?(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i,
    /\bvence\b(?:\s+el)?\s*[:\s]*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i,
    /\bvto\.?\b(?!\s+pr[oó]xim)\s*:?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i,
    /\bvencimiento\b(?!\s+pr[oó]xim)[\s\S]{0,30}?(\d{1,2}\s+(?:de\s+)?[a-záé]+(?:\s+(?:de\s+)?\d{2,4})?)/i,
    /\bvence\b(?:\s+el)?\s*[:\s]*(\d{1,2}\s+(?:de\s+)?[a-záé]+(?:\s+(?:de\s+)?\d{2,4})?)/i,
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
  // Variantes vistas:
  //   "Cuenta n° 4131911000"           (UTE)
  //   "Cuenta nº 25006163000108"       (Antel subject)
  //   "NUMERO DE CUENTA 25006163000108"(Antel PDF body)
  //   "NRO CLIENTE: 3317403"           (Prosegur)
  //   "Ref. Cobro: 329232040"          (OSE)
  //   "Cuenta 2 259 142 078"           (Edenor PDF — con espacios!)
  //   "Cuenta cliente: 1234567"
  // Los patrones capturan dígitos separados por espacios opcionales; el
  // caller hace `.replace(/\s/g, "")` para normalizar.
  const haystack = `${subject}\n${body}`;
  const candidates = [
    // "Numero de cuenta 25006163000108" / "Número de cuenta: …"
    /n[uú]mero\s+de\s+cuenta\s*[:#°º.\-]*\s*((?:\d[ \t]*){5,18})/i,
    // "Cuenta nº 4131911000" / "Cuenta n° X" / "Cuenta contrato 12345"
    // / "Cuenta 2 259 142 078" (Edenor — dígitos con espacios)
    /\bcuenta\s+(?:contrato|cliente|n[uú]mero)?\s*[:#°ºn.\-]*\s*((?:\d[ \t]*){5,18})/i,
    // "Nº de cuenta: 12345" / "N° de cuenta 12345"
    /n[ºo°.]?\s*de\s+cuenta\s*:?\s*((?:\d[ \t]*){5,18})/i,
    // "NRO CLIENTE: 3317403" / "Nro Cliente 12345" / "N° de cliente 12345"
    /(?:nro\.?|n[ºo°.]?)\s*(?:de\s+)?cliente\s*:?\s*((?:\d[ \t]*){5,18})/i,
    // "Ref. Cobro: 329232040" / "Referencia de cobro …"
    /ref\.?\s*(?:de\s+)?cobro\s*:?\s*((?:\d[ \t]*){5,18})/i,
  ];
  for (const rx of candidates) {
    const m = rx.exec(haystack);
    if (m) {
      const normalized = m[1].replace(/\s+/g, "");
      if (normalized.length >= 5) return normalized;
    }
  }
  return null;
}

function extractKwh(body: string): number | null {
  // "550 kWh" / "550kWh" — number before unit
  const a = /(\d+(?:[.,]\d+)?)\s*kwh\b/i.exec(body);
  if (a) return parseAmount(a[1]);
  // "CONSUMO KWH 550" / "Consumo kWh\n550" — label first, number after
  const b = /consumo\s+kwh[:\s\n]*(\d+(?:[.,]\d+)?)/i.exec(body);
  if (b) return parseAmount(b[1]);
  return null;
}

/**
 * Try to pull a period_to date from the body. Common landmarks:
 *   "Hasta el 26/05/2026"                (Edenor)
 *   "Período hasta: 05/05/2026"
 *   "Fecha de cierre: 05/05/2026"
 *   "07/04/2026-05/05/2026"              (OSE — range with hyphen)
 *
 * We deliberately don't try period_from here because most providers don't
 * surface it cleanly; for now period_from stays manual.
 */
function extractPeriodTo(body: string): string | null {
  const candidates = [
    // "Período de consumo: 11/12/2025 al 13/01/2026"  (Edenor)
    // "11/12/2025 AL 13/01/2026"                        (range with "al"/"AL")
    /\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\s+al\s+(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i,
    // "07/04/2026 - 05/05/2026" — range with hyphen
    /\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\s*[-–]\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/,
    // "Período hasta" / "Periodo hasta"
    /per[ií]odo\s+hasta\s*:?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i,
    // "Fecha de cierre 05/05/2026"
    /fecha\s+de\s+cierre\s*:?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i,
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

/** Try to pull period_from from a date-range pattern. */
function extractPeriodFrom(body: string): string | null {
  const candidates = [
    // "11/12/2025 al 13/01/2026" — left side of "al" range
    /(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})\s+al\s+\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}/i,
    // "07/04/2026 - 05/05/2026" — left side of hyphen range
    /(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})\s*[-–]\s*\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}/,
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

function extractM3(body: string): number | null {
  // "34 m3" / "34 m³" — number before unit
  const a = /(\d+(?:[.,]\d+)?)\s*m[³3]\b/i.exec(body);
  if (a) return parseAmount(a[1]);
  // "CONSUMO M3 34" / "CONSUMO M3\n34" (OSE)
  const b = /consumo\s+m[³3][:\s\n]*(\d+(?:[.,]\d+)?)/i.exec(body);
  if (b) return parseAmount(b[1]);
  return null;
}

/**
 * Detect the bill's provider from sender + body + subject. Exposed so the
 * inbound handler can run detection once for an email containing multiple
 * PDFs (we want all of them to share the same provider, derived from the
 * email envelope, instead of re-detecting per-PDF text).
 */
export function detectBillProvider(
  fromEmail: string | null,
  fromName: string | null,
  subject: string,
  body: string,
): ProviderRule | null {
  return detectProvider(fromEmail, fromName, subject, body);
}

/**
 * Extract amount / due-date / account / etc. from a body string assuming
 * the provider is already known. Used both by `parseBillEmail` (single-bill
 * flow) and by the multi-PDF flow in the inbound handler, which calls this
 * once per PDF so each PDF becomes its own utility_bills row.
 */
export function extractBillFields(
  rule: ProviderRule,
  body: string,
  subject: string,
): ParsedBillEmail {
  // Normalize stuck pdf-parse output before running landmark regex. The
  // operation is idempotent on already-spaced text (email bodies pass
  // through unchanged).
  const normalizedBody = normalizePdfWhitespace(body);
  const normalizedSubject = normalizePdfWhitespace(subject);

  const { amount, currency } = extractAmountAndCurrency(
    normalizedBody,
    rule.currency,
  );
  const due_date = extractDueDate(normalizedBody);
  const invoice_number = extractInvoiceNumber(normalizedBody);
  const account_number = extractAccountNumber(normalizedBody, normalizedSubject);
  const period_to = extractPeriodTo(normalizedBody);
  const period_from = extractPeriodFrom(normalizedBody);
  const kwh_billed = rule.utility_type === "luz" ? extractKwh(normalizedBody) : null;
  const m3_billed = rule.utility_type === "agua" ? extractM3(normalizedBody) : null;

  const everythingGood = amount != null && currency != null;
  return {
    kind: everythingGood ? "matched" : "partial",
    provider: rule.provider,
    utility_type: rule.utility_type,
    amount,
    currency: currency ?? rule.currency,
    period_from,
    period_to,
    issue_date: null,
    due_date,
    kwh_billed,
    m3_billed,
    account_number,
    invoice_number,
    property_id: null,
  };
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
  return extractBillFields(rule, body, subject);
}

/**
 * Build the same "body blob" that parseBillEmail uses internally, from raw
 * email fields. Useful when the caller needs the haystack to feed to
 * `detectBillProvider` directly (e.g. multi-PDF flow).
 */
export function buildBillBody(
  text: string,
  html: string | null | undefined,
  pdfText: string | null | undefined,
  subject: string,
): string {
  return [text, stripHtml(html), pdfText ?? "", subject]
    .filter((s) => s && s.length > 0)
    .join("\n");
}
