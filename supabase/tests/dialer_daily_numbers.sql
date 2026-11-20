-- Dialer calls feed metrics_daily (migration 0073). Uses a day in 2001 so it
-- cannot collide with real numbers, and ROLLS BACK: nothing persists.
-- Run with 0072 and 0073 applied:
--   npx supabase db query --linked -f supabase/tests/dialer_daily_numbers.sql
begin;

insert into public.user_roles (user_id, role, books, name)
values ('00000000-0000-4000-8000-0000000002b1', 'owner', array['mpg', 'bay'], 'Dialer metrics test');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000002b1","role":"authenticated"}', true);

do $$
declare calls numeric; convos numeric;
begin
  insert into public.dialer_lists (id, business_id, name) values ('00000000-0000-4000-8000-0000000002e1', 'mpg', 'Metrics list');
  insert into public.dialer_leads (id, list_id, business_id, phone_e164, position)
  values ('00000000-0000-4000-8000-0000000002f1', '00000000-0000-4000-8000-0000000002e1', 'mpg', '+17135550201', 1);
  -- 21:30 UTC on Jan 2 is 15:30 in Chicago: the Jan 2 row.
  insert into public.dialer_calls (id, lead_id, list_id, business_id, phone_e164, dialed_at)
  values ('00000000-0000-4000-8000-0000000002a1', '00000000-0000-4000-8000-0000000002f1', '00000000-0000-4000-8000-0000000002e1',
          'mpg', '+17135550201', '2001-01-02 21:30:00+00');
  -- 03:00 UTC on Jan 3 is still Jan 2 in Chicago.
  insert into public.dialer_calls (lead_id, list_id, business_id, phone_e164, dialed_at)
  values ('00000000-0000-4000-8000-0000000002f1', '00000000-0000-4000-8000-0000000002e1',
          'mpg', '+17135550201', '2001-01-03 03:00:00+00');

  select value into calls from public.metrics_daily where business_id = 'mpg' and date = '2001-01-02' and metric_key = 'calls';
  if calls is distinct from 2 then raise exception 'FAIL: calls = %, expected 2', calls; end if;

  update public.dialer_calls set outcome = 'no_answer' where id = '00000000-0000-4000-8000-0000000002a1';
  select value into convos from public.metrics_daily where business_id = 'mpg' and date = '2001-01-02' and metric_key = 'live_conversations';
  if convos is not null then raise exception 'FAIL: no answer counted as a conversation'; end if;

  update public.dialer_calls set outcome = 'interested' where id = '00000000-0000-4000-8000-0000000002a1';
  select value into convos from public.metrics_daily where business_id = 'mpg' and date = '2001-01-02' and metric_key = 'live_conversations';
  if convos is distinct from 1 then raise exception 'FAIL: conversations = %, expected 1', convos; end if;

  update public.dialer_calls set notes = 'edited' where id = '00000000-0000-4000-8000-0000000002a1';
  update public.dialer_calls set outcome = 'appointment_set' where id = '00000000-0000-4000-8000-0000000002a1';
  select value into convos from public.metrics_daily where business_id = 'mpg' and date = '2001-01-02' and metric_key = 'live_conversations';
  if convos is distinct from 1 then raise exception 'FAIL: connect to connect changed the count to %', convos; end if;

  update public.dialer_calls set outcome = 'voicemail' where id = '00000000-0000-4000-8000-0000000002a1';
  select value into convos from public.metrics_daily where business_id = 'mpg' and date = '2001-01-02' and metric_key = 'live_conversations';
  if convos is distinct from 0 then raise exception 'FAIL: conversations = % after the correction, expected 0', convos; end if;

  -- Bayway dials land on the Bayway row.
  select value into calls from public.metrics_daily where business_id = 'bay' and date = '2001-01-02' and metric_key = 'calls';
  if calls is not null then raise exception 'FAIL: MPG dial counted for Bayway'; end if;

  raise notice 'dialer daily numbers checks passed';
end $$;

rollback;
