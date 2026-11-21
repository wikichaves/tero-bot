# Agency availability — review / rollout

## Scope and ownership

Wikibot implements directly (Wiki, 2026-11-21). No Linear/Rubencito dependency.
Base verified through GitHub REST: `716d1950a558db91485abd5d8ae1d58c1645be72`.
No production changes, messages, invitations or real calendar changes performed.

- `/admin/agencies`: admin-only account creation, property grants/revocation,
  nightly seasonal rates, local blocks, private iCal link creation/rotation/revocation.
- `/availability`: separate read-only portal; admin can inspect all rental homes.
  Agencies see only assigned homes, dates, rates and sync health. No guest PII,
  earnings, property integration URLs or operational data is returned.
- All existing rental properties are reused. Operator assigns the five Uruguay
  homes and Buenos Aires home by actual identity; no records/prices fabricated.
- Mobile displays one home selected by filter; desktop can display every home.
- Rates and blocks use end-exclusive local dates, explicit USD/UYU/ARS currency.
  Editing an interval is remove/recreate; overlap fails at DB level under a
  per-property transaction advisory lock, shared with manual reservation writes.
- Account is initially banned until role and grants have been fully provisioned.
  No email is automatically sent. Admin distributes credentials privately.

## Integration and safety

Existing Airbnb sync now validates a complete DATE-only snapshot and saves busy
ranges, including blocks, atomically. Timed or recurring events fail closed.
The previous snapshot survives fetch/parse/database failures. A failed, missing,
changed-source or older-than-six-hours sync never advertises unoccupied days as
available. Properties with a Booking.com feed are explicitly unconfirmed (this
feature does not implement Booking sync). Manual-only properties use local data.

Existing noncancelled reservations are always busy, including emails arriving
before the next iCal refresh. Removed iCal events cancel only Airbnb reservations
previously observed in a successful snapshot; pre-existing/email-only records
are retained conservatively. Historical stale records may require operator review.

Exports contain only manual reservations and local blocks. Imported events are
never re-exported. UIDs are stable; reflected events preserving our UID are
ignored. No guest names, descriptions or prices enter exports. Removing a block
removes its event from the next full feed; verify Airbnb's deletion behavior in
staging before relying on it. Third-party UID rewriting may leave a conservative
imported busy interval until their next refresh; no instant synchronization is
promised. Tokens are random 256-bit values, stored only as hashes, shown once,
revocable, non-cacheable; hosting request logs may contain their URL.

Agency DB role is isolated by restrictive RLS across public tables and Storage;
profiles permit only self-read for agencies, never role/grant edits. New domain
tables and RPCs are service-role-only. Adding future operational tables requires
preserving the agency isolation policy. Portal reads authenticate every request,
check active membership, filter property IDs before fetching and return only an
explicit safe projection. Do not use profile_properties for agency grants.

## Validation performed locally

- `node --import tsx --test tests/availability.test.ts`: 10/10 passed.
- `npm run lint`: passed.
- `npx tsc --noEmit`: passed.
- Next build passed **with test-only substituted font CSS and placeholder Supabase
  environment**. Normal build is blocked downloading Google Fonts. No application
  files/fonts were altered for this workaround; not a production-ready build.
- Real SQL regression suite: `tests/sql/run-agency-sql.sh` passes against the
  prepared `tero-agency-tests` PostgreSQL container, including rollback of
  reservations/placeholders, successful replacement, idempotency, cancelled and
  local UID filtering, cross-property UID collision rejection, and concurrency.
  This is a bootstrap-minimal database test, not an end-to-end Supabase test.
- Authenticated mobile/desktop interaction and end-to-end Airbnb imports/exports
  remain **unverified**. No production DB used.

## Required before activation

1. Review auth, RLS, trigger locks and existing privileged API/RPC entry points.
   Paths covered by CODEOWNERS require independent review. No merge/deploy yet.
2. Apply only `Agency availability` from schema.sql to an isolated Supabase test
   project; never replay the whole production schema. Enum comparisons use text,
   allowing enum addition and this section in one transaction.
3. Use real test accounts (admin, agency A/B, revoked agency, staff); verify portal
   access, tampered property IDs, direct REST access to reservations/profiles/
   expenses/devices/storage, server actions and active-session revocation.
4. Concurrent inserts: overlapping blocks/manual stays and same-property rates
   must yield one success and one 23P01; adjacent checkout/check-in must succeed.
   Verify existing gestor reservation edits still work via security-definer trigger.
5. Exercise snapshot replacement/cancellation/error recovery and fresh/six-hour/
   URL-change transitions. Confirm empty feed only clears after valid VCALENDAR.
6. Render and interact at 360/390/768/1440 px, ES/EN. Test real login, filters,
   blocked dates, contact creation, saving/revocation and signout without overflow.
7. On explicit production authorization: incremental schema first, deploy exact
   reviewed SHA second; confirm successful sync before issuing agency credentials.
   Configure existing six homes/contacts/rates manually; import generated private
   links into Airbnb explicitly and verify actual round-trip, delay and cancellation.

## Rollback

Revoke feeds and disable agencies before rolling code back. Keep agency role/RLS
isolation in place: old code must not grant portal users operational privileges.
Do not drop tables or delete production business data during rollback.
