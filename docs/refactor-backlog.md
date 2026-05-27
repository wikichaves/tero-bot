# Refactor backlog

Items detectados en el audit del 2026-05-27 que **no entraron** en el refactor de ese día (5 batches mergeados en commits `6b9536c..a5ed6bb`). Postergados por riesgo, esfuerzo, o porque necesitan métricas que no tenemos a mano.

Orden: highest impact primero.

## 1. Romper el monolito `src/app/api/whatsapp/route.ts`

- 613 LOC en un solo handler. Está en CODEOWNERS — cualquier PR requiere review humana.
- Hay 2 `console.time/timeEnd` (líneas ~606, 608) que sugieren que en algún momento hubo problema de perf.
- Proponer: extraer handlers a `src/lib/whatsapp/webhook/` con dispatch table (ej. `commands.ts`, `attachments.ts`, etc.).
- **Esfuerzo: L · Riesgo: med-high** (toca el webhook crítico — si rompe, no entran mensajes).
- **Pre-vacaciones: NO** tocar.

## 2. `.select("*")` → enumerar columnas en hot paths

`Supabase.from(...).select("*")` aparece en 18+ sitios. Trae filas completas cuando muchos callers usan 2-3 columnas. Los hot paths a atacar primero:

- `src/lib/auth.ts:19` (CODEOWNERS) — query por request a `profiles`
- `src/app/api/whatsapp/route.ts:246` (CODEOWNERS) — webhook
- `src/app/admin/properties/page.tsx:26`
- `src/app/admin/alarms/page.tsx:82`
- `src/app/whatsapp/[id]/page.tsx` (varias rutas)

**Esfuerzo: M · Riesgo: low** (cuidar columnas usadas downstream — TS te avisa).

## 3. Auditoría de índices en Supabase

`supabase/schema.sql` declara ~35 índices. Sin métricas reales no se sabe cuáles faltan ni cuáles están duplicados / cuáles nunca se usan.

- Habilitar `pg_stat_statements` en Supabase (Settings → Database)
- Identificar top-10 queries por tiempo total
- Comparar con índices existentes
- Sesión dedicada (1-2h) post-vacaciones

**Esfuerzo: M-L · Riesgo: high** (cambios destructivos a `schema.sql` son irreversibles sin backup).

## 4. Casts `as unknown as X` (5 sitios)

Reemplazar por tipos generados de Supabase (`Database["public"]["Tables"]["X"]["Row"]`):

- `src/app/admin/alarms/page.tsx:121`
- `src/app/dashboard/sensor-alarms-card.tsx:76`, `:92`
- `src/lib/sensors/reports.ts:53`

**Esfuerzo: M · Riesgo: low**. Mejora type-safety, sin runtime change.

## 5. Limpiar las 6 lint warnings restantes

Todas triviales — probablemente 15 min combinadas.

- `public/sw.js:13, :24` — `event` unused en service worker (renombrar a `_event` o usarlo)
- `scripts/timelapse/milestones.mjs:24` — `existsSync` import unused (`eslint --fix`)
- `src/app/admin/alarms/page.tsx:12` — `Badge` import unused (`eslint --fix`)
- `src/app/admin/whatsapp/submit-templates-button.tsx:82` — disable directive sin warning subyacente
- `src/app/api/admin/tuya/inspect-rooms/route.ts:61` — `e` unused en `catch` (renombrar a `_e`)

**Esfuerzo: S · Riesgo: low**.

## 6. Revisar `scripts/timelapse/`

Directorio con scripts que no aparecen en `package.json`. Confirmar si:
- Sigue siendo invocado desde algún workflow (`timelapse.yml`)
- Si solo se corrió una vez y quedó como artifact

Si es lo segundo: mover a `_archive/` o borrar.

**Esfuerzo: S · Riesgo: low**.

## Lo que NO va en el backlog

Cosas que el audit mencionó pero ya se descartaron:

- **`_archive/*`**: lo movió Wiki ahí intencionalmente; mantenerlo
- **`shadcn` devDep move**: hecho en batch 1 (commit `6b9536c`)
- **`pdf-parse`**: confirmado en uso por `src/lib/bills/parse-pdf.ts` ✅
- **Migrar a pnpm / Prisma / otro stack**: out of scope, el stack es deliberadamente lean

## Referencias

- Audit completo: ver historial de la sesión que produjo los commits `6b9536c..a5ed6bb`
- Convenciones del repo: [AGENTS.md](../AGENTS.md)
- Reglas para el worker autónomo durante vacaciones: [CLAUDE.md](../CLAUDE.md)
