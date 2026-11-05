-- Lead Sources & ROI card (spec 2026-11-05-lead-sources-roi-design.md).
--   * source_aliases: merge raw lead sources under one label, and mark a
--     label free (no spend expected). raw is the cleaned source as the
--     Analytics table shows it.
--   * marketing_spend: one amount per book, label and month.
-- Owner only: Analytics is not on the assistant's pages.

create table if not exists public.source_aliases (
  id         uuid primary key default gen_random_uuid(),
  book       text not null check (book in ('bay', 'mpg')),
  raw        text not null,
  label      text not null check (length(trim(label)) > 0),
  is_free    boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (book, raw)
);

create table if not exists public.marketing_spend (
  id         uuid primary key default gen_random_uuid(),
  book       text not null check (book in ('bay', 'mpg')),
  source     text not null,
  month      date not null check (extract(day from month) = 1),
  amount     numeric(12, 2) not null check (amount >= 0),
  updated_at timestamptz not null default now(),
  unique (book, source, month)
);

alter table public.source_aliases enable row level security;
alter table public.marketing_spend enable row level security;

drop policy if exists "owner all source_aliases" on public.source_aliases;
create policy "owner all source_aliases" on public.source_aliases
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

drop policy if exists "owner all marketing_spend" on public.marketing_spend;
create policy "owner all marketing_spend" on public.marketing_spend
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
