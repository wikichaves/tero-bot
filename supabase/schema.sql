-- tero.bot — schema
-- Run in Supabase SQL editor (or via supabase CLI) on a fresh project.

-- Roles enum
--
-- WIK-74: `limpieza` quedó DEPRECADO y unificado en `mantenimiento`. El valor
-- sigue presente en el enum porque Postgres no permite removerlo sin
-- recrear todas las columnas que lo usan; en cambio, hay un CHECK
-- constraint en `profiles` que bloquea nuevas escrituras del valor viejo
-- (ver más abajo). Los profiles existentes con role=limpieza fueron
-- migrados a mantenimiento.
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

-- WIK-74: bloquea el valor 'limpieza' (deprecado, unificado en mantenimiento).
alter table public.profiles
  drop constraint if exists profiles_role_not_limpieza;
alter table public.profiles
  add constraint profiles_role_not_limpieza
  check (role::text <> 'limpieza');

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
-- the primary lock for property "Casa A". One Tuya device belongs to
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
-- date_trunc on timestamptz is NOT marked IMMUTABLE in modern Postgres
-- (because it depends on session timezone). Pinning to UTC explicitly
-- via `timezone('UTC', taken_at)` makes the expression deterministic
-- and indexable. Otherwise the CREATE INDEX fails with 42P17.
create unique index if not exists energy_snapshots_unique_hourly
  on public.energy_snapshots(
    property_device_id,
    (date_trunc('hour', timezone('UTC', taken_at)))
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
-- internet/alarma a bills@<inbound-domain> → Postmark inbound
-- → /api/inbound (router) → /api/inbound/bills (handler). El parser hace
-- best-effort por proveedor (UTE/OSE/Antel/Prosegur/Edenor/AySA/Telecentro)
-- y deja el resto editable manual en /bills.

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
  /** Texto crudo extraído de los PDFs adjuntos (concatenado), para
   *  iterar regex landmarks contra samples reales sin tener que
   *  descargar los PDFs uno por uno. Nullable porque rows viejas
   *  no lo tienen. */
  pdf_text_extract text,
  received_at timestamptz not null default now()
);

alter table public.bill_inbound_emails
  add column if not exists pdf_text_extract text;

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

-- ────────────────────────────────────────────────────────────────────────
-- Provider account mapping (WIK-65). Cuando hay múltiples propiedades con
-- la misma currency (5 propiedades UYU, p. ej.), no podemos desambiguar
-- la propiedad por currency sola. Cada proveedor da un número de cuenta /
-- cliente único por propiedad — mapeamos provider → account_number aquí,
-- y el inbound handler lo consulta para asignar la factura a la propiedad
-- correcta. Forma: {"UTE": "4131911000", "OSE": "12345", ...}.
alter table public.properties
  add column if not exists provider_accounts jsonb not null default '{}'::jsonb;

create index if not exists properties_provider_accounts_idx
  on public.properties using gin (provider_accounts);

-- ────────────────────────────────────────────────────────────────────────
-- Property sort order (WIK-64). Permite al admin reordenar manualmente
-- las propiedades en /admin/properties. Default 0; al insertar via UI
-- se asigna max(sort_order)+1 para que las nuevas queden al final.
alter table public.properties
  add column if not exists sort_order int not null default 0;

-- ────────────────────────────────────────────────────────────────────────
-- WIK-82: Sensores Tuya T/H por ambiente + histórico + alarmas.
--
-- Esquema mínimo para el feature de sensores de temperatura/humedad.
-- Mirror del patrón de energy_snapshots (Fase 1 del WIK-82):
--
--   - rooms: ambientes por propiedad (sembrados desde Tuya rooms,
--     editables manualmente desde admin).
--   - property_devices.room_id: opcional, vincula un device a un room.
--   - sensor_snapshots: capturas horarias de T/H/battery.
--   - alarm_rules: thresholds configurables (scope property/room/device).
--   - alarm_events: incidencias firing/resolved.
--
-- También se extiende el check constraint de property_devices.device_kind
-- para incluir 'sensor' y 'breaker' (este último era category implícita
-- pero nunca estaba en el enum).

