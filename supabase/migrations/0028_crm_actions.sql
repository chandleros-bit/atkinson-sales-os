-- Quick Actions (CRM write-back v1). Audit + idempotency table for the
-- crm-action edge function, the per-book feature flag, and a phone on the two
-- read models whose rows show actions (Log call needs one for FUB).
--
-- The app still never writes CRM-mirrored tables directly: crm-action writes
-- with the service role (bypasses RLS). Authenticated users may only SELECT
-- crm_actions (the Sync Status "Write-back" row reads it). The metric_targets
-- policy from 0012 is untouched.

create table if not exists crm_actions (
  id               uuid primary key default gen_random_uuid(),
  -- One per submit. Inserted FIRST with status 'pending', so the unique key
  -- picks a single winner when the same submit arrives twice.
  client_action_id uuid not null unique,
  user_id          uuid not null,
  action           text not null,      -- log_call | add_note | create_task | complete_task | push_task
  business_id      text not null references businesses(id),
  contact_id       uuid references contacts(id),
  task_id          uuid references tasks(id),
  request          jsonb not null,
  results          jsonb,              -- [{ step, ok, crm_id, error, mirror_error }]
  status           text not null
                   check (status in ('pending', 'ok', 'partial', 'error', 'refused')),
  created_at       timestamptz not null default now()
);

alter table crm_actions enable row level security;

-- Idempotent drop-then-create, same style as 0012.
drop policy if exists "authenticated read crm_actions" on crm_actions;
create policy "authenticated read crm_actions" on crm_actions
  for select to authenticated using (true);

create index if not exists crm_actions_created_idx on crm_actions (created_at desc);

-- Per-book switch. The UI hides actions and the function refuses them for a
-- book that is off. MPG turns on after the Zoho re-authorization.
insert into settings (key, value)
values ('writeback_enabled', '{"bay": true, "mpg": false}')
on conflict (key) do nothing;

-- v_priority_leads + phone (appended last: create or replace may only add
-- trailing columns). Otherwise identical to 0013.
create or replace view public.v_priority_leads
with (security_invoker = on) as
select
  c.id,
  c.business_id,
  c.name,
  c.owner,
  c.score,
  c.tier,
  c.last_activity_at,
  la.type as last_activity_type,
  c.ai_note,
  c.ai_note_generated_at,
  coalesce(c.raw->'tags', '[]'::jsonb) as tags,
  'https://baywayhtx.followupboss.com/2/people/view/' || c.external_id as fub_profile_url,
  c.phone
from contacts c
left join lateral (
  select a.type
  from activities a
  where a.contact_id = c.id
  order by a.occurred_at desc nulls last
  limit 1
) la on true
where c.business_id = 'bay'
  and c.source_crm = 'fub'
  and c.tier is not null;

-- v_tasks + the contact's phone (appended last). Otherwise identical to 0018.
create or replace view public.v_tasks
with (security_invoker = on) as
select
  t.id,
  t.business_id,
  t.source_crm,
  t.task_type,
  t.title,
  t.due_at,
  t.priority,
  t.owner,
  t.contact_id,
  c.name             as contact_name,
  c.company          as company,
  case c.business_id
    when 'bay' then 'https://baywayhtx.followupboss.com/2/people/view/' || c.external_id
    when 'mpg' then 'https://crm.zoho.com/crm/tab/Leads/' || c.external_id
  end                as crm_profile_url,
  t.deal_id,
  d.name             as deal_name,
  c.phone            as contact_phone
from tasks t
left join contacts c on c.id = t.contact_id
left join deals    d on d.id = t.deal_id
where t.is_completed = false
order by t.due_at asc nulls last, t.id asc;
