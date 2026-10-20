-- Tier 1 card health (docs/superpowers/specs/2026-10-19-tier1-pipeline-flow-design.md).
-- The two board views gain the five fields Up Next reads from v_lead_signals,
-- so each card can show its next step, days in stage and speed-to-lead
-- without a second query. v_lead_signals can't be reused: it drops snoozed
-- and reason-less leads. Same expressions as v_lead_signals (0029). New
-- columns go at the END so create or replace view keeps working (as 0022).

create or replace view public.v_active_pipeline
with (security_invoker = on) as
select id, business_id, name, email, phone, last_touch_at, stage, crm_profile_url,
       docs_tracked, docs_outstanding, docs_outstanding_count,
       docs_oldest_requested_at, doc_notes,
       last_note_snippet, last_note_at,
       stage_since, crm_created_at, last_outbound_call_at,
       open_task_count, oldest_open_due_at
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
    n.occurred_at as last_note_at,
    c.stage_since,
    public.try_timestamptz(case c.business_id when 'bay' then c.raw->>'created' else c.raw->>'Created_Time' end)
      as crm_created_at,
    oc.last_outbound_call_at,
    coalesce(tk.open_task_count, 0) as open_task_count,
    tk.oldest_open_due_at
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
  left join (
    select contact_id, max(occurred_at) as last_outbound_call_at
    from activities
    where type = 'call' and direction = 'outbound' and contact_id is not null
    group by contact_id
  ) oc on oc.contact_id = c.id
  left join (
    select contact_id, count(*)::int as open_task_count, min(due_at) as oldest_open_due_at
    from tasks
    where is_completed = false and contact_id is not null
    group by contact_id
  ) tk on tk.contact_id = c.id
) s
where stage is not null;

create or replace view public.v_mpg_contacts
with (security_invoker = on) as
select
  c.id,
  c.name,
  c.company,
  c.email,
  c.phone,
  c.last_touch_at,
  coalesce(c.person_stage, '—') as stage,
  'https://crm.zoho.com/crm/tab/Leads/' || c.external_id as crm_profile_url,
  c.stage_since,
  public.try_timestamptz(c.raw->>'Created_Time') as crm_created_at,
  oc.last_outbound_call_at,
  coalesce(tk.open_task_count, 0) as open_task_count,
  tk.oldest_open_due_at
from contacts c
left join (
  select contact_id, max(occurred_at) as last_outbound_call_at
  from activities
  where type = 'call' and direction = 'outbound' and contact_id is not null
  group by contact_id
) oc on oc.contact_id = c.id
left join (
  select contact_id, count(*)::int as open_task_count, min(due_at) as oldest_open_due_at
  from tasks
  where is_completed = false and contact_id is not null
  group by contact_id
) tk on tk.contact_id = c.id
where c.business_id = 'mpg';

-- Keep settings.priority_rules mirroring DEFAULT_RULES (priorityQueue.js).
-- Only adds the key; never overwrites a value Chandler has edited.
update settings
set value = value || jsonb_build_object('stuck_days_by_stage', jsonb_build_object(
  'New Lead', 2,
  'Attempted', 5,
  'Contacted/Working', 7,
  'Application/Estimate Sent', 7,
  'Application Received', 14,
  'Nurture / Credit Repair', null
))
where key = 'priority_rules'
  and not (value ? 'stuck_days_by_stage');
