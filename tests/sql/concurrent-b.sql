select pg_sleep(0.3);
set role service_role;
insert into public.availability_blocks(property_id,start_date,end_date) values ('00000000-0000-0000-0000-0000000000f2','2031-08-04','2031-08-06');
