-- Phase 3: active-pipeline view for the Overview and later pipeline screens.
-- Translates FUB import tags / person stages into a clean stage per contact.
-- security_invoker = on: queries run with the caller's rights, so the app's
-- read-only RLS (authenticated select) applies unchanged.

create or replace view public.v_active_pipeline
with (security_invoker = on) as
select id, business_id, name, email, phone, last_touch_at, stage
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
        select replace(t.tag, 'Imported Stage: ', '')
        from jsonb_array_elements_text(coalesce(c.raw->'tags', '[]'::jsonb)) as t(tag)
        where t.tag like 'Imported Stage: %'
        limit 1
      ),
      case when c.person_stage = 'Lead' then 'New Lead' end
    ) as stage
  from contacts c
) s
where stage is not null;
