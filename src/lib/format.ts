/**
 * Shared formatting helpers — pure functions, no I/O, safe to import from
 * both server and client components.
 *
 * Previously these lived in `@/lib/tuya/energy`, but that file is marked
 * `server-only` (it talks to the Tuya API). When a client component
 * (e.g. /facturas's bills table) wants to format money / kWh, it would
 * pull in `server-only` transitively and break the build. Splitting the
 * pure formatters out here keeps server-only in `tuya/energy.ts` and lets
 * the UI re-use them cleanly.
 */

const formatterCache = new Map<string, Intl.NumberFormat>();

/**
 * Locale used everywhere in the energy UI. `es-UY` and `es-AR` both produce
 * the conventional Spanish number format: `.` for thousands, `,` for
 * decimals (e.g. `1.234,56`).
 */
const LOCALE = "es-UY";

/**
 * Format a money amount in the given ISO 4217 currency (e.g. UYU, ARS, USD).
 *
 * We force `currencyDisplay: "code"` so the prefix is ALWAYS the ISO code
 * (`UYU 4.441`, `ARS 120.518`, `USD 30`). Without it, Intl.NumberFormat
 * with locale `es-UY` shows `$` for UYU but the literal "ARS" code for
 * argentino (because `$` isn't recognized as ARS in the UY locale) —
 * inconsistent and confusing when mixing properties.
 *
 * Uses a per-currency cache so we don't re-instantiate the formatter on
 * every render.
 */
export function formatMoney(
  amount: number | null,
  currency: string = "UYU",
): string {
  if (amount == null) return "—";
  let fmt = formatterCache.get(currency);
  if (!fmt) {
    try {
      fmt = new Intl.NumberFormat(LOCALE, {
        style: "currency",
        currency,
        currencyDisplay: "code",
        maximumFractionDigits: 0,
      });
    } catch {
      fmt = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
    }
    formatterCache.set(currency, fmt);
  }
  return fmt.format(amount);
}

/** Backwards-compat alias for the old UYU-only formatter. */
export function formatUyu(amount: number | null): string {
  return formatMoney(amount, "UYU");
}

/**
 * Format a kWh value with Spanish thousands/decimals.
 */
export function formatKwh(kwh: number | null, digits = 1): string {
  if (kwh == null) return "—";
  return (
    kwh.toLocaleString(LOCALE, {
      maximumFractionDigits: digits,
      minimumFractionDigits: 0,
    }) + " kWh"
  );
}

/**
 * Format a numeric value with a unit and Spanish thousands/decimals.
 */
export function formatNumeric(
  n: number | null,
  unit: string,
  digits = 1,
): string {
  if (n == null) return "—";
  return (
    n.toLocaleString(LOCALE, {
      maximumFractionDigits: digits,
      minimumFractionDigits: 0,
    }) +
    " " +
    unit
  );
}

/**
 * Format watts as W or kW depending on size, Spanish locale.
 */
export function formatPower(w: number | null): string {
  if (w == null) return "—";
  if (w < 1000) {
    return (
      w.toLocaleString(LOCALE, { maximumFractionDigits: 0 }) + " W"
    );
  }
  return (
    (w / 1000).toLocaleString(LOCALE, { maximumFractionDigits: 2 }) +
    " kW"
  );
}
