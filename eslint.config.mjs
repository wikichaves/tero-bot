import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Downgrade rules React 19 trae nuevas (purity / set-state-in-effect) a
  // warning. Razones:
  //   - `react-hooks/purity` no distingue server components, donde
  //     `Date.now()` corre una sola vez por request y es totalmente
  //     determinista respecto al render.
  //   - `react-hooks/set-state-in-effect` flagea el patrón estándar
  //     `useEffect(() => setMounted(true), [])` que usamos en mode-toggle
  //     para evitar hydration mismatches.
  // Las warnings quedan visibles en CI (npm run lint) pero no rompen el
  // gate — el build sí lo hace si introducimos algo realmente roto.
  {
    rules: {
      "react-hooks/purity": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
