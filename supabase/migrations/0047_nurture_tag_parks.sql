-- Nurture and Credit Repair are now two Move stage choices that tag FUB
-- `Nurture` or `Credit Repair`; both park the lead in the one
-- "Nurture / Credit Repair" column. derive_stage() reads either tag as parked,
-- mirroring bayStageFromTags() in supabase/functions/_shared/bay-stages.ts.
-- Otherwise identical to 0035. Every view that calls derive_stage picks this
-- up; none of their columns change.

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
    -- Marked lost from the board (tag `Lost`): wins over everything, parked included.
    when exists (select 1 from t where tag = 'lost') then 'Lost'
    -- Parked (Smart List 11): tag Nurture or Credit Repair, over every other stage signal.
    when exists (select 1 from t where tag in ('credit repair', 'nurture')) then 'Nurture / Credit Repair'
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
