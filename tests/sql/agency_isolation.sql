\set ON_ERROR_STOP on
set client_min_messages = warning;
insert into auth.users(id,email) values ('00000000-0000-0000-0000-0000000000a1','agency-a@test.invalid'),('00000000-0000-0000-0000-0000000000b1','agency-b@test.invalid') on conflict do nothing;
grant all on all tables in schema public, auth, storage to service_role;
grant all on all sequences in schema public, auth, storage to service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
set role service_role;
delete from public.availability_imports where property_id in ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000f2');
delete from public.availability_blocks where property_id in ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000f2');
delete from public.reservations where property_id in ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000f2');
update public.profiles set role='agency', full_name='Agency A' where id='00000000-0000-0000-0000-0000000000a1';
update public.profiles set role='agency', full_name='Agency B' where id='00000000-0000-0000-0000-0000000000b1';
insert into public.properties(id,name,is_rental) values ('00000000-0000-0000-0000-0000000000f1','SQL test home A',true),('00000000-0000-0000-0000-0000000000f2','SQL test home B',true) on conflict (id) do update set is_rental=true;
insert into public.agencies(profile_id,name,email,phone) values ('00000000-0000-0000-0000-0000000000a1','A','agency-a@test.invalid','1'),('00000000-0000-0000-0000-0000000000b1','B','agency-b@test.invalid','2') on conflict (profile_id) do update set active=true;
select public.set_agency_access('00000000-0000-0000-0000-0000000000a1',array['00000000-0000-0000-0000-0000000000f1'::uuid],true);
select public.set_agency_access('00000000-0000-0000-0000-0000000000b1',array['00000000-0000-0000-0000-0000000000f2'::uuid],true);
insert into public.availability_blocks(property_id,start_date,end_date) values ('00000000-0000-0000-0000-0000000000f1','2031-01-10','2031-01-12');
insert into public.reservations(property_id,guest_name,check_in,check_out,source) values ('00000000-0000-0000-0000-0000000000f1','secret guest','2031-02-01','2031-02-03','manual');
reset role;
set role authenticated; set request.jwt.claim.role='authenticated'; set request.jwt.claim.sub='00000000-0000-0000-0000-0000000000a1';
do $$ declare n int; begin select count(*) into n from properties; if n<>0 then raise exception 'properties leaked'; end if; select count(*) into n from reservations; if n<>0 then raise exception 'reservations leaked'; end if; select count(*) into n from availability_blocks; if n<>0 then raise exception 'blocks leaked'; end if; select count(*) into n from profiles; if n<>1 then raise exception 'profile isolation failed'; end if; update profiles set full_name='tampered' where id=auth.uid(); if (select full_name from profiles where id=auth.uid())<>'Agency A' then raise exception 'self update allowed'; end if; end $$;
set request.jwt.claim.sub='00000000-0000-0000-0000-0000000000b1'; do $$ begin if (select count(*) from profiles)<>1 then raise exception 'B isolation failed'; end if; end $$;
do $$ begin begin perform public.replace_availability_import('00000000-0000-0000-0000-0000000000f1','[]','x'); raise exception 'RPC callable'; exception when insufficient_privilege then null; end; end $$;
reset role; set role service_role;
insert into public.availability_blocks(property_id,start_date,end_date) values ('00000000-0000-0000-0000-0000000000f1','2031-04-01','2031-04-03');
do $$ begin begin insert into public.availability_blocks(property_id,start_date,end_date) values ('00000000-0000-0000-0000-0000000000f1','2031-04-02','2031-04-04'); raise exception 'overlap accepted'; exception when exclusion_violation then null; end; insert into public.availability_blocks(property_id,start_date,end_date) values ('00000000-0000-0000-0000-0000000000f1','2031-04-03','2031-04-04'); end $$;
insert into public.reservations(property_id,guest_name,check_in,check_out,source,external_id) values ('00000000-0000-0000-0000-0000000000f1','ical','2031-05-01','2031-05-03','airbnb','keep');
select public.replace_availability_import('00000000-0000-0000-0000-0000000000f1','[{"uid":"keep","start_date":"2031-05-01","end_date":"2031-05-03","kind":"reservation"}]','s1');
do $$ begin begin perform public.replace_availability_import('00000000-0000-0000-0000-0000000000f1','[{"uid":"bad","start_date":"2031-06-03","end_date":"2031-06-01","kind":"block"}]','bad'); raise exception 'invalid accepted'; exception when others then null; end; if not exists(select 1 from availability_imports where uid='keep') then raise exception 'old snapshot lost'; end if; end $$;
select public.replace_availability_import('00000000-0000-0000-0000-0000000000f1','[{"uid":"new","start_date":"2031-07-01","end_date":"2031-07-03","kind":"block"}]','s2');
do $$ begin if exists(select 1 from reservations where external_id='keep' and status<>'cancelled') then raise exception 'removed event not cancelled'; end if; if not exists(select 1 from availability_imports where uid='new') then raise exception 'replacement missing'; end if; end $$;
insert into public.reservations(property_id,source,external_id,reservation_code,check_in,check_out)
values ('00000000-0000-0000-0000-0000000000f1','airbnb','HMPLACE','HMPLACE','2031-09-01','2031-09-03');
do $$ begin
  begin
    perform public.reconcile_airbnb_import('00000000-0000-0000-0000-0000000000f1',
      '[{"uid":"newuid","check_in":"2031-09-01","check_out":"2031-09-03","notes":"x","reservation_code":"HMPLACE"}]',
      '[{"uid":"bad","start_date":"2031-10-03","end_date":"2031-10-01","kind":"reservation"}]','bad');
    raise exception 'invalid reconciliation accepted';
  exception when others then null;
  end;
  if not exists(select 1 from reservations where external_id='HMPLACE') then raise exception 'reservation rollback failed'; end if;
