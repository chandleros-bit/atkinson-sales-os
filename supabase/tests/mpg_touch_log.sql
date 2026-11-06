-- RLS checks for the MPG touch log (migration 0060, spec 2026-11-05).
-- Runs as postgres, switches to the authenticated role as two fake users, and
-- ROLLS BACK: nothing persists.
-- Run: npx supabase db query --linked -f supabase/tests/mpg_touch_log.sql
-- Passing prints the "passed" notice; a failure raises 'FAIL: ...'.
begin;

insert into public.user_roles (user_id, role, books, name)
values
  ('00000000-0000-4000-8000-0000000000b1', 'owner', array['mpg', 'bay'], 'MPG touch test A'),
  ('00000000-0000-4000-8000-0000000000b2', 'owner', array['mpg', 'bay'], 'MPG touch test B');
insert into public.contacts (id, business_id, source_crm, external_id, name)
values
  ('00000000-0000-4000-8000-0000000000c1', 'mpg', 'zoho', 'touch-test-mpg', 'Touch Test MPG'),
  ('00000000-0000-4000-8000-0000000000c2', 'bay', 'fub', 'touch-test-bay', 'Touch Test Bay');

set local role authenticated;

-- User B owns a list, a prospect and a touch.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
insert into public.mpg_prospect_lists (id, name) values ('00000000-0000-4000-8000-0000000000e2', 'B list');
insert into public.mpg_prospects (id, business_name) values ('00000000-0000-4000-8000-0000000000f2', 'B Prospect');
insert into public.mpg_touches (id, channel, business_name, prospect_id)
values ('00000000-0000-4000-8000-0000000000a2', 'walk_in', 'B Touch', '00000000-0000-4000-8000-0000000000f2');

-- User A: isolation and refused cross-owner / non-MPG parents.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
do $$
declare n int;
begin
  -- A's own rows work, including an MPG contact.
  insert into public.mpg_prospect_lists (name) values ('A list');
  insert into public.mpg_prospects (business_name) values ('A Prospect');
  insert into public.mpg_touches (channel, business_name, contact_id)
  values ('walk_in', 'A Touch', '00000000-0000-4000-8000-0000000000c1');

  -- Own-row read isolation.
  select count(*) into n from public.mpg_touches where business_name = 'B Touch';
  if n <> 0 then raise exception 'FAIL: A reads % of B touches', n; end if;
  select count(*) into n from public.mpg_prospects where business_name = 'B Prospect';
  if n <> 0 then raise exception 'FAIL: A reads % of B prospects', n; end if;
  select count(*) into n from public.mpg_prospect_lists where name = 'B list';
  if n <> 0 then raise exception 'FAIL: A reads % of B lists', n; end if;
  select count(*) into n from public.mpg_touches;
  if n <> 1 then raise exception 'FAIL: A reads % touches (want only their own 1)', n; end if;

  -- A touch pointing at B's prospect.
  begin
    insert into public.mpg_touches (channel, business_name, prospect_id)
    values ('walk_in', 'X', '00000000-0000-4000-8000-0000000000f2');
    raise exception 'FAIL: A inserted a touch on B''s prospect';
  exception when insufficient_privilege then null;
  end;

  -- A prospect pointing at B's list.
  begin
    insert into public.mpg_prospects (business_name, list_id)
    values ('X', '00000000-0000-4000-8000-0000000000e2');
    raise exception 'FAIL: A inserted a prospect on B''s list';
  exception when insufficient_privilege then null;
  end;

  -- A touch whose contact is not an MPG contact.
  begin
    insert into public.mpg_touches (channel, business_name, contact_id)
    values ('walk_in', 'X', '00000000-0000-4000-8000-0000000000c2');
    raise exception 'FAIL: A inserted a touch on a non-MPG contact';
  exception when insufficient_privilege then null;
  end;

  raise notice 'mpg touch log RLS: all checks passed';
end $$;

rollback;
