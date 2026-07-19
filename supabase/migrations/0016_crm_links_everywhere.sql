-- Clickable leads everywhere: extend the CRM deep-link from 0015 (contacts views)
-- to the two remaining lead surfaces — the Pipeline board / Overview "Needs
-- Attention" (v_active_pipeline) and the Activity feed (v_bayway_activity).
--   Bayway -> Follow Up Boss person  (locked account URL, same as 0013/0015)
--   MPG    -> Zoho CRM Lead record   (US data center; MPG pipeline lives on Leads)
-- v_active_pipeline carries BOTH businesses, so the link is chosen per row.
-- Columns are appended at the end so `create or replace view` keeps dependents
-- (v_bayway_contacts joins this view) valid. security_invoker stays on.

create or replace view public.v_active_pipeline
with (security_invoker = on) as
select id, business_id, name, email, phone, last_touch_at, stage, crm_profile_url
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
    end as crm_profile_url
  from contacts c
) s
where stage is not null;

create or replace view public.v_bayway_activity
with (security_invoker = on) as
select
  a.id,
  a.type,
  a.occurred_at,
  a.contact_id,
  c.name    as contact_name,
  c.company as company,
  c.owner   as owner,
  a.notes   as snippet,
  a.business_id,
  'https://baywayhtx.followupboss.com/2/people/view/' || c.external_id as crm_profile_url
from activities a
left join contacts c on c.id = a.contact_id
where a.business_id = 'bay'
  and a.type in ('call', 'text', 'email', 'note', 'appointment')
order by a.occurred_at desc nulls last, a.id desc;
