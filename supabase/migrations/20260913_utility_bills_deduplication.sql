-- Prevent duplicate utility bills at the database boundary.
-- Safe to rerun: all DDL is idempotent and no rows are deleted.

alter table public.utility_bills
  add column if not exists document_hash text;

-- Backfill the retained July Edenor invoice whose PDF was verified manually.
update public.utility_bills
set document_hash = 'af347d4488f519cf4761ac95f6b60f8de83b60cfc43228e658abb698a5383b69'
where id = '108ee762-26fb-4975-9de0-507b01c51c33'
  and document_hash is null;

-- A PDF can only represent one bill for the same property. Scoping by
-- property avoids collisions if the same document is intentionally attached
-- to records owned by different properties.
drop index if exists public.utility_bills_document_hash_uidx;
create unique index utility_bills_document_hash_uidx
  on public.utility_bills(property_id, document_hash)
  where document_hash is not null;

create unique index if not exists utility_bills_invoice_identity_uidx
  on public.utility_bills(property_id, provider, invoice_number)
  where invoice_number is not null and btrim(invoice_number) <> '';

create unique index if not exists utility_bills_period_account_identity_uidx
  on public.utility_bills(property_id, provider, account_number, period_to)
  where period_to is not null and account_number is not null;

create unique index if not exists utility_bills_period_no_account_identity_uidx
  on public.utility_bills(property_id, provider, period_to)
  where period_to is not null and account_number is null;

create unique index if not exists utility_bills_fallback_identity_uidx
  on public.utility_bills(
    property_id,
    provider,
    utility_type,
    coalesce(currency, ''),
    amount,
    coalesce(account_number, ''),
    coalesce(issue_date, due_date)
  )
  where invoice_number is null
    and period_to is null
    and amount is not null
    and coalesce(issue_date, due_date) is not null;
