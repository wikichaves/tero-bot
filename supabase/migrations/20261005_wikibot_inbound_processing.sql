do $$
declare
  automation_already_initialized boolean;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'wikibot_inbound_emails'
      and column_name = 'processing_status'
  ) into automation_already_initialized;

  alter table public.wikibot_inbound_emails
    add column if not exists processing_status text not null default 'pending'
      check (processing_status in ('pending', 'claimed', 'processed')),
    add column if not exists claimed_at timestamptz,
    add column if not exists claim_token uuid,
    add column if not exists processed_at timestamptz;

  -- Emails received before automation existed must not generate retroactive alerts.
  if not automation_already_initialized then
    update public.wikibot_inbound_emails
    set processing_status = 'processed',
        processed_at = coalesce(processed_at, now())
    where processing_status = 'pending';
  end if;
end;
$$;

create index if not exists wikibot_inbound_emails_processing_idx
  on public.wikibot_inbound_emails(processing_status, claimed_at, received_at);

create or replace function public.claim_wikibot_inbound_emails(
  p_limit integer default 5,
  p_lease_seconds integer default 300
)
returns table (
  message_id text,
  claim_token uuid,
  from_email text,
  from_name text,
  to_email text,
  subject text,
  text_body text,
  attachment_metadata jsonb,
  received_at timestamptz
)
language plpgsql
set search_path = public
as $$
begin
  return query
  with candidates as (
    select email.id
    from public.wikibot_inbound_emails as email
    where email.processing_status = 'pending'
       or (
         email.processing_status = 'claimed'
         and email.claimed_at < now() - make_interval(
           secs => greatest(60, least(coalesce(p_lease_seconds, 300), 3600))
         )
       )
    order by email.received_at asc
    limit greatest(1, least(coalesce(p_limit, 5), 10))
    for update skip locked
  ), claimed as (
    update public.wikibot_inbound_emails as email
    set processing_status = 'claimed',
        claimed_at = now(),
        claim_token = gen_random_uuid()
    from candidates
    where email.id = candidates.id
    returning email.message_id, email.claim_token, email.from_email,
      email.from_name, email.to_email, email.subject, email.text_body,
      email.attachment_metadata, email.received_at
  )
  select * from claimed;
end;
$$;

create or replace function public.ack_wikibot_inbound_email(
  p_message_id text,
  p_claim_token uuid
)
returns boolean
language sql
set search_path = public
as $$
  with updated as (
    update public.wikibot_inbound_emails as email
    set processing_status = 'processed',
        processed_at = now(),
        claimed_at = null,
        claim_token = null
    where email.message_id = p_message_id
      and email.claim_token = p_claim_token
      and email.processing_status = 'claimed'
    returning 1
  )
  select exists(select 1 from updated);
$$;

revoke all on function public.claim_wikibot_inbound_emails(integer, integer) from public, anon, authenticated;
revoke all on function public.ack_wikibot_inbound_email(text, uuid) from public, anon, authenticated;
grant execute on function public.claim_wikibot_inbound_emails(integer, integer) to service_role;
grant execute on function public.ack_wikibot_inbound_email(text, uuid) to service_role;
