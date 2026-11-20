-- RLS and constraint checks for the Power Dialer schema (migration 0072).
-- Runs as postgres, switches to the authenticated role as two fake users, and
-- ROLLS BACK: nothing persists.
-- Run: npx supabase db query --linked -f supabase/tests/power_dialer.sql
-- Passing prints the "passed" notice; a failure raises 'FAIL: ...'.
begin;

insert into public.user_roles (user_id, role, books, name)
values
  ('00000000-0000-4000-8000-0000000001b1', 'owner', array['mpg', 'bay'], 'Dialer test A'),
  ('00000000-0000-4000-8000-0000000001b2', 'assistant', array['mpg', 'bay'], 'Dialer test B');

set local role authenticated;

-- User B owns a list, a lead, a call and a queue row.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000001b2","role":"authenticated"}', true);
insert into public.dialer_lists (id, business_id, name) values ('00000000-0000-4000-8000-0000000001e2', 'mpg', 'B list');
insert into public.dialer_leads (id, list_id, business_id, company, phone_e164, position)
values ('00000000-0000-4000-8000-0000000001f2', '00000000-0000-4000-8000-0000000001e2', 'mpg', 'B Co', '+17135550102', 1);
insert into public.dialer_calls (lead_id, list_id, business_id, phone_e164, outcome)
values ('00000000-0000-4000-8000-0000000001f2', '00000000-0000-4000-8000-0000000001e2', 'mpg', '+17135550102', 'interested');
insert into public.dialer_push_queue (lead_id, business_id, target, outcome)
values ('00000000-0000-4000-8000-0000000001f2', 'mpg', 'zoho', 'interested');
insert into public.dnc_numbers (phone_e164, source) values ('+17135550199', 'dialer');

