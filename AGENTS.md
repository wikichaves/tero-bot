<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version (16.2.4) has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# tero-bot — agent orientation

A modular property-management system for a 4-house vacation rental complex. One operator. Capabilities split into domain modules: WhatsApp/Telegram bots, Tuya IoT (locks, thermostats, sensors), Airbnb iCal sync, energy/bill parsing, pre-checkin HVAC conditioning, sensor alarms, tasks. See [README.md](README.md) for full philosophy and module breakdown.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 + shadcn/ui · Supabase (Postgres + Auth + RLS) · next-intl (es/en) · Vercel (hosting + cron) · zod · npm (`package-lock.json`). No test framework set up.

## Map

| Path | What lives here |
|---|---|
| `src/app/*` | App Router pages (server components by default) |
| `src/app/<feature>/actions.ts` | Server actions for mutations |
| `src/app/api/*/route.ts` | API routes (webhooks, cron, admin) |
| `src/app/api/cron/<name>/route.ts` | Vercel scheduled jobs |
| `src/lib/<domain>/` | Domain modules: `whatsapp`, `telegram`, `airbnb`, `tuya`, `energy`, `bills`, `tasks`, `sensors`, `inbound`, `pre-checkin`, `linear`, `github`, `auth` |
| `src/lib/supabase/` | DB clients: `client.ts` (browser), `server.ts` (RSC/actions), `admin.ts` (service role), `middleware.ts` |
| `src/lib/util/cron-log.ts` | Structured cron logging (use in every cron) |
| `src/i18n/` + `messages/{en,es}.json` | next-intl setup |
| `supabase/schema.sql` | Source-of-truth DB schema |
| `scripts/*.ts` | One-off operational scripts (tsx-runnable) |
| `vercel.json` | Vercel cron schedule registry |
| `docs/WIK-*.md` | Ticket-scoped design docs |
| `CODEOWNERS` | Paths that require manual review (block auto-merge) |

## Patterns

**Server actions** — preferred for mutations. Pattern: `"use server"` at top, zod schema for input, `createAdminClient` from `@/lib/supabase/admin`, `requireRole` from `@/lib/auth` for permission checks. See `src/app/bills/actions.ts` for a canonical example.

**Crons** — add to `vercel.json` (`{"path": "/api/cron/<name>", "schedule": "..."}`) AND create `src/app/api/cron/<name>/route.ts`. Every cron MUST:
- Check `Bearer ${process.env.CRON_SECRET}` and return 401 if missing/mismatched
- Use `createAdminClient` from `@/lib/supabase/admin`
- Emit a single structured log via `cron-log.ts` helpers (`logCronSnapshot` etc.) — filterable in Vercel Logs by event name

**Webhooks** (`/api/whatsapp`, `/api/telegram`, `/api/inbound`) — verify signature/secret first, dispatch to handler in `src/lib/<domain>/`.

**i18n** — strings live in `messages/{en,es}.json`. Don't hardcode UI text in components. `useTranslations` (client) / `getTranslations` (server).

**Supabase** — never write standalone migration files. Edit `supabase/schema.sql` → `npm run db:check` (preview diff) → `npm run db:apply`. RLS policies are part of `schema.sql`.

**Modules are siloed** — `src/lib/<domain>/` modules don't reach across each other. Cross-domain orchestration happens at the route / action / cron layer, not inside `lib/`.

**Branches & PRs** — Claude work goes on `claude/WIK-XXX` branches. PRs target `main`. CI (`ci.yml`) is the merge gate; `claude-worker.yml` is the autonomous worker (one ticket at a time, no auto-merge).

## Don'ts

- Don't add a dependency without a clear reason — the stack is intentionally lean.
- Don't write SQL migrations as standalone files — edit `supabase/schema.sql`.
- Don't bypass `cron-log` in cron handlers (kills observability).
- Don't bypass the `CRON_SECRET` check on cron routes.
- Don't reach across domain modules from inside `src/lib/` — orchestrate at the route/action layer.
- Don't auto-merge changes to paths listed in `CODEOWNERS` (whatsapp, telegram, linear, github, tuya, bills, airbnb, sensors, alarm-reminders, supabase, auth, api routes, schema, deploy config).
- Don't mock the DB in tests (when tests get added, they hit a real DB).
- Don't commit without `npm run lint` clean.

## Commands

```bash
npm run dev                    # local dev (auto-regen landing stats)
npm run build                  # prod build
npm run lint                   # eslint
npm run db:check               # preview schema diff vs Supabase
npm run db:apply               # apply schema.sql
npm run wa:templates:status    # check WhatsApp template approval state
npm run wa:templates:submit:dry
npm run airbnb:status          # recent Airbnb iCal sync state
npm run airbnb:reprocess:dry
npm run stats:landing          # regenerate landing stats JSON
```
