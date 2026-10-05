create table if not exists public.wikibot_inbound_emails (
  id uuid primary key default gen_random_uuid(),
  message_id text not null unique,
  from_email text,
  from_name text,
  to_email text,
  subject text,
  text_body text,
  html_body text,
  headers jsonb not null default '[]'::jsonb,
  attachment_metadata jsonb not null default '[]'::jsonb,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists wikibot_inbound_emails_received_at_idx
  on public.wikibot_inbound_emails(received_at desc);

alter table public.wikibot_inbound_emails enable row level security;
