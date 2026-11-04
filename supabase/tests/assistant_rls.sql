-- RLS checks for the assistant role (spec 2026-11-03, Testing: RLS tests).
-- Runs as postgres, switches to the authenticated role with a fake assistant
-- and then the real owner, and ROLLS BACK: nothing persists.
-- Run: npx supabase db query --linked -f supabase/tests/assistant_rls.sql
-- Passing prints the two "passed" notices; a failure raises 'FAIL: ...'.
begin;

insert into public.user_roles (user_id, role, books, name)
values ('00000000-0000-4000-8000-0000000000a1', 'assistant', array['bay'], 'RLS test');

set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
do $$
declare n int;
begin
  select count(*) into n from public.contacts where business_id = 'mpg';
  if n <> 0 then raise exception 'FAIL: assistant reads % MPG contacts', n; end if;
  select count(*) into n from public.contacts where business_id = 'bay';
  if n = 0 then raise exception 'FAIL: assistant reads no Bayway contacts'; end if;
  select count(*) into n from public.v_active_pipeline where business_id = 'mpg';
  if n <> 0 then raise exception 'FAIL: assistant reads % MPG pipeline rows', n; end if;
  select count(*) into n from public.activities where business_id = 'mpg';
  if n <> 0 then raise exception 'FAIL: assistant reads % MPG activities', n; end if;
  select count(*) into n from public.tasks where business_id = 'mpg';
  if n <> 0 then raise exception 'FAIL: assistant reads % MPG tasks', n; end if;
  select count(*) into n from public.loans;
  if n <> 0 then raise exception 'FAIL: assistant reads % loans', n; end if;
  select count(*) into n from public.sync_log;
  if n <> 0 then raise exception 'FAIL: assistant reads % sync_log rows', n; end if;
  select count(*) into n from public.metrics_daily;
  if n <> 0 then raise exception 'FAIL: assistant reads % metrics_daily rows', n; end if;
  select count(*) into n from public.calendar_events;
  if n <> 0 then raise exception 'FAIL: assistant reads % calendar events', n; end if;
  select count(*) into n from public.crm_actions;
  if n <> 0 then raise exception 'FAIL: assistant reads % crm_actions rows', n; end if;
  select count(*) into n from public.settings where key not in ('priority_rules', 'writeback_enabled', 'create_lead_enabled');
  if n <> 0 then raise exception 'FAIL: assistant reads % private settings', n; end if;
  select count(*) into n from public.user_roles;
  if n <> 1 then raise exception 'FAIL: assistant reads % user_roles rows (want only her own)', n; end if;
  begin
    insert into public.lead_ratings (contact_id, business_id, temperature)
    select id, 'bay', 'hot' from public.contacts where business_id = 'bay' limit 1;
    raise exception 'FAIL: assistant wrote a lead rating';
  exception when insufficient_privilege then null;
  end;
  update public.settings set value = value where key = 'priority_rules';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: assistant updated settings'; end if;
  raise notice 'assistant RLS: all checks passed';
end $$;

select set_config('request.jwt.claims', '{"sub":"2cbf8825-be9d-429a-a4ed-3c3915d09c1d","role":"authenticated"}', true);
do $$
declare n int;
begin
  select count(*) into n from public.contacts where business_id = 'mpg';
  if n = 0 then raise exception 'FAIL: owner reads no MPG contacts'; end if;
  select count(*) into n from public.sync_log;
  if n = 0 then raise exception 'FAIL: owner reads no sync_log'; end if;
  select count(*) into n from public.settings where key = 'arive';
  if n = 0 then raise exception 'FAIL: owner cannot read arive settings'; end if;
  select count(*) into n from public.user_roles;
  if n < 2 then raise exception 'FAIL: owner reads % user_roles rows (want all)', n; end if;
  raise notice 'owner RLS: all checks passed';
end $$;

rollback;
