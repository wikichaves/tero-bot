-- Acme Rentals — Admin schema
-- Run in Supabase SQL editor (or via supabase CLI) on a fresh project.

-- Roles enum
do $$ begin
  create type user_role as enum ('admin', 'gestor', 'limpieza', 'mantenimiento');
exception when duplicate_object then null; end $$;

do $$ begin
  create type reservation_source as enum ('airbnb', 'booking', 'manual');
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_kind as enum ('limpieza', 'mantenimiento', 'insumos', 'otro');
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_status as enum ('pending', 'in_progress', 'done');
exception when duplicate_object then null; end $$;

-- Profiles (extends auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  role user_role not null default 'gestor',
  whatsapp text,
  created_at timestamptz not null default now()
);

-- IMPORTANT: do NOT read `role` from raw_user_meta_data here. That field is
-- attacker-controlled at signup time (Supabase's public signup endpoint accepts
-- arbitrary metadata with only the anon key). Allowing it would let anyone
-- self-register as 'admin'. Roles are always assigned by an admin server action
-- via the service-role client AFTER the auth user is created — see
-- src/app/admin/users/actions.ts.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', null),
    'gestor'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Properties
create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  airbnb_ical_url text,
  booking_ical_url text,
  currency text not null default 'UYU' check (currency ~ '^[A-Z]{3}$'),
  tariff_per_kwh numeric,
  created_at timestamptz not null default now()
);

-- Backfill columns for projects that had `properties` from before WIK-41:
alter table public.properties
  add column if not exists currency text not null default 'UYU'
    check (currency ~ '^[A-Z]{3}$'),
  add column if not exists tariff_per_kwh numeric;

-- Reservations
create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  guest_name text,
  guest_phone text,
  check_in date not null,
  check_out date not null,
  source reservation_source not null default 'manual',
  external_id text,
  notes text,
  created_at timestamptz not null default now(),
  unique (source, external_id)
);

create index if not exists reservations_check_in_idx on public.reservations(check_in);
create index if not exists reservations_check_out_idx on public.reservations(check_out);

-- Tasks (cleaning, maintenance, supplies)
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  kind task_kind not null,
  status task_status not null default 'pending',
  title text not null,
  description text,
  assigned_to uuid references public.profiles(id) on delete set null,
  reported_by uuid references public.profiles(id) on delete set null,
  due_date date,
  created_at timestamptz not null default now()
);

create index if not exists tasks_property_idx on public.tasks(property_id);
create index if not exists tasks_assigned_idx on public.tasks(assigned_to);

-- Helper: current user's role
create or replace function public.current_role()
returns user_role
language sql stable security definer set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- Row Level Security
alter table public.profiles enable row level security;
alter table public.properties enable row level security;
alter table public.reservations enable row level security;
alter table public.tasks enable row level security;

-- profiles
drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles
  for select using (auth.uid() = id or public.current_role() = 'admin');

drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles
  for all using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

-- properties: admin/gestor read+write. Limpieza/mantenimiento don't read
-- properties directly (avoids leaking iCal URLs); they get property name via
-- the tasks they're assigned to (denormalized when needed).
drop policy if exists properties_read on public.properties;
create policy properties_read on public.properties
  for select using (public.current_role() in ('admin', 'gestor'));

drop policy if exists properties_write on public.properties;
create policy properties_write on public.properties
  for all using (public.current_role() in ('admin', 'gestor'))
  with check (public.current_role() in ('admin', 'gestor'));

-- reservations: admin/gestor full; limpieza/mantenimiento read only
drop policy if exists reservations_read on public.reservations;
create policy reservations_read on public.reservations
  for select using (auth.role() = 'authenticated');

drop policy if exists reservations_write on public.reservations;
create policy reservations_write on public.reservations
  for all using (public.current_role() in ('admin', 'gestor'))
  with check (public.current_role() in ('admin', 'gestor'));

-- tasks: admin/gestor full; limpieza/mantenimiento can read+update tasks assigned to them
drop policy if exists tasks_read on public.tasks;
create policy tasks_read on public.tasks
  for select using (
    public.current_role() in ('admin', 'gestor')
    or assigned_to = auth.uid()
    or reported_by = auth.uid()
  );

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert with check (
    public.current_role() in ('admin', 'gestor')
    or reported_by = auth.uid()
  );

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update using (
    public.current_role() in ('admin', 'gestor') or assigned_to = auth.uid()
  );

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks
  for delete using (public.current_role() = 'admin');

