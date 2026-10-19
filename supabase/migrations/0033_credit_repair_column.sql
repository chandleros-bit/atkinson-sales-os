-- Bayway "Nurture / Credit Repair" column, matching FUB Smart List
-- "11 - Nurture / Credit Repair" (tag `Credit Repair`). A parked lead stays
-- parked whatever other stage tag or Pre-Qualified stage it has. Mirrors
-- supabase/functions/_shared/bay-stages.ts (bayStageFromTags); keep in step.
-- The stage name contains "Nurture", so v_lead_signals (Up Next) excludes
-- these leads, the same as FUB-stage Nurture.

create or replace function public.derive_stage(raw jsonb, person_stage text, business_id text)
returns text
language sql
immutable
as $$
  with t as (
    select lower(trim(x)) as tag
    from jsonb_array_elements_text(
      case when jsonb_typeof(raw->'tags') = 'array' then raw->'tags' else '[]'::jsonb end
    ) as x
  )
  select case
    -- MPG stages come from Zoho's Lead Status, not from here.
    when business_id is distinct from 'bay' then null
    -- Nurture, Realtors, Closed, Lost: off the board, whatever the tags say.
    when lower(trim(coalesce(person_stage, ''))) not in ('lead', 'pre-qualified') then null
    -- Parked (Smart List 11) wins over every other stage signal.
    when exists (select 1 from t where tag = 'credit repair') then 'Nurture / Credit Repair'
    -- Pre-Qualified (pre-approved) is past application.
    when lower(trim(person_stage)) = 'pre-qualified' then 'Application Received'
    when exists (select 1 from t where tag in ('application received', 'need docs', 'under contract'))
      then 'Application Received'
    when exists (select 1 from t where tag in ('estimate sent', 'application sent'))
      then 'Application/Estimate Sent'
    when exists (select 1 from t where tag = 'working estimate') then 'Contacted/Working'
    when exists (select 1 from t where tag = 'attempted') then 'Attempted'
    else 'New Lead'
  end
$$;

-- These leads were already tagged; putting them in the new column is a
-- relabel, not a move, so don't stamp stage_since.
alter table contacts disable trigger contacts_track_stage;

update contacts
set stage_key = public.derive_stage(raw, person_stage, business_id)
where business_id = 'bay'
  and stage_key is distinct from public.derive_stage(raw, person_stage, business_id);

alter table contacts enable trigger contacts_track_stage;
