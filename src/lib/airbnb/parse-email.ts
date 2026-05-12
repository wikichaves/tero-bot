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
 *
 * Important: Airbnb's modern transactional emails have an almost-empty
 * `TextBody` (in some flows it's just "Tarifa de limpieza") and put all
 * the structured data in the HTML. We always parse against the combined
 * `text + stripHtml(html)` so the regex have material to bite.
 */

type Locale = "es" | "en";

type Landmarks = {
  cancellationSubject: RegExp;
  modificationSubject: RegExp;
  confirmationSubject: RegExp;
  /** Pull guest first name (from subject or body). */
  guestName: RegExp[];
  /** "3 guests" / "3 huéspedes" / "1 adulto". Captures the integer. */
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
      // Modern Airbnb subject: "Reserva confirmada: Juana Pérez llega el …"
      /Reserva\s+confirmada\s*[:\-]\s*([A-ZÁ-Úa-zá-ú][A-Za-zá-úÁ-Ú'’\-]+(?:\s+[A-ZÁ-Úa-zá-ú][A-Za-zá-úÁ-Ú'’\-]+){0,2})\s+llega/i,
      // Body H1: "¡Nueva reserva confirmada! Juana llega el …"
      /Nueva\s+reserva\s+confirmada[!¡]?\s+([A-ZÁ-Úa-zá-ú][A-Za-zá-úÁ-Ú'’\-]+(?:\s+[A-ZÁ-Úa-zá-ú][A-Za-zá-úÁ-Ú'’\-]+){0,2})\s+llega/i,
      // Older / generic patterns kept as fallback.
      /Hu[eé]sped:\s*([A-ZÁ-Úa-zá-ú][A-Za-zá-úÁ-Ú'’\-]+)/,
      /Reserva\s+de\s+([A-ZÁ-Úa-zá-ú][A-Za-zá-úÁ-Ú'’\-]+)/,
    ],
    guestCount: [
      // "1 adulto" / "2 adultos" — the dominant pattern in 2026 ES emails.
      /(\d+)\s+adultos?\b/i,
      // "3 huéspedes" / "1 huésped" — older / aggregate pattern.
      /(\d+)\s+hu[eé]sped(?:es)?/i,
      // "3 viajeros" — sometimes used.
      /(\d+)\s+viajeros?/i,
    ],
    payout: [
      // "Pago total: $1.234,56 ARS" / "Total a recibir: USD 1.000"
      /(?:pago\s+total|total\s+a\s+recibir|ganar[aá]s)[^\n$0-9]{0,40}([A-Z]{3}|\$|US\$|U\$S|€)\s*([\d.,]+)/i,
      /([A-Z]{3})\s*\$?\s*([\d.,]+)\s*(?:de\s+pago|de\s+ganancia)/i,
      // "Vas a recibir US$ 1.234,56" / "Recibirás US$ 1.234,56"
      /(?:vas\s+a\s+recibir|recibir[aá]s)[^\n$0-9]{0,30}(US\$|U\$S|\$|€|[A-Z]{3})\s*([\d.,]+)/i,
    ],
    message: [
      // "Mensaje de Juan: hola..." (capture up to ~500 chars or paragraph end)
      /Mensaje\s+(?:de\s+\S+)?:?\s*\n?([\s\S]{1,500}?)(?:\n\s*\n|$)/i,
    ],
    checkIn: [
      // "vie, 22 may" — current Airbnb 2026 format
      /Check-?in\s*\n?\s*[a-záé]{3,4}\.?,?\s*(\d{1,2})\s+([a-záé]{3,5})\.?/i,
      // "Llegada: 22 de mayo"
      /(?:Llegada|Check-?in|Entrada)[\s:]+([A-Za-zÁ-ú]{3,9}\.?,?\s+\d{1,2}\s+(?:de\s+)?[A-Za-zá-ú]{3,9})/i,
      /(?:Llegada|Check-?in|Entrada)[\s:]+(\d{4}-\d{2}-\d{2})/i,
    ],
    checkOut: [
      /Check-?out\s*\n?\s*[a-záé]{3,4}\.?,?\s*(\d{1,2})\s+([a-záé]{3,5})\.?/i,
      /(?:Salida|Check-?out)[\s:]+([A-Za-zÁ-ú]{3,9}\.?,?\s+\d{1,2}\s+(?:de\s+)?[A-Za-zá-ú]{3,9})/i,
      /(?:Salida|Check-?out)[\s:]+(\d{4}-\d{2}-\d{2})/i,
    ],
    listing: [
      // Modern: H2 contains the Airbnb listing title (e.g. "Charming Family Stay …")
      // Extracted directly from HTML before stripping (see findListingNameInHtml).
      // These body fallbacks are for older templates.
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
      // Subject: "Reservation confirmed: Juana Pérez arrives May 22"
      /Reservation\s+confirmed\s*[:\-]\s*([A-Z][A-Za-z'’\-]+(?:\s+[A-Z][A-Za-z'’\-]+){0,2})\s+arriv/i,
      // Body H1: "New reservation confirmed! Juana arrives May 22"
      /New\s+reservation\s+confirmed[!]?\s+([A-Z][A-Za-z'’\-]+(?:\s+[A-Z][A-Za-z'’\-]+){0,2})\s+arriv/i,
      /Guest:\s*([A-Z][A-Za-z'’\-]+)/,
      /Reservation\s+(?:by|from)\s+([A-Z][A-Za-z'’\-]+)/,
    ],
    guestCount: [
      /(\d+)\s+adults?\b/i,
      /(\d+)\s+guests?/i,
      /(\d+)\s+travelers?/i,
    ],
    payout: [
      /(?:total\s+payout|you'?ll\s+earn|payout)[^\n$0-9]{0,40}([A-Z]{3}|\$|US\$|€)\s*([\d.,]+)/i,
      /([A-Z]{3})\s*\$?\s*([\d.,]+)\s*payout/i,
      /you'?ll\s+receive[^\n$0-9]{0,30}(US\$|\$|€|[A-Z]{3})\s*([\d.,]+)/i,
    ],
    message: [
      /Message\s+(?:from\s+\S+)?:?\s*\n?([\s\S]{1,500}?)(?:\n\s*\n|$)/i,
    ],
    checkIn: [
      /Check-?in\s*\n?\s*[A-Za-z]{3,4}\.?,?\s*(\d{1,2})\s+([A-Za-z]{3,5})\.?/i,
      /Check-?in[\s:]+([A-Za-z]{3,9}\.?,?\s+\d{1,2})/i,
      /Check-?in[\s:]+(\d{4}-\d{2}-\d{2})/i,
    ],
    checkOut: [
      /Check-?out\s*\n?\s*[A-Za-z]{3,4}\.?,?\s*(\d{1,2})\s+([A-Za-z]{3,5})\.?/i,
      /Check-?out[\s:]+([A-Za-z]{3,9}\.?,?\s+\d{1,2})/i,
      /Check-?out[\s:]+(\d{4}-\d{2}-\d{2})/i,
    ],
    listing: [/Listing:\s*([^\n]{3,120})/i],
  },
};

/**
 * The HM code regex stays deliberately loose — Airbnb has used `HM*`, `HMS*`,
 * `HMP*` and embeds the code in URLs like
 * `/hosting/reservations/details/HMTEST0002?…`. We accept any alphanumeric
 * token starting with H, 6-12 chars total.
 */
const HM_CODE_RX = /\bH[A-Z0-9]{6,12}\b/;

const CURRENCY_SYMBOL_MAP: Record<string, string> = {
  $: "USD",
  "US$": "USD",
  U$S: "USD",
  USD: "USD",
  ARS: "ARS",
  UYU: "UYU",
  BRL: "BRL",
  EUR: "EUR",
  "€": "EUR",
};

const ES_MONTHS: Record<string, string> = {
  ene: "01",
  feb: "02",
  mar: "03",
  abr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  ago: "08",
  sep: "09",
  set: "09",
  oct: "10",
  nov: "11",
  dic: "12",
};

const EN_MONTHS: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  sept: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

function detectLocale(subject: string, body: string): Locale {
  const combined = `${subject}\n${body}`;
  if (
    /hu[eé]sped|reserva|llegada|salida|pago\s+total|check-?in|adultos?/i.test(
      combined,
    ) &&
    /[áéíóúñ¡¿]|reserva\s+confirmada|llega\s+el/i.test(combined)
  ) {
    return "es";
  }
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

/**
 * Convert an Airbnb-formatted short date into ISO `YYYY-MM-DD`. Handles
 * patterns like:
 *   - "22 may" (es, current year assumed)
 *   - "22 mayo"
 *   - "22 de mayo"
 *   - "May 22" (en)
 *   - already-ISO "2026-05-22"
 *
 * Returns null if the input doesn't parse to a real date.
 */
function normalizeDate(
  raw: string | null,
  monthFromGroup2: string | null,
  locale: Locale,
): string | null {
  if (!raw) return null;
  raw = raw.trim().toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const months = locale === "es" ? ES_MONTHS : EN_MONTHS;

  let day: string | null = null;
  let monthName: string | null = monthFromGroup2;
  if (!monthName) {
    // Try "22 may", "may 22", "22 de mayo", etc.
    const m1 = raw.match(/(\d{1,2})\s+(?:de\s+)?([a-záé]{3,5})/);
    if (m1) {
      day = m1[1];
      monthName = m1[2];
    } else {
      const m2 = raw.match(/([a-záé]{3,5})\s+(\d{1,2})/);
      if (m2) {
        monthName = m2[1];
        day = m2[2];
      }
    }
  } else {
    const m = raw.match(/(\d{1,2})/);
    if (m) day = m[1];
  }
  if (!day || !monthName) return null;
  monthName = monthName.replace(/\./g, "").slice(0, 4);
  const monthNum = months[monthName] ?? months[monthName.slice(0, 3)];
  if (!monthNum) return null;
  const year = new Date().getFullYear();
  const dd = day.padStart(2, "0");
  return `${year}-${monthNum}-${dd}`;
}

function parseNumber(s: string): number | null {
  const trimmed = s.replace(/\s/g, "");
  const lastDot = trimmed.lastIndexOf(".");
  const lastComma = trimmed.lastIndexOf(",");
  let normalized = trimmed;
  if (lastComma > lastDot) {
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
 * Pull the listing title from a `<h2>` block in the raw HTML. Airbnb's
 * confirmation emails put it as the second/third H2 — the first H1 is the
 * "Nueva reserva confirmada!" headline, the H2 right under the cover image
 * is the listing title.
 *
 * We just grab the H2 that contains the kind of words a listing title has
 * (≥3 words OR ≥20 chars, ignoring section headers like "Check-in" /
 * "Viajeros" / "Pago" which are short).
 */
function findListingNameInHtml(html: string): string | null {
  if (!html) return null;
  const matches = Array.from(html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi));
  for (const m of matches) {
    const text = stripHtml(m[1] ?? "").trim();
    if (text.length >= 12 && !/^(check|viajeros|pago|m[aá]s\s+detalles|llegada|salida)/i.test(text)) {
      return text;
    }
  }
  return null;
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
  const text = input.text ?? "";
  const html = input.html ?? "";
  // Always parse against text + stripped HTML. Airbnb's TextBody is often
  // nearly empty; the HTML carries everything.
  const body = [text, stripHtml(html)].filter(Boolean).join("\n");
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

  // Listing name: prefer extracting from a real <h2> in the raw HTML (more
  // reliable than regex on the stripped text). Fall back to landmark regex.
  const listing_name =
    findListingNameInHtml(html) ?? firstMatch(l.listing, body);

  // Numeric Airbnb listing id from URLs like `/rooms/1526467` — useful for
  // robust property matching since the display name can change.
  const listingIdMatch = body.match(/\/rooms\/(\d{4,})/) ?? html.match(/\/rooms\/(\d{4,})/);
  const airbnb_listing_id = listingIdMatch ? listingIdMatch[1] : null;

  // Guest profile photo on Airbnb's CDN. Pattern:
  //   a0.muscache.com/im/pictures/user/<uuid>.jpg?aki_policy=profile_x_medium
  // Look in the raw HTML (the `body` strips the URL down to text fragments).
  const photoMatch = html.match(
    /https?:\/\/[a-z0-9.-]*muscache\.com\/im\/pictures\/user\/[^"'\s)]+/i,
  );
  const guest_photo_url = photoMatch ? photoMatch[0] : null;

  if (kind === "cancellation") {
    return {
      kind,
      reservation_code,
      listing_name,
      airbnb_listing_id,
      locale,
    };
  }

  // Guest name: try subject + H1 + fallback body patterns.
  const guest_first_name =
    firstMatch(l.guestName, subject) ?? firstMatch(l.guestName, body);

  const countRaw = firstMatch(l.guestCount, body);
  const guest_count_parsed = countRaw ? Number(countRaw) : null;
  const { amount: payout_amount, currency: payout_currency } = extractPayout(
    l.payout,
    body,
  );
  const guest_message = firstMatch(l.message, body);

  // Date extraction: regex returns either a single capture (whole string) or
  // two captures (day + month name). normalizeDate handles both.
  let check_in: string | null = null;
  let check_out: string | null = null;
  for (const rx of l.checkIn) {
    const m = body.match(rx);
    if (m) {
      check_in = normalizeDate(m[1] ?? null, m[2] ?? null, locale);
      if (check_in) break;
    }
  }
  for (const rx of l.checkOut) {
    const m = body.match(rx);
    if (m) {
      check_out = normalizeDate(m[1] ?? null, m[2] ?? null, locale);
      if (check_out) break;
    }
  }

  return {
    kind,
    reservation_code,
    guest_first_name,
    guest_count:
      guest_count_parsed != null &&
      Number.isFinite(guest_count_parsed) &&
      guest_count_parsed > 0
        ? guest_count_parsed
        : null,
    payout_amount,
    payout_currency,
    guest_message,
    check_in,
    check_out,
    listing_name,
    airbnb_listing_id,
    guest_photo_url,
    locale,
  };
}

/**
 * Very crude HTML → text. Postmark gives us TextBody usually; this is the
 * primary source for Airbnb whose TextBody is intentionally minimal.
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
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
