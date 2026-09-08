-- Run only against a new isolated local PostgreSQL database.
\set ON_ERROR_STOP on
create role anon;
create role authenticated;
create role service_role bypassrls;
-- Reproduce Supabase's broad defaults; the migration must narrow these grants.
alter default privileges in schema public grant all on tables to service_role;
\ir ../../supabase/migrations/20260908201905_saved_play_consent.sql
set role service_role;
insert into public.pvp_play_consents(wallet_address,terms_version,session_id,stock_token_eligibility_attested)
values ('0x2222222222222222222222222222222222222222','2026-09-08.1','11111111-1111-4111-8111-111111111111',true)
on conflict(wallet_address,terms_version) do nothing;
insert into public.pvp_play_consents(wallet_address,terms_version,session_id,stock_token_eligibility_attested)
values ('0x2222222222222222222222222222222222222222','2026-09-08.1','11111111-1111-4111-8111-111111111111',true)
on conflict(wallet_address,terms_version) do nothing;
select wallet_address,terms_version from public.pvp_play_consents;
reset role;
do $$ begin
  if (select count(*) from public.pvp_play_consents) <> 1 then raise exception 'Acceptance was duplicated'; end if;
  if has_table_privilege('anon','public.pvp_play_consents','select,insert,update,delete') then raise exception 'Anonymous role has consent access'; end if;
  if has_table_privilege('authenticated','public.pvp_play_consents','select,insert,update,delete') then raise exception 'Authenticated role has consent access'; end if;
  if not (select relrowsecurity from pg_class where oid='public.pvp_play_consents'::regclass) then raise exception 'RLS is disabled'; end if;
  if has_table_privilege('service_role','public.pvp_play_consents','update,delete') then raise exception 'Consent records must be append-only'; end if;
end $$;
