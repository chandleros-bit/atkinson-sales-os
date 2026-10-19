-- Keep Atkinson Sales OS to Chandler's own FollowUpBoss book.
--
-- Chandler's FUB login is an admin, so the API returns every agent's people
-- and tasks. From now on the FUB syncs keep only records assigned to
-- FUB_USER_ID (Chandler = 6; see supabase/functions/_shared/fub-owner.ts).
-- This migration adds the removal helper those syncs call, and does the
-- one-time cleanup of what was already synced. Nothing here touches FUB.
--
-- At the time of writing (2026-10-19): 70 contacts owned by Ronnie Gaydos (63),
-- Alex Boeger (6) and Santiago Jimenez (1), with 475 activities and 21 tasks,
-- plus 84 tasks assigned to other agents.

-- Remove FUB contacts (by FUB person id) and the rows that hang off them.
-- activities / tasks / deals are mirrors of that person and go with it. The
-- write-back audit (crm_actions) and doc tracking (keyed by fub_person_id from
-- the sheet) are kept and only unlinked. lead_snoozes cascades.
create or replace function public.remove_fub_contacts(ext_ids text[])
returns integer
language plpgsql
set search_path = public
as $$
declare
  ids uuid[];
  n integer;
begin
  select array_agg(id) into ids
  from contacts
  where source_crm = 'fub' and external_id = any (ext_ids);
  if ids is null then
    return 0;
  end if;
  delete from activities where contact_id = any (ids);
  delete from tasks where contact_id = any (ids);
  delete from deals where contact_id = any (ids);
  update crm_actions set contact_id = null where contact_id = any (ids);
  update borrower_doc_tracking set contact_id = null where contact_id = any (ids);
  delete from contacts where id = any (ids);
  get diagnostics n = row_count;
  return n;
end
$$;

-- Only the service-role syncs may call it (the app's users must not be able
-- to delete through /rest/v1/rpc).
revoke execute on function public.remove_fub_contacts(text[]) from public;
revoke execute on function public.remove_fub_contacts(text[]) from anon, authenticated;
grant execute on function public.remove_fub_contacts(text[]) to service_role;

-- One-time cleanup. '6' is Chandler's FUB user id (confirmed via crm-action
-- whoami on 2026-10-18), the same value as the FUB_USER_ID function secret.

-- Tasks assigned to another agent, on anyone's contact.
delete from tasks
where source_crm = 'fub'
  and coalesce(raw->>'assignedUserId', '') <> '6';

-- Other agents' contacts and everything hanging off them.
select public.remove_fub_contacts(
  coalesce(
    (select array_agg(external_id)
     from contacts
     where source_crm = 'fub'
       and coalesce(raw->>'assignedUserId', '') <> '6'),
    '{}'::text[]
  )
);
