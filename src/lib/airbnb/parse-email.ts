import "server-only";
import type { ParsedAirbnbEmail } from "@/lib/types";

/**
 * Parse an Airbnb host email (confirmation / modification / cancellation)
 * into a structured payload. Pure regex, no LLM — Airbnb's text bodies have
 * stable landmark phrases per locale.
 *
 * Returns `{ kind: "unknown" }` when we can't recognize the email or the
 * mandatory `reservation_code` is missing.
 *
 * Supported locales: `es`, `en`. To add more, extend the LANDMARKS map.
 */

type Locale = "es" | "en";

type Landmarks = {
  cancellationSubject: RegExp;
  modificationSubject: RegExp;
  confirmationSubject: RegExp;
  /** Pull guest first name. */
  guestName: RegExp[];
  /** "3 guests" / "3 huéspedes". Captures the integer. */
  guestCount: RegExp[];
  /** "Total payout $X" / "Pago total $X". Captures amount + currency. */
  payout: RegExp[];
  /** Guest message — usually after a "Message from <name>:" line. */
  message: RegExp[];
  /** Check-in / check-out dates if present in body. */
  checkIn: RegExp[];
  checkOut: RegExp[];
  /** Listing name — varies wildly, only used as a hint for property match. */
  listing: RegExp[];
};

