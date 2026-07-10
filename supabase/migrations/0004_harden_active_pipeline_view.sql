-- Phase 3 follow-up: harden v_active_pipeline (code-review findings).
-- 1. True prefix strip (regexp anchor) instead of global replace().
-- 2. Deterministic tag pick: last 'Imported Stage:' tag wins (most recently appended).
-- 3. Guard against raw->'tags' not being a JSON array (bad row must not break the view).
-- Contacts whose person_stage is neither tagged nor 'Lead' (e.g. Nurture) are
-- excluded by design — they are counted only in the Overview's nurture footnote.

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
    ) as stage
  from contacts c
) s
where stage is not null;
