// NOTE: no `import "server-only"` — this file is pure string processing
// with no Node-specific imports, and removing the marker lets us test it
// directly with tsx + node:test. It's still only reachable from server
// routes (the only callers are `handle-inbound.ts` → API route handlers).
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
    // Airbnb es-AR uses both word orders: "Reserva cancelada" (older) and
    // "Cancelada: reserva HM…" (current 2025+). Accept both, plus the
    // legacy "cancelación de reserva" form.
    cancellationSubject:
      /reserva\s+cancelada|cancelaci[oó]n\s+de\s+reserva|^cancelada\s*[:\s]/i,
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
      // "Pago total: $1.234,56 ARS" / "Total a recibir: USD 1.000" /
      // "Ganás: $492,87" (es-AR voseo) / "Ganarás: $492,87" (neutral).
      //
      // Crucially the value can be on the NEXT line ("Ganás:\n$492,87")
      // — Airbnb's text bodies wrap the label and amount across lines.
      // The label-to-value gap therefore uses `[\s:]*` (whitespace +
      // colons, including newlines) instead of the older `[^\n$0-9]{0,40}`
      // which silently dropped every multi-line payout in production.
      /(?:pago\s+total|total\s+a\s+recibir|gan(?:ar)?[aá]s)\b[\s:]*([A-Z]{3}|US\$|U\$S|\$|€)\s*([\d.,]+)/i,
      /([A-Z]{3})\s*\$?\s*([\d.,]+)\s*(?:de\s+pago|de\s+ganancia)/i,
      // "Vas a recibir US$ 1.234,56" / "Recibirás US$ 1.234,56"
      /(?:vas\s+a\s+recibir|recibir[aá]s)\b[\s:]*(US\$|U\$S|\$|€|[A-Z]{3})\s*([\d.,]+)/i,
    ],
    message: [
      // "Mensaje de Juan: hola..." — capture hasta ~500 chars o paragraph end.
      // WIK-169 v2: requiere literal "Mensaje de NAME:" con colon obligatorio.
      // El regex viejo `/Mensaje\s+(?:de\s+\S+)?:?\s*\n?...` se comía:
      //   - "Mensaje a Anastasia" (CTA "send message to")
      //   - "mensaje para confirmar los detalles del check-in" (texto inline)
      //   - "mensaje de bienvenida" (otro CTA)
      // El colon + "de" estricto descarta todos esos casos. Si el huésped
      // realmente no manda mensaje, este regex NO matchea y guest_message
      // queda null — que es la respuesta correcta.
      /Mensaje\s+de\s+[A-ZÁÉÍÓÚÑa-záéíóúñ][^\n:]{0,40}:\s*\n?([\s\S]{1,500}?)(?:\n\s*\n|$)/i,
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
    cancellationSubject:
      /reservation\s+canceled|booking\s+canceled|^canceled\s*[:\s]/i,
    modificationSubject:
      /reservation\s+(changed|modified)|booking\s+(changed|modified)|date\s+change/i,
    confirmationSubject:
      /reservation\s+confirmed|new\s+reservation|booking\s+confirmed|new\s+booking/i,
    guestName: [
      // Subject: "Reservation confirmed: Jane Smith arrives May 22"
      /Reservation\s+confirmed\s*[:\-]\s*([A-Z][A-Za-z'’\-]+(?:\s+[A-Z][A-Za-z'’\-]+){0,2})\s+arriv/i,
      // Body H1: "New reservation confirmed! Jane arrives May 22"
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
      // Multi-line tolerant — see es comments above.
      /(?:total\s+payout|you'?ll\s+earn|payout)\b[\s:]*([A-Z]{3}|\$|US\$|€)\s*([\d.,]+)/i,
      /([A-Z]{3})\s*\$?\s*([\d.,]+)\s*payout/i,
      /you'?ll\s+receive\b[\s:]*(US\$|\$|€|[A-Z]{3})\s*([\d.,]+)/i,
    ],
    message: [
      // WIK-169 v2: require literal "Message from NAME:" w/ mandatory colon.
      // Same rationale as the ES variant — old regex was too permissive and
      // matched CTA fragments like "Message to <name>".
      /Message\s+from\s+[A-Z][^\n:]{0,40}:\s*\n?([\s\S]{1,500}?)(?:\n\s*\n|$)/i,
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

/**
 * Airbnb's outgoing emails carry an `X-Template` header that identifies the
 * email type independent of locale or wording changes. Examples seen in real
 * payloads:
 *   - `BOOKING_CONFIRMATION_TO_HOST` → confirmation
 *   - `CANCELLATIONS_RESERVATION_CANCELED_BY_GUEST_TO_HOST` → cancellation
 *   - `CANCELLATIONS_RESERVATION_CANCELED_BY_HOST_TO_HOST` → cancellation
 *   - `reservation/alteration/alteration_requested` → no-op (no HM code)
 *   - `reservation/alteration/alteration_accepted` → modification (future)
 *
 * This is the most reliable discriminator we have — much more stable than
 * regex on the subject, which Airbnb tweaks per locale and over time. When
 * the header is missing or unrecognized we fall back to the subject/body
 * regex in `detectKind`.
 */
function detectKindFromTemplate(
  template: string | null,
): "confirmation" | "cancellation" | "modification" | null {
  if (!template) return null;
  const t = template.toLowerCase();
  // Cancellations always carry "cancel" in the template name.
  if (t.includes("cancel")) return "cancellation";
  // Alterations: only the "accepted/confirmed/approved" variants are
  // actionable (they carry an HM code). The "requested" variant has only
  // a guest first-name + listing name + alteration_id, no reservation_code,
  // so we deliberately return null and let the HM-code check turn it into
  // `kind=unknown` — that ensures we log the email but don't try to
  // mis-match it against a reservation.
  if (t.includes("alteration")) {
    if (/(accepted|confirmed|approved)/.test(t)) return "modification";
    return null;
  }
  if (t.includes("confirmation")) return "confirmation";
  return null;
}

/**
 * Postmark exposes the original message's headers as `Headers: [{Name,Value}]`.
 * Header lookup is case-insensitive per RFC 5322.
 */
function findHeader(
  headers:
    | ReadonlyArray<{ Name?: string; Value?: string }>
    | null
    | undefined,
  name: string,
): string | null {
  if (!headers) return null;
  const target = name.toLowerCase();
  for (const h of headers) {
    if ((h.Name ?? "").toLowerCase() === target) return h.Value ?? null;
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
  /** Original message headers from Postmark (`body.Headers`). Optional —
   *  the parser still works without them, falling back to subject/body
   *  regex for kind detection. */
  headers?: ReadonlyArray<{ Name?: string; Value?: string }> | null;
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
  // Prefer the X-Template header (locale-agnostic, copy-agnostic) when
  // present. Fall back to subject/body regex for older payloads or when
  // Postmark doesn't pass through all original headers.
  const xTemplate = findHeader(input.headers, "x-template");
  const templateKind = detectKindFromTemplate(xTemplate);
  const kind = templateKind ?? detectKind(subject, body, l);
  // Always include the X-Template in the `unknown` reason so we can grep
  // Vercel logs for new template names Airbnb introduces (e.g. eventual
  // `alteration_accepted`, review requests, payout notifications…).
  const templateNote = xTemplate ? ` x-template=${xTemplate}` : "";
  if (!kind) {
    return { kind: "unknown", reason: `no airbnb landmark found.${templateNote}` };
  }

  const codeMatch = body.match(HM_CODE_RX) ?? subject.match(HM_CODE_RX);
  if (!codeMatch) {
    return {
      kind: "unknown",
      reason: `no reservation code (HM…).${templateNote}`,
    };
  }
  const reservation_code = codeMatch[0];

  // Listing name: prefer extracting from a real <h2> in the raw HTML (more
  // reliable than regex on the stripped text). Fall back to landmark regex.
  const listing_name =
    findListingNameInHtml(html) ?? firstMatch(l.listing, body);

  // Numeric Airbnb listing id from URLs / body text — preferred over the
  // display name for property matching since the name can be renamed by the
  // host. Airbnb leaks it in several places depending on the template:
  //   - Confirmation: `/rooms/1526467` link to the listing page
  //   - Cancellation: HTML img URL `/im/pictures/hosting/Hosting-0000000/…`
  //     plus body text "Anuncio n.º 1526467"
  //   - en locale equivalent: "Listing #1526467"
  // We try each pattern in order; first hit wins.
  const listingIdMatch =
    body.match(/\/rooms\/(\d{4,})/) ??
    html.match(/\/rooms\/(\d{4,})/) ??
    html.match(/\/Hosting-(\d{4,})\//) ??
    body.match(/Anuncio\s*n\.?\s*[º°o]\s*(\d{4,})/i) ??
    body.match(/Listing\s*#?\s*(\d{4,})/i);
  const airbnb_listing_id = listingIdMatch ? listingIdMatch[1] : null;

  // Guest profile photo on Airbnb's CDN. Pattern:
  //   a0.muscache.com/im/pictures/user/<uuid>.jpg?aki_policy=profile_x_medium
  // Look in the raw HTML (the `body` strips the URL down to text fragments).
  const photoMatch = html.match(
    /https?:\/\/[a-z0-9.-]*muscache\.com\/im\/pictures\/user\/[^"'\s)]+/i,
  );
  const guest_photo_url = photoMatch ? photoMatch[0] : null;

  // Identity Verified: Airbnb literally writes "Identity Verified" /
  // "Identity Verified" next to a shield icon. Absence = false (could
  // also mean unknown; using `null` if we have no signal at all).
  let guest_identity_verified: boolean | null = null;
  if (locale === "es") {
    if (/Identidad\s+verificada/i.test(body)) guest_identity_verified = true;
  } else {
    if (/Identity\s+verified/i.test(body)) guest_identity_verified = true;
  }

  // Guest location: short text right under the "Identity Verified" line.
  // We anchor to the home icon URL Airbnb uses for "from" location:
  //   00000000-0000-0000-0000-000000000002.jpg
  // and capture the next text-ish fragment.
  let guest_location: string | null = null;
  const locMatchHtml = html.match(
    /00000000-0000-0000-0000-000000000002[\s\S]{0,400}?>([^<>]{3,80})<\/p>/i,
  );
  if (locMatchHtml) {
    guest_location = stripHtml(locMatchHtml[1]).trim();
  }

  // Group breakdown: parse "1 adulto", "2 adultos", "1 niño", "1 bebé".
  // Airbnb usually shows them comma-separated under the "Viajeros" section.
  const adultsMatch = body.match(/(\d+)\s+adultos?\b/i);
  const childrenMatch = body.match(/(\d+)\s+ni[ñn]os?\b/i);
  const infantsMatch = body.match(/(\d+)\s+beb[eé]s?\b/i);
  const guest_adults = adultsMatch ? Number(adultsMatch[1]) : null;
  const guest_children = childrenMatch ? Number(childrenMatch[1]) : null;
  const guest_infants = infantsMatch ? Number(infantsMatch[1]) : null;

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
  // WIK-169 v2: defensa adicional contra falsos positivos. Si el regex
  // se rompe por algún cambio futuro de template y captura una URL de
  // Airbnb (CTAs típicas tipo "Send a message to Anastasia [https://…]")
  // descartamos. Un mensaje real de un huésped nunca contiene URLs de
  // airbnb.com — Airbnb las strip-ea del input por seguridad.
  const guestMessageRaw = firstMatch(l.message, body);
  const guest_message =
    guestMessageRaw && /airbnb\.com|muscache\.com/i.test(guestMessageRaw)
      ? null
      : guestMessageRaw;

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

  // Check-in / out times. Airbnb shows them under the dates as
  //   "4:00 p. m." (es-AR/UY) or "4:00 PM" (en).
  // We look for the time right after the Check-in/Check-out section.
  const ciTime = extractTimeAfter(body, locale, "in");
  const coTime = extractTimeAfter(body, locale, "out");
  const check_in_time = ciTime;
  const check_out_time = coTime;

  // Total guest count: prefer the explicit breakdown if we got it, else
  // fall back to the legacy "guest_count" landmark match.
  const breakdownSum =
    (guest_adults ?? 0) + (guest_children ?? 0) + (guest_infants ?? 0);
  const totalCount =
    breakdownSum > 0
      ? breakdownSum
      : guest_count_parsed != null &&
          Number.isFinite(guest_count_parsed) &&
          guest_count_parsed > 0
        ? guest_count_parsed
        : null;

  return {
    kind,
    reservation_code,
    guest_first_name,
    guest_count: totalCount,
    guest_adults,
    guest_children,
    guest_infants,
    guest_identity_verified,
    guest_location,
    payout_amount,
    payout_currency,
    guest_message,
    check_in,
    check_out,
    check_in_time,
    check_out_time,
    listing_name,
    airbnb_listing_id,
    guest_photo_url,
    locale,
  };
}

/**
 * Pull a "HH:MM" 24h time out of the body that appears near the Check-in
 * or Check-out section heading. Handles both "4:00 p. m." (es) and
 * "4:00 PM" (en) formats.
 *
 * Returns null if no time can be confidently associated with the section.
 */
function extractTimeAfter(
  body: string,
  locale: Locale,
  which: "in" | "out",
): string | null {
  // Match the "Check-in"/"Check-out" *heading*, not the same word used in
  // prose. Airbnb's confirmation text starts with "Enviá un mensaje para
  // confirmar los detalles del check-in o…" — the lowercase narrative
  // occurrence would otherwise win over the actual table header, and the
  // 200-char window from that position has no time. Anchor to start of
  // line so only the heading qualifies.
  const heading =
    which === "in" ? /(?:^|\n)\s*Check-?in\b/i : /(?:^|\n)\s*Check-?out\b/i;
  const m = heading.exec(body);
  if (!m) return null;
  // Search a window after the heading for the first time-like pattern.
  const start = m.index + m[0].length;
  const window = body.slice(start, start + 200);
  // es: "4:00 p. m." / en: "4:00 PM"
  const rx =
    locale === "es"
      ? /\b(\d{1,2}):(\d{2})\s*([ap])\.?\s*m\.?/i
      : /\b(\d{1,2}):(\d{2})\s*([ap])\.?\s*m\.?/i;
  const tm = rx.exec(window);
  if (!tm) return null;
  let hour = Number(tm[1]);
  const minute = Number(tm[2]);
  const ampm = tm[3].toLowerCase();
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 12 || minute < 0 || minute > 59) return null;
  if (ampm === "p" && hour < 12) hour += 12;
  if (ampm === "a" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
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
