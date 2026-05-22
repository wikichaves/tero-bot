/**
 * Brand / deployment configuration.
 *
 * Single product name: `tero.bot`. The previous operator/branding split
 * (separate product name + per-operator name) was collapsed in WIK-131 —
 * one product, one identity, used everywhere from page titles to
 * WhatsApp footers.
 *
 * Functional locale config (timezone, country, currency) stays
 * configurable via env because it's NOT branding — it's how date math
 * and currency formatters behave for the deployment.
 *
 * Build-time vs run-time:
 *   - Anything prefixed `NEXT_PUBLIC_` is bundled into the client.
 *   - Server-only constants don't need the prefix.
 */

/**
 * The product name. Used everywhere user-facing: page titles, WhatsApp
 * bot intro, template footers, daily report headers, etc. Stable.
 */
export const APP_NAME = "tero.bot";

/**
 * One-line tagline. Used in metadata description and the public landing.
 */
export const APP_TAGLINE = "Operativa para alquileres temporarios";

/**
 * Helper for the WhatsApp footers and daily-report subheaders.
 * Returns `"tero.bot · Tareas"`, `"tero.bot · Sensores"`, etc.
 */
export function brandedFooter(subsystem: string): string {
  return `${APP_NAME} · ${subsystem}`;
}

/**
 * Public app URL (no trailing slash). Used to build deeplinks from
 * WhatsApp messages, email signatures, etc. Defaults to the canonical
 * `https://tero.bot`; override per deployment via env.
 */
export const APP_URL = (
  process.env.NEXT_PUBLIC_APP_URL ??
  process.env.NEXT_PUBLIC_SITE_URL ??
  "https://tero.bot"
).replace(/\/$/, "");

/**
 * Just the host portion of `APP_URL` (no scheme). Used in WhatsApp
 * deeplinks where we want short `tero.bot/tasks/<id>` instead of the
 * full URL. E.g. "tero.bot".
 */
export const APP_HOST = APP_URL.replace(/^https?:\/\//, "");

/**
 * Subdomain configured to receive Postmark Inbound MX (Airbnb forwards,
 * utility bill PDFs). Optional — leave empty if not using inbound email.
 */
export const INBOUND_DOMAIN =
  process.env.NEXT_PUBLIC_INBOUND_DOMAIN ?? "";

/**
 * Default country code (ISO 3166-1 alpha-2). Affects timezone defaults,
 * default currency, and which utility providers show up in the property
 * form. "UY" or "AR" recognized today; falls back to UY.
 */
export const DEFAULT_COUNTRY = (
  process.env.DEFAULT_COUNTRY ?? "UY"
).toUpperCase();

/**
 * Default currency (ISO 4217). UYU for UY, ARS for AR. Override via env
 * to support other currencies.
 */
export const DEFAULT_CURRENCY = (
  process.env.DEFAULT_CURRENCY ??
  (DEFAULT_COUNTRY === "AR" ? "ARS" : "UYU")
).toUpperCase();

/**
 * IANA timezone for the deployment. Used to determine quiet hours for
 * WhatsApp alerts (WIK-125), format dates in reports, etc.
 *
 * Env var name kept as OPERATOR_TIMEZONE for backward compat with
 * existing Vercel configs even though the "operator" concept itself
 * went away in WIK-131. Re-name freely if you don't care about migrating
 * the env value.
 */
export const APP_TIMEZONE =
  process.env.OPERATOR_TIMEZONE ?? "America/Montevideo";

/**
 * UTC offset in HOURS (e.g. -3 for Montevideo). Used by date-math code
 * that doesn't want a full tz library.
 */
export const APP_UTC_OFFSET_HOURS = Number(
  process.env.OPERATOR_UTC_OFFSET_HOURS ?? "-3",
);
