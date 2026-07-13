-- Phase 11: Bayway activity feed view. One row per Bayway activity, joined to
-- its contact for name/company/owner. security_invoker = on keeps the app's
-- read-only RLS in force (as with v_bayway_contacts / v_active_pipeline).
-- Ordered most-recent first; the screen paginates with range().

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
  a.business_id
from activities a
left join contacts c on c.id = a.contact_id
where a.business_id = 'bay'
  and a.type in ('call', 'text', 'email', 'note', 'appointment')
order by a.occurred_at desc nulls last;
