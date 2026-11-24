-- Run only against an isolated schema-loaded PostgreSQL. Always rolls back.
\set ON_ERROR_STOP on
begin;
do $$
declare
  c uuid;
  other_c uuid;
  n integer;
begin
  insert into public.whatsapp_conversations(phone_number) values ('+199900000001') returning id into c;
  insert into public.whatsapp_conversations(phone_number) values ('+199900000002') returning id into other_c;
  insert into public.whatsapp_messages(conversation_id, external_id, direction, template_name)
    values(c, 'password-recovery:test-1', 'outbound', 'password_recovery');
  begin
    insert into public.whatsapp_messages(conversation_id, external_id, direction, template_name)
      values(c, 'password-recovery:test-1', 'outbound', 'password_recovery');
    raise exception 'duplicate recovery claim accepted';
  exception when unique_violation then null;
  end;
  insert into public.whatsapp_messages(conversation_id, external_id, direction, template_name)
    select c, 'password-recovery:test-' || i, 'outbound', 'password_recovery' from generate_series(2,4) i;
  insert into public.whatsapp_messages(conversation_id, external_id, direction, template_name, sent_at)
    values(c, 'password-recovery:old', 'outbound', 'password_recovery', now()-interval '11 minutes'),
          (other_c, 'password-recovery:other', 'outbound', 'password_recovery', now());
  select count(*) into n from public.whatsapp_messages where conversation_id=c
    and template_name='password_recovery' and sent_at >= now()-interval '10 minutes';
  if n <> 4 then raise exception 'limit counted % instead of 4', n; end if;
  select count(*) into n from public.whatsapp_messages where conversation_id=other_c
    and template_name='password_recovery' and sent_at >= now()-interval '10 minutes';
  if n <> 1 then raise exception 'cross-sender limit leakage'; end if;
end $$;
rollback;
