-- Tune-up page and bot change log (Bayway Bot Engine doc, learning loop).
-- The Friday tune-up bot proposes changes here (a new lesson line, or an edit
-- to a bot's instructions) with the evidence; Chandler approves or rejects on
-- the Tune-up page. Approving commits the change to the private bayway-bots
-- repo through the bot-repo function, so every version can be rolled back.
-- bot_files mirrors the repo's bots/ and lessons/ files so scheduled bots can
-- read the current text with SQL. compliance.md is never touched.

create table if not exists public.bot_changes (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  bot         text not null,
  kind        text not null check (kind in ('lesson', 'instruction')),
  file_path   text not null check (file_path ~ '^(bots|lessons)/[a-z0-9._-]+\.md$' and file_path !~* 'compliance'),
  summary     text not null,           -- one line: what changes
  lesson      text,                    -- kind = lesson: the line to add
  old_text    text,                    -- kind = instruction: exact text to replace
  new_text    text,                    -- kind = instruction: replacement
  evidence    text not null,
  status      text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected', 'applied', 'failed')),
  version     int,                     -- per-bot version once applied
  commit_sha  text,
  error       text,
  decided_at  timestamptz,
  check ((kind = 'lesson' and lesson is not null) or (kind = 'instruction' and old_text is not null and new_text is not null))
);
create index if not exists bot_changes_status_idx on public.bot_changes (status, created_at);

create table if not exists public.bot_files (
  path       text primary key,
  content    text not null,
  sha        text,
  updated_at timestamptz not null default now()
);

alter table public.bot_changes enable row level security;
alter table public.bot_files enable row level security;
drop policy if exists "owner all bot_changes" on public.bot_changes;
create policy "owner all bot_changes" on public.bot_changes for all to authenticated using (public.is_owner()) with check (public.is_owner());
drop policy if exists "owner read bot_files" on public.bot_files;
create policy "owner read bot_files" on public.bot_files for select to authenticated using (public.is_owner());
