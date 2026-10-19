-- Link FUB activities and tasks that were synced before their person.
--
-- fub-activity-sync and fub-task-sync resolve contact_id from a map of our
-- contacts built at the start of each run. fub-sync (people) runs on the same
-- cron tick, so a lead created minutes before a run (e.g. Lamond Hammer Allen,
-- created 15:55, called 15:57, synced 16:00) can have its call stored with
-- contact_id NULL. Later runs never revisit that row, so the dashboard shows
-- "not called" for good. As of 2026-10-19: 9 activities (4 outbound calls) and
-- 18 tasks were stuck that way.
--
-- link_fub_orphans() attaches any such row to its contact once the contact
-- exists. All three FUB syncs call it at the end of each run, so whichever
-- finishes last does the linking.
create or replace function public.link_fub_orphans()
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  a integer;
  t integer;
begin
  update activities x
  set contact_id = c.id
  from contacts c
  where x.source_crm = 'fub'
    and x.contact_id is null
    and c.source_crm = 'fub'
    and c.external_id = coalesce(x.raw->>'personId', x.raw->'person'->>'id');
  get diagnostics a = row_count;

  update tasks x
  set contact_id = c.id
  from contacts c
  where x.source_crm = 'fub'
    and x.contact_id is null
    and c.source_crm = 'fub'
    and c.external_id = coalesce(x.raw->>'personId', x.raw->'person'->>'id');
  get diagnostics t = row_count;

  return jsonb_build_object('activities', a, 'tasks', t);
end
$$;

revoke execute on function public.link_fub_orphans() from public;
revoke execute on function public.link_fub_orphans() from anon, authenticated;
grant execute on function public.link_fub_orphans() to service_role;

-- One-time backfill.
select public.link_fub_orphans();

-- Leftovers from before the owner filter (0030): activity on people who are
-- not in Chandler's book, which 0030's per-contact cleanup could not reach
-- because these rows were never linked to a contact (Ronnie Gaydos / Alex
-- Boeger calls, notes and appointments). Anything still unlinked after the
-- backfill above, whose person is not one of our contacts, is not his.
-- Older than a day only, so a brand-new lead's activity that is still waiting
-- for its contact is never caught here.
delete from activities x
where x.source_crm = 'fub'
  and x.contact_id is null
  and coalesce(x.raw->>'personId', x.raw->'person'->>'id') is not null
  and x.occurred_at < now() - interval '1 day'
  and not exists (
    select 1 from contacts c
    where c.source_crm = 'fub'
      and c.external_id = coalesce(x.raw->>'personId', x.raw->'person'->>'id')
  );
