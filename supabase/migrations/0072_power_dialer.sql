-- Power Dialer phase 1: schema (spec: docs/superpowers/specs/2026-11-20-power-dialer-design.md).
-- App-owned and per user, like mpg_touch_log (0060). Nothing here is synced to
-- Zoho or FUB; only dialer-crm-push (phase 7) writes to a CRM, after approval.
--   dialer_lists       one row per uploaded CSV
--   dialer_leads       one row per person on a list
--   dialer_calls       one row per dial (outcome filled in when logged)
--   dialer_sessions    one row per dialing session (counts derive from dialer_calls)
--   dialer_push_queue  Ready to Push review queue
--   dialer_scripts     per-business script, follow-up templates and retry settings
--   dnc_numbers        shared internal Do Not Call list (all users, both books)
--
-- Business ids follow the rest of the schema: 'mpg' | 'bay'.

-- ------------------------------------------------------------------ lists
create table if not exists public.dialer_lists (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null default auth.uid(),
  business_id             text not null references public.businesses(id) check (business_id in ('mpg', 'bay')),
  temperature             text check (temperature in ('cold', 'warm')),
  name                    text not null check (nullif(trim(name), '') is not null),
  source_filename         text,
  column_mapping          jsonb not null default '{}'::jsonb,
  status                  text not null default 'active' check (status in ('active', 'completed', 'archived')),
  include_crm_duplicates  boolean not null default false,
  dnc_scrub_confirmed_by  uuid,
  dnc_scrub_confirmed_at  timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  -- Bayway lists are Cold or Warm; MPG lists carry no temperature.
  constraint dialer_lists_temperature check (
    (business_id = 'bay' and temperature is not null) or (business_id = 'mpg' and temperature is null)
  ),
  -- Cold Bayway lists need the National DNC Registry scrub confirmation.
  constraint dialer_lists_cold_scrub check (
    not (business_id = 'bay' and temperature = 'cold')
    or (dnc_scrub_confirmed_by is not null and dnc_scrub_confirmed_at is not null)
  )
);
create index if not exists dialer_lists_user_status on public.dialer_lists (user_id, status, business_id);

-- ------------------------------------------------------------------ leads
create table if not exists public.dialer_leads (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid(),
  list_id          uuid not null references public.dialer_lists(id) on delete cascade,
  business_id      text not null references public.businesses(id) check (business_id in ('mpg', 'bay')),
  first_name       text,
  last_name        text,
  company          text,
  phone_raw        text,
  phone_e164       text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  email            text,
  address          text,
  city             text,
  state            text,
  zip              text,
  extra            jsonb not null default '{}'::jsonb,
  status           text not null default 'queued' check (status in
                   ('queued', 'retry', 'confirmed', 'pushed', 'dead', 'dnc', 'crm_duplicate', 'invalid_phone')),
  attempt_count    int not null default 0 check (attempt_count >= 0),
  last_outcome     text,
  next_attempt_at  timestamptz,
  crm_match        jsonb,
  position         int not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- A dialable lead has a normalized phone.
  constraint dialer_leads_phone check (status = 'invalid_phone' or phone_e164 is not null),
  unique (list_id, position)
);
-- Queue: queued first in CSV order, then retry leads whose next attempt is due.
create index if not exists dialer_leads_queue on public.dialer_leads (list_id, status, next_attempt_at);
-- DNC sweeps and the 3-calls-in-24-hours check look leads up by number.
create index if not exists dialer_leads_user_phone on public.dialer_leads (user_id, phone_e164);

-- ------------------------------------------------------------------ sessions
create table if not exists public.dialer_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid(),
  business_id  text not null references public.businesses(id) check (business_id in ('mpg', 'bay')),
  list_id      uuid references public.dialer_lists(id) on delete set null,
  started_at   timestamptz not null default now(),
  ended_at     timestamptz
);
create index if not exists dialer_sessions_user_started on public.dialer_sessions (user_id, started_at);

