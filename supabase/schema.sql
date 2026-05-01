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
  created_at timestamptz not null default now()
);

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
