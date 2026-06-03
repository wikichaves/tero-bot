/**
 * Shared formatting helpers — pure functions, no I/O, safe to import from
 * both server and client components.
 *
 * Previously these lived in `@/lib/tuya/energy`, but that file is marked
 * `server-only` (it talks to the Tuya API). When a client component
 * (e.g. /bills's bills table) wants to format money / kWh, it would
 * pull in `server-only` transitively and break the build. Splitting the
 * pure formatters out here keeps server-only in `tuya/energy.ts` and lets
 * the UI re-use them cleanly.
 */

import { APP_TIMEZONE } from "./brand";

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
 * Decimal rule (WIK-70): enteros se muestran SIN decimales (`UYU 4.441`),
 * fraccionarios SIEMPRE con dos (`ARS 1.391,50`). Antes mostrábamos
 * `1.391,5` ARS cuando el monto venía con un decimal del parser, lo cual
 * es confuso en una columna de plata.
 *
 * `alwaysDecimals` (WIK-229) fuerza SIEMPRE dos decimales, incluso en
 * enteros (`UYU 4.441,00`). Lo usa la tabla de Bills para que todos los
 * importes queden alineados al comparar filas; el resto de la UI (energy)
 * mantiene la regla WIK-70.
 *
 * Uses a per-(currency, decimals) cache so we don't re-instantiate the
 * formatter on every render.
 */
export function formatMoney(
  amount: number | null,
  currency: string = "UYU",
  options?: { alwaysDecimals?: boolean },
): string {
  if (amount == null) return "—";
  const hasDecimals = Math.abs(amount - Math.round(amount)) >= 0.005;
  const digits = options?.alwaysDecimals || hasDecimals ? 2 : 0;
  const cacheKey = `${currency}|${digits}`;
  let fmt = formatterCache.get(cacheKey);
  if (!fmt) {
    try {
      fmt = new Intl.NumberFormat(LOCALE, {
        style: "currency",
        currency,
        currencyDisplay: "code",
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
    } catch {
      fmt = new Intl.NumberFormat(LOCALE, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
    }
    formatterCache.set(cacheKey, fmt);
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
 * Time formatting para los charts (energy / rooms).
 *
 * Los snapshots se guardan en UTC, pero queremos mostrarlos SIEMPRE en la
 * hora local de las casas (Uruguay), no en la del browser del que mira.
 * Si no fijamos timeZone, `new Date(ms)` se formatea en la tz del visitante
 * y un usuario viajando (ej. San Francisco, UTC-7) ve los charts corridos
 * varias horas — confuso, porque Tuya configura y muestra todo en hora local
 * del device. Fijamos `APP_TIMEZONE` para que coincida con lo que se ve en
 * la app de Tuya.
 *
 * Usamos `formatToParts` en vez del string directo de Intl para evitar la
 * coma que Intl mete entre fecha y hora ("2 jun, 14:30") y para dropear el
 * punto de abreviatura, replicando el layout que daba date-fns ("2 jun 14:30").
 */
function tzParts(
  fmt: Intl.DateTimeFormat,
  ms: number,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(ms)) out[p.type] = p.value;
  return out;
}

const stripDot = (s: string): string => s.replace(/\.$/, "");

const chartAxisFmt = new Intl.DateTimeFormat(LOCALE, {
  timeZone: APP_TIMEZONE,
  hour12: false,
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const chartTooltipFmt = new Intl.DateTimeFormat(LOCALE, {
  timeZone: APP_TIMEZONE,
  hour12: false,
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** Eje X de los charts: "2 jun 14:30" en hora de las casas (Uruguay). */
export function formatChartAxisTime(ms: number): string {
  const p = tzParts(chartAxisFmt, ms);
  return `${p.day} ${stripDot(p.month)} ${p.hour}:${p.minute}`;
}

/** Tooltip de los charts: "lun 2 jun 14:30" en hora de las casas (Uruguay). */
export function formatChartTooltipTime(ms: number): string {
  const p = tzParts(chartTooltipFmt, ms);
  return `${stripDot(p.weekday)} ${p.day} ${stripDot(p.month)} ${p.hour}:${p.minute}`;
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
