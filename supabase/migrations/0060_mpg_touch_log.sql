-- MPG touch log (spec: docs/superpowers/specs/2026-11-05-mpg-tracker-touch-log-design.md).
-- App-owned and per user, like work_items (0041): never synced to Zoho.
--   mpg_prospect_lists  one row per imported call list (used from slice 4)
--   mpg_prospects       businesses the OS knows that are not (yet) Zoho leads
--   mpg_touches         one row per touch; the only table the tracker export reads

create table if not exists mpg_prospect_lists (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid(),
  name        text not null,
  source      text,
  imported_at timestamptz not null default now(),
  row_count   int not null default 0
);

create table if not exists mpg_prospects (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid(),
  kind           text not null default 'merchant' check (kind in ('merchant', 'isv')),
  list_id        uuid references mpg_prospect_lists(id) on delete set null,
  business_name  text not null check (nullif(trim(business_name), '') is not null),
  contact_name   text,
  contact_role   text,
  phone          text,
  phone_key      text,
  email          text,
  address        text,
  category       text,
  platform       text,
  isv_stage      text check (isv_stage in ('new_prospect', 'contacted', 'discovery', 'technical_review',
                                           'proposal', 'agreement', 'live', 'not_a_fit')),
  temperature    text check (temperature in ('hot', 'warm', 'cold')),
  status         text not null default 'new'
                 check (status in ('new', 'working', 'cold', 'bad_number', 'promoted')),
  zoho_lead_id   text,
  promoted_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists mpg_prospects_user_phone on mpg_prospects (user_id, phone_key);
create index if not exists mpg_prospects_user_list on mpg_prospects (user_id, list_id, status);

create table if not exists mpg_touches (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid(),
  occurred_at     timestamptz not null default now(),
  channel         text not null check (channel in
                  ('walk_in', 'cold_call', 'follow_up_call', 'email', 'social', 'isv')),
  prospect_id     uuid references mpg_prospects(id) on delete set null,
  contact_id      uuid references contacts(id) on delete set null,
  business_name   text not null check (nullif(trim(business_name), '') is not null),
  contact_label   text,
  reach_label     text,
  notes           text,
  next_step       text,
  follow_up_on    date,
  temperature     text check (temperature in ('hot', 'warm', 'cold')),
  call_result     text check (call_result in ('no_answer', 'voicemail', 'gatekeeper', 'dm_reached', 'bad_number')),
  dm_conversation boolean not null default false,
  statement       boolean not null default false,
  demo_proposal   boolean not null default false,
  application     boolean not null default false,
  boarded         boolean not null default false,
  isv_stage       text,
  crm_action_id   uuid references crm_actions(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
-- A touch whose prospect or contact was deleted keeps its snapshot text, so the
-- subject check applies on insert only (enforced in the app), not as a constraint.
create index if not exists mpg_touches_user_occurred on mpg_touches (user_id, occurred_at);

-- Own-row RLS on all three, same four policies as work_items.
do $$
declare t text;
begin
  foreach t in array array['mpg_prospect_lists', 'mpg_prospects', 'mpg_touches']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "own %1$s select" on %1$I', t);
    execute format('create policy "own %1$s select" on %1$I for select to authenticated using (user_id = auth.uid())', t);
    execute format('drop policy if exists "own %1$s insert" on %1$I', t);
    execute format('create policy "own %1$s insert" on %1$I for insert to authenticated with check (user_id = auth.uid())', t);
    execute format('drop policy if exists "own %1$s update" on %1$I', t);
    execute format('create policy "own %1$s update" on %1$I for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('drop policy if exists "own %1$s delete" on %1$I', t);
    execute format('create policy "own %1$s delete" on %1$I for delete to authenticated using (user_id = auth.uid())', t);
  end loop;
end $$;

create or replace function public.mpg_touch_log_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists mpg_prospects_touch on mpg_prospects;
create trigger mpg_prospects_touch before update on mpg_prospects
  for each row execute function public.mpg_touch_log_touch();
drop trigger if exists mpg_touches_touch on mpg_touches;
create trigger mpg_touches_touch before update on mpg_touches
  for each row execute function public.mpg_touch_log_touch();
