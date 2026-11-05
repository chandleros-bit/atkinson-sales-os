-- Borrower docs tracked in the OS (spec 2026-11-05-docs-in-os-design.md).
-- The tables and v_active_pipeline stay; the writer moves from the Google
-- Sheet (sheets-docs-sync, now unscheduled) to three RPCs. A trigger seeds
-- the default checklist when a Bayway lead reaches Application Received.

-- 1. Columns ------------------------------------------------------------------
alter table public.borrower_docs add column if not exists received_by_name text;
alter table public.borrower_docs add column if not exists updated_by uuid;

-- 2. Default checklist ---------------------------------------------------------
create or replace function public.default_borrower_docs() returns text[]
language sql immutable as $$
  select array['Paystubs', 'W2', 'Bank statements', 'ID', 'Tax returns']::text[]
$$;

-- 3. Internal helpers ------------------------------------------------------------
-- The active tracking row for a Bayway contact: existing, re-activated or new.
-- Null when the contact is not Bayway or has no FUB id.
create or replace function public._doc_tracking_for(p_contact uuid) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  ext text;
  tid bigint;
  gone timestamptz;
begin
  select external_id into ext from contacts where id = p_contact and business_id = 'bay';
  if ext is null then return null; end if;
  select id, removed_at into tid, gone from borrower_doc_tracking where fub_person_id = ext;
  if tid is null then
    insert into borrower_doc_tracking (fub_person_id, contact_id, updated_at)
    values (ext, p_contact, now())
    returning id into tid;
  elsif gone is not null then
    update borrower_doc_tracking set removed_at = null, contact_id = p_contact, updated_at = now() where id = tid;
  end if;
  return tid;
end
$$;

