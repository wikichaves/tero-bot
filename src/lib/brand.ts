/**
 * Brand / deployment configuration (WIK-126).
 *
 * The project itself is called "Tero" (Tero Admin / Tero Bot). What
 * varies between deployments is the OPERATOR — the business actually
 * using the system (e.g. "Acme Rentals", another short-term rental
 * group, a hotel chain). All operator-specific strings + URLs come from
 * env vars so the codebase can be open-sourced without leaking branding
 * of any particular operator.
 *
 * Build-time vs run-time:
 *   - Anything prefixed `NEXT_PUBLIC_` is bundled into the client. Safe
 *     for branding, URLs, etc.
 *   - Server-only constants don't need the prefix.
 *
 * Defaults are intentionally generic. In production each operator sets
 * their own values in Vercel / .env.local.
 */

export const APP_NAME = "Tero Admin";
export const APP_TAGLINE = "Multi-property short-term rental ops";
export const BOT_NAME = "Tero Bot";

/**
 * The business / property group that operates this instance. Used in
 * WhatsApp template footers, daily reports, manifest description, etc.
 * Required for production deploys; falls back to a placeholder during
 * local dev so the app boots without env config.
 */
export const OPERATOR_NAME =
  process.env.NEXT_PUBLIC_OPERATOR_NAME ?? "Your Property Group";

/**
 * Public admin URL (e.g. `https://admin.example.com`). Used to build
 * deeplinks from WhatsApp messages, email signatures, etc. No trailing
 * slash.
 */
export const APP_URL = (
  process.env.NEXT_PUBLIC_APP_URL ??
  process.env.NEXT_PUBLIC_SITE_URL ??
  "http://localhost:3000"
).replace(/\/$/, "");

/**
 * Just the host portion of `APP_URL` (no scheme), useful for the body
 * of WhatsApp messages that link back here. E.g. "admin.example.com".
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
 * to support other currencies as the project gains operators.
 */
export const DEFAULT_CURRENCY = (
  process.env.DEFAULT_CURRENCY ??
  (DEFAULT_COUNTRY === "AR" ? "ARS" : "UYU")
).toUpperCase();

/**
 * IANA timezone for the operator's local time. Used to determine quiet
 * hours for WhatsApp alerts (WIK-125), format dates in reports, etc.
 *
 * We default to America/Montevideo (UTC-3 year-round, no DST) — the most
 * common case for the original operator. Argentina is the same offset.
 */
export const OPERATOR_TIMEZONE =
  process.env.OPERATOR_TIMEZONE ?? "America/Montevideo";

/**
 * UTC offset in HOURS (e.g. -3 for Montevideo). Used by date-math code
 * that doesn't want a full tz library. Kept here so the offset is in
 * one place if/when we move to a tz-aware library.
 */
export const OPERATOR_UTC_OFFSET_HOURS = Number(
  process.env.OPERATOR_UTC_OFFSET_HOURS ?? "-3",
);

/**
 * Helper used by WhatsApp templates and notification messages.
 * Returns "<operator> · <subsystem>" — e.g. "Acme Rentals · Tareas".
 */
export function brandedFooter(subsystem: string): string {
  return `${OPERATOR_NAME} · ${subsystem}`;
}
