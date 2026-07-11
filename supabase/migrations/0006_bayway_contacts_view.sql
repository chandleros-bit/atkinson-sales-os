-- Phase 6: Bayway contacts view — every Bayway contact enriched with its
-- pipeline stage (Pre-Approved / Waiting on Docs / New Lead) via
-- v_active_pipeline, defaulting to 'Nurture' for everyone else.
-- security_invoker = on keeps the app's read-only RLS in force (as with
-- v_active_pipeline). One row per Bayway contact. No base-schema change.

create or replace view public.v_bayway_contacts
with (security_invoker = on) as
select
  c.id,
  c.name,
  c.email,
  c.phone,
  c.last_touch_at,
  coalesce(p.stage, 'Nurture') as stage
from contacts c
left join v_active_pipeline p on p.id = c.id
where c.business_id = 'bay';
