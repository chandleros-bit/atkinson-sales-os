-- MPG pipeline stages, from Zoho's Lead Status:
--   Not Contacted > Initial Lead Follow Up > Open > Submitted > Approved >
--   Closed Non-Compatible > Nurture
-- Mirrors supabase/functions/_shared/mpg-stages.ts (mpgStageFromStatus); keep
-- the two in step. Zoho stays the source of truth; the OS writes Lead_Status
-- back through crm-action set_stage.
--   * mpg_stage(): Lead_Status -> board label. Unknown statuses pass through.
--   * contacts.person_stage / stage_key for MPG: relabel without recording a
--     stage move (as 0031 did for Bayway). Every view that reads MPG's stage
--     (v_mpg_contacts, v_lead_signals, v_dial_contacts) reads person_stage,
--     so they all switch over with this.
--   * settings.priority_rules: MPG status lists under the new labels; the
--     end-of-road stages are never "stuck".

create or replace function public.mpg_stage(status text)
returns text
language sql
immutable
as $$
  select case lower(trim(coalesce(status, '')))
    when '' then null
    when 'not contacted' then 'Not Contacted'
    when 'initial lead follow up' then 'Initial Lead Follow Up'
    when 'attempted to contact' then 'Initial Lead Follow Up'
    when 'follow up' then 'Initial Lead Follow Up'
    when 'reschedule' then 'Initial Lead Follow Up'
    when 'open' then 'Open'
    when 'contacted' then 'Open'
    when 'contact in future' then 'Open'
    when 'pre-qualified' then 'Open'
    when 'qualified' then 'Open'
    when 'submitted' then 'Submitted'
    when 'application complete' then 'Submitted'
    when 'pending' then 'Submitted'
    when 'conditional approval' then 'Submitted'
    when 'mpa pending follow up' then 'Submitted'
    when 'mpa conditional approval follow up' then 'Submitted'
    when 'mpa no response follow up' then 'Submitted'
    when 'approved' then 'Approved'
    when 'closed non-compatible' then 'Closed Non-Compatible'
    when 'declined' then 'Closed Non-Compatible'
    when 'closed lost' then 'Closed Non-Compatible'
    when 'nurture' then 'Nurture'
    else trim(status)
  end
$$;

alter table contacts disable trigger contacts_track_stage;

update contacts
set person_stage = public.mpg_stage(raw->>'Lead_Status'),
    stage_key = public.mpg_stage(raw->>'Lead_Status')
where business_id = 'mpg'
  and raw ? 'Lead_Status'
  and (person_stage is distinct from public.mpg_stage(raw->>'Lead_Status')
       or stage_key is distinct from public.mpg_stage(raw->>'Lead_Status'));

alter table contacts enable trigger contacts_track_stage;

-- Worked leads. The old list (Open, Pending, Initial lead follow up) reads as
-- exactly these three under the new labels.
update settings
set value = jsonb_set(value, '{mpg_active_statuses}', '["Initial Lead Follow Up", "Open", "Submitted"]'::jsonb)
where key = 'priority_rules';

update settings
set value = jsonb_set(value, '{mpg_dead_statuses}', '["Closed Non-Compatible"]'::jsonb)
where key = 'priority_rules'
  and coalesce(jsonb_array_length(value->'mpg_dead_statuses'), 0) = 0;

update settings
set value = jsonb_set(value, '{stuck_days_by_stage}',
  value->'stuck_days_by_stage'
  || '{"Approved": null, "Closed Non-Compatible": null, "Nurture": null}'::jsonb)
where key = 'priority_rules'
  and jsonb_typeof(value->'stuck_days_by_stage') = 'object';
