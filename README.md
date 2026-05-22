# Tero Admin

Open-source admin panel for **multi-property short-term rental operations**.
Pulls together the messy day-to-day of running a handful of Airbnb-style
properties — reservations, cleaning tasks, smart locks, energy meters,
T/H sensors, utility bills, WhatsApp comms with guests and staff — and
puts it under a single roof.

> ⚠️ **Work in progress.** This started as a private tool for a single
> two-property operator in Uruguay (Acme Rentals). It's now being
> generalized so others can self-host. Expect rough edges, hardcoded
> assumptions you'll need to unpick, and breaking changes. PRs welcome.

## What it does (today)

- **Dashboard** — today / tomorrow check-ins and check-outs at a glance.
- **Reservations** — synced from Airbnb iCal + enriched from forwarded
  Airbnb confirmation emails (via Postmark Inbound).
- **Tasks** — cleaning / maintenance / supplies, assignable to staff,
  with WhatsApp reminders X hours before due.
- **Smart locks** — Tuya integration: per-reservation temp passcodes
  generated and revoked automatically (offline + online locks).
- **Energy** — per-device meter snapshots from Tuya, daily reports,
  per-property and per-circuit consumption views.
- **Sensors (T/H)** — Tuya humidity/temperature sensors grouped by
  "ambiente", threshold alarms via WhatsApp.
- **Pre-checkin climate** — when a check-in is 2h away and the property
  is too cold/hot, send the operator a WhatsApp with [Sí] / [No] buttons
  to fire a Tuya scene that turns on HVAC.
- **Utility bills** — forward your provider's email to a Postmark
  Inbound alias, get the PDF parsed and the row created automatically
  (UTE, OSE, Antel, Edenor, AySA, Personal Flow, Prosegur supported).
- **WhatsApp bot** ("Tero Bot") — staff can request task lists, daily
  consumption reports, create tasks by sending a photo, etc. Pre-approved
  Meta templates for outbound notifications.

## Stack

- **Framework**: Next.js 16 (App Router) + React 19 + TypeScript
- **Styling**: Tailwind v4 + shadcn/ui (mint green theme, dark/light)
- **Data**: Supabase (Postgres + Auth + Storage + RLS)
- **Hosting**: Vercel (Cron, Edge functions). Anywhere else that runs
  Next 16 should work too.
- **Integrations**: Tuya Cloud (smart locks + smart-home), Kapso (BSP
  over Meta WhatsApp Cloud API), Postmark (inbound email parsing).

## Quick start

```bash
git clone https://github.com/<you>/example-admin.git
cd example-admin
npm install
cp .env.example .env.local   # fill in at least Supabase + branding
```

Create a Supabase project, then in the SQL editor run the contents of
`supabase/schema.sql`. Or, if you've set `DATABASE_URL` in `.env.local`
(Session Pooler URI from Supabase Settings → Connect):

```bash
npm run db:check   # dry-run, prints what would change
npm run db:apply   # applies the full schema (idempotent)
```

Create the first admin via Supabase Dashboard → Authentication → Users.
Then in the `profiles` table, set `role = 'admin'` for that user.

```bash
npm run dev   # → http://localhost:3000
```

## Configuration

All operator-specific values come from environment variables — the
codebase has no hardcoded business names, URLs, or branding. See
[`.env.example`](.env.example) for the full list with inline docs.

The bare minimum to boot:

| Env var | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key (server-side only) |
| `NEXT_PUBLIC_OPERATOR_NAME` | Your business name (shown in UI/WA) |
| `NEXT_PUBLIC_APP_URL` | e.g. `https://admin.example.com` |

Optional but recommended for the integrations you'll actually use:
`TUYA_*`, `KAPSO_*`, `POSTMARK_INBOUND_*`, `CRON_SECRET`.

## Roles

| Role | Capabilities |
|---|---|
| `admin` | Everything. Manages users, properties, reservations, tasks, integrations. |
| `gestor` | Operations manager. Reservations + tasks, scoped to assigned properties. |
| `limpieza` / `mantenimiento` | Staff. See & update assigned tasks. Can report supplies/damage via WhatsApp. |

## Project structure

```
src/
  app/
    dashboard/              # main protected view (today's check-ins, etc.)
    reservations/           # CRUD + Airbnb iCal sync
    tasks/                  # task list + create/edit
    energy/, ambientes/     # Tuya energy + sensor dashboards
    facturas/               # utility bills
    api/
      cron/                 # daily reports, alarm reminders, etc.
      inbound/              # Postmark webhook (Airbnb emails + bills)
      whatsapp/             # Kapso webhook (Tero Bot)
  lib/
    supabase/               # server/browser/middleware clients
    tuya/, whatsapp/, etc.  # integration helpers
    brand.ts                # env-var-backed branding (operator name, etc.)
supabase/
  schema.sql                # full DB schema (idempotent, sectioned)
docs/                       # design notes (historical, written for original operator)
```

## Self-hosting

The repo is set up for Vercel — `vercel.json` declares the cron schedule
and the build step is the default `next build`. Any host that runs
Next.js 16 works (Render, Railway, fly.io, your own VPS).

For the integrations, each one is **optional**. If you don't set the
relevant env vars, the corresponding feature just no-ops:

- **No Tuya?** Smart-lock, energy, and sensor features become passive
  (you can still enter readings manually).
- **No WhatsApp/Kapso?** The bot endpoints stay dormant; the rest of
  the app works fine.
- **No Postmark?** Airbnb iCal sync still works — you just won't get
  enriched guest data (count, payout, message) until you set inbound up.

See `docs/` for design notes on the original spike (historical, written
for the original operator — kept as a real-world example).

## Contributing

This is being open-sourced as I generalize it. If you want to use it
for your own properties:

1. Fork the repo, clone, set up `.env.local`.
2. Open issues for anything that's too hardcoded to the original
   operator (date/currency formats, locale strings, country-specific
   utility providers).
3. PRs welcome — small focused ones preferred.

If you're a property manager with a non-Uruguay setup interested in
self-hosting, ping me — extending to support your locale / providers /
WhatsApp BSP is exactly the kind of feedback that's needed.

## License

[MIT](./LICENSE) — do what you want, no warranty.
