-- Drafts inbox (Bayway Bot Engine doc, Sales OS item 2) with the learning-loop
-- fields. Bots (Claude scheduled tasks) insert drafts here; Chandler approves,
-- edits or skips them in Sales OS. Approving an email opens it ready to send in
-- Outlook and logs a FUB note through crm-action. The Friday tune-up reads the
-- original vs final text, the change size, skip reasons and outcomes.
-- Owner-only, like Partners.

create table if not exists public.bot_drafts (
  id               uuid primary key default gen_random_uuid(),
  business_id      text not null default 'bay' check (business_id in ('bay', 'mpg')),
  bot              text not null,          -- e.g. 'cold_email', 'newsletter', 'gbp', 'seo'
  draft_type       text not null check (draft_type in ('email', 'gbp_post', 'blog', 'newsletter', 'text', 'other')),
  contact_id       uuid references public.contacts(id) on delete set null,
  partner_id       uuid references public.partner_profiles(id) on delete set null,
  to_name          text,
  to_email         text,
  subject          text,
  body             text not null,          -- the current text (edited in place)
  original_subject text,                   -- the bot's text, never changed
  original_body    text not null,
  final_subject    text,                   -- what was approved
  final_body       text,
  change_pct       numeric,                -- 0 = approved untouched, 100 = rewritten
  status           text not null default 'waiting' check (status in ('waiting', 'approved', 'sent', 'skipped')),
  reason           text check (reason in ('too long', 'too salesy', 'wrong person', 'wrong timing', 'off voice', 'other')),
  reason_note      text,
  outcome          text check (outcome in ('replied', 'booked', 'attended', 'referred')),
  crm_action_id    uuid,
  meta             jsonb not null default '{}'::jsonb, -- bot extras: sequence step, sources, due date
  created_at       timestamptz not null default now(),
  decided_at       timestamptz,
  updated_at       timestamptz not null default now()
);

create index if not exists bot_drafts_waiting_idx on public.bot_drafts (created_at) where status = 'waiting';
create index if not exists bot_drafts_bot_idx on public.bot_drafts (bot, created_at);

alter table public.bot_drafts enable row level security;
drop policy if exists "owner all bot_drafts" on public.bot_drafts;
create policy "owner all bot_drafts" on public.bot_drafts
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- Approval rate per bot per week, for the Tune-up page and the Friday coach:
-- approved with no edits divided by all decided drafts.
create or replace view public.v_bot_approval_weekly with (security_invoker = true) as
select bot,
       date_trunc('week', (coalesce(decided_at, created_at) at time zone 'America/Chicago'))::date as week_start,
       count(*) filter (where status in ('approved', 'sent', 'skipped')) as decided,
       count(*) filter (where status in ('approved', 'sent') and coalesce(change_pct, 0) = 0) as untouched,
       count(*) filter (where status in ('approved', 'sent') and change_pct > 0) as edited,
       count(*) filter (where status = 'skipped') as skipped,
       round(100.0 * count(*) filter (where status in ('approved', 'sent') and coalesce(change_pct, 0) = 0)
             / nullif(count(*) filter (where status in ('approved', 'sent', 'skipped')), 0)) as approval_rate
from public.bot_drafts
group by 1, 2;
