-- Dial list phase 2: the weekday theme people join v_dial_contacts
-- (docs/superpowers/specs/2026-10-29-dialer-cadence-design.md, Weekday themes).
-- Same columns as 0049, plus person_stage and pre_approved_at at the end.
--   Mon new realtors   FUB stage Realtors, created in the last 90 days
--   Tue loan status    Disclosed, or tagged under contract (still on the board)
--   Wed past clients   FUB stage Closed / Past Client
--   Thu pre-approved   tagged Pre-Approved, on the board before Disclosed
--   Fri top partners   tagged Top Partner
create or replace view public.v_dial_contacts
with (security_invoker = on) as
select * from (
  select
    c.id,
    c.business_id,
    c.name,
    c.company,
    c.phone,
    c.email,
    case c.business_id
      when 'bay' then 'https://baywayhtx.followupboss.com/2/people/view/' || c.external_id
      else 'https://crm.zoho.com/crm/tab/Leads/' || c.external_id
    end as crm_profile_url,
    case c.business_id
      when 'bay' then public.derive_stage(c.raw, c.person_stage, c.business_id)
      else c.person_stage
    end as stage,
    c.stage_since,
    public.try_timestamptz(case c.business_id when 'bay' then c.raw->>'created' else c.raw->>'Created_Time' end)
      as crm_created_at,
    case when c.business_id = 'bay' and jsonb_typeof(c.raw->'tags') = 'array'
      then array(select lower(trim(t)) from jsonb_array_elements_text(c.raw->'tags') as t)
      else '{}'::text[]
    end as tags,
    case c.business_id when 'bay' then c.raw->>'source' else c.raw->>'Lead_Source' end as lead_source,
    coalesce(oc.calls, 0) as outbound_calls,
    coalesce(oc.calls_since_stage, 0) as outbound_calls_since_stage,
    oc.first_at as first_outbound_call_at,
    oc.last_at as last_outbound_call_at,
    oc.connected_at,
    c.person_stage,
    pa.at as pre_approved_at
  from contacts c
  left join lateral (
    select count(*)::int as calls,
           (count(*) filter (where c.stage_since is null or a.occurred_at >= c.stage_since))::int as calls_since_stage,
           min(a.occurred_at) as first_at,
           max(a.occurred_at) as last_at,
           max(a.occurred_at) filter (where public.call_connected(a.raw)) as connected_at
    from activities a
    where a.contact_id = c.id
      and a.type = 'call'
      and a.direction = 'outbound'
  ) oc on true
  left join lateral (
    -- When the OS tagged Pre-Approved (Workbench Review complete).
    select max(ca.created_at) as at
    from crm_actions ca
    where ca.contact_id = c.id
      and ca.action = 'set_stage'
      and ca.request->'payload'->>'target' = 'pre_approved'
      and ca.status in ('ok', 'partial')
  ) pa on true
) s
where (business_id = 'bay' and stage in ('New Lead', 'Attempted', 'Nurture / Credit Repair'))
   or (business_id = 'mpg' and stage in ('Not Contacted', 'Open', 'Attempted to Contact'))
   or (business_id = 'bay' and person_stage = 'Realtors' and crm_created_at >= now() - interval '90 days')
   or (business_id = 'bay' and person_stage in ('Closed', 'Past Client'))
   or (business_id = 'bay' and 'top partner' = any (tags))
   or (business_id = 'bay' and stage is not null and stage not in ('Lost', 'Nurture / Credit Repair')
       and (stage = 'Disclosed' or 'under contract' = any (tags) or 'pre-approved' = any (tags)));
