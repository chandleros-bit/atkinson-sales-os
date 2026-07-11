-- Phase 7: MPG contacts view — all MPG (Zoho) contacts with the merchant
-- company name and the raw Zoho lead status as 'stage'. security_invoker = on
-- keeps the app's read-only RLS in force. One row per MPG contact.

create or replace view public.v_mpg_contacts
with (security_invoker = on) as
select
  c.id,
  c.name,
  c.company,
  c.email,
  c.phone,
  c.last_touch_at,
  coalesce(c.person_stage, '—') as stage
from contacts c
where c.business_id = 'mpg';
