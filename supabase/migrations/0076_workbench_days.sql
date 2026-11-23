-- Workbench v2, step 3 (spec 2026-11-23-workbench-v2-design.md, §4 and Data):
-- the day's order. On the first Workbench load after 6 AM Central, each work
-- list's item keys are saved in order and held until tomorrow. Items that
-- arrive later wait in "New since 8:00" until pulled in. Yesterday's unfinished
-- items go first in today's order. The end-of-day wrap (step 7) fills
-- closed_at and wrap. Per user by RLS, like work_items.
--
-- lists      { calls: [key...], files: [key...], partners: [key...] }
-- pulled_in  [key...] added after the order was set, in the order pulled
-- An item's key: a file item's source key ('estimate:<id>', 'custom:<id>'),
-- else 'contact:<contact id>'.

create table if not exists public.workbench_days (
  user_id    uuid not null default auth.uid(),
  day        date not null,
  set_at     timestamptz not null default now(),
  lists      jsonb not null default '{}'::jsonb,
  pulled_in  jsonb not null default '[]'::jsonb,
  closed_at  timestamptz,
  wrap       jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.workbench_days enable row level security;

drop policy if exists "own workbench_days select" on public.workbench_days;
create policy "own workbench_days select" on public.workbench_days
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "own workbench_days insert" on public.workbench_days;
create policy "own workbench_days insert" on public.workbench_days
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "own workbench_days update" on public.workbench_days;
create policy "own workbench_days update" on public.workbench_days
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.workbench_days_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists workbench_days_touch on public.workbench_days;
create trigger workbench_days_touch
  before update on public.workbench_days
  for each row execute function public.workbench_days_touch();
