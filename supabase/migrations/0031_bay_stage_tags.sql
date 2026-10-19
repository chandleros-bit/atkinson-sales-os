-- Bayway pipeline stages from FollowUpBoss tags. See
-- docs/superpowers/specs/2026-10-19-bayway-stage-tags-design.md.
--
-- New board: New Lead > Attempted > Contacted/Working >
-- Application/Estimate Sent > Application Received. The same rule lives in
-- supabase/functions/_shared/bay-stages.ts (bayStageFromTags); keep them in step.
--
-- derive_stage() feeds v_active_pipeline, v_lead_signals and the
-- contacts_track_stage trigger, so all three switch over with this function.

create or replace function public.derive_stage(raw jsonb, person_stage text, business_id text)
returns text
language sql
immutable
as $$
  select case
    -- MPG stages come from Zoho's Lead Status, not from here.
    when business_id is distinct from 'bay' then null
    -- Pre-Qualified (Smart List 07, pre-approved) is past application.
    when lower(trim(coalesce(person_stage, ''))) = 'pre-qualified' then 'Application Received'
    -- Nurture, Realtors, Closed, Lost: off the board, whatever the tags say.
    when lower(trim(coalesce(person_stage, ''))) <> 'lead' then null
    else (
      with t as (
        select lower(trim(x)) as tag
        from jsonb_array_elements_text(
          case when jsonb_typeof(raw->'tags') = 'array' then raw->'tags' else '[]'::jsonb end
        ) as x
      )
      -- Furthest column any workflow tag reaches.
      select case
        when exists (select 1 from t where tag in ('application received', 'need docs', 'under contract'))
          then 'Application Received'
        when exists (select 1 from t where tag in ('estimate sent', 'application sent'))
          then 'Application/Estimate Sent'
        when exists (select 1 from t where tag = 'working estimate') then 'Contacted/Working'
        when exists (select 1 from t where tag = 'attempted') then 'Attempted'
        else 'New Lead'
      end
    )
  end
$$;

-- Relabel stage_key under the new names WITHOUT recording a stage change:
-- renaming the columns is not a lead moving, and "Stuck in stage" must only
-- count real moves.
alter table contacts disable trigger contacts_track_stage;

update contacts
set stage_key = public.derive_stage(raw, person_stage, business_id)
where business_id = 'bay'
  and stage_key is distinct from public.derive_stage(raw, person_stage, business_id);

alter table contacts enable trigger contacts_track_stage;
