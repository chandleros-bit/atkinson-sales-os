-- Arive loans import (docs/superpowers/specs/2026-10-30-arive-loans-import-design.md).
--   * loans: one row per Arive loan, upserted from the browser by
--     arive_loan_id. Import-owned columns are overwritten on every import;
--     scenario_override and comp_override belong to Chandler and the import
--     never sends them. No delete policy: the OS never deletes loans.
--   * settings 'arive': loan officer name and commission rates.
--   * sync_log: the browser logs each import with source 'arive'.

create table if not exists public.loans (
  id uuid primary key default gen_random_uuid(),
  arive_loan_id text not null unique,
  business_id text not null default 'bay' references public.businesses(id),
  loan_officer text,
  role text not null default 'primary' check (role in ('primary', 'assisted')),
  borrower_name text,
  borrower_first text,
  borrower_last text,
  borrower_email text,
  borrower_phone text,
  co_borrower_name text,
  co_borrower_email text,
  contact_id uuid references public.contacts(id) on delete set null,
  amount numeric,
  purpose text,
  stage text,
  stage_group text check (stage_group in ('prospect', 'processing', 'closing', 'funded', 'adverse', 'other')),
  property_address text,
  property_state text,
  lender text,
  title_company text,
  closed_on date,
  funded_on date,
  firm_closing_on date,
  application_on date,
  rate numeric,
  loan_type text,
  term_months int,
  buyer_agent_name text,
  buyer_agent_company text,
  buyer_agent_email text,
  buyer_agent_phone text,
  seller_agent_name text,
  seller_agent_company text,
  seller_agent_email text,
  seller_agent_phone text,
  scenario_auto boolean not null default false,
  scenario_override boolean,
  comp_override numeric,
  raw jsonb,
  first_imported_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists loans_funded_on_idx on public.loans (funded_on);
create index if not exists loans_stage_group_idx on public.loans (stage_group);

alter table public.loans enable row level security;
drop policy if exists "authenticated select loans" on public.loans;
create policy "authenticated select loans" on public.loans
  for select to authenticated using (true);
drop policy if exists "authenticated insert loans" on public.loans;
create policy "authenticated insert loans" on public.loans
  for insert to authenticated with check (true);
drop policy if exists "authenticated update loans" on public.loans;
create policy "authenticated update loans" on public.loans
  for update to authenticated using (true) with check (true);

insert into public.settings (key, value)
values ('arive', '{"lo_name": "Chandler Dean Atkinson", "primary_pct": 1.25, "assisted_pct": 0.75}'::jsonb)
on conflict (key) do nothing;

drop policy if exists "authenticated insert arive settings" on public.settings;
create policy "authenticated insert arive settings" on public.settings
  for insert to authenticated with check (key = 'arive');
drop policy if exists "authenticated update arive settings" on public.settings;
create policy "authenticated update arive settings" on public.settings
  for update to authenticated using (key = 'arive') with check (key = 'arive');

drop policy if exists "authenticated insert arive sync_log" on public.sync_log;
create policy "authenticated insert arive sync_log" on public.sync_log
  for insert to authenticated with check (source = 'arive');
