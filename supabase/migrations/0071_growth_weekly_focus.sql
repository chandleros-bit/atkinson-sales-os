-- Growth bot and weekly focus (Bayway Bot Engine doc, Bot 11 and Sales OS
-- item 5). Two Claude scheduled tasks: Monday sets one focus and 3 tasks as
-- Sales OS work items; Friday logs the check-in. Overview shows the focus.

-- One focus item plus its tasks per week, as ordinary custom work items.
alter table public.work_items add column if not exists focus_week date;
alter table public.work_items add column if not exists focus_role text
  check (focus_role in ('focus', 'task'));
create index if not exists work_items_focus_week_idx on public.work_items (focus_week) where focus_week is not null;

-- Friday check-in log: how many of the week's tasks got done, and the note.
create table if not exists public.growth_checkins (
  week_start date primary key,
  done       int not null,
  total      int not null,
  note       text,
  created_at timestamptz not null default now()
);
alter table public.growth_checkins enable row level security;
drop policy if exists "owner read growth_checkins" on public.growth_checkins;
create policy "owner read growth_checkins" on public.growth_checkins
  for select to authenticated using (public.is_owner());

-- Weekly numbers for the Growth bot, Monday-start weeks in Chicago time, last
-- 8 weeks. Money scorecard first (doc: "the money scorecard leads"), then
-- activity. Targets come from settings.metric_targets.
create or replace view public.v_growth_weeks with (security_invoker = true) as
with weeks as (
  select (date_trunc('week', (now() at time zone 'America/Chicago')::date) - (n || ' weeks')::interval)::date as week_start
  from generate_series(0, 7) n
),
acts as (
  select date_trunc('week', (a.occurred_at at time zone 'America/Chicago'))::date as wk,
         a.business_id, a.type, a.direction, public.call_connected(a.raw) as connected,
         c.person_stage, c.raw ->> 'source' as source
  from public.activities a
  left join public.contacts c on c.id = a.contact_id
  where a.occurred_at >= now() - interval '9 weeks'
),
leads as (
  select date_trunc('week', (s.crm_created_at at time zone 'America/Chicago'))::date as wk, s.business_id
  from public.v_lead_signals s
  where s.crm_created_at >= now() - interval '9 weeks' and not coalesce(s.is_partner, false)
),
loans as (
  select funded_on, amount from public.loans
  where business_id = 'bay' and not coalesce(scenario_override, scenario_auto, false)
),
-- Applications: Arive's App/TRID completed date, plus Sales OS contacts that
-- entered Application Received (only their current stage date is kept), one
-- per person.
apps as (
  select coalesce(contact_id::text, id::text) as who, public.arive_date(raw ->> 'App/TRID Completed Date') as d
  from public.loans where business_id = 'bay'
  union
  select id::text, (stage_since at time zone 'America/Chicago')::date
  from public.contacts where business_id = 'bay' and stage_key = 'Application Received' and stage_since is not null
),
t as (select value as v from public.settings where key = 'metric_targets')
select w.week_start,
       (w.week_start + 6) as week_end,
       -- Money scorecard
       (select count(*) from acts a where a.wk = w.week_start and a.type = 'call' and a.direction = 'outbound' and a.connected) as conversations,
       (select count(distinct x.who) from apps x where date_trunc('week', x.d)::date = w.week_start) as applications,
       (select count(*) from acts a where a.wk = w.week_start and a.business_id = 'bay' and a.type = 'call' and a.direction = 'outbound' and a.source = 'Past Client') as past_client_calls,
       (select count(*) from loans l where date_trunc('week', l.funded_on)::date = w.week_start) as funded_loans,
       (select coalesce(sum(l.amount), 0) from loans l where date_trunc('week', l.funded_on)::date = w.week_start) as funded_volume,
       -- Activity
       (select count(*) from acts a where a.wk = w.week_start and a.business_id = 'bay' and a.type = 'call' and a.direction = 'outbound') as bay_calls,
       (select count(*) from acts a where a.wk = w.week_start and a.business_id = 'mpg' and a.type = 'call' and a.direction = 'outbound') as mpg_calls,
       (select count(*) from acts a where a.wk = w.week_start and a.business_id = 'bay' and a.direction = 'outbound' and a.person_stage = 'Realtors') as agent_touches,
       (select count(*) from leads x where x.wk = w.week_start and x.business_id = 'bay') as bay_new_leads,
       (select count(*) from leads x where x.wk = w.week_start and x.business_id = 'mpg') as mpg_new_leads,
       -- Targets (weekly; conversations is 10 a day x 5)
       coalesce((t.v ->> 'live_conversations')::numeric * 5, 50) as conversations_target,
       coalesce((t.v ->> 'applications_weekly')::numeric, 3) as applications_target,
       coalesce((t.v ->> 'past_client_investor_calls_weekly')::numeric, 15) as past_client_calls_target,
       coalesce((t.v ->> 'funded_loans_monthly')::numeric, 4) as funded_loans_monthly_target
from weeks w left join t on true
order by w.week_start desc;
