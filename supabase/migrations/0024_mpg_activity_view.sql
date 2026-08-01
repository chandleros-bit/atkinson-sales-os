-- MPG activity feed view. Mirror of 0009's v_bayway_activity: one row per MPG
-- activity, joined to its contact for name/company/owner. security_invoker = on
-- keeps the app's read-only RLS in force. Ordered most-recent first; the screen
-- paginates with range(). Rows come from zoho-activity-sync (source_crm 'zoho').
-- The feed-query index added in 0011 (business_id, occurred_at desc, id desc)
-- already covers business_id = 'mpg', so no new index is needed here.

create or replace view public.v_mpg_activity
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
where a.business_id = 'mpg'
  and a.type in ('call', 'text', 'email', 'note', 'appointment')
order by a.occurred_at desc nulls last, a.id desc;
