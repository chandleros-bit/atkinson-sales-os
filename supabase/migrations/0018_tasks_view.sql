-- Phase 13 — unified Tasks view. One row per OPEN task, joined to its contact
-- (name / company / CRM deep link) and optional deal. security_invoker = on
-- keeps the app's read-only RLS in force (as with v_bayway_activity).
-- Ascending order — soonest and overdue first, the opposite of the feed.
--
-- crm_profile_url is not a real column on `contacts` (see 0015/0016) — it's
-- always computed per-business from external_id. tasks spans both business_id
-- values, so this reuses the same case-per-business pattern as
-- v_active_pipeline (0016_crm_links_everywhere.sql) rather than referencing a
-- column that doesn't exist.

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
  d.name             as deal_name
from tasks t
left join contacts c on c.id = t.contact_id
left join deals    d on d.id = t.deal_id
where t.is_completed = false
order by t.due_at asc nulls last, t.id asc;
