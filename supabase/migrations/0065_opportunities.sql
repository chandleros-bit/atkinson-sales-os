-- Database Opportunity Agent (Bayway Engine #1), build step 1.
-- Spec: "Spec: Database Opportunity Agent (Bayway Engine #1)",
-- https://claude.ai/artifact/WWYoPrV8R4p3o5iTho2E35
--
-- Five new tables keyed on contacts.id, plus an `opportunities` settings key.
-- All tables are owner-only, like Partners and Drafts; Shelby's access is
-- unchanged. Edge functions use the service role key.
--
-- The PMMS history seed is a follow-up step: load Freddie Mac's weekly history
-- file into pmms_weekly before the nightly job runs.

-- One row per past client with property facts from Arive, the title rep,
-- the county files or a paid source.
create table if not exists public.past_client_property (
  contact_id        uuid primary key references public.contacts(id) on delete cascade,
  address           text,
  city              text,
  state             text,
  zip               text,
  county            text,
  recording_date    date,
  sale_price        numeric,
  orig_loan_amount  numeric,
  rate_actual       numeric,
  term_months       int,
  loan_type         text,
  lender            text,
  market_value      numeric,
  market_value_year int,
  homestead         boolean,
  parcels_owned     int,
  kept_prior_home   boolean not null default false,
  no_property_found boolean not null default false,
  source            text check (source in ('arive', 'title_rep', 'hcad', 'fbcad', 'mcad', 'paid', 'manual')),
  confidence        text check (confidence in ('high', 'medium', 'low')),
  is_manual         boolean not null default false,
  updated_at        timestamptz not null default now()
);

-- Freddie Mac weekly average rates.
create table if not exists public.pmms_weekly (
  week_date     date primary key,
  rate_30_fixed numeric not null,
  rate_15_fixed numeric
);

-- Latest computed numbers per contact (recomputed nightly).
create table if not exists public.opportunity_estimates (
  contact_id  uuid primary key references public.contacts(id) on delete cascade,
  est_rate    numeric,
  est_balance numeric,
  est_value   numeric,
  est_equity  numeric,
  est_ltv     numeric,
  years_owned numeric,
  inputs      jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now()
);

-- The daily list and what happened.
create table if not exists public.opportunity_picks (
  id            uuid primary key default gen_random_uuid(),
  pick_date     date not null,
  contact_id    uuid not null references public.contacts(id) on delete cascade,
  rank          int not null,
  score         int not null default 0,
  kind          text not null default 'review' check (kind in ('review', 'check_in')),
  reason_codes  text[] not null default '{}',
  ai_note       jsonb,
  status        text not null default 'pending'
                check (status in ('pending', 'called', 'connected', 'no_answer', 'skipped', 'not_a_fit')),
  outcome_note  text,
  crm_action_id uuid references public.crm_actions(id),
  created_at    timestamptz not null default now(),
  unique (pick_date, contact_id)
);
create index if not exists opportunity_picks_contact_idx
  on public.opportunity_picks (contact_id, pick_date desc);

-- Medium-confidence matches waiting on Chandler.
create table if not exists public.enrichment_review (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid not null references public.contacts(id) on delete cascade,
  candidate   jsonb not null,
  confidence  text not null check (confidence in ('high', 'medium', 'low')),
  decision    text not null default 'pending' check (decision in ('accept', 'reject', 'pending')),
  decided_at  timestamptz,
  created_at  timestamptz not null default now()
);

alter table public.past_client_property  enable row level security;
alter table public.pmms_weekly           enable row level security;
alter table public.opportunity_estimates enable row level security;
alter table public.opportunity_picks     enable row level security;
alter table public.enrichment_review     enable row level security;

drop policy if exists "owner all past_client_property" on public.past_client_property;
create policy "owner all past_client_property" on public.past_client_property
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

drop policy if exists "owner all pmms_weekly" on public.pmms_weekly;
create policy "owner all pmms_weekly" on public.pmms_weekly
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

drop policy if exists "owner all opportunity_estimates" on public.opportunity_estimates;
create policy "owner all opportunity_estimates" on public.opportunity_estimates
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

drop policy if exists "owner all opportunity_picks" on public.opportunity_picks;
create policy "owner all opportunity_picks" on public.opportunity_picks
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

drop policy if exists "owner all enrichment_review" on public.enrichment_review;
create policy "owner all enrichment_review" on public.enrichment_review
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- Tunables. Weights are starting points, to be tuned after 60 days of outcomes.
-- Wednesday (ISO weekday 3) is the past-client call day: 15 picks.
insert into public.settings (key, value) values ('opportunities', '{
  "picks_per_day": 5,
  "picks_by_weekday": {"3": 15},
  "check_in_every": 5,
  "cooldown_days": 90,
  "min_months_owned": 12,
  "ai_enabled": true,
  "value_growth_by_county": {},
  "licensed_states": ["TX", "FL"],
  "active_stages": ["New Lead", "Attempted", "Contacted/Working", "Application/Estimate Sent",
                    "Application Received", "Pre-Approved", "Disclosed"],
  "weights": {
    "RATE_GAP_HIGH": 30,
    "RATE_GAP": 15,
    "EQUITY_100K": 30,
    "EQUITY_50K": 20,
    "PMI_LIKELY_REMOVABLE": 15,
    "INVESTOR": 15,
    "MOVE_UP_WINDOW": 10,
    "ANNIVERSARY": 10,
    "RECENT_ENGAGEMENT": 20,
    "KNOWN_ARM": 25
  }
}'::jsonb)
on conflict (key) do nothing;
