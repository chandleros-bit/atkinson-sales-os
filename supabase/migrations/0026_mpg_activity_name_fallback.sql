-- MPG activity feed: fall back to the name Zoho stored on the activity when the
-- linked contact can't be resolved. MPG logs calls against Leads (the person
-- sits in What_Id / Who_Id on the raw payload), and a lead that hasn't been
-- pulled into `contacts` yet — or was deleted — leaves contact_id null, which
-- otherwise renders as "(unknown)". Coalescing the raw Who_Id/What_Id name means
-- a row still shows who it was with. contact_id stays as-is, so the CRM link
-- lights up whenever the lead is synced. Unlike v_bayway_activity (FUB always
-- resolves the person), this view needs the fallback because of the Lead split.

create or replace view public.v_mpg_activity
with (security_invoker = on) as
select
  a.id,
  a.type,
  a.occurred_at,
  a.contact_id,
  coalesce(
    c.name,
    a.raw -> 'Who_Id'  ->> 'name',
    a.raw -> 'What_Id' ->> 'name'
  ) as contact_name,
  c.company as company,
  c.owner   as owner,
  a.notes   as snippet,
  a.business_id
from activities a
left join contacts c on c.id = a.contact_id
where a.business_id = 'mpg'
  and a.type in ('call', 'text', 'email', 'note', 'appointment')
order by a.occurred_at desc nulls last, a.id desc;
