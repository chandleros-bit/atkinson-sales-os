-- Workbench slice 1 (docs/superpowers/specs/2026-10-22-workbench-design.md):
-- each call row shows the lead's source and its first note as quick facts.
--   * contacts.first_note / first_note_at / first_note_checked_at: a Bayway
--     lead's first FUB note (or first event message), fetched once by
--     fub-sync (_shared/fub-first-note.ts). The activity sync only pulls notes
--     for recently touched leads, so most first notes were never synced.
--   * first_note_candidates(): which leads fub-sync checks next.
--   * v_lead_signals: same as 0029 plus lead_source and first_note at the END
--     (MPG first_note falls back to the Zoho lead's Description).

alter table contacts add column if not exists first_note text;
alter table contacts add column if not exists first_note_at timestamptz;
alter table contacts add column if not exists first_note_checked_at timestamptz;

-- Bayway leads on the board (FUB stage Lead / Pre-Qualified) never checked,
-- plus leads created in the last 3 days still without a note (a provider's
-- details can land just after the person), re-checked at most every 30
-- minutes. Newest first; fub-sync takes a few per run.
create or replace function public.first_note_candidates(max_rows int default 30)
returns table (id uuid, external_id text)
language sql
stable
security invoker
set search_path = public
as $$
  select c.id, c.external_id
  from contacts c
  where c.business_id = 'bay'
    and c.person_stage in ('Lead', 'Pre-Qualified')
    and (
      c.first_note_checked_at is null
      or (
        c.first_note is null
        and c.first_note_checked_at < now() - interval '30 minutes'
        and public.try_timestamptz(c.raw->>'created') > now() - interval '3 days'
      )
    )
  order by public.try_timestamptz(c.raw->>'created') desc nulls last
  limit greatest(1, least(coalesce(max_rows, 30), 100));
$$;

-- Only the sync (service role) needs it.
revoke execute on function public.first_note_candidates(int) from public, anon, authenticated;

create or replace view public.v_lead_signals
with (security_invoker = on) as
with rules as (
  select coalesce((select value from settings where key = 'priority_rules'), '{}'::jsonb) as r
),
list as (
  select
    array(select jsonb_array_elements_text(coalesce(r->'mpg_active_statuses', '[]'))) as mpg_active,
    array(select jsonb_array_elements_text(coalesce(r->'mpg_hot_statuses', '[]'))) as mpg_hot,
    array(select jsonb_array_elements_text(coalesce(r->'mpg_dead_statuses', '[]'))) as mpg_dead,
    array(select jsonb_array_elements_text(coalesce(r->'bay_partner_stages', '["Realtors"]'))) as bay_partner,
    array(select jsonb_array_elements_text(coalesce(r->'bay_excluded_stages', '["Nurture","Closed","Lost"]'))) as bay_excluded,
    coalesce((r->>'new_lead_days')::int, 7) as new_lead_days
  from rules
),
act as (
  select
    contact_id,
    max(occurred_at) filter (
      where (type = 'call' and direction = 'outbound') or type in ('note', 'appointment')
    ) as last_outbound_at,
    max(occurred_at) filter (where type = 'call' and direction = 'outbound') as last_outbound_call_at,
    max(occurred_at) filter (where type = 'call' and direction = 'inbound') as last_inbound_at
  from activities
  where contact_id is not null
  group by contact_id
),
tk as (
  select contact_id, count(*)::int as open_task_count, min(due_at) as oldest_open_due_at
  from tasks
  where is_completed = false and contact_id is not null
  group by contact_id
),
sn as (
  select
    contact_id,
    bool_or(until_date > (now() at time zone 'America/Chicago')::date) as snoozed,
    (count(*) filter (where created_at > now() - interval '60 days'))::int as snooze_count_60d
  from lead_snoozes
  group by contact_id
),
base as (
  select
    c.id,
    c.business_id,
    c.name,
    c.company,
    c.phone,
    case c.business_id
      when 'bay' then 'https://baywayhtx.followupboss.com/2/people/view/' || c.external_id
      when 'mpg' then 'https://crm.zoho.com/crm/tab/Leads/' || c.external_id
    end as crm_profile_url,
    case when c.business_id = 'mpg' then c.person_stage
         else public.derive_stage(c.raw, c.person_stage, c.business_id) end as stage,
    c.person_stage,
    c.stage_since,
    -- Workbench (0040): where the lead came from and what the source said.
    case c.business_id when 'bay' then c.raw->>'source' else c.raw->>'Lead_Source' end as lead_source,
    case c.business_id
      when 'bay' then c.first_note
      else coalesce(c.first_note, nullif(trim(c.raw->>'Description'), ''))
    end as first_note,
    c.score,
    c.tier,
    case c.business_id
      when 'bay' then (
        c.tier = 'hot'
        or exists (
          select 1
          from jsonb_array_elements_text(
            case when jsonb_typeof(c.raw->'tags') = 'array' then c.raw->'tags' else '[]'::jsonb end
          ) as t(tag)
          where lower(trim(t.tag)) = 'hot'
        )
      )
      else coalesce(c.person_stage = any (l.mpg_hot), false)
    end as is_hot,
    coalesce(c.business_id = 'bay' and c.person_stage = any (l.bay_partner), false) as is_partner,
    public.try_timestamptz(case c.business_id when 'bay' then c.raw->>'created' else c.raw->>'Created_Time' end)
      as crm_created_at,
    public.try_timestamptz(case c.business_id when 'bay' then c.raw->>'lastActivity' else c.raw->>'Last_Activity_Time' end)
      as crm_last_activity_at,
    a.last_outbound_at,
    a.last_outbound_call_at,
    a.last_inbound_at,
    coalesce(tk.open_task_count, 0) as open_task_count,
    tk.oldest_open_due_at,
    coalesce(sn.snoozed, false) as snoozed,
    coalesce(sn.snooze_count_60d, 0) as snooze_count_60d,
    l.mpg_active,
    l.mpg_dead,
    l.bay_excluded,
    l.new_lead_days
  from contacts c
  cross join list l
  left join act a on a.contact_id = c.id
  left join tk on tk.contact_id = c.id
  left join sn on sn.contact_id = c.id
),
flagged as (
  select
    b.*,
    -- Mirrors LOST_KEYWORDS in src/lib/pipeline.js; keep the two in sync.
    (
      coalesce(b.stage, '') ~* '(lost|dead|disengaged|withdrawn|denied|junk|unqualified|not qualified|nurture)'
      or coalesce(b.business_id = 'bay' and b.person_stage = any (b.bay_excluded), false)
      or coalesce(b.business_id = 'mpg' and b.person_stage = any (b.mpg_dead), false)
    ) as is_excluded,
    coalesce(b.last_inbound_at > coalesce(b.last_outbound_at, '-infinity'::timestamptz), false) as inbound_waiting
  from base b
),
scored as (
  select
    f.*,
    coalesce(
      case f.business_id
        when 'bay' then f.stage is not null and not f.is_partner
        else f.person_stage = any (f.mpg_active)
      end,
      false
    ) as is_active
  from flagged f
)
select
  id, business_id, name, company, phone, crm_profile_url,
  stage, person_stage, stage_since, is_hot, is_active, is_partner, score, tier,
  crm_created_at, crm_last_activity_at,
  last_outbound_at, last_outbound_call_at, last_inbound_at,
  greatest(last_outbound_at, last_inbound_at) as human_touch_at,
  open_task_count, oldest_open_due_at, snooze_count_60d,
  lead_source, first_note
from scored
where not is_excluded
  and not snoozed
  and (
    inbound_waiting
    or (
      not is_partner
      and (
        is_active
        or is_hot
        or open_task_count > 0
        or crm_created_at >= now() - make_interval(days => new_lead_days)
      )
    )
  );