-- Default list, Needed, for a Bayway contact with no active tracking row.
-- A file that is already tracked is left alone (never reset).
create or replace function public.seed_borrower_docs(p_contact uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  ext text;
  tid bigint;
  d text;
begin
  select external_id into ext from contacts where id = p_contact and business_id = 'bay';
  if ext is null then return; end if;
  if exists (select 1 from borrower_doc_tracking where fub_person_id = ext and removed_at is null) then return; end if;
  tid := public._doc_tracking_for(p_contact);
  foreach d in array public.default_borrower_docs() loop
    insert into borrower_docs (tracking_id, doc_type, status, first_requested_at, updated_at, updated_by)
    values (tid, d, 'needed', now(), now(), auth.uid())
    on conflict (tracking_id, doc_type) do update
      set status = 'needed', first_requested_at = now(), received_at = null, received_by_name = null,
          removed_at = null, updated_at = now(), updated_by = auth.uid()
      where borrower_docs.removed_at is not null;
  end loop;
end
$$;

-- Owner or assistant, on a Bayway contact they can read.
create or replace function public._doc_guard(p_contact uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(public.app_role(), '') not in ('owner', 'assistant') then
    raise exception 'not allowed';
  end if;
  if not public.can_read_book('bay')
     or not exists (select 1 from contacts where id = p_contact and business_id = 'bay' and external_id is not null) then
    raise exception 'Bayway contacts only';
  end if;
end
$$;

-- 4. RPCs (the only write path) ---------------------------------------------------
create or replace function public.set_borrower_doc(p_contact uuid, p_doc_type text, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare
  nm text := btrim(coalesce(p_doc_type, ''));
  tid bigint;
  cur borrower_docs%rowtype;
  who text;
begin
  perform public._doc_guard(p_contact);
  if p_status is null or p_status not in ('needed', 'received', 'removed') then
    raise exception 'bad status';
  end if;
  if length(nm) < 1 or length(nm) > 60 then
    raise exception 'doc name must be 1-60 characters';
  end if;
  tid := public._doc_tracking_for(p_contact);
  select * into cur from borrower_docs
   where tracking_id = tid and lower(doc_type) = lower(nm)
   order by (removed_at is null) desc, id
   limit 1;

  if p_status = 'removed' then
    if cur.id is not null then
      update borrower_docs set removed_at = now(), updated_at = now(), updated_by = auth.uid() where id = cur.id;
    end if;
  elsif p_status = 'received' then
    select name into who from user_roles where user_id = auth.uid();
    if cur.id is null then
      insert into borrower_docs (tracking_id, doc_type, status, received_at, received_by_name, updated_at, updated_by)
      values (tid, nm, 'received', now(), who, now(), auth.uid());
    else
      update borrower_docs
         set status = 'received', received_at = now(), received_by_name = who, removed_at = null,
             updated_at = now(), updated_by = auth.uid()
       where id = cur.id;
    end if;
  else
    if cur.id is null then
      insert into borrower_docs (tracking_id, doc_type, status, first_requested_at, updated_at, updated_by)
      values (tid, nm, 'needed', now(), now(), auth.uid());
    elsif cur.status <> 'needed' or cur.removed_at is not null then
      update borrower_docs
         set status = 'needed', first_requested_at = now(), received_at = null, received_by_name = null,
             removed_at = null, updated_at = now(), updated_by = auth.uid()
       where id = cur.id;
    end if;
  end if;
  update borrower_doc_tracking set updated_at = now() where id = tid;
end
$$;

create or replace function public.set_borrower_doc_note(p_contact uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare
  n text := nullif(btrim(coalesce(p_note, '')), '');
  tid bigint;
begin
  perform public._doc_guard(p_contact);
  if length(n) > 500 then
    raise exception 'note must be 500 characters or fewer';
  end if;
  tid := public._doc_tracking_for(p_contact);
  update borrower_doc_tracking set notes = n, updated_at = now() where id = tid;
end
$$;

create or replace function public.setup_borrower_docs(p_contact uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._doc_guard(p_contact);
  perform public.seed_borrower_docs(p_contact);
end
$$;

-- 5. Seed trigger -----------------------------------------------------------------
-- contacts_track_stage (BEFORE) sets stage_key from the FUB fields; these AFTER
-- triggers see the final value. Not "UPDATE OF stage_key": syncs update raw /
-- person_stage, and a column list only matches columns named in the UPDATE.
create or replace function public.contacts_seed_docs() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.seed_borrower_docs(new.id);
  return null;
end
$$;

drop trigger if exists contacts_seed_docs_ins on public.contacts;
create trigger contacts_seed_docs_ins
  after insert on public.contacts
  for each row
  when (new.business_id = 'bay' and new.stage_key = 'Application Received')
  execute function public.contacts_seed_docs();

drop trigger if exists contacts_seed_docs_upd on public.contacts;
create trigger contacts_seed_docs_upd
  after update on public.contacts
  for each row
  when (new.business_id = 'bay' and new.stage_key = 'Application Received'
        and old.stage_key is distinct from new.stage_key)
  execute function public.contacts_seed_docs();

-- 6. Grants -----------------------------------------------------------------------
revoke all on function public.default_borrower_docs() from public, anon, authenticated;
revoke all on function public._doc_tracking_for(uuid) from public, anon, authenticated;
revoke all on function public.seed_borrower_docs(uuid) from public, anon, authenticated;
revoke all on function public._doc_guard(uuid) from public, anon, authenticated;
revoke all on function public.contacts_seed_docs() from public, anon, authenticated;
revoke all on function public.set_borrower_doc(uuid, text, text) from public, anon;
revoke all on function public.set_borrower_doc_note(uuid, text) from public, anon;
revoke all on function public.setup_borrower_docs(uuid) from public, anon;
grant execute on function public.set_borrower_doc(uuid, text, text) to authenticated;
grant execute on function public.set_borrower_doc_note(uuid, text) to authenticated;
grant execute on function public.setup_borrower_docs(uuid) to authenticated;

-- 7. Retire the Google Sheet feed ---------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'sheets-docs-sync-15min') then
    perform cron.unschedule('sheets-docs-sync-15min');
  end if;
end
$$;
-- Every active row came from the sheet (3 test borrowers since Jul 22). Hidden, not deleted.
update public.borrower_docs set removed_at = now(), updated_at = now() where removed_at is null;
update public.borrower_doc_tracking set removed_at = now(), updated_at = now() where removed_at is null;

-- 8. Launch backfill: leads in Application Received today; aging starts now. ----------
do $$
declare c uuid;
begin
  for c in select id from public.contacts where business_id = 'bay' and stage_key = 'Application Received' loop
    perform public.seed_borrower_docs(c);
  end loop;
end
$$;