-- ------------------------------------------------------------------ calls
-- A row is created when Call is tapped (dialed_at) and the outcome is filled
-- in when it is logged. Every row is a dial; is_connect marks a conversation.
create table if not exists public.dialer_calls (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid(),
  lead_id      uuid not null references public.dialer_leads(id) on delete cascade,
  list_id      uuid references public.dialer_lists(id) on delete set null,
  session_id   uuid references public.dialer_sessions(id) on delete set null,
  business_id  text not null references public.businesses(id) check (business_id in ('mpg', 'bay')),
  phone_e164   text not null,
  outcome      text check (outcome in (
                 'no_answer', 'voicemail', 'owner_unavailable', 'bad_number', 'not_interested',
                 'do_not_call', 'callback_requested', 'interested', 'appointment_set', 'application_sent')),
  is_connect   boolean generated always as (
                 coalesce(outcome in ('owner_unavailable', 'not_interested', 'do_not_call',
                                      'callback_requested', 'interested', 'appointment_set',
                                      'application_sent'), false)
               ) stored,
  notes        text,
  callback_at  timestamptz,
  dialed_at    timestamptz not null default now(),
  logged_at    timestamptz,
  -- Owner not available is MPG only; Application sent is Bayway only.
  constraint dialer_calls_business_outcome check (
    outcome is null
    or (outcome = 'owner_unavailable' and business_id = 'mpg')
    or (outcome = 'application_sent' and business_id = 'bay')
    or outcome not in ('owner_unavailable', 'application_sent')
  ),
  constraint dialer_calls_callback check (outcome is distinct from 'callback_requested' or callback_at is not null)
);
-- Daily numbers per business, and the per-lead / per-number history.
create index if not exists dialer_calls_business_dialed on public.dialer_calls (business_id, dialed_at);
create index if not exists dialer_calls_lead on public.dialer_calls (lead_id, dialed_at);
create index if not exists dialer_calls_user_phone_dialed on public.dialer_calls (user_id, phone_e164, dialed_at);

-- ------------------------------------------------------------------ push queue
create table if not exists public.dialer_push_queue (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid(),
  lead_id        uuid not null references public.dialer_leads(id) on delete cascade,
  business_id    text not null references public.businesses(id) check (business_id in ('mpg', 'bay')),
  target         text not null check (target in ('zoho', 'fub')),
  outcome        text not null check (outcome in ('callback_requested', 'interested', 'appointment_set', 'application_sent')),
  payload        jsonb not null default '{}'::jsonb,
  status         text not null default 'pending' check (status in ('pending', 'approved', 'pushed', 'failed', 'skipped')),
  crm_record_id  text,
  error          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  approved_at    timestamptz,
  pushed_at      timestamptz,
  -- MPG lands in Zoho, Bayway in FUB.
  constraint dialer_push_queue_target check (
    (business_id = 'mpg' and target = 'zoho') or (business_id = 'bay' and target = 'fub')
  ),
  unique (lead_id)
);
create index if not exists dialer_push_queue_user_status on public.dialer_push_queue (user_id, status, business_id);

-- ------------------------------------------------------------------ scripts and settings
-- One row per user and business: call script, follow-up templates, retry rule
-- and the Cold-list calling hours guard. Templates use {first_name}, {company}.
create table if not exists public.dialer_scripts (
  user_id          uuid not null default auth.uid(),
  business_id      text not null references public.businesses(id) check (business_id in ('mpg', 'bay')),
  body             text not null default '',
  sms_template     text not null default '',
  email_subject    text not null default '',
  email_body       text not null default '',
  max_attempts     int not null default 3 check (max_attempts between 1 and 3),
  min_retry_hours  int not null default 4 check (min_retry_hours between 1 and 72),
  hours_guard      boolean not null default true,
  updated_at       timestamptz not null default now(),
  primary key (user_id, business_id)
);

