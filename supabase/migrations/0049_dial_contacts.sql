-- Dial list phase 1 (docs/superpowers/specs/2026-10-29-dialer-cadence-design.md).
--   * call_connected(raw): a call record was a real conversation: CRM outcome
--     Interested / Not Interested (FUB outcome; Zoho Call_Result or the
--     "Call: <outcome>" subject crm-action writes) or 2+ minutes long.
--   * v_dial_contacts: the lead-cadence leads of both books with their
--     outbound-call history. Phase 2 widens the WHERE (realtors, past clients).
--   * dial_skips: "Not today" in the dialer (app-owned, per user).

create or replace function public.call_connected(raw jsonb)
returns boolean
language sql
immutable
as $$
  select coalesce(raw->>'outcome', '') in ('Interested', 'Not Interested')
      or coalesce(raw->>'Call_Result', '') in ('Interested', 'Not interested')
      or coalesce(raw->>'Subject', '') in ('Call: Interested', 'Call: Not Interested')
      or case when coalesce(raw->>'duration', '') ~ '^\d+$'
              then (raw->>'duration')::int >= 120 else false end
      or case when coalesce(raw->>'Call_Duration', '') ~ '^\d+:\d{2}$'
              then split_part(raw->>'Call_Duration', ':', 1)::int * 60
                 + split_part(raw->>'Call_Duration', ':', 2)::int >= 120
              else false end
$$;

create or replace view public.v_dial_contacts
with (security_invoker = on) as
select * from (
  select
    c.id,
    c.business_id,
    c.name,
    c.company,
    c.phone,
    c.email,
    case c.business_id
      when 'bay' then 'https://baywayhtx.followupboss.com/2/people/view/' || c.external_id
      else 'https://crm.zoho.com/crm/tab/Leads/' || c.external_id
    end as crm_profile_url,
    case c.business_id
      when 'bay' then public.derive_stage(c.raw, c.person_stage, c.business_id)
      else c.person_stage
    end as stage,
    c.stage_since,
    public.try_timestamptz(case c.business_id when 'bay' then c.raw->>'created' else c.raw->>'Created_Time' end)
      as crm_created_at,
    case when c.business_id = 'bay' and jsonb_typeof(c.raw->'tags') = 'array'
      then array(select lower(trim(t)) from jsonb_array_elements_text(c.raw->'tags') as t)
      else '{}'::text[]
    end as tags,
    case c.business_id when 'bay' then c.raw->>'source' else c.raw->>'Lead_Source' end as lead_source,
    coalesce(oc.calls, 0) as outbound_calls,
    coalesce(oc.calls_since_stage, 0) as outbound_calls_since_stage,
    oc.first_at as first_outbound_call_at,
    oc.last_at as last_outbound_call_at,
    oc.connected_at
  from contacts c
  left join lateral (
    select count(*)::int as calls,
           (count(*) filter (where c.stage_since is null or a.occurred_at >= c.stage_since))::int as calls_since_stage,
           min(a.occurred_at) as first_at,
           max(a.occurred_at) as last_at,
           max(a.occurred_at) filter (where public.call_connected(a.raw)) as connected_at
    from activities a
    where a.contact_id = c.id
      and a.type = 'call'
      and a.direction = 'outbound'
  ) oc on true
) s
where (business_id = 'bay' and stage in ('New Lead', 'Attempted', 'Nurture / Credit Repair'))
   or (business_id = 'mpg' and stage in ('Not Contacted', 'Open', 'Attempted to Contact'));

create table if not exists dial_skips (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid(),
  contact_id  uuid not null references contacts(id) on delete cascade,
  until_date  date not null,
  created_at  timestamptz not null default now(),
  unique (user_id, contact_id)
);

alter table dial_skips enable row level security;

drop policy if exists "own dial_skips select" on dial_skips;
create policy "own dial_skips select" on dial_skips
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "own dial_skips insert" on dial_skips;
create policy "own dial_skips insert" on dial_skips
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "own dial_skips update" on dial_skips;
create policy "own dial_skips update" on dial_skips
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own dial_skips delete" on dial_skips;
create policy "own dial_skips delete" on dial_skips
  for delete to authenticated using (user_id = auth.uid());
