-- Assistant login (spec 2026-11-03, section 3, "The assistant's login").
--   * user_roles: who is the owner (both books) and who is the assistant
--     (Bayway only). Rows are added by hand (docs/assistant-login-setup.md);
--     no app write policy. No FK to auth.users, so the RLS test can use a
--     throwaway id inside a rolled-back transaction.
--   * app_role / is_owner / can_read_book: SECURITY DEFINER so policies can
--     read user_roles without recursing into its own RLS.
--   * Read policies: book tables by can_read_book(business_id); Bayway-only
--     tables by can_read_book('bay'); money and Chandler-only tables
--     (loans, metrics_daily, calendar_events, sync_log) owner-only.
--   * Write policies on settings, loans, metrics_daily, sync_log and
--     lead_ratings become owner-only.
--   * v_assistant_writes: the notes and tasks the assistant created through
--     crm-action, so the OS can show "by assistant".
--   * briefings.assistant_enabled = false until Chandler turns it on.

create table if not exists public.user_roles (
  user_id    uuid primary key,
  role       text not null check (role in ('owner', 'assistant')),
  books      text[] not null,
  name       text,
  created_at timestamptz not null default now()
);
alter table public.user_roles enable row level security;

create or replace function public.app_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.user_roles where user_id = auth.uid()
$$;
create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'owner')
$$;
create or replace function public.can_read_book(book text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and book = any (books))
$$;
revoke all on function public.app_role() from public, anon;
revoke all on function public.is_owner() from public, anon;
revoke all on function public.can_read_book(text) from public, anon;
grant execute on function public.app_role() to authenticated, service_role;
grant execute on function public.is_owner() to authenticated, service_role;
grant execute on function public.can_read_book(text) to authenticated, service_role;

drop policy if exists "read own or owner user_roles" on public.user_roles;
create policy "read own or owner user_roles" on public.user_roles
  for select to authenticated using (user_id = auth.uid() or public.is_owner());

-- Chandler is the owner. Fail the migration rather than lock him out.
insert into public.user_roles (user_id, role, books, name)
select id, 'owner', array['bay', 'mpg'], 'Chandler Atkinson'
from auth.users where email = 'chandler.dashboard@gmail.com'
on conflict (user_id) do nothing;
do $$
begin
  if not exists (select 1 from public.user_roles where role = 'owner') then
    raise exception 'no owner: chandler.dashboard@gmail.com is not in auth.users';
  end if;
end $$;

-- ---- Read: by book ---------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['stages', 'contacts', 'deals', 'activities', 'tasks'] loop
    execute format('drop policy if exists "authenticated read %1$s" on public.%1$I', t);
    execute format('create policy "authenticated read %1$s" on public.%1$I for select to authenticated using (public.can_read_book(business_id))', t);
  end loop;
  foreach t in array array['borrower_doc_tracking', 'borrower_docs', 'contact_relationships', 'contact_relationship_syncs'] loop
    execute format('drop policy if exists "authenticated read %1$s" on public.%1$I', t);
    execute format('create policy "authenticated read %1$s" on public.%1$I for select to authenticated using (public.can_read_book(''bay''))', t);
  end loop;
  foreach t in array array['calendar_events', 'metrics_daily', 'sync_log'] loop
    execute format('drop policy if exists "authenticated read %1$s" on public.%1$I', t);
    execute format('create policy "authenticated read %1$s" on public.%1$I for select to authenticated using (public.is_owner())', t);
  end loop;
end $$;

drop policy if exists "authenticated select loans" on public.loans;
create policy "authenticated select loans" on public.loans
  for select to authenticated using (public.is_owner());

drop policy if exists "authenticated read crm_actions" on public.crm_actions;
create policy "authenticated read crm_actions" on public.crm_actions
  for select to authenticated using (user_id = auth.uid() or public.is_owner());

drop policy if exists "authenticated read settings" on public.settings;
create policy "authenticated read settings" on public.settings
  for select to authenticated
  using (public.is_owner() or (public.app_role() = 'assistant' and key in ('priority_rules', 'writeback_enabled', 'create_lead_enabled')));

drop policy if exists "authenticated read lead_ratings" on public.lead_ratings;
create policy "authenticated read lead_ratings" on public.lead_ratings
  for select to authenticated using (public.can_read_book(business_id));

-- ---- Write: owner only -----------------------------------------------------
drop policy if exists "authenticated insert lead_ratings" on public.lead_ratings;
create policy "authenticated insert lead_ratings" on public.lead_ratings
  for insert to authenticated with check (rated_by = auth.uid() and public.is_owner());
