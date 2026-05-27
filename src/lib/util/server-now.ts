import "server-only";

/**
 * `Date.now()` para uso en server components / actions / route handlers.
 *
 * React 19 marca `Date.now()` como "impure" en la regla `react-hooks/purity`
 * porque produce un resultado diferente en cada llamada. En server components
 * eso no aplica de la misma forma: cada render corre exactamente una vez por
 * request, así que `Date.now()` es pure-en-el-rango-del-request.
 *
 * Centralizamos la única suppression acá para que el resto del código
 * server-side no tenga `// eslint-disable` esparcidos. Si en el futuro se
 * mockea para tests, el único punto a tocar es éste.
 *
 * Para client components NO usar este helper — la impureza ahí sí matters y
 * dispara hydration mismatches (#418). Capturar en server y pasar como prop.
 */
export const serverNow = (): number => Date.now();
