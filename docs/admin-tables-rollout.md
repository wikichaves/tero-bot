# Administration tables and Geist Serif

## Changes

- Users: Name first, actions last; all six data headers toggle ascending/descending order. Locale-aware name/text ordering, chronological ISO dates, missing values last, stable ID ties. Existing role/scope permissions stay server-side.
- Properties: pointer/touch drag handles, keyboard up/down keys, Escape/pointer cancellation, pending-state lock, error recovery. Complete order saved atomically through an admin-only SECURITY INVOKER RPC. No properties are reordered during implementation.
- Typography: official Geist Serif Regular, plus self-hosted existing Sans/Mono to remove Google build network dependence. OFL included.

## Rollout

1. Review SQL section `Admin property drag order` in `supabase/schema.sql` and apply only that section before deploying this UI (`npm run db:apply -- --section "Admin property drag order"`). No schema or data change has been applied to production in this work.
2. Verify the RPC under a real authenticated admin transaction; unauthorized callers, duplicate IDs and stale property sets must fail, and the full sort order must be atomic. This live DB verification remains pending; the browser fixture does not prove database persistence.
3. Deploy after review. In authenticated UI, reorder and reload, verify other lists, and test mobile touch. Never change a live property order merely for testing without restoring it.

## Verification

- ESLint, TypeScript, production build.
- Isolated browser fixture using real components and synthetic data: name/date sorting, pointer reorder, keyboard reorder, no page-level overflow at 768px and 390px. Server action boundary is stubbed only in the external fixture; this is not a database mock or a claim of production persistence.
- Fonts downloaded from official GitHub contents API and verified by Git blob SHA.
