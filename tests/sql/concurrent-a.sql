set role service_role;
begin;
insert into public.availability_blocks(property_id,start_date,end_date) values ('00000000-0000-0000-0000-0000000000f2','2031-08-01','2031-08-05');
select pg_sleep(2);
commit;
