-- Disclosed: a Bayway stage after Application Received (FUB tag `Disclosed`),
-- tracked in a Workbench "Disclosed" group until an Under Contract pipeline
-- exists. Mirrors bayStageFromTags() in supabase/functions/_shared/bay-stages.ts.
--   * derive_stage(): a `disclosed` tag gives 'Disclosed', after Lost and
--     parked, before Pre-Qualified's Application Received. Otherwise as 0047.
--   * work_items: kind 'disclosed' for the Workbench group's rows.
--   * settings.priority_rules: Disclosed is never "stuck" (only adds the key).

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
    -- Disclosed is past Application Received, Pre-Qualified included.
    when exists (select 1 from t where tag = 'disclosed') then 'Disclosed'
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

alter table work_items drop constraint if exists work_items_kind_check;
alter table work_items add constraint work_items_kind_check
  check (kind in ('estimate', 'application', 'disclosed', 'statement', 'custom'));

update settings
set value = jsonb_set(value, '{stuck_days_by_stage,Disclosed}', 'null'::jsonb)
where key = 'priority_rules'
  and value ? 'stuck_days_by_stage'
  and not (value->'stuck_days_by_stage' ? 'Disclosed');
