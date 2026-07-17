-- Phase 13: Priority Leads.
-- Extend the shared `contacts` table with computed lead-scoring columns that
-- the score-fub-leads Edge Function writes back (service role, bypassing the
-- read-only RLS). The existing "authenticated read contacts" policy from
-- 0001_init.sql already covers these new columns for the app's SELECTs.
-- `ai_note` / `ai_note_generated_at` are reserved for a deferred AI-note
-- function and stay null for now.

alter table contacts
  add column if not exists score                numeric,
  add column if not exists tier                 text,        -- hot | warm | active | never_contacted
  add column if not exists last_activity_at      timestamptz,
  add column if not exists ai_note               text,        -- reserved (deferred generate-lead-notes)
  add column if not exists ai_note_generated_at  timestamptz;

-- Panel query is "by business, ranked by score within a tier".
create index if not exists contacts_tier_score_idx
  on contacts (business_id, tier, score desc);

-- ----------------------------------------------------------- v_priority_leads
-- Read model for the Priority Leads panel. security_invoker = on so the app's
-- read-only RLS (authenticated select) applies unchanged, mirroring
-- 0003_active_pipeline_view.sql. Only scored Bayway contacts appear.
create or replace view public.v_priority_leads
with (security_invoker = on) as
select
  c.id,
  c.business_id,
  c.name,
  c.owner,
  c.score,
  c.tier,
  c.last_activity_at,
  la.type as last_activity_type,
  c.ai_note,
  c.ai_note_generated_at,
  coalesce(c.raw->'tags', '[]'::jsonb) as tags,
  -- FUB profile deep link (locked account URL pattern).
  'https://baywayhtx.followupboss.com/2/people/view/' || c.external_id as fub_profile_url
from contacts c
-- Most-recent activity's type, for the "last activity date/type" row label.
left join lateral (
  select a.type
  from activities a
  where a.contact_id = c.id
  order by a.occurred_at desc nulls last
  limit 1
) la on true
where c.business_id = 'bay'
  and c.source_crm = 'fub'
  and c.tier is not null;