-- ------------------------------------------------------------------ DNC
-- Shared across users and both books: a number one person was asked not to
-- call is blocked for everyone. Anyone signed in can read and add; only the
-- owner can remove a number.
create table if not exists public.dnc_numbers (
  phone_e164  text primary key check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  reason      text,
  source      text not null default 'manual' check (source in ('dialer', 'manual', 'import')),
  added_by    uuid default auth.uid(),
  added_at    timestamptz not null default now()
);

-- ------------------------------------------------------------------ RLS
-- Own-row RLS on the six per-user tables, same four policies as mpg_touch_log.
do $$
declare t text;
begin
  foreach t in array array['dialer_lists', 'dialer_leads', 'dialer_sessions', 'dialer_calls',
                           'dialer_push_queue', 'dialer_scripts']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own %1$s select" on public.%1$I', t);
    execute format('create policy "own %1$s select" on public.%1$I for select to authenticated using (user_id = auth.uid())', t);
    execute format('drop policy if exists "own %1$s insert" on public.%1$I', t);
    execute format('create policy "own %1$s insert" on public.%1$I for insert to authenticated with check (user_id = auth.uid())', t);
    execute format('drop policy if exists "own %1$s update" on public.%1$I', t);
    execute format('create policy "own %1$s update" on public.%1$I for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('drop policy if exists "own %1$s delete" on public.%1$I', t);
    execute format('create policy "own %1$s delete" on public.%1$I for delete to authenticated using (user_id = auth.uid())', t);
  end loop;
end $$;

-- FK checks bypass RLS, so recreate the child insert/update policies with an
-- explicit check that the parent belongs to the same user (as in 0060).
drop policy if exists "own dialer_leads insert" on public.dialer_leads;
create policy "own dialer_leads insert" on public.dialer_leads for insert to authenticated
  with check (user_id = auth.uid()
    and exists (select 1 from public.dialer_lists l where l.id = list_id and l.user_id = auth.uid() and l.business_id = dialer_leads.business_id));
drop policy if exists "own dialer_leads update" on public.dialer_leads;
create policy "own dialer_leads update" on public.dialer_leads for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid()
    and exists (select 1 from public.dialer_lists l where l.id = list_id and l.user_id = auth.uid() and l.business_id = dialer_leads.business_id));

drop policy if exists "own dialer_sessions insert" on public.dialer_sessions;
create policy "own dialer_sessions insert" on public.dialer_sessions for insert to authenticated
  with check (user_id = auth.uid()
    and (list_id is null or exists (select 1 from public.dialer_lists l where l.id = list_id and l.user_id = auth.uid())));
drop policy if exists "own dialer_sessions update" on public.dialer_sessions;
create policy "own dialer_sessions update" on public.dialer_sessions for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid()
    and (list_id is null or exists (select 1 from public.dialer_lists l where l.id = list_id and l.user_id = auth.uid())));

drop policy if exists "own dialer_calls insert" on public.dialer_calls;
create policy "own dialer_calls insert" on public.dialer_calls for insert to authenticated
  with check (user_id = auth.uid()
    and exists (select 1 from public.dialer_leads d where d.id = lead_id and d.user_id = auth.uid() and d.business_id = dialer_calls.business_id)
    and (list_id is null or exists (select 1 from public.dialer_lists l where l.id = list_id and l.user_id = auth.uid()))
    and (session_id is null or exists (select 1 from public.dialer_sessions s where s.id = session_id and s.user_id = auth.uid())));
drop policy if exists "own dialer_calls update" on public.dialer_calls;
create policy "own dialer_calls update" on public.dialer_calls for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid()
    and exists (select 1 from public.dialer_leads d where d.id = lead_id and d.user_id = auth.uid() and d.business_id = dialer_calls.business_id)
    and (list_id is null or exists (select 1 from public.dialer_lists l where l.id = list_id and l.user_id = auth.uid()))
    and (session_id is null or exists (select 1 from public.dialer_sessions s where s.id = session_id and s.user_id = auth.uid())));