drop policy if exists "authenticated update lead_ratings" on public.lead_ratings;
create policy "authenticated update lead_ratings" on public.lead_ratings
  for update to authenticated using (public.is_owner()) with check (rated_by = auth.uid() and public.is_owner());
drop policy if exists "authenticated delete lead_ratings" on public.lead_ratings;
create policy "authenticated delete lead_ratings" on public.lead_ratings
  for delete to authenticated using (public.is_owner());

drop policy if exists "authenticated insert loans" on public.loans;
create policy "authenticated insert loans" on public.loans
  for insert to authenticated with check (public.is_owner());
drop policy if exists "authenticated update loans" on public.loans;
create policy "authenticated update loans" on public.loans
  for update to authenticated using (public.is_owner()) with check (public.is_owner());

drop policy if exists "authenticated insert metrics_daily" on public.metrics_daily;
create policy "authenticated insert metrics_daily" on public.metrics_daily
  for insert to authenticated with check (public.is_owner());
drop policy if exists "authenticated update metrics_daily" on public.metrics_daily;
create policy "authenticated update metrics_daily" on public.metrics_daily
  for update to authenticated using (public.is_owner()) with check (public.is_owner());

-- Settings writes: the three keys the app saves, owner only.
drop policy if exists "authenticated insert arive settings" on public.settings;
drop policy if exists "authenticated update arive settings" on public.settings;
drop policy if exists "authenticated insert forecast settings" on public.settings;
drop policy if exists "authenticated update forecast settings" on public.settings;
drop policy if exists "authenticated insert metric_targets" on public.settings;
drop policy if exists "authenticated update metric_targets" on public.settings;
drop policy if exists "owner insert settings" on public.settings;
drop policy if exists "owner update settings" on public.settings;
create policy "owner insert settings" on public.settings
  for insert to authenticated with check (public.is_owner() and key in ('arive', 'forecast', 'metric_targets'));
create policy "owner update settings" on public.settings
  for update to authenticated
  using (public.is_owner() and key in ('arive', 'forecast', 'metric_targets'))
  with check (public.is_owner() and key in ('arive', 'forecast', 'metric_targets'));

drop policy if exists "authenticated insert arive sync_log" on public.sync_log;
create policy "authenticated insert arive sync_log" on public.sync_log
  for insert to authenticated with check (source = 'arive' and public.is_owner());

-- Per-user tables keep their own-row rules and gain the book check.
drop policy if exists "own work_items insert" on public.work_items;
create policy "own work_items insert" on public.work_items
  for insert to authenticated with check (user_id = auth.uid() and public.can_read_book(business_id));
drop policy if exists "own work_items update" on public.work_items;
create policy "own work_items update" on public.work_items
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and public.can_read_book(business_id));
drop policy if exists "own contact_events insert" on public.contact_events;
create policy "own contact_events insert" on public.contact_events
  for insert to authenticated with check (user_id = auth.uid() and public.can_read_book(business_id));
drop policy if exists "own contact_events update" on public.contact_events;
create policy "own contact_events update" on public.contact_events
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and public.can_read_book(business_id));

-- ---- "by assistant" ----------------------------------------------------------
-- Each successful add_note / create_task step the assistant ran, joined to
-- the mirrored row (FUB notes are activities 'note-<id>', tasks are tasks
-- '<id>'). security_invoker: the owner sees all, the assistant her own.
create or replace view public.v_assistant_writes
with (security_invoker = on) as
select ca.contact_id, ca.created_at, a.id as activity_id, t.id as task_id
from public.crm_actions ca
join public.user_roles ur on ur.user_id = ca.user_id and ur.role = 'assistant'
cross join lateral jsonb_array_elements(case when jsonb_typeof(ca.results) = 'array' then ca.results else '[]'::jsonb end) s
left join public.activities a
  on s->>'step' = 'add_note' and a.source_crm = 'fub' and a.external_id = 'note-' || (s->>'crm_id')
left join public.tasks t
  on s->>'step' = 'create_task' and t.source_crm = 'fub' and t.external_id = s->>'crm_id'
where (s->>'ok')::boolean is true
  and (a.id is not null or t.id is not null);
revoke all on public.v_assistant_writes from anon;
grant select on public.v_assistant_writes to authenticated;

-- Shelby's briefing stays off until Chandler test-sends it.
update public.settings
set value = value || '{"assistant_enabled": false}'::jsonb
where key = 'briefings' and not (value ? 'assistant_enabled');
