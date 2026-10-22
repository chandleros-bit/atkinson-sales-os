-- Workbench work items (slice 3). See
-- docs/superpowers/specs/2026-10-22-workbench-design.md and
-- docs/superpowers/plans/2026-10-22-workbench-work-items.md.
--
-- App-owned and per user, like lead_snoozes: it never touches a CRM. Holds
-- what the CRMs can't: a status (Working / Waiting on…), a check-back day,
-- notes, the weekly application review and your own custom items.
--
-- Estimate, application and MPG-task items are generated in the browser from
-- CRM state (workbench.js). Their row is created the first time you change
-- one, keyed by the item's key in source_key:
--   estimate:<contact id>   application:<contact id>   mpg_task:<task id>
-- Custom items ("+ Work item") have no source_key.
create table if not exists work_items (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid(),
  business_id    text not null references businesses(id),
  source_key     text,
  kind           text not null check (kind in ('estimate', 'application', 'statement', 'custom')),
  contact_id     uuid references contacts(id) on delete cascade,
  title          text,
  status         text not null default 'open' check (status in ('open', 'working', 'waiting', 'done')),
  waiting_on     text,
  check_back_on  date,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  done_at        timestamptz,
  constraint work_items_custom_has_title check (kind <> 'custom' or nullif(trim(title), '') is not null),
  constraint work_items_generated_has_key check (kind = 'custom' or source_key is not null)
);

-- The browser upserts generated items on (user_id, source_key). Custom rows
-- have a null source_key, which never conflicts.
create unique index if not exists work_items_user_source_key on work_items (user_id, source_key);
create index if not exists work_items_user_status on work_items (user_id, status, done_at);

alter table work_items enable row level security;

drop policy if exists "own work_items select" on work_items;
create policy "own work_items select" on work_items
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "own work_items insert" on work_items;
create policy "own work_items insert" on work_items
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "own work_items update" on work_items;
create policy "own work_items update" on work_items
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own work_items delete" on work_items;
create policy "own work_items delete" on work_items
  for delete to authenticated using (user_id = auth.uid());

-- updated_at is always now(). done_at: the browser sends it when it marks an
-- item done (so a second weekly review re-stamps it); a done row without one
-- gets now(), and reopening a row clears it.
create or replace function public.work_items_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  if new.status = 'done' then
    new.done_at := coalesce(new.done_at, now());
  else
    new.done_at := null;
  end if;
  return new;
end
$$;

drop trigger if exists work_items_touch on work_items;
create trigger work_items_touch
  before insert or update on work_items
  for each row execute function public.work_items_touch();
