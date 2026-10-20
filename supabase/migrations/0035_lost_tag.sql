-- Tier 1 slice 5: mark a Bayway lead Lost from the board
-- (docs/superpowers/specs/2026-10-19-tier1-pipeline-flow-design.md, section 4).
-- Lost is a FUB TAG (`Lost`), because person stages can only be edited by the
-- FUB account owner. Mirrors bay-stages.ts (bayStageFromTags); keep in step.
--   * derive_stage(): a `lost` tag gives 'Lost', over every other signal.
--   * v_active_pipeline: same as 0034, minus 'Lost' rows (off the board).
--   * v_bayway_contacts: shows 'Lost' instead of falling back to 'Nurture'.
-- v_lead_signals is unchanged: its stage reads 'Lost', which Up Next's
-- isLostStage() already excludes.

create or replace function public.derive_stage(raw jsonb, person_stage text, business_id text)
returns text
language sql
immutable
as $$
  with t as (
    select lower(trim(x)) as tag
    from jsonb_array_elements_text(
      case when jsonb_typeof(raw->'tags') = 'array' then raw->'tags' else '[]'::jsonb end
    ) as x
  )
  select case
    -- MPG stages come from Zoho's Lead Status, not from here.
    when business_id is distinct from 'bay' then null
    -- Nurture, Realtors, Closed, Lost: off the board, whatever the tags say.
    when lower(trim(coalesce(person_stage, ''))) not in ('lead', 'pre-qualified') then null
    -- Marked lost from the board (tag `Lost`): wins over everything, parked included.
    when exists (select 1 from t where tag = 'lost') then 'Lost'
    -- Parked (Smart List 11) wins over every other stage signal.
    when exists (select 1 from t where tag = 'credit repair') then 'Nurture / Credit Repair'
    -- Pre-Qualified (pre-approved) is past application.
    when lower(trim(person_stage)) = 'pre-qualified' then 'Application Received'
    when exists (select 1 from t where tag in ('application received', 'need docs', 'under contract'))
      then 'Application Received'
    when exists (select 1 from t where tag in ('estimate sent', 'application sent'))
      then 'Application/Estimate Sent'
    when exists (select 1 from t where tag = 'working estimate') then 'Contacted/Working'
    when exists (select 1 from t where tag = 'attempted') then 'Attempted'
    else 'New Lead'
  end
$$;

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
-- Lost leads are off the board (and Up Next skips the "Lost" stage name).
where stage is not null
  and stage <> 'Lost';

create or replace view public.v_bayway_contacts
with (security_invoker = on) as
select
  c.id,
  c.name,
  c.email,
  c.phone,
  c.last_touch_at,
  coalesce(p.stage, public.derive_stage(c.raw, c.person_stage, c.business_id), 'Nurture') as stage,
  'https://baywayhtx.followupboss.com/2/people/view/' || c.external_id as crm_profile_url
from contacts c
left join v_active_pipeline p on p.id = c.id
where c.business_id = 'bay';

-- Re-derive stage_key under the new rule. A relabel, not a move, so don't
-- stamp stage_since (none carried the tag on 2026-10-20 anyway).
alter table contacts disable trigger contacts_track_stage;

update contacts
set stage_key = public.derive_stage(raw, person_stage, business_id)
where business_id = 'bay'
  and stage_key is distinct from public.derive_stage(raw, person_stage, business_id);

alter table contacts enable trigger contacts_track_stage;
