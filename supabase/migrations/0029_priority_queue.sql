-- Priority queue ("Up Next"). See
-- docs/superpowers/specs/2026-10-18-priority-queue-design.md and
-- docs/superpowers/plans/2026-10-18-priority-queue.md.
--
--   1. derive_stage(): the Bayway stage expression, moved out of
--      v_active_pipeline so the stage-tracking trigger can share it.
--   2. contacts.stage_key / stage_since + trigger ("Stuck in stage").
--   3. lead_snoozes: app-owned, per-user, never touches the CRM.
--   4. settings.priority_rules.
--   5. v_lead_signals: one row per CANDIDATE lead with its touch and task
--      aggregates, so the browser never loads the whole book.

-- ------------------------------------------------------------ 1. derive_stage
-- Same expression v_active_pipeline used inline since 0003/0022: the latest
-- "Imported Stage: X" FUB tag, else 'New Lead' for person stage 'Lead'.
-- business_id is accepted for future per-book rules; today it is unused.
--
-- No-change check (run before and after applying; the hashes must match):
--   select count(*), md5(string_agg(id::text || ':' || coalesce(stage, ''), ',' order by id))
--   from v_active_pipeline;
create or replace function public.derive_stage(raw jsonb, person_stage text, business_id text)
returns text
language sql
immutable
as $$
  select coalesce(
    (
      select regexp_replace(t.tag, '^Imported Stage: ', '')
      from jsonb_array_elements_text(
        case when jsonb_typeof(raw->'tags') = 'array' then raw->'tags' else '[]'::jsonb end
      ) with ordinality as t(tag, ord)
      where t.tag like 'Imported Stage: %'
      order by t.ord desc
      limit 1
    ),
    case when person_stage = 'Lead' then 'New Lead' end
  )
$$;

-- Identical to 0022 except the stage column now calls derive_stage().
create or replace view public.v_active_pipeline
with (security_invoker = on) as
select id, business_id, name, email, phone, last_touch_at, stage, crm_profile_url,
       docs_tracked, docs_outstanding, docs_outstanding_count,
       docs_oldest_requested_at, doc_notes,
       last_note_snippet, last_note_at
from (
  select
    c.id,
    c.business_id,
    c.name,
    c.email,
    c.phone,
    c.last_touch_at,
    public.derive_stage(c.raw, c.person_stage, c.business_id) as stage,
    case c.business_id
      when 'bay' then 'https://baywayhtx.followupboss.com/2/people/view/' || c.external_id
      when 'mpg' then 'https://crm.zoho.com/crm/tab/Leads/' || c.external_id
    end as crm_profile_url,
    (bdt.id is not null) as docs_tracked,
    coalesce(d.names, '{}'::text[]) as docs_outstanding,
    coalesce(d.cnt, 0) as docs_outstanding_count,
    d.oldest as docs_oldest_requested_at,
    bdt.notes as doc_notes,
    n.snippet as last_note_snippet,
    n.occurred_at as last_note_at
  from contacts c
  left join borrower_doc_tracking bdt
    on c.business_id = 'bay'
   and bdt.removed_at is null
   and bdt.fub_person_id = c.external_id
  left join lateral (
    select array_agg(bd.doc_type order by bd.first_requested_at asc nulls last, bd.doc_type asc) as names,
           count(*)::int as cnt,
           min(bd.first_requested_at) as oldest
    from borrower_docs bd
    where bd.tracking_id = bdt.id
      and bd.status = 'needed'
      and bd.removed_at is null
  ) d on true
  left join lateral (
    select a.notes as snippet, a.occurred_at
    from activities a
    where a.contact_id = c.id
      and a.type = 'note'
    order by a.occurred_at desc nulls last, a.id desc
    limit 1
  ) n on c.business_id = 'bay'
) s
where stage is not null;

-- ------------------------------------------------------ 2. stage tracking
alter table contacts add column if not exists stage_key text;
alter table contacts add column if not exists stage_since timestamptz;

-- Backfill the current stage but NOT stage_since: nobody knows when today's
-- stages began, and a fake date would flag the whole book as stuck on day one.
-- "Stuck in stage" only fires once a lead has a real, observed stage change.
-- Runs before the trigger exists, so it can't stamp stage_since = now().
update contacts
set stage_key = case when business_id = 'mpg' then person_stage
                     else public.derive_stage(raw, person_stage, business_id) end
