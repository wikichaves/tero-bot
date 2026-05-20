/**
 * Smoke tests for `src/lib/airbnb/parse-email.ts` against three real
 * Airbnb host email templates (es-AR locale, captured 2025-2026):
 *
 *   1. BOOKING_CONFIRMATION_TO_HOST     → confirmation (full data)
 *   2. reservation/alteration/alteration_requested
 *      → no actionable: no HM code in payload, parser returns `unknown`
 *   3. CANCELLATIONS_RESERVATION_CANCELED_BY_GUEST_TO_HOST → cancellation
 *
 * Fixtures preserve the exact subject, X-Template, X-Locale headers and
 * the text/html portions the parser actually consumes. SMTP/ARC/DKIM
 * headers and CSS boilerplate are stripped — they don't affect parsing.
 *
 * Run: `pnpm test:parse-email`
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAirbnbEmail } from "../src/lib/airbnb/parse-email";

// ──────────────────────────────────────────────────────────────────────
// Fixture 1: confirmation
// ──────────────────────────────────────────────────────────────────────

const CONFIRMATION = {
  subject: "Reserva confirmada: Juana Pérez llega el 22 may.",
  text: `¡NUEVA RESERVA CONFIRMADA! ANASTASIA LLEGA EL 22 MAY.

Enviá un mensaje para confirmar los detalles del check-in o
dar la bienvenida a Juana.

https://www.airbnb.com.ar/hosting/reservations/details/HMTEST0002?isPending=true
Juana Pérez

Identity Verified
Madrid, España

https://www.airbnb.com.ar/rooms/1526467

CHARMING FAMILY STAY WITH ROOFTOP & CHILD'S ROOM

Casa/dpto. entero

Check-in      Check-out
vie, 22 may   lun, 1 jun
4:00 p. m.    12:00 p. m.

VIAJEROS

1 adulto

CÓDIGO DE CONFIRMACIÓN
HMTEST0002

EL VIAJERO PAGÓ

$48,16 x 10 noches   $481,60
Tarifa de limpieza   $30,00
Tarifa por servicio para huéspedes   $72,23

TOTAL (USD)   $583,83

COBRO DEL ANFITRIÓN

Tarifa por 10 noches   $602,00
Tarifa de limpieza   $30,00
Ajuste del precio por noche   -$120,40
Tarifa por servicio para anfitriones (3.0 % + IVA)   -$18,73

GANÁS:   $492,87
`,
  html: `<html><body>
<h1>¡Nueva reserva confirmada! Juana llega el 22 may.</h1>
<a href="https://www.airbnb.com.ar/hosting/reservations/details/HMTEST0002">
  <img src="https://a0.muscache.com/im/pictures/user/00000000-0000-0000-0000-000000000000.jpg?aki_policy=profile_x_medium" />
</a>
<p>Juana Pérez</p>
<p><img src="https://a0.muscache.com/im/pictures/00000000-0000-0000-0000-000000000001.jpg" />Identity Verified</p>
<p><img src="https://a0.muscache.com/im/pictures/00000000-0000-0000-0000-000000000002.jpg" />Madrid, España</p>
<a href="https://www.airbnb.com.ar/rooms/1526467"><h2>Charming Family Stay with Rooftop & Child's Room</h2></a>
<p>Check-in</p><p>vie, 22 may</p><p>4:00 p. m.</p>
<p>Check-out</p><p>lun, 1 jun</p><p>12:00 p. m.</p>
<h2>Viajeros</h2><p>1 adulto</p>
<h2>Código de confirmación</h2><p>HMTEST0002</p>
<h2>El viajero pagó</h2>
<p>Total (USD)</p><p>$583,83</p>
<h2>Cobro del anfitrión</h2>
<h3>Ganás:</h3><p>$492,87</p>
</body></html>`,
  headers: [
    { Name: "From", Value: "Airbnb <automated@airbnb.com>" },
    { Name: "Subject", Value: "Reserva confirmada: Juana Pérez llega el 22 may." },
    { Name: "X-Template", Value: "BOOKING_CONFIRMATION_TO_HOST" },
    { Name: "X-Locale", Value: "es-AR" },
    { Name: "Message-ID", Value: "<1Yfx1nSIS9iHjrp3ZMV3cw@geopod-ismtpd-53>" },
  ],
};

// ──────────────────────────────────────────────────────────────────────
// Fixture 2: alteration_requested (no HM code, not actionable)
// ──────────────────────────────────────────────────────────────────────

const ALTERATION_REQUESTED = {
  subject: "María quiere hacer un cambio en su reserva",
  text: `FATIMA QUIERE HACER UN CAMBIO EN SU RESERVA

FATIMA

CF

· Charming Family Stay with Rooftop & Child's Room

FECHAS ORIGINALES

11 de mar de 2026 - 10 de abr de 2026

FECHAS SOLICITADAS

11 de mar de 2026 - 9 de abr de 2026

Si aceptás la solicitud de María, vamos a actualizar la
reserva de inmediato.

Accedé a la solicitud
https://www.airbnb.com.ar/reservation/alteration/1632897506908832139
`,
  html: `<html><body>
<h1>María quiere hacer un cambio en su reserva</h1>
<h2>María</h2><p>CF</p><p> · Charming Family Stay with Rooftop & Child's Room</p>
<h3>Fechas originales</h3><p>11 de mar de 2026 - 10 de abr de 2026</p>
<h3>Fechas solicitadas</h3><p>11 de mar de 2026 - 9 de abr de 2026</p>
<a href="https://www.airbnb.com.ar/reservation/alteration/1632897506908832139">Accedé a la solicitud</a>
</body></html>`,
  headers: [
    { Name: "From", Value: "Airbnb <automated@airbnb.com>" },
    { Name: "Subject", Value: "María quiere hacer un cambio en su reserva" },
    { Name: "X-Template", Value: "reservation/alteration/alteration_requested" },
    { Name: "X-Locale", Value: "es-AR" },
  ],
};

// ──────────────────────────────────────────────────────────────────────
// Fixture 3: cancellation
// ──────────────────────────────────────────────────────────────────────

const CANCELLATION = {
  subject: "Cancelada: reserva HMTEST0001 (del 3‒15 de oct de 2025)",
  text: `RESERVA CANCELADA

https://www.airbnb.com.ar/hosting/reservations/canceled?confirmationCode=HMTEST0001

Charming Family Stay with Rooftop & Child's Room

Anuncio n.º 1526467

03‒15 de 10, 2 huéspedes

Lamentamos informarte que Pedro Gómez, tu huésped, tuvo
que cancelar la reserva HMTEST0001 para el período del
03‒15 de 10. Actualizamos tu calendario para mostrar que
esas fechas ahora están disponibles.

Conforme a tu política de cancelación, el huésped recibió un
reembolso total.
`,
  html: `<html><body>
<h1>Reserva cancelada</h1>
<a href="https://www.airbnb.com.ar/hosting/reservations/canceled?confirmationCode=HMTEST0001">
  <img src="https://a0.muscache.com/im/pictures/hosting/Hosting-0000000/original/00000000-0000-0000-0000-000000000003.jpeg" />
</a>
<p>Charming Family Stay with Rooftop & Child's Room</p>
<p>Anuncio n.º 1526467</p>
<p>03‒15 de 10, 2 huéspedes</p>
<p>Lamentamos informarte que Pedro Gómez, tu huésped, tuvo que cancelar la reserva HMTEST0001.</p>
</body></html>`,
  headers: [
    { Name: "From", Value: "Airbnb <automated@airbnb.com>" },
    { Name: "Subject", Value: "Cancelada: reserva HMTEST0001 (del 3‒15 de oct de 2025)" },
    { Name: "X-Template", Value: "CANCELLATIONS_RESERVATION_CANCELED_BY_GUEST_TO_HOST" },
    { Name: "X-Locale", Value: "es-AR" },
  ],
};

// ──────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────

test("confirmation: extracts all fields from real BOOKING_CONFIRMATION_TO_HOST", () => {
  const r = parseAirbnbEmail(CONFIRMATION);
  assert.equal(r.kind, "confirmation");
  if (r.kind !== "confirmation") throw new Error("type guard");

  assert.equal(r.reservation_code, "HMTEST0002");
  assert.equal(r.airbnb_listing_id, "1526467");
  assert.equal(r.listing_name, "Charming Family Stay with Rooftop & Child's Room");
  // Subject "Reserva confirmada: Juana Pérez llega el…" gives us the
  // full first+last name; we accept that (more useful than just the first
  // name — admin can split if needed). The body H1 form would give just
  // "Juana" — see the fallback test below.
  assert.equal(r.guest_first_name, "Juana Pérez");
  assert.equal(r.guest_adults, 1);
  assert.equal(r.guest_count, 1);
  assert.equal(r.guest_identity_verified, true);
  assert.equal(r.guest_location, "Madrid, España");
  assert.equal(r.payout_amount, 492.87);
  assert.equal(r.payout_currency, "USD");
  assert.ok(
    r.guest_photo_url?.includes("00000000-0000-0000-0000-000000000000"),
    "guest_photo_url should point to the user avatar",
  );
  assert.equal(r.locale, "es");
  assert.equal(r.check_in_time, "16:00");
  assert.equal(r.check_out_time, "12:00");
});

test("confirmation: still works when X-Template header is absent (subject fallback)", () => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { headers: _ignore, ...withoutHeaders } = CONFIRMATION;
  const r = parseAirbnbEmail(withoutHeaders);
  assert.equal(r.kind, "confirmation");
  if (r.kind !== "confirmation") throw new Error("type guard");
  assert.equal(r.reservation_code, "HMTEST0002");
});

test("alteration_requested: no HM code → returns unknown", () => {
  // The alteration_requested template carries only an alteration_id (not
  // an HM code), so the parser cannot link it to a specific reservation.
  // We expect `unknown` with a reason, so the route still 200s and logs
  // the email without touching any reservation row.
  const r = parseAirbnbEmail(ALTERATION_REQUESTED);
  assert.equal(r.kind, "unknown");
  if (r.kind !== "unknown") throw new Error("type guard");
  assert.ok(
    r.reason.toLowerCase().includes("reservation code") ||
      r.reason.toLowerCase().includes("hm"),
    `reason should mention missing HM code, got: "${r.reason}"`,
  );
});

test("cancellation: detects via X-Template + extracts code & listing_id", () => {
  const r = parseAirbnbEmail(CANCELLATION);
  assert.equal(r.kind, "cancellation");
  if (r.kind !== "cancellation") throw new Error("type guard");
  assert.equal(r.reservation_code, "HMTEST0001");
  // Critical: the listing_id must be extracted in cancellation emails so
  // the handler can match by id (not just by fuzzy name). Cancellations
  // don't include the `/rooms/NNN` URL — only `/Hosting-NNN/` (in img
  // src) and "Anuncio n.º NNN" (in body text). The parser tries both.
  assert.equal(
    r.airbnb_listing_id,
    "1526467",
    "should extract listing_id from /Hosting-NNN/ URL or 'Anuncio n.º NNN' text",
  );
  assert.equal(r.locale, "es");
  // Note: `listing_name` is best-effort in cancellations — Airbnb's HTML
  // wraps the title in a <p>, not an <h2>, so findListingNameInHtml may
  // return null. We don't assert on it here because property matching
  // falls back to `airbnb_listing_id` which is more reliable anyway.
});

test("cancellation: still works when subject says 'Cancelada: reserva HMXXX'", () => {
  // The 2025+ subject format inverts the word order ("Cancelada: reserva")
  // vs. the older "Reserva cancelada" wording. The regex must accept both.
  // Drop the X-Template header to force the subject path.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { headers: _ignore, ...withoutHeaders } = CANCELLATION;
  const r = parseAirbnbEmail(withoutHeaders);
  assert.equal(
    r.kind,
    "cancellation",
    "subject regex must accept 'Cancelada: reserva HMXXX'",
  );
});

test("empty input → unknown", () => {
  const r = parseAirbnbEmail({ subject: "", text: "", html: "" });
  assert.equal(r.kind, "unknown");
});

test("unrelated email (e.g. a review request) → unknown", () => {
  const r = parseAirbnbEmail({
    subject: "How was your stay?",
    text: "Tell us about your experience.",
    html: "",
  });
  assert.equal(r.kind, "unknown");
});
