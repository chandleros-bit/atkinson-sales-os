-- MPG "Initial lead" leads (the untouched Web Research list) stay out of the OS.
-- zoho-sync skips them and calls remove_zoho_contacts for any lead that moves
-- back into that status. Zoho is untouched; a lead returns on the next sync
-- once Zoho moves it to another status.
--
-- Removing a contact deletes its activities and unlinks deals, tasks and
-- crm_actions (no-action foreign keys). lead_snoozes and work_items cascade.
-- Service role only.
create or replace function remove_zoho_contacts(ext_ids text[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  ids uuid[];
  n integer;
begin
  select array_agg(id) into ids
  from contacts
  where source_crm = 'zoho' and external_id = any(ext_ids);
  if ids is null then
    return 0;
  end if;
  delete from activities where contact_id = any(ids);
  update deals set contact_id = null where contact_id = any(ids);
  update tasks set contact_id = null where contact_id = any(ids);
  update crm_actions set contact_id = null where contact_id = any(ids);
  delete from contacts where id = any(ids);
  get diagnostics n = row_count;
  return n;
end
$$;

revoke all on function remove_zoho_contacts(text[]) from public, anon, authenticated;
grant execute on function remove_zoho_contacts(text[]) to service_role;

-- Clear the ones already synced.
select remove_zoho_contacts(array(
  select external_id from contacts
  where business_id = 'mpg' and source_crm = 'zoho'
    and lower(trim(person_stage)) = 'initial lead'
));