where stage_key is distinct from
      case when business_id = 'mpg' then person_stage
           else public.derive_stage(raw, person_stage, business_id) end;

create or replace function public.contacts_track_stage()
returns trigger
language plpgsql
as $$
declare
  k text := case when new.business_id = 'mpg' then new.person_stage
                 else public.derive_stage(new.raw, new.person_stage, new.business_id) end;
begin
  if tg_op = 'INSERT' then
    new.stage_key := k;
    new.stage_since := case when k is not null then now() end;
  elsif k is distinct from old.stage_key then
    new.stage_key := k;
    new.stage_since := now();
  else
    -- Unchanged stage: keep the observed start even if a writer sent these.
    new.stage_key := old.stage_key;
    new.stage_since := old.stage_since;
  end if;
  return new;
end
$$;

drop trigger if exists contacts_track_stage on contacts;
create trigger contacts_track_stage
  before insert or update on contacts
  for each row execute function public.contacts_track_stage();

-- ------------------------------------------------------------ 3. snoozes
create table if not exists lead_snoozes (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid not null references contacts(id) on delete cascade,
  until_date  date not null,
  reason      text,
  user_id     uuid not null default auth.uid(),
  created_at  timestamptz not null default now()
);

alter table lead_snoozes enable row level security;

drop policy if exists "own lead_snoozes select" on lead_snoozes;
create policy "own lead_snoozes select" on lead_snoozes
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "own lead_snoozes insert" on lead_snoozes;
create policy "own lead_snoozes insert" on lead_snoozes
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "own lead_snoozes delete" on lead_snoozes;
create policy "own lead_snoozes delete" on lead_snoozes
  for delete to authenticated using (user_id = auth.uid());

create index if not exists lead_snoozes_contact_idx on lead_snoozes (contact_id, until_date);

-- ------------------------------------------------------------ 4. settings
-- Values from the 2026-10-18 data check (see the plan). Edit in SQL for now.
insert into settings (key, value)
values ('priority_rules', '{
  "new_lead_days": 7,
  "hot_cold_days": 3,
  "quiet_days": 7,
  "stuck_days": 14,
  "daily_cap": 15,
  "use_crm_last_activity_fallback": true,
  "mpg_active_statuses": ["Open", "Pending", "Initial lead follow up"],
  "mpg_hot_statuses": [],
  "mpg_dead_statuses": [],
  "bay_partner_stages": ["Realtors"],
  "bay_excluded_stages": ["Nurture", "Closed", "Lost"]
}'::jsonb)
on conflict (key) do nothing;

-- ------------------------------------------------------- 5. v_lead_signals
-- CRM date strings live in contacts.raw; one malformed value must not make
-- every query on the view fail, so casts go through this guard.
create or replace function public.try_timestamptz(v text)
returns timestamptz
language plpgsql
stable
as $$
begin
  if v is null or v !~ '^\d{4}-\d{2}-\d{2}' then return null; end if;
  return v::timestamptz;
exception when others then
  return null;
end
$$;

