-- Lock Watch (Bayway Bot Engine doc, Bot 13). A Claude scheduled task runs
-- weekdays at 7:45 AM: it searches the rate market, reads v_lock_watch for
-- loans with a lock decision due, posts to #bayway-alerts and saves the note
-- here. The RateUpdate newsletter bot reads the week's notes later.

create table if not exists public.market_notes (
  note_date  date primary key,
  note       text not null,
  sources    jsonb not null default '[]'::jsonb, -- [{ title, url, date }]
  loans      jsonb not null default '[]'::jsonb, -- the lock decisions listed that day
  created_at timestamptz not null default now()
);

alter table public.market_notes enable row level security;
drop policy if exists "owner read market_notes" on public.market_notes;
create policy "owner read market_notes" on public.market_notes
  for select to authenticated using (public.is_owner());

-- Open, real, unfunded Bayway loans with a lock decision to make:
--   lock_expiring  locked; lock expires within 10 days or expired in the last 30
--   floating       not locked; in processing or closing, or a firm closing date
--                  within 30 days (or already passed, which means Arive is stale)
-- Pre-approvals and App Intake with no closing date aren't lock decisions yet.
create or replace view public.v_lock_watch with (security_invoker = true) as
with today as (select (now() at time zone 'America/Chicago')::date d),
open_loans as (
  select l.*
  from public.loans l
  where l.business_id = 'bay'
    and l.funded_on is null
    and l.stage_group in ('prospect', 'processing', 'closing')
    and not coalesce(l.scenario_override, l.scenario_auto, false)
)
select o.id, o.borrower_name, o.stage, o.purpose, o.amount, o.lender,
       o.lock_date, o.lock_expires_on, o.firm_closing_on,
       case when o.lock_date is not null or o.lock_expires_on is not null then 'lock_expiring' else 'floating' end as kind,
       (o.lock_expires_on - t.d) as days_to_lock_expiry,
       (o.firm_closing_on - t.d) as days_to_closing,
       (o.firm_closing_on is not null and o.firm_closing_on < t.d) as closing_date_passed,
       o.last_seen_at::date as arive_last_seen
from open_loans o cross join today t
where
  (o.lock_expires_on is not null and o.lock_expires_on between t.d - 30 and t.d + 10)
  or (o.lock_date is null and o.lock_expires_on is null and (
        o.stage_group in ('processing', 'closing')
        or (o.firm_closing_on is not null and o.firm_closing_on <= t.d + 30)
  ));