end $$;
select public.reconcile_airbnb_import('00000000-0000-0000-0000-0000000000f1',
  '[{"uid":"newuid","check_in":"2031-09-01","check_out":"2031-09-03","notes":"x","reservation_code":"HMPLACE"}]',
  '[{"uid":"newuid","start_date":"2031-09-01","end_date":"2031-09-03","kind":"reservation"}]','ok');
select public.reconcile_airbnb_import('00000000-0000-0000-0000-0000000000f1',
  '[{"uid":"newuid","check_in":"2031-09-01","check_out":"2031-09-03","notes":"x","reservation_code":"HMPLACE"}]',
  '[{"uid":"newuid","start_date":"2031-09-01","end_date":"2031-09-03","kind":"reservation"}]','ok');
do $$ begin
  if (select count(*) from reservations where external_id='newuid')<>1 then raise exception 'idempotency failed'; end if;
  if (select count(*) from availability_imports where uid='newuid')<>1 then raise exception 'snapshot idempotency failed'; end if;
end $$;
-- Cancelled and local placeholder events are absent from the parsed snapshot.
insert into public.reservations(property_id,source,external_id,status,check_in,check_out)
values ('00000000-0000-0000-0000-0000000000f1','airbnb','cancelled-uid','cancelled','2031-11-01','2031-11-03');
select public.reconcile_airbnb_import('00000000-0000-0000-0000-0000000000f1','[]','[]','empty');
do $$ begin
  if (select status from reservations where external_id='cancelled-uid')<>'cancelled' then raise exception 'cancelled event reactivated'; end if;
  if exists(select 1 from availability_imports where uid like 'tero-local-%') then raise exception 'local placeholder imported'; end if;
end $$;
insert into public.reservations(property_id,source,external_id,check_in,check_out)
values ('00000000-0000-0000-0000-0000000000f2','airbnb','owned-by-b','2031-12-01','2031-12-03');
do $$ begin
  begin
    perform public.reconcile_airbnb_import('00000000-0000-0000-0000-0000000000f1',
      '[{"uid":"owned-by-b","check_in":"2031-12-01","check_out":"2031-12-03"}]',
      '[{"uid":"owned-by-b","start_date":"2031-12-01","end_date":"2031-12-03","kind":"reservation"}]','collision');
    raise exception 'cross-property UID accepted';
  exception when others then null;
  end;
  if (select property_id from reservations where external_id='owned-by-b')<>'00000000-0000-0000-0000-0000000000f2' then raise exception 'reservation moved property'; end if;
  if exists(select 1 from availability_imports where uid='owned-by-b') then raise exception 'collision snapshot committed'; end if;
end $$;
rollback;