-- Permitir kind='sensor' y 'breaker' en property_devices.
alter table public.property_devices
  drop constraint if exists property_devices_device_kind_check;
alter table public.property_devices
  add constraint property_devices_device_kind_check
  check (device_kind in (
    'lock', 'thermostat', 'light', 'switch',
    'camera', 'sensor', 'breaker', 'other'
  ));

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null,
  tuya_room_id text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (property_id, name)
);
create index if not exists rooms_property_idx on public.rooms(property_id);

alter table public.property_devices
  add column if not exists room_id uuid references public.rooms(id) on delete set null;
create index if not exists property_devices_room_idx
  on public.property_devices(room_id);

create table if not exists public.sensor_snapshots (
  id uuid primary key default gen_random_uuid(),
  property_device_id uuid not null references public.property_devices(id) on delete cascade,
  taken_at timestamptz not null default now(),
  temperature_c numeric(5,2),
  humidity_pct numeric(5,2),
  battery_pct int,
  raw_dps jsonb,
  unique (property_device_id, taken_at)
);
create index if not exists sensor_snapshots_device_time_idx
  on public.sensor_snapshots(property_device_id, taken_at desc);

create table if not exists public.alarm_rules (
  id uuid primary key default gen_random_uuid(),
  -- Scope: alguno de los 3 (validado en app code).
  property_id uuid references public.properties(id) on delete cascade,
  room_id uuid references public.rooms(id) on delete cascade,
  property_device_id uuid references public.property_devices(id) on delete cascade,
  metric text not null check (metric in ('temperature_c', 'humidity_pct')),
  operator text not null check (operator in ('gt', 'lt')),
  threshold numeric(5,2) not null,
  debounce_minutes int not null default 15,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.alarm_events (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.alarm_rules(id) on delete cascade,
  property_device_id uuid not null references public.property_devices(id) on delete cascade,
  fired_at timestamptz not null,
  resolved_at timestamptz,
  trigger_value numeric(5,2) not null,
  notified_via_whatsapp boolean not null default false
);
create index if not exists alarm_events_active_idx
  on public.alarm_events(resolved_at) where resolved_at is null;

-- RLS: lectura admin/gestor/mantenimiento; escritura admin/gestor.
alter table public.rooms enable row level security;
alter table public.sensor_snapshots enable row level security;
alter table public.alarm_rules enable row level security;
alter table public.alarm_events enable row level security;

drop policy if exists rooms_read on public.rooms;
create policy rooms_read on public.rooms for select
  using (public.current_role() in ('admin', 'gestor', 'mantenimiento'));
drop policy if exists rooms_write on public.rooms;
create policy rooms_write on public.rooms for all
  using (public.current_role() in ('admin', 'gestor'))
  with check (public.current_role() in ('admin', 'gestor'));

drop policy if exists sensor_snapshots_read on public.sensor_snapshots;
create policy sensor_snapshots_read on public.sensor_snapshots for select
  using (public.current_role() in ('admin', 'gestor', 'mantenimiento'));

drop policy if exists alarm_rules_read on public.alarm_rules;
create policy alarm_rules_read on public.alarm_rules for select
  using (public.current_role() in ('admin', 'gestor', 'mantenimiento'));
drop policy if exists alarm_rules_write on public.alarm_rules;
create policy alarm_rules_write on public.alarm_rules for all
  using (public.current_role() in ('admin', 'gestor'))
  with check (public.current_role() in ('admin', 'gestor'));

drop policy if exists alarm_events_read on public.alarm_events;
create policy alarm_events_read on public.alarm_events for select
  using (public.current_role() in ('admin', 'gestor', 'mantenimiento'));

-- ────────────────────────────────────────────────────────────────────────
-- WIK-94: scope por property para roles gestor / mantenimiento.
--
-- Admin tiene acceso global (no se mete en esta tabla — la lógica en
-- el código TS asume "sin filas = admin scope = todas las properties").
-- Gestor / mantenimiento solo ven/manejan las properties que un admin
-- les asigna en esta tabla.
--
-- El filtro se aplica en lib/auth/scope.ts:getAllowedPropertyIds y se
-- inyecta en cada query relevante con `.in("property_id", allowedIds)`.

create table if not exists public.profile_properties (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, property_id)
);
create index if not exists profile_properties_profile_idx
  on public.profile_properties(profile_id);
