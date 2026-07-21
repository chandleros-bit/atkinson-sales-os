-- Surface borrower doc status and the last conversation note on the pipeline
-- board. Appended to v_active_pipeline (not a new view) so the Pipeline page
-- keeps one query. New columns go at the END so `create or replace view` keeps
-- dependents (v_bayway_contacts joins this view) valid — same rule as 0016.
-- Both laterals are null/empty for MPG: there is no Arive and no sheet there.

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
    coalesce(
      (
        select regexp_replace(t.tag, '^Imported Stage: ', '')
        from jsonb_array_elements_text(
          case when jsonb_typeof(c.raw->'tags') = 'array'
               then c.raw->'tags' else '[]'::jsonb end
        ) with ordinality as t(tag, ord)
        where t.tag like 'Imported Stage: %'
        order by t.ord desc
        limit 1
      ),
      case when c.person_stage = 'Lead' then 'New Lead' end
    ) as stage,
    case c.business_id
      when 'bay' then 'https://baywayhtx.followupboss.com/2/people/view/' || c.external_id
      when 'mpg' then 'https://crm.zoho.com/crm/tab/Leads/' || c.external_id
    end as crm_profile_url,
    -- Presence of a tracking row IS the "tracked" signal: it distinguishes
    -- "not in the sheet" from "in the sheet, owes nothing".
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
  -- Oldest-requested first, so the two names the card shows are always the two
  -- that have been outstanding longest.
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