-- ────────────────────────────────────────────────────────────────────────
-- WhatsApp persistence (added 2026-05-01). The webhook at /api/whatsapp
-- writes here using the service-role client (bypasses RLS); reading is
-- restricted to admin/gestor.

create table if not exists public.whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  phone_number text not null unique,
  display_name text,
  audience text not null default 'unknown'
    check (audience in ('guest', 'staff', 'unknown')),
  profile_id uuid references public.profiles(id) on delete set null,
  last_message_at timestamptz,
  last_message_text text,
  last_message_direction text
    check (last_message_direction in ('inbound', 'outbound')),
  unread_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists whatsapp_conversations_last_message_idx
  on public.whatsapp_conversations(last_message_at desc nulls last);

create table if not exists public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.whatsapp_conversations(id)
    on delete cascade,
  external_id text unique,
  direction text not null check (direction in ('inbound', 'outbound')),
  type text not null default 'text',
  body text,
  media_url text,
  template_name text,
  status text,
  raw jsonb,
  sent_at timestamptz not null default now()
);

create index if not exists whatsapp_messages_conversation_idx
  on public.whatsapp_messages(conversation_id, sent_at desc);

alter table public.whatsapp_conversations enable row level security;
alter table public.whatsapp_messages enable row level security;

drop policy if exists whatsapp_conversations_read on public.whatsapp_conversations;
create policy whatsapp_conversations_read on public.whatsapp_conversations
  for select using (public.current_role() in ('admin', 'gestor'));

drop policy if exists whatsapp_conversations_write on public.whatsapp_conversations;
create policy whatsapp_conversations_write on public.whatsapp_conversations
  for all using (public.current_role() in ('admin', 'gestor'))
  with check (public.current_role() in ('admin', 'gestor'));

drop policy if exists whatsapp_messages_read on public.whatsapp_messages;
create policy whatsapp_messages_read on public.whatsapp_messages
  for select using (public.current_role() in ('admin', 'gestor'));

drop policy if exists whatsapp_messages_write on public.whatsapp_messages;
create policy whatsapp_messages_write on public.whatsapp_messages
  for all using (public.current_role() in ('admin', 'gestor'))
  with check (public.current_role() in ('admin', 'gestor'));

-- ────────────────────────────────────────────────────────────────────────
-- Property ↔ Tuya device mapping (added 2026-05-07). Lets us know which
-- physical device serves which property — e.g. "Puerta Principal" lock is
-- the primary lock for "Acme Rentals". One Tuya device belongs to
-- at most one property; a property can have many devices of different
-- kinds, but only one primary per kind.

