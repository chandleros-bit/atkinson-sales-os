-- Phase 15: Clickable contacts — add a CRM deep-link to both contact views so
-- the Contacts page can link each name straight to its source-CRM profile.
--   Bayway  -> Follow Up Boss person  (locked account URL, same pattern as
--              v_priority_leads.fub_profile_url in 0013).
--   MPG     -> Zoho CRM Lead record   (US data center; MPG's pipeline lives on
--              the Leads module, so all MPG contacts deep-link to the Leads tab).
-- Both views keep security_invoker = on so the app's read-only RLS is unchanged.

create or replace view public.v_bayway_contacts
with (security_invoker = on) as
select
  c.id,
  c.name,
  c.email,
  c.phone,
  c.last_touch_at,
  coalesce(p.stage, 'Nurture') as stage,
  'https://baywayhtx.followupboss.com/2/people/view/' || c.external_id as crm_profile_url
from contacts c
left join v_active_pipeline p on p.id = c.id
where c.business_id = 'bay';

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
  'https://crm.zoho.com/crm/tab/Leads/' || c.external_id as crm_profile_url
from contacts c
where c.business_id = 'mpg';