drop policy if exists "own dialer_push_queue insert" on public.dialer_push_queue;
create policy "own dialer_push_queue insert" on public.dialer_push_queue for insert to authenticated
  with check (user_id = auth.uid()
    and exists (select 1 from public.dialer_leads d where d.id = lead_id and d.user_id = auth.uid() and d.business_id = dialer_push_queue.business_id));
drop policy if exists "own dialer_push_queue update" on public.dialer_push_queue;
create policy "own dialer_push_queue update" on public.dialer_push_queue for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid()
    and exists (select 1 from public.dialer_leads d where d.id = lead_id and d.user_id = auth.uid() and d.business_id = dialer_push_queue.business_id));

-- Shared DNC list.
alter table public.dnc_numbers enable row level security;
drop policy if exists "authenticated read dnc_numbers" on public.dnc_numbers;
create policy "authenticated read dnc_numbers" on public.dnc_numbers for select to authenticated using (true);
drop policy if exists "authenticated add dnc_numbers" on public.dnc_numbers;
create policy "authenticated add dnc_numbers" on public.dnc_numbers for insert to authenticated
  with check (added_by = auth.uid());
drop policy if exists "owner remove dnc_numbers" on public.dnc_numbers;
create policy "owner remove dnc_numbers" on public.dnc_numbers for delete to authenticated using (public.is_owner());

-- ------------------------------------------------------------------ updated_at
create or replace function public.dialer_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

do $$
declare t text;
begin
  foreach t in array array['dialer_lists', 'dialer_leads', 'dialer_push_queue', 'dialer_scripts']
  loop
    execute format('drop trigger if exists %1$s_touch on public.%1$I', t);
    execute format('create trigger %1$s_touch before update on public.%1$I for each row execute function public.dialer_touch()', t);
  end loop;
end $$;

-- ------------------------------------------------------------------ seed
-- Placeholder scripts and templates for each owner, edited later in Settings.
insert into public.dialer_scripts (user_id, business_id, body, sms_template, email_subject, email_body)
select r.user_id, b.business_id, b.body, b.sms_template, b.email_subject, b.email_body
from public.user_roles r
cross join (values
  ('mpg',
   E'# MPG call script\n\n- Opener: Hi, is this the owner of {company}? This is Chandler with Media Payments Group.\n- Reason for the call: (placeholder)\n- Questions: Who do you process cards with today? When did your rates last go up?\n- Ask: a 10 minute statement review.\n\n_Placeholder text. Edit in Power Dialer Settings._',
   'Hi {first_name}, this is Chandler with Media Payments Group. Thanks for the time today. [MPG phone] / [MPG email]',
   'Following up from our call, {company}',
   E'Hi {first_name},\n\nThanks for taking my call today. (placeholder)\n\nChandler Atkinson\nMedia Payments Group\n[MPG phone]\n[MPG email]'),
  ('bay',
   E'# Bayway call script\n\n- Opener: Hi {first_name}, this is Chandler with Bayway Mortgage.\n- Reason for the call: (placeholder)\n- Questions: Are you thinking about buying or refinancing this year?\n- Ask: a quick call to run your numbers.\n\n_Placeholder text. Edit in Power Dialer Settings._',
   'Hi {first_name}, this is Chandler with Bayway Mortgage. Here is the application link: https://baywayhtx.my1003app.com/1851744/register  Or grab a time: https://calendly.com/chandler-baywayhtx/30min',
   'Next steps from our call',
   E'Hi {first_name},\n\nThanks for taking my call today. (placeholder)\n\nApply here: https://baywayhtx.my1003app.com/1851744/register\nBook a time: https://calendly.com/chandler-baywayhtx/30min\n\nChandler Atkinson\nBayway Mortgage')
) as b(business_id, body, sms_template, email_subject, email_body)
where r.role = 'owner'
on conflict (user_id, business_id) do nothing;