const LANDMARKS: Record<Locale, Landmarks> = {
  es: {
    cancellationSubject: /reserva\s+cancelada|cancelaci[oó]n\s+de\s+reserva/i,
    modificationSubject:
      /reserva\s+modificada|cambio\s+en\s+la\s+reserva|nueva\s+fecha/i,
    confirmationSubject:
      /reserva\s+confirmada|nueva\s+reserva|reserva\s+(de|para)\s+/i,
    guestName: [
      /Hu[eé]sped:\s*([A-ZÁ-Úa-zá-ú][\w'’\-]+)/,
      /Reserva\s+de\s+([A-ZÁ-Úa-zá-ú][\w'’\-]+)/,
      /([A-ZÁ-Úa-zá-ú][\w'’\-]+)\s+(?:reserv[oó]|hizo\s+una\s+reserva)/,
    ],
    guestCount: [
      /(\d+)\s+hu[eé]sped(?:es)?/i,
      /(\d+)\s+adult/i, // "1 adulto, 2 niños" — fallback (use just adults)
    ],
    payout: [
      // "Pago total: $1.234,56 ARS" / "Total a recibir: USD 1.000"
      /(?:pago\s+total|total\s+a\s+recibir|ganar[aá]s)[^\n$0-9]*([A-Z]{3}|\$|US\$)\s*([\d.,]+)/i,
      /([A-Z]{3})\s*\$?\s*([\d.,]+)\s*(?:de\s+pago|de\s+ganancia)/i,
    ],
    message: [
      // "Mensaje de Juan: hola..." (capture rest of paragraph)
      /Mensaje\s+(?:de\s+\S+)?:?\s*\n?([\s\S]{1,500}?)(?:\n\s*\n|$)/i,
    ],
    checkIn: [
      /(?:Llegada|Check-?in|Entrada)[\s:]+([A-Za-zÁ-ú]{3,9}\.?,?\s+\d{1,2}\s+(?:de\s+)?[A-Za-zá-ú]{3,9})/i,
      /(?:Llegada|Check-?in|Entrada)[\s:]+(\d{4}-\d{2}-\d{2})/i,
    ],
    checkOut: [
      /(?:Salida|Check-?out)[\s:]+([A-Za-zÁ-ú]{3,9}\.?,?\s+\d{1,2}\s+(?:de\s+)?[A-Za-zá-ú]{3,9})/i,
      /(?:Salida|Check-?out)[\s:]+(\d{4}-\d{2}-\d{2})/i,
    ],
    listing: [
      /(?:Anuncio|Alojamiento|Propiedad):\s*([^\n]{3,120})/i,
    ],
  },
  en: {
    cancellationSubject: /reservation\s+canceled|booking\s+canceled/i,
    modificationSubject:
      /reservation\s+(changed|modified)|booking\s+(changed|modified)|date\s+change/i,
    confirmationSubject:
      /reservation\s+confirmed|new\s+reservation|booking\s+confirmed|new\s+booking/i,
    guestName: [
      /Guest:\s*([A-Z][\w'’\-]+)/,
      /Reservation\s+(?:by|from)\s+([A-Z][\w'’\-]+)/,
      /([A-Z][\w'’\-]+)\s+(?:booked|made\s+a\s+reservation)/,
    ],
    guestCount: [/(\d+)\s+guests?/i, /(\d+)\s+adults?/i],
    payout: [
      /(?:total\s+payout|you'?ll\s+earn|payout)[^\n$0-9]*([A-Z]{3}|\$|US\$)\s*([\d.,]+)/i,
      /([A-Z]{3})\s*\$?\s*([\d.,]+)\s*payout/i,
    ],
    message: [
      /Message\s+(?:from\s+\S+)?:?\s*\n?([\s\S]{1,500}?)(?:\n\s*\n|$)/i,
    ],
    checkIn: [
      /Check-?in[\s:]+([A-Za-z]{3,9}\.?,?\s+\d{1,2})/i,
      /Check-?in[\s:]+(\d{4}-\d{2}-\d{2})/i,
    ],
    checkOut: [
      /Check-?out[\s:]+([A-Za-z]{3,9}\.?,?\s+\d{1,2})/i,
      /Check-?out[\s:]+(\d{4}-\d{2}-\d{2})/i,
    ],
    listing: [/Listing:\s*([^\n]{3,120})/i],
  },
};

/**
 * The HM code regex stays deliberately loose — Airbnb has used `HM*`, `HMS*`,
 * `HMP*` over the years and may add new prefixes. We validate length and
 * that the first char is H, but don't lock to exact prefix.
 */
const HM_CODE_RX = /\bH[A-Z0-9]{6,12}\b/;

const CURRENCY_SYMBOL_MAP: Record<string, string> = {
  $: "USD", // best guess; Airbnb usually qualifies with "US$" or " USD"
  "US$": "USD",
  USD: "USD",
  ARS: "ARS",
  UYU: "UYU",
  BRL: "BRL",
  EUR: "EUR",
  "€": "EUR",
};

function detectLocale(subject: string, body: string): Locale {
  const combined = `${subject}\n${body}`;
  // Hints unique to ES.
  if (/huésped|reserva|llegada|salida|pago\s+total/i.test(combined)) return "es";
  return "en";
}

function detectKind(
  subject: string,
  body: string,
  l: Landmarks,
): "confirmation" | "cancellation" | "modification" | null {
  const combined = `${subject}\n${body}`;
  if (l.cancellationSubject.test(subject) || l.cancellationSubject.test(body)) {
    return "cancellation";
  }
  if (l.modificationSubject.test(subject) || l.modificationSubject.test(body)) {
    return "modification";
  }
  if (
    l.confirmationSubject.test(subject) ||
    l.confirmationSubject.test(body) ||
    HM_CODE_RX.test(combined) // fallback: HM present = treat as confirmation
  ) {
    return "confirmation";
  }
  return null;
}

function firstMatch(rxs: RegExp[], text: string): string | null {
  for (const rx of rxs) {
    const m = text.match(rx);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

function parseNumber(s: string): number | null {
  // Handle "1.234,56" (es-UY) and "1,234.56" (en). Pick the format by which
  // separator appears last.
  const trimmed = s.replace(/\s/g, "");
  const lastDot = trimmed.lastIndexOf(".");
  const lastComma = trimmed.lastIndexOf(",");
  let normalized = trimmed;
  if (lastComma > lastDot) {
    // Comma is decimal separator.
    normalized = trimmed.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma) {
    normalized = trimmed.replace(/,/g, "");
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function extractPayout(rxs: RegExp[], text: string): {
  amount: number | null;
  currency: string | null;
} {
  for (const rx of rxs) {
    const m = text.match(rx);
    if (!m) continue;
    const currencyRaw = (m[1] ?? "").toUpperCase();
    const amount = parseNumber(m[2] ?? "");
    const currency = CURRENCY_SYMBOL_MAP[currencyRaw] ?? null;
    if (amount != null) return { amount, currency };
  }
  return { amount: null, currency: null };
}

/**
 * Returns true if the parser found enough to call it a real Airbnb email.
 * Used so we can ack 200 (no retry) but mark it as `unknown` in the DB.
 */
export function parseAirbnbEmail(input: {
  subject: string;
  text: string;
  html?: string | null;
}): ParsedAirbnbEmail {
  const subject = input.subject ?? "";
  // Prefer plain text; fall back to a stripped HTML if no text was provided.
  const body = input.text || stripHtml(input.html ?? "");
  if (!subject && !body) {
    return { kind: "unknown", reason: "empty subject and body" };
  }

  const locale = detectLocale(subject, body);
  const l = LANDMARKS[locale];
  const kind = detectKind(subject, body, l);
  if (!kind) {
    return { kind: "unknown", reason: "no airbnb landmark found" };
  }

  const codeMatch = body.match(HM_CODE_RX) ?? subject.match(HM_CODE_RX);
  if (!codeMatch) {
    return { kind: "unknown", reason: "no reservation code (HM…)" };
  }
  const reservation_code = codeMatch[0];
  const listing_name = firstMatch(l.listing, body);

  if (kind === "cancellation") {
    return { kind, reservation_code, listing_name, locale };
  }

  const guest_first_name = firstMatch(l.guestName, body);
  const countRaw = firstMatch(l.guestCount, body);
  const guest_count = countRaw ? Number(countRaw) : null;
  const { amount: payout_amount, currency: payout_currency } = extractPayout(
    l.payout,
    body,
  );
  const guest_message = firstMatch(l.message, body);

  return {
    kind,
    reservation_code,
    guest_first_name,
    guest_count:
      guest_count != null && Number.isFinite(guest_count) && guest_count > 0
        ? guest_count
        : null,
    payout_amount,
    payout_currency,
    guest_message,
    check_in: firstMatch(l.checkIn, body),
    check_out: firstMatch(l.checkOut, body),
    listing_name,
    locale,
  };
}

/**
 * Very crude HTML → text. Postmark gives us TextBody usually; this is a
 * safety net for senders that only ship HTML.
 */
function stripHtml(html: string): string {
  if (!html) return "";
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
