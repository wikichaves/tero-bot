import "server-only";

/**
 * FX rate fetcher — converts local currency amounts to USD.
 *
 * Strategy:
 *   - ARS uses the "dolar blue" rate from dolarapi.com (more realistic for
 *     residents/owners than the official rate, which is artificial).
 *   - Other currencies use open.er-api.com which provides a free public
 *     daily-updated rate against USD with no API key.
 *
 * Server-only. Cached at the fetch layer for 1 hour via Next's revalidate.
 */

export type FxRate = {
  /** ISO 4217 currency code. */
  currency: string;
  /** How many local-currency units equal 1 USD. */
  per_usd: number;
  /** Where the rate came from (for footer attribution). */
  source: string;
  /** When the rate was last updated by the source (ISO 8601). */
  timestamp: string;
};

const REVALIDATE_SECONDS = 60 * 60; // 1 hour

async function fetchArsBlue(): Promise<FxRate | null> {
  try {
    const res = await fetch("https://dolarapi.com/v1/dolares/blue", {
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      venta?: number;
      compra?: number;
      fechaActualizacion?: string;
    };
    if (typeof data.venta !== "number" || data.venta <= 0) return null;
    return {
      currency: "ARS",
      per_usd: data.venta,
      source: "dolarapi.com (blue, venta)",
      timestamp: data.fechaActualizacion ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

type ErApiResponse = {
  result?: string;
  base_code?: string;
  rates?: Record<string, number>;
  time_last_update_utc?: string;
};

let cachedErApi: ErApiResponse | null = null;
let cachedErApiAt = 0;

async function fetchErApi(): Promise<ErApiResponse | null> {
  // open.er-api.com updates once a day; per-instance memoize to avoid
  // re-parsing on every request even though Next caches the fetch.
  if (cachedErApi && Date.now() - cachedErApiAt < REVALIDATE_SECONDS * 1000) {
    return cachedErApi;
  }
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as ErApiResponse;
    if (data.result !== "success") return null;
    cachedErApi = data;
    cachedErApiAt = Date.now();
    return data;
  } catch {
    return null;
  }
}

export async function getRateToUsd(currency: string): Promise<FxRate | null> {
  const code = currency.toUpperCase();
  if (code === "USD") {
    return {
      currency: "USD",
      per_usd: 1,
      source: "fixed",
      timestamp: new Date().toISOString(),
    };
  }

  if (code === "ARS") {
    const blue = await fetchArsBlue();
    if (blue) return blue;
    // Fall through to open.er-api if blue API fails.
  }

  const general = await fetchErApi();
  if (general?.rates?.[code]) {
    return {
      currency: code,
      per_usd: general.rates[code],
      source: "open.er-api.com",
      timestamp: general.time_last_update_utc ?? new Date().toISOString(),
    };
  }
  return null;
}

/**
 * Fetch rates for many currencies in parallel and return a Map. Failed
 * currencies are simply absent from the map (caller should treat as null).
 */
export async function getRatesToUsd(
  currencies: Iterable<string>,
): Promise<Map<string, FxRate>> {
  const unique = Array.from(new Set(Array.from(currencies, (c) => c.toUpperCase())));
  const entries = await Promise.all(
    unique.map(async (c) => [c, await getRateToUsd(c)] as const),
  );
  const map = new Map<string, FxRate>();
  for (const [c, rate] of entries) {
    if (rate) map.set(c, rate);
  }
  return map;
}

export function toUsd(amount: number | null, rate: FxRate | undefined): number | null {
  if (amount == null || !rate || rate.per_usd <= 0) return null;
  return amount / rate.per_usd;
}

const usdFmt = new Intl.NumberFormat("es-UY", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

/** Format a USD amount with `.` thousands and `,` decimals (Spanish). */
export function formatUsd(amount: number | null): string {
  if (amount == null) return "—";
  return usdFmt.format(amount);
}

/** Format a generic number (e.g. exchange rate) with Spanish locale. */
export function formatRate(n: number, digits = 2): string {
  return n.toLocaleString("es-UY", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}
