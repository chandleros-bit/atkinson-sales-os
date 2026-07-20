-- Phase 13 — unified Tasks screen. Normalized, source-agnostic task table
-- alongside contacts / deals / activities. Populated by fub-task-sync and
-- zoho-task-sync with the service role; the app only SELECTs (read-only RLS,
-- same shape as every table in 0001_init.sql).

create table if not exists tasks (
  id           uuid primary key default gen_random_uuid(),
  business_id  text not null references businesses(id),   -- 'mpg' | 'bay'
  source_crm   text not null,                             -- 'fub' | 'zoho'
  external_id  text not null,                             -- id in the source CRM
  contact_id   uuid references contacts(id),
  deal_id      uuid references deals(id),
  title        text,
  task_type    text,
  due_at       timestamptz,
  priority     text,
  owner        text,
  is_completed boolean not null default false,
  raw          jsonb,
  updated_at   timestamptz not null default now(),
  unique (source_crm, external_id)
);

alter table tasks enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'tasks'
      and policyname = 'authenticated read tasks'
  ) then
    execute 'create policy "authenticated read tasks" on tasks for select to authenticated using (true)';
  end if;
end $$;

-- The board's core filter+sort, and contact resolution / future drill-in.
create index if not exists idx_tasks_open_due on tasks (business_id, is_completed, due_at);
create index if not exists idx_tasks_contact  on tasks (contact_id);