create index if not exists profile_properties_property_idx
  on public.profile_properties(property_id);

alter table public.profile_properties enable row level security;

-- Lectura: admin/gestor/mantenimiento (la app filtra por profile_id).
drop policy if exists profile_properties_read on public.profile_properties;
create policy profile_properties_read on public.profile_properties for select
  using (public.current_role() in ('admin', 'gestor', 'mantenimiento'));

-- Escritura: solo admin asigna scopes.
drop policy if exists profile_properties_write on public.profile_properties;
create policy profile_properties_write on public.profile_properties for all
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

-- ────────────────────────────────────────────────────────────────────────
-- WIK-95: overrides manuales home Tuya → property.
--
-- Por default, el sync de /api/admin/tuya/sync-rooms matchea cada home
-- de Smart Life con una property por nombre (substring case-insensitive).
-- Funciona cuando hay 1 home Tuya = 1 property con nombres consistentes.
--
-- Cuando NO matchea (ej. un home de Smart Life que agrupa devices de
-- varias casas físicas), el admin define un override manual acá.
--   - property_id set → ese home mapea explícitamente a esa property.
--   - property_id null → "ignorar este home" (skip silencioso, sin
--     warning en el sync).

create table if not exists public.tuya_home_overrides (
  tuya_home_id text primary key,
  property_id uuid references public.properties(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tuya_home_overrides_property_idx
  on public.tuya_home_overrides(property_id);

alter table public.tuya_home_overrides enable row level security;

drop policy if exists tuya_home_overrides_read on public.tuya_home_overrides;
create policy tuya_home_overrides_read on public.tuya_home_overrides for select
  using (public.current_role() in ('admin', 'gestor'));

drop policy if exists tuya_home_overrides_write on public.tuya_home_overrides;
create policy tuya_home_overrides_write on public.tuya_home_overrides for all
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

-- ─── WhatsApp alarm reminders (WIK-124) ────────────────────────────────
--
-- El cron `/api/cron/alarm-reminders` (cada 15min en Vercel Pro) busca
-- tasks y reservations que tienen `alarm_hours_before` seteado, y manda
-- un WhatsApp con el template `task_reminder` / `reservation_checkin_reminder`
-- aproximadamente esa cantidad de horas antes del vencimiento. La tabla
-- `alarm_notifications_sent` evita que se mande 2 veces para el mismo
-- ítem (idempotencia entre runs del cron + entre reruns manuales).

alter table public.tasks
  add column if not exists due_time time,
  add column if not exists alarm_hours_before int;
-- Sanity: si hay alarma configurada debe haber due_date. (No exigimos
-- due_time porque podés alarma "el día antes" sin hora específica — el
-- cron usa medianoche local como fallback.)
do $$ begin
  alter table public.tasks
    add constraint tasks_alarm_requires_due_date
    check (alarm_hours_before is null or due_date is not null);
exception when duplicate_object then null; end $$;

alter table public.reservations
  add column if not exists alarm_hours_before int;

-- Polymorphic: exactamente UNA de las dos columnas no-null. El unique
-- por columna garantiza que cada task/reserva solo dispara una alarma.
create table if not exists public.alarm_notifications_sent (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.tasks(id) on delete cascade,
  reservation_id uuid references public.reservations(id) on delete cascade,
  whatsapp_template text not null,
  sent_at timestamptz not null default now(),
  -- Snapshot del número al que se mandó — útil para auditar y para
  -- detectar casos donde el assignee cambió después de mandado.
  sent_to_phone text,
  constraint alarm_notifications_one_target check (
    (task_id is not null)::int + (reservation_id is not null)::int = 1
  )
);
create unique index if not exists alarm_notifications_task_unique
  on public.alarm_notifications_sent(task_id)
  where task_id is not null;
create unique index if not exists alarm_notifications_reservation_unique
  on public.alarm_notifications_sent(reservation_id)
  where reservation_id is not null;
create index if not exists alarm_notifications_sent_at_idx
  on public.alarm_notifications_sent(sent_at desc);

alter table public.alarm_notifications_sent enable row level security;
drop policy if exists alarm_notifications_admin_read
  on public.alarm_notifications_sent;
create policy alarm_notifications_admin_read
  on public.alarm_notifications_sent
  for select using (public.current_role() in ('admin', 'gestor'));
-- Write solo via service-role (el cron). Sin policy de insert para
-- otros roles → bloqueado por RLS default-deny.

-- ─── Pre-checkin climate conditioning (WIK-125) ────────────────────────
--
-- El cron `/api/cron/pre-checkin-conditioning` (cada 15min) detecta
-- check-ins próximos en una ventana T-2h, lee la temperatura promedio
-- actual de la property via sensor_snapshots, compara con el target
-- range configurado, y manda alerta WhatsApp al gestor con buttons
-- Quick Reply (SI / NO). Si el gestor acepta, el bot dispara la
-- Tuya scene configurada (cool_scene_id o heat_scene_id).
--
-- Quiet hours: el cron evita mandar entre 22:00 y 08:00 hora UY (UTC-3).

alter table public.properties
  add column if not exists target_temp_min_c numeric default 20,
  add column if not exists target_temp_max_c numeric default 25,
  -- Tuya scene IDs (de tap-to-run scenes). Vacío en cualquiera de los
  -- dos = la property no puede auto-acondicionar en esa dirección.
  add column if not exists cool_scene_id text,
  add column if not exists heat_scene_id text;

-- Una row por reservation que entra al flow (incluso si el resultado
-- termina siendo "no acción"). El unique index garantiza que cada
-- reserva entra al flow una sola vez (idempotencia del cron).
create table if not exists public.pre_checkin_conditioning (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  -- Estados del flow:
  --   'no_action_needed'    → la temp ya está en rango, no se notifica al gestor
  --   'alert_sent_2h'       → alerta inicial enviada, esperando respuesta
  --   'gestor_responded_no' → gestor respondió NO, no se hace nada
  --   'started'             → gestor respondió SI, scene disparada
  --   'check_1h_done'       → cron check 1h-antes hecho
  --   'check_0h_done'       → cron check final hecho
  --   'cancelled'           → reserva cancelada después del start del flow
  --   'no_response'         → no hubo respuesta del gestor antes del T-30m
  --   'quiet_hours_skipped' → la ventana T-2h cayó en horario nocturno
  stage text not null,
  -- Dirección del acondicionamiento elegida:
  --   'cool' | 'heat' | 'no_action' | null (pendiente)
  decision text,
  decision_by uuid references public.profiles(id) on delete set null,
  decision_at timestamptz,
  -- Tracking del Tuya scene disparado.
  scene_triggered_id text,
  scene_triggered_at timestamptz,
  -- Snapshot de la temp al momento del primer alerta — sirve para
  -- mostrar progreso ("temp inicial X°C → ahora Y°C") en los checks
  -- posteriores y en la UI del dashboard.
  initial_temp_c numeric,
  -- Notes para debug / audit (ej. "sensor offline en T-2h, sin alerta").
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists pre_checkin_conditioning_reservation_unique
  on public.pre_checkin_conditioning(reservation_id);
create index if not exists pre_checkin_conditioning_stage_idx
  on public.pre_checkin_conditioning(stage);

alter table public.pre_checkin_conditioning enable row level security;
drop policy if exists pre_checkin_conditioning_admin_read
  on public.pre_checkin_conditioning;
create policy pre_checkin_conditioning_admin_read
  on public.pre_checkin_conditioning
  for select using (public.current_role() in ('admin', 'gestor'));
-- Update permitido a admin/gestor para que el bot router (running con
-- service-role bypass) y el override manual (server action con
-- requireRole admin/gestor) puedan modificar el state. Insert también.
drop policy if exists pre_checkin_conditioning_admin_write
  on public.pre_checkin_conditioning;
create policy pre_checkin_conditioning_admin_write
  on public.pre_checkin_conditioning
  for all using (public.current_role() in ('admin', 'gestor'))
  with check (public.current_role() in ('admin', 'gestor'));
