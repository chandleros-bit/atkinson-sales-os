-- Atkinson Sales OS - Phase 2 schema
-- Normalized, source-agnostic model from the build spec (section 8).
-- Read-only v1: the app only SELECTs; Edge Functions write with the service role.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- businesses
create table if not exists businesses (
  id              text primary key,            -- 'mpg' | 'bay'
  name            text not null,
  accent_color    text not null,
  secondary_color text
);

insert into businesses (id, name, accent_color, secondary_color) values
  ('mpg', 'Media Payments Group', '#26ABE0', '#151518'),
  ('bay', 'Bayway Mortgage',      '#0B5E42', '#7CAD44')
on conflict (id) do nothing;

-- -------------------------------------------------------------------- stages
-- Populated by each CRM sync from the source system (FUB pipelines, Zoho
-- deal stages) so the board always mirrors the source of truth.
create table if not exists stages (
  id          uuid primary key default gen_random_uuid(),
  business_id text not null references businesses(id),
  name        text not null,
  sort_order  int  not null default 0,
  is_won      boolean not null default false,
  is_lost     boolean not null default false,
  external_id text,                             -- id in the source CRM
  unique (business_id, external_id)
);

-- ------------------------------------------------------------------ contacts
create table if not exists contacts (
  id            uuid primary key default gen_random_uuid(),
  business_id   text not null references businesses(id),
  source_crm    text not null,                  -- 'fub' | 'zoho'
  external_id   text not null,
  name          text,
  company       text,
  email         text,
  phone         text,
  owner         text,
  person_stage  text,                           -- FUB person stage / Zoho lead status
  last_touch_at timestamptz,
  raw           jsonb,
  updated_at    timestamptz not null default now(),
  unique (source_crm, external_id)
);

-- --------------------------------------------------------------------- deals
create table if not exists deals (
  id               uuid primary key default gen_random_uuid(),
  business_id      text not null references businesses(id),
  source_crm       text not null,
  external_id      text not null,
  contact_id       uuid references contacts(id),
  stage_id         uuid references stages(id),
  name             text,
  value            numeric,                     -- MPG: est. monthly residual | Bayway: loan amount
  secondary_value  numeric,                     -- MPG: processing volume     | Bayway: commission
  expected_close   date,
  segment_tag      text,                        -- MPG: Displacement | Greenfield
  referral_partner text,                        -- Bayway
  next_action_at   timestamptz,
  stage_entered_at timestamptz,
  status           text not null default 'open',-- open | won | lost
  raw              jsonb,
  updated_at       timestamptz not null default now(),
  unique (source_crm, external_id)
);

-- ---------------------------------------------------------------- activities
create table if not exists activities (
  id          uuid primary key default gen_random_uuid(),
  business_id text not null references businesses(id),
  source_crm  text,
  external_id text,
  type        text,                             -- call | email | text | note | event...
  contact_id  uuid references contacts(id),
  deal_id     uuid references deals(id),
  occurred_at timestamptz,
  notes       text,
  raw         jsonb,
  unique (source_crm, external_id)
);

-- ----------------------------------------------------------- calendar_events
create table if not exists calendar_events (
  id             uuid primary key default gen_random_uuid(),
  source_account text not null,                 -- 'outlook-mpg' | 'outlook-bayway'
  external_id    text not null,
  title          text,
  starts_at      timestamptz,
  ends_at        timestamptz,
  location       text,
  is_all_day     boolean not null default false,
  raw            jsonb,
  unique (source_account, external_id)
);

-- ------------------------------------------------------------- metrics_daily
create table if not exists metrics_daily (
  id          bigint generated always as identity primary key,
  business_id text not null references businesses(id),
  date        date not null,
  metric_key  text not null,
  value       numeric not null default 0,
  unique (business_id, date, metric_key)
);

-- ------------------------------------------------------------------ sync_log
create table if not exists sync_log (
  id               bigint generated always as identity primary key,
  source           text not null,               -- 'fub' | 'zoho' | 'outlook-mpg' | 'outlook-bayway'
  ran_at           timestamptz not null default now(),
  records_upserted int not null default 0,
  status           text not null,               -- 'ok' | 'error'
  message          text
);

-- ------------------------------------------------------------------ settings
create table if not exists settings (
  key   text primary key,
  value jsonb not null
);

-- --------------------------------------------------------------- RLS: read-only for the signed-in user
-- Edge Functions use the service role key and bypass RLS for writes.
alter table businesses      enable row level security;
alter table stages          enable row level security;
alter table contacts        enable row level security;
alter table deals           enable row level security;
alter table activities      enable row level security;
alter table calendar_events enable row level security;
alter table metrics_daily   enable row level security;
alter table sync_log        enable row level security;
alter table settings        enable row level security;

do $$
declare t text;
begin
  foreach t in array array['businesses','stages','contacts','deals','activities','calendar_events','metrics_daily','sync_log','settings']
  loop
    execute format(
      'create policy "authenticated read %1$s" on %1$I for select to authenticated using (true)', t
    );
  end loop;
end $$;

-- Helpful indexes for the dashboard queries
create index if not exists deals_business_status_idx on deals (business_id, status);
create index if not exists deals_next_action_idx     on deals (next_action_at);
create index if not exists contacts_business_idx     on contacts (business_id);
create index if not exists events_time_idx           on calendar_events (starts_at);
create index if not exists sync_log_source_idx       on sync_log (source, ran_at desc);
