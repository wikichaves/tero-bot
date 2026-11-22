\set ON_ERROR_STOP on
begin;
set role service_role;
select update_user_profile_admin('00000000-0000-0000-0000-0000000000a1','{"full_name":"Edited Agency","whatsapp":"+59899123456","role":"agency"}',array['00000000-0000-0000-0000-0000000000f2'::uuid]);
do $$ begin
 if (select name from agencies where profile_id='00000000-0000-0000-0000-0000000000a1')<>'Edited Agency' then raise exception 'contact not synced'; end if;
 if (select count(*) from agency_properties where profile_id='00000000-0000-0000-0000-0000000000a1' and property_id='00000000-0000-0000-0000-0000000000f2')<>1 then raise exception 'scope not synced'; end if;
 begin
   perform update_user_profile_admin('00000000-0000-0000-0000-0000000000a1','{"full_name":"Must Roll Back","role":"agency"}',array['11111111-1111-4111-8111-111111111111'::uuid]);
   raise exception 'invalid property accepted';
 exception when raise_exception then
   if SQLERRM='invalid property accepted' then raise; end if;
 end;
 if (select full_name from profiles where id='00000000-0000-0000-0000-0000000000a1')<>'Edited Agency' then raise exception 'partial mutation'; end if;
end $$;
select set_agency_access('00000000-0000-0000-0000-0000000000a1','{}',false);
select update_user_profile_admin('00000000-0000-0000-0000-0000000000a1','{"full_name":"Still Disabled"}',null);
do $$ begin if (select active from agencies where profile_id='00000000-0000-0000-0000-0000000000a1') then raise exception 'revocation lost'; end if; end $$;
select update_user_profile_admin('00000000-0000-0000-0000-0000000000a1','{"role":"gestor"}',array['00000000-0000-0000-0000-0000000000f1'::uuid]);
do $$ begin if (select role::text from profiles where id='00000000-0000-0000-0000-0000000000a1')<>'gestor' then raise exception 'role not updated'; end if; end $$;
reset role;
set role authenticated;
do $$ begin
 begin perform update_user_profile_admin('00000000-0000-0000-0000-0000000000a1','{"role":"admin"}',null);raise exception 'unauthorized RPC allowed';
 exception when insufficient_privilege then null; end;
end $$;
rollback;
