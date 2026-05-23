/**
 * Helpers estadísticos para series de números (WIK-96).
 *
 * Sin `server-only` — los importan tanto el detalle de /rooms
 * (server component) como buildSensorSummary (server) y potencialmente
 * componentes cliente en el futuro.
 */

/**
 * Promedio simple. Devuelve null si el array está vacío para que el
 * caller pueda distinguir entre "no hay datos" y "el promedio es 0".
 */
export function avg(arr: number[]): number | null {
  if (arr.length === 0) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/**
 * Percentil con interpolación lineal — útil para filtrar outliers
 * cuando se calcula min/max sobre series ruidosas (lecturas de
 * sensores, deltas de medidores).
 *
 * Para series cortas (<20 muestras) cae al min/max raw porque los
 * percentiles no son estadísticamente significativos con tan poca
 * data.
 *
 * Algoritmo: ordenar ascendente, interpolar linealmente entre los
 * dos valores que rodean el rank objetivo. Mismo método que C=7 en
 * R o `numpy.percentile` con `interpolation="linear"`.
 *
 * @param arr Lista de valores numéricos
 * @param p Percentil entre 0 y 100 (ej. 5 = p5, 95 = p95)
 */
export function percentile(arr: number[], p: number): number | null {
  if (arr.length === 0) return null;
  if (arr.length < 20) {
    return p < 50 ? Math.min(...arr) : Math.max(...arr);
  }
  const sorted = arr.slice().sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (rank - lo) * (sorted[hi] - sorted[lo]);
}