-- "Human touch" comes from activities only (outbound call, note, appointment),
-- never contacts.last_touch_at, which for FUB falls back to person.updated and
-- so moves on tag changes and automations. crm_last_activity_at is exposed
-- for the opt-in fallback, which the browser applies (priorityQueue.js).
--
-- security_invoker = on: the app's read RLS applies, and lead_snoozes only
-- shows the signed-in user's own snoozes.
create or replace view public.v_lead_signals
with (security_invoker = on) as
with rules as (
  select coalesce((select value from settings where key = 'priority_rules'), '{}'::jsonb) as r
),
list as (
  select
    array(select jsonb_array_elements_text(coalesce(r->'mpg_active_statuses', '[]'))) as mpg_active,
    array(select jsonb_array_elements_text(coalesce(r->'mpg_hot_statuses', '[]'))) as mpg_hot,
    array(select jsonb_array_elements_text(coalesce(r->'mpg_dead_statuses', '[]'))) as mpg_dead,
    array(select jsonb_array_elements_text(coalesce(r->'bay_partner_stages', '["Realtors"]'))) as bay_partner,
    array(select jsonb_array_elements_text(coalesce(r->'bay_excluded_stages', '["Nurture","Closed","Lost"]'))) as bay_excluded,
    coalesce((r->>'new_lead_days')::int, 7) as new_lead_days
  from rules
),
act as (
  select
    contact_id,
    max(occurred_at) filter (
      where (type = 'call' and direction = 'outbound') or type in ('note', 'appointment')
    ) as last_outbound_at,
    max(occurred_at) filter (where type = 'call' and direction = 'outbound') as last_outbound_call_at,
    max(occurred_at) filter (where type = 'call' and direction = 'inbound') as last_inbound_at
  from activities
  where contact_id is not null
  group by contact_id
),
tk as (
  select contact_id, count(*)::int as open_task_count, min(due_at) as oldest_open_due_at
  from tasks
  where is_completed = false and contact_id is not null
  group by contact_id
),
sn as (
  select
    contact_id,
    bool_or(until_date > (now() at time zone 'America/Chicago')::date) as snoozed,
    (count(*) filter (where created_at > now() - interval '60 days'))::int as snooze_count_60d
  from lead_snoozes
  group by contact_id
),
base as (
  select
    c.id,
    c.business_id,
    c.name,
    c.company,
    c.phone,
    case c.business_id
      when 'bay' then 'https://baywayhtx.followupboss.com/2/people/view/' || c.external_id
      when 'mpg' then 'https://crm.zoho.com/crm/tab/Leads/' || c.external_id
    end as crm_profile_url,
    case when c.business_id = 'mpg' then c.person_stage
         else public.derive_stage(c.raw, c.person_stage, c.business_id) end as stage,
    c.person_stage,
    c.stage_since,
    c.score,
    c.tier,
    case c.business_id
      when 'bay' then (
        c.tier = 'hot'
        or exists (
          select 1
          from jsonb_array_elements_text(
            case when jsonb_typeof(c.raw->'tags') = 'array' then c.raw->'tags' else '[]'::jsonb end
          ) as t(tag)
          where lower(trim(t.tag)) = 'hot'
        )
      )
      else coalesce(c.person_stage = any (l.mpg_hot), false)
    end as is_hot,
    coalesce(c.business_id = 'bay' and c.person_stage = any (l.bay_partner), false) as is_partner,
    public.try_timestamptz(case c.business_id when 'bay' then c.raw->>'created' else c.raw->>'Created_Time' end)
      as crm_created_at,
    public.try_timestamptz(case c.business_id when 'bay' then c.raw->>'lastActivity' else c.raw->>'Last_Activity_Time' end)
      as crm_last_activity_at,
    a.last_outbound_at,
    a.last_outbound_call_at,
    a.last_inbound_at,
    coalesce(tk.open_task_count, 0) as open_task_count,
    tk.oldest_open_due_at,
    coalesce(sn.snoozed, false) as snoozed,
    coalesce(sn.snooze_count_60d, 0) as snooze_count_60d,
    l.mpg_active,
    l.mpg_dead,
    l.bay_excluded,
    l.new_lead_days
  from contacts c
  cross join list l
  left join act a on a.contact_id = c.id
  left join tk on tk.contact_id = c.id
  left join sn on sn.contact_id = c.id
),
flagged as (
  select
    b.*,
    -- Mirrors LOST_KEYWORDS in src/lib/pipeline.js; keep the two in sync.
    (
      coalesce(b.stage, '') ~* '(lost|dead|disengaged|withdrawn|denied|junk|unqualified|not qualified|nurture)'
      or coalesce(b.business_id = 'bay' and b.person_stage = any (b.bay_excluded), false)
      or coalesce(b.business_id = 'mpg' and b.person_stage = any (b.mpg_dead), false)
    ) as is_excluded,
    coalesce(b.last_inbound_at > coalesce(b.last_outbound_at, '-infinity'::timestamptz), false) as inbound_waiting
  from base b
),
scored as (
  select
    f.*,
    coalesce(
      case f.business_id
        when 'bay' then f.stage is not null and not f.is_partner
        else f.person_stage = any (f.mpg_active)
      end,
      false
    ) as is_active
  from flagged f
)
select
  id, business_id, name, company, phone, crm_profile_url,
  stage, person_stage, stage_since, is_hot, is_active, is_partner, score, tier,
  crm_created_at, crm_last_activity_at,
  last_outbound_at, last_outbound_call_at, last_inbound_at,
  greatest(last_outbound_at, last_inbound_at) as human_touch_at,
  open_task_count, oldest_open_due_at, snooze_count_60d
from scored
where not is_excluded
  and not snoozed
  and (
    inbound_waiting
    or (
      not is_partner
      and (
        is_active
        or is_hot
        or open_task_count > 0
        or crm_created_at >= now() - make_interval(days => new_lead_days)
      )
    )
  );