create table if not exists public.property_devices (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  tuya_device_id text not null unique,
  tuya_device_name text,
  device_kind text not null check (
    device_kind in ('lock', 'thermostat', 'light', 'switch', 'camera', 'other')
  ),
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists property_devices_property_idx
  on public.property_devices(property_id);
create index if not exists property_devices_kind_idx
  on public.property_devices(device_kind);

-- Only one primary device per (property, kind).
create unique index if not exists property_devices_primary_idx
  on public.property_devices(property_id, device_kind)
  where is_primary;

alter table public.property_devices enable row level security;

drop policy if exists property_devices_read on public.property_devices;
create policy property_devices_read on public.property_devices
  for select using (public.current_role() in ('admin', 'gestor'));

drop policy if exists property_devices_write on public.property_devices;
create policy property_devices_write on public.property_devices
  for all using (public.current_role() in ('admin', 'gestor'))
  with check (public.current_role() in ('admin', 'gestor'));

-- ────────────────────────────────────────────────────────────────────────
-- Lock temp passwords (added 2026-05-07). Tuya doesn't expose a GET
-- endpoint to list offline temp passwords on a lock — we have to keep
-- our own ledger. Each row records what we created via Tuya so we can
-- show active codes, link them to reservations, and revoke them later.

create table if not exists public.lock_passwords (
  id uuid primary key default gen_random_uuid(),
  property_device_id uuid not null
    references public.property_devices(id) on delete cascade,
  reservation_id uuid references public.reservations(id) on delete set null,
  name text not null,
  password text not null,
  tuya_password_id text not null,
  effective_time timestamptz not null,
  invalid_time timestamptz not null,
  status text not null default 'active'
    check (status in ('active', 'revoked', 'expired')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists lock_passwords_device_idx
  on public.lock_passwords(property_device_id);
create index if not exists lock_passwords_reservation_idx
  on public.lock_passwords(reservation_id);
create index if not exists lock_passwords_status_idx
  on public.lock_passwords(status, invalid_time);

alter table public.lock_passwords enable row level security;

drop policy if exists lock_passwords_read on public.lock_passwords;
create policy lock_passwords_read on public.lock_passwords
  for select using (public.current_role() in ('admin', 'gestor'));

drop policy if exists lock_passwords_write on public.lock_passwords;
create policy lock_passwords_write on public.lock_passwords
  for all using (public.current_role() in ('admin', 'gestor'))
  with check (public.current_role() in ('admin', 'gestor'));

-- ────────────────────────────────────────────────────────────────────────
-- Energy snapshots (added 2026-05-07). Hourly captures of each property
-- device's instantaneous reading + cumulative kWh. Lets us compute real
-- daily/weekly consumption (not just projections from current power).

create table if not exists public.energy_snapshots (
  id uuid primary key default gen_random_uuid(),
  property_device_id uuid not null
    references public.property_devices(id) on delete cascade,
  power_w numeric,
  total_energy_kwh numeric,
  voltage_v numeric,
  current_a numeric,
  taken_at timestamptz not null default now()
);

create index if not exists energy_snapshots_device_taken_idx
  on public.energy_snapshots(property_device_id, taken_at desc);

-- Idempotency: at most one snapshot per device per hour.
create unique index if not exists energy_snapshots_unique_hourly
  on public.energy_snapshots(
    property_device_id,
    date_trunc('hour', taken_at)
  );

alter table public.energy_snapshots enable row level security;

drop policy if exists energy_snapshots_read on public.energy_snapshots;
create policy energy_snapshots_read on public.energy_snapshots
  for select using (public.current_role() in ('admin', 'gestor'));

drop policy if exists energy_snapshots_write on public.energy_snapshots;
create policy energy_snapshots_write on public.energy_snapshots
  for all using (public.current_role() in ('admin', 'gestor'))
  with check (public.current_role() in ('admin', 'gestor'));

-- ────────────────────────────────────────────────────────────────────────
-- Airbnb inbound email enrichment (added 2026-05-12). The iCal feed only
-- gives dates + a reservation code (HM…); confirmation emails carry the
-- rest (guest name, count, payout). A Postmark Inbound webhook at
-- /api/inbound/airbnb parses these and writes into the columns below.

do $$ begin
  create type reservation_status as enum ('confirmed','cancelled','altered');
exception when duplicate_object then null; end $$;

alter table public.reservations
  add column if not exists reservation_code text,
  add column if not exists guest_count int,
  add column if not exists payout_amount numeric,
  add column if not exists payout_currency text
    check (payout_currency is null or payout_currency ~ '^[A-Z]{3}$'),
  add column if not exists guest_message text,
  add column if not exists status reservation_status not null default 'confirmed';

create index if not exists reservations_code_idx
  on public.reservations(reservation_code);

-- Raw inbound payload retention for debug + replay. Purged at 30 days by
-- /api/cron/inbound-purge so we don't accumulate PII.
create table if not exists public.airbnb_inbound_emails (
  id uuid primary key default gen_random_uuid(),
  message_id text unique,
  reservation_id uuid references public.reservations(id) on delete set null,
  parsed_kind text,
  parsed jsonb,
  raw jsonb,
  received_at timestamptz not null default now()
);

create index if not exists airbnb_inbound_emails_received_at_idx
  on public.airbnb_inbound_emails(received_at desc);

alter table public.airbnb_inbound_emails enable row level security;

drop policy if exists airbnb_inbound_emails_admin_read
  on public.airbnb_inbound_emails;
create policy airbnb_inbound_emails_admin_read
  on public.airbnb_inbound_emails
  for select using (public.current_role() in ('admin','gestor'));

-- No write policy: only the service-role client (route handler) writes here.

-- ────────────────────────────────────────────────────────────────────────
-- Airbnb listing matching + guest photo (added 2026-05-12 follow-up).
-- Lets the inbound email parser match a reservation to a property by the
-- numeric Airbnb listing id (more stable than fuzzy-matching the display
-- name), and lets us render the guest's Airbnb profile photo on the
-- reservation detail page.

alter table public.properties
  add column if not exists airbnb_listing_id text;

create index if not exists properties_airbnb_listing_id_idx
  on public.properties(airbnb_listing_id);

alter table public.reservations
  add column if not exists guest_photo_url text;

-- ────────────────────────────────────────────────────────────────────────
-- Richer Airbnb reservation data (added 2026-05-12 second follow-up).
-- Lets the dashboard render guest verification status, location, the full
-- adult/child/infant breakdown, and the check-in / check-out times that
-- Airbnb advertises (which the admin can override if the guest arranged
-- a different schedule).

alter table public.reservations
  add column if not exists guest_identity_verified boolean,
  add column if not exists guest_location text,
  add column if not exists guest_adults int,
  add column if not exists guest_children int,
  add column if not exists guest_infants int,
  add column if not exists check_in_time text
    check (check_in_time is null or check_in_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  add column if not exists check_out_time text
    check (check_out_time is null or check_out_time ~ '^[0-2][0-9]:[0-5][0-9]$');

-- ────────────────────────────────────────────────────────────────────────
-- Utility bills (WIK-62, added 2026-05-14). Forward facturas de luz/agua/
-- internet/alarma a bills@inbound.example.com → Postmark inbound
-- → /api/inbound (router) → /api/inbound/bills (handler). El parser hace
-- best-effort por proveedor (UTE/OSE/Antel/Prosegur/Edenor/AySA/Telecentro)
-- y deja el resto editable manual en /facturas.

do $$ begin
  create type utility_type as enum (
    'luz', 'agua', 'internet', 'alarma', 'otro'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type bill_status as enum (
    'pending', 'paid', 'overdue', 'cancelled'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.bill_inbound_emails (
  id uuid primary key default gen_random_uuid(),
  message_id text unique,
  parsed_kind text,         -- 'matched' | 'partial' | 'unknown'
  provider_hint text,       -- detectado por sender domain (ute, ose, antel, ...)
  utility_type_hint text,
  property_hint uuid references public.properties(id) on delete set null,
  parsed jsonb,
  raw jsonb,
  attachment_paths jsonb,   -- ["bills/<uuid>/factura.pdf", ...] en Storage
  received_at timestamptz not null default now()
);

create index if not exists bill_inbound_emails_received_at_idx
  on public.bill_inbound_emails(received_at desc);

create table if not exists public.utility_bills (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  utility_type utility_type not null,
  provider text not null,        -- 'UTE', 'OSE', 'Antel', 'Prosegur', 'Edenor', 'AySA', 'Telecentro', 'Otro'
  amount numeric,                -- nullable hasta que se complete manual
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  period_from date,
  period_to date,
  issue_date date,
  due_date date,
  paid_at date,
  status bill_status not null default 'pending',
  kwh_billed numeric,            -- solo aplica a luz
  m3_billed numeric,             -- solo aplica a agua
  account_number text,           -- nº de cuenta / contrato del proveedor
  invoice_number text,           -- nº de factura
  inbound_email_id uuid references public.bill_inbound_emails(id) on delete set null,
  pdf_path text,                 -- path en Storage (bucket 'bill-attachments')
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists utility_bills_property_idx
  on public.utility_bills(property_id, period_to desc nulls last);
create index if not exists utility_bills_type_idx
  on public.utility_bills(utility_type);
create index if not exists utility_bills_status_idx
  on public.utility_bills(status, due_date);

create or replace function public.utility_bills_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists utility_bills_updated_at_trg on public.utility_bills;
create trigger utility_bills_updated_at_trg
  before update on public.utility_bills
  for each row execute function public.utility_bills_set_updated_at();

alter table public.bill_inbound_emails enable row level security;
alter table public.utility_bills enable row level security;

drop policy if exists bill_inbound_emails_admin_read on public.bill_inbound_emails;
create policy bill_inbound_emails_admin_read on public.bill_inbound_emails
  for select using (public.current_role() in ('admin', 'gestor'));

drop policy if exists utility_bills_read on public.utility_bills;
create policy utility_bills_read on public.utility_bills
  for select using (public.current_role() in ('admin', 'gestor'));

drop policy if exists utility_bills_write on public.utility_bills;
create policy utility_bills_write on public.utility_bills
  for all using (public.current_role() in ('admin', 'gestor'))
  with check (public.current_role() in ('admin', 'gestor'));

-- Storage bucket para adjuntos (PDFs). Crear manualmente en Supabase
-- Studio si esta línea falla (versiones viejas no exponen storage.buckets
-- desde SQL editor):
insert into storage.buckets (id, name, public)
values ('bill-attachments', 'bill-attachments', false)
on conflict (id) do nothing;

-- Solo admin/gestor pueden bajar adjuntos.
drop policy if exists bill_attachments_read on storage.objects;
create policy bill_attachments_read on storage.objects
  for select using (
    bucket_id = 'bill-attachments'
    and public.current_role() in ('admin', 'gestor')
  );
