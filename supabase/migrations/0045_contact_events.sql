-- Calls and meetings you schedule from a contact ("call with Jane Doe, Thu
-- 2:30 PM"), with an in-app reminder before each. See
-- docs/superpowers/specs/2026-10-29-contact-events-design.md.
--
-- App-owned and per user, like work_items: it never touches a CRM or Outlook.
-- The Calendar page and the Overview "Today's Events" card show these next to
-- calendar_events; ReminderHost pops a reminder remind_min minutes before
-- starts_at and stamps reminded_at so it fires once across tabs and devices.
create table if not exists contact_events (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid(),
  business_id   text not null references businesses(id),
  contact_id    uuid not null references contacts(id) on delete cascade,
  kind          text not null check (kind in ('call', 'meeting')),
  starts_at     timestamptz not null,
  duration_min  int not null default 30 check (duration_min between 5 and 480),
  note          text,
  -- Minutes before starts_at to remind; null = no reminder.
  remind_min    int check (remind_min is null or remind_min between 0 and 1440),
  status        text not null default 'scheduled' check (status in ('scheduled', 'done', 'canceled')),
  reminded_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists contact_events_user_starts on contact_events (user_id, starts_at);
create index if not exists contact_events_contact on contact_events (contact_id, starts_at);

alter table contact_events enable row level security;

drop policy if exists "own contact_events select" on contact_events;
create policy "own contact_events select" on contact_events
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "own contact_events insert" on contact_events;
create policy "own contact_events insert" on contact_events
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "own contact_events update" on contact_events;
create policy "own contact_events update" on contact_events
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own contact_events delete" on contact_events;
create policy "own contact_events delete" on contact_events
  for delete to authenticated using (user_id = auth.uid());

create or replace function public.contact_events_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists contact_events_touch on contact_events;
create trigger contact_events_touch
  before update on contact_events
  for each row execute function public.contact_events_touch();
