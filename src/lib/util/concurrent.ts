/**
 * Tiny concurrency utilities — usados principalmente por los crons que
 * llaman Tuya por device (`snapshotAllDevices`, `snapshotAllSensors`).
 *
 * Razón (WIK-161 v2): cuando había ~10 devices y el cron arrancaba con
 * `Promise.all`, Tuya tiraba 429s en ráfaga y el cron quedaba con gaps
 * silenciosos. Estos helpers limitan la concurrencia (default 3) y
 * reintentan con backoff exponencial ante 429 / 5xx / network errors.
 *
 * No depend de ninguna lib externa para mantener la dependencia 0.
 */

/**
 * Ejecuta `fn(item)` por cada item con un cap de concurrencia. Devuelve
 * los resultados en el mismo orden que `items`. No hace retry — sólo
 * limita concurrencia. Para retry usar {@link withRetry} adentro del fn.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number = 3,
): Promise<R[]> {
  if (items.length === 0) return [];
  // Clamp a 1..items.length para que no se rompa con inputs raros.
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  }
  // Lanzamos `limit` workers que comparten el cursor.
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

export type RetryOptions = {
  /** Cuántos intentos en total (incluido el primero). Default 3. */
  attempts?: number;
  /** Delay base en ms para backoff exponencial. Default 500. */
  baseDelayMs?: number;
  /** Cap máximo del delay en ms (para que no explote en intentos altos). Default 5000. */
  maxDelayMs?: number;
  /**
   * Decide si una excepción merece retry. Default: matchea status 429
   * (Too Many Requests), 5xx, network errors / fetch failed.
   * Para errors no-retryable (auth, "function not supported"), devolver
   * `false` y se propaga la excepción inmediatamente sin reintentar.
   */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
};

const DEFAULT_SHOULD_RETRY = (err: unknown): boolean => {
  const msg = String((err as Error)?.message ?? err).toLowerCase();
  // Tuya devuelve códigos custom — buscamos los patterns más comunes:
  if (msg.includes("429") || msg.includes("too many requests")) return true;
  if (msg.includes("rate limit") || msg.includes("rate-limit")) return true;
  if (msg.includes("timeout") || msg.includes("etimedout")) return true;
  if (msg.includes("econnreset") || msg.includes("econnrefused")) return true;
  if (msg.includes("fetch failed") || msg.includes("network")) return true;
  // 5xx genérico (Tuya tira "frequent request" sometimes con 500-ish).
  if (/\b5\d{2}\b/.test(msg)) return true;
  return false;
};

/**
 * Ejecuta `fn` con retry + backoff exponencial. Por default reintenta
 * solo 429 / timeouts / network errors. Errores que claramente no son
 * retryables (auth, function-not-supported) se propagan directo.
 */
export async function withRetry<R>(
  fn: (attempt: number) => Promise<R>,
  options: RetryOptions = {},
): Promise<R> {
  const attempts = options.attempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 5000;
  const shouldRetry = options.shouldRetry ?? DEFAULT_SHOULD_RETRY;

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      const isLast = attempt === attempts;
      if (isLast || !shouldRetry(err, attempt)) {
        throw err;
      }
      // Exponential backoff: base * 2^(attempt-1), capped + jitter.
      const expo = baseDelayMs * Math.pow(2, attempt - 1);
      const capped = Math.min(expo, maxDelayMs);
      const jitter = Math.random() * 0.3 * capped;
      const delay = Math.round(capped + jitter);
      await new Promise((res) => setTimeout(res, delay));
    }
  }
  // Inalcanzable pero TS no lo sabe.
  throw lastErr;
}