-- User A: isolation, refused cross-owner parents, constraints.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000001b1","role":"authenticated"}', true);
do $$
declare n int; ok boolean;
begin
  -- A's own rows work.
  insert into public.dialer_lists (id, business_id, temperature, name) values ('00000000-0000-4000-8000-0000000001e1', 'bay', 'warm', 'A warm list');
  insert into public.dialer_leads (id, list_id, business_id, first_name, phone_e164, position)
  values ('00000000-0000-4000-8000-0000000001f1', '00000000-0000-4000-8000-0000000001e1', 'bay', 'Ann', '+17135550101', 1);
  insert into public.dialer_calls (lead_id, list_id, business_id, phone_e164)
  values ('00000000-0000-4000-8000-0000000001f1', '00000000-0000-4000-8000-0000000001e1', 'bay', '+17135550101');

  -- Own-row read isolation.
  select count(*) into n from public.dialer_lists where name = 'B list';
  if n <> 0 then raise exception 'FAIL: A reads % of B lists', n; end if;
  select count(*) into n from public.dialer_leads where company = 'B Co';
  if n <> 0 then raise exception 'FAIL: A reads % of B leads', n; end if;
  select count(*) into n from public.dialer_calls where phone_e164 = '+17135550102';
  if n <> 0 then raise exception 'FAIL: A reads % of B calls', n; end if;
  select count(*) into n from public.dialer_push_queue;
  if n <> 0 then raise exception 'FAIL: A reads % B queue rows', n; end if;

  -- Shared DNC: A sees B's number.
  select count(*) into n from public.dnc_numbers where phone_e164 = '+17135550199';
  if n <> 1 then raise exception 'FAIL: shared DNC not visible to A'; end if;

  -- A cannot hang a lead on B's list.
  ok := false;
  begin
    insert into public.dialer_leads (list_id, business_id, phone_e164, position)
    values ('00000000-0000-4000-8000-0000000001e2', 'mpg', '+17135550103', 2);
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL: A inserted a lead on B list'; end if;

  -- A cannot log a call or queue row against B's lead.
  ok := false;
  begin
    insert into public.dialer_calls (lead_id, business_id, phone_e164)
    values ('00000000-0000-4000-8000-0000000001f2', 'mpg', '+17135550102');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL: A logged a call on B lead'; end if;

  -- Lead business must match its list.
  ok := false;
  begin
    insert into public.dialer_leads (list_id, business_id, phone_e164, position)
    values ('00000000-0000-4000-8000-0000000001e1', 'mpg', '+17135550104', 2);
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL: MPG lead on a Bayway list'; end if;

  -- Cold Bayway list without the DNC scrub confirmation is refused.
  ok := false;
  begin
    insert into public.dialer_lists (business_id, temperature, name) values ('bay', 'cold', 'A cold list');
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL: cold list saved without DNC scrub'; end if;
  insert into public.dialer_lists (business_id, temperature, name, dnc_scrub_confirmed_by, dnc_scrub_confirmed_at)
  values ('bay', 'cold', 'A cold list', auth.uid(), now());

  -- MPG list cannot carry a temperature; Bayway list must.
  ok := false;
  begin
    insert into public.dialer_lists (business_id, temperature, name) values ('mpg', 'warm', 'A bad MPG list');
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL: MPG list with temperature'; end if;

  -- Application sent is Bayway only; Owner not available is MPG only.
  update public.dialer_calls set outcome = 'application_sent', logged_at = now()
  where lead_id = '00000000-0000-4000-8000-0000000001f1';
  ok := false;
  begin
    update public.dialer_calls set outcome = 'owner_unavailable'
    where lead_id = '00000000-0000-4000-8000-0000000001f1';
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL: owner_unavailable on a Bayway call'; end if;

  -- Connect flag follows the outcome.
  select count(*) into n from public.dialer_calls
  where lead_id = '00000000-0000-4000-8000-0000000001f1' and is_connect;
  if n <> 1 then raise exception 'FAIL: application_sent not a connect'; end if;

  -- Callback needs a time.
  ok := false;
  begin
    update public.dialer_calls set outcome = 'callback_requested'
    where lead_id = '00000000-0000-4000-8000-0000000001f1';
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL: callback without callback_at'; end if;

  -- Bayway pushes to FUB, not Zoho.
  ok := false;
  begin
    insert into public.dialer_push_queue (lead_id, business_id, target, outcome)
    values ('00000000-0000-4000-8000-0000000001f1', 'bay', 'zoho', 'application_sent');
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL: Bayway row targeted Zoho'; end if;
  insert into public.dialer_push_queue (lead_id, business_id, target, outcome)
  values ('00000000-0000-4000-8000-0000000001f1', 'bay', 'fub', 'application_sent');

  -- A dialable lead needs a phone; invalid_phone may have none.
  ok := false;
  begin
    insert into public.dialer_leads (list_id, business_id, phone_raw, position)
    values ('00000000-0000-4000-8000-0000000001e1', 'bay', 'n/a', 3);
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL: queued lead without phone'; end if;
  insert into public.dialer_leads (list_id, business_id, phone_raw, status, position)
  values ('00000000-0000-4000-8000-0000000001e1', 'bay', 'n/a', 'invalid_phone', 3);
end $$;

-- B (not owner) cannot remove a DNC number; A (owner) can.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000001b2","role":"authenticated"}', true);
delete from public.dnc_numbers where phone_e164 = '+17135550199';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000001b1","role":"authenticated"}', true);
do $$
declare n int;
begin
  select count(*) into n from public.dnc_numbers where phone_e164 = '+17135550199';
  if n <> 1 then raise exception 'FAIL: non-owner removed a DNC number'; end if;
  delete from public.dnc_numbers where phone_e164 = '+17135550199';
  select count(*) into n from public.dnc_numbers where phone_e164 = '+17135550199';
  if n <> 0 then raise exception 'FAIL: owner could not remove a DNC number'; end if;
  raise notice 'power_dialer RLS checks passed';
end $$;

rollback;
