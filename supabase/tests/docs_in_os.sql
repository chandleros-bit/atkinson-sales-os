-- Docs in the OS (spec 2026-11-05). Runs as postgres, impersonates the owner
-- and a fake assistant, and ROLLS BACK: nothing persists.
-- Run: npx supabase db query --linked -f supabase/tests/docs_in_os.sql
-- Passing: no error (each failed check raises 'FAIL: ...').
begin;

-- Test contacts. derive_stage: person_stage 'Pre-qualified' = Application Received.
insert into public.contacts (id, business_id, source_crm, external_id, name, person_stage, raw)
values
  ('00000000-0000-4000-8000-0000000000d1', 'bay', 'fub', 'docs-test-1', 'Docs Test Bay', 'Lead', '{"tags":[]}'),
  ('00000000-0000-4000-8000-0000000000d2', 'mpg', 'zoho', 'docs-test-2', 'Docs Test MPG', 'Open', '{}');
insert into public.user_roles (user_id, role, books, name)
values ('00000000-0000-4000-8000-0000000000a2', 'assistant', array['bay'], 'Test Assistant');

do $$
declare n int; t1 timestamptz; t2 timestamptz;
begin
  -- Seeding on reaching Application Received.
  update public.contacts set person_stage = 'Pre-qualified' where id = '00000000-0000-4000-8000-0000000000d1';
  select count(*) into n from public.borrower_docs d join public.borrower_doc_tracking t on t.id = d.tracking_id
   where t.fub_person_id = 'docs-test-1' and d.status = 'needed' and d.removed_at is null;
  if n <> 5 then raise exception 'FAIL: seeded % docs, want 5', n; end if;

  select min(first_requested_at) into t1 from public.borrower_docs d join public.borrower_doc_tracking t on t.id = d.tracking_id
   where t.fub_person_id = 'docs-test-1';
  -- Away and back: no reseed, no clock reset.
  update public.contacts set raw = '{"tags":["disclosed"]}' where id = '00000000-0000-4000-8000-0000000000d1';
  update public.contacts set raw = '{"tags":[]}' where id = '00000000-0000-4000-8000-0000000000d1';
  select count(*), min(first_requested_at) into n, t2 from public.borrower_docs d join public.borrower_doc_tracking t on t.id = d.tracking_id
   where t.fub_person_id = 'docs-test-1';
  if n <> 5 or t2 <> t1 then raise exception 'FAIL: reseeded (% rows) or clock moved', n; end if;

  -- MPG never seeded.
  perform public.seed_borrower_docs('00000000-0000-4000-8000-0000000000d2');
  select count(*) into n from public.borrower_doc_tracking where fub_person_id = 'docs-test-2';
  if n <> 0 then raise exception 'FAIL: MPG contact got doc tracking'; end if;
end $$;

set local role authenticated;

-- Owner.
select set_config('request.jwt.claims', '{"sub":"2cbf8825-be9d-429a-a4ed-3c3915d09c1d","role":"authenticated"}', true);
do $$
declare n int; r record;
begin
  perform public.set_borrower_doc('00000000-0000-4000-8000-0000000000d1', 'w2', 'received');
  select d.* into r from public.borrower_docs d join public.borrower_doc_tracking t on t.id = d.tracking_id
   where t.fub_person_id = 'docs-test-1' and d.doc_type = 'W2';
  if r.status <> 'received' or r.received_at is null or r.received_by_name is distinct from 'Chandler Atkinson' then
    raise exception 'FAIL: received not stamped (status %, by %)', r.status, r.received_by_name;
  end if;

  perform public.set_borrower_doc('00000000-0000-4000-8000-0000000000d1', 'W2', 'needed');
  select d.* into r from public.borrower_docs d join public.borrower_doc_tracking t on t.id = d.tracking_id
   where t.fub_person_id = 'docs-test-1' and d.doc_type = 'W2';
  if r.status <> 'needed' or r.received_at is not null then raise exception 'FAIL: back to needed did not reset'; end if;

  perform public.set_borrower_doc('00000000-0000-4000-8000-0000000000d1', 'ID', 'removed');
  select count(*) into n from public.v_active_pipeline
   where id = '00000000-0000-4000-8000-0000000000d1' and 'ID' = any (docs_outstanding);
  if n <> 0 then raise exception 'FAIL: removed doc still outstanding'; end if;

  perform public.set_borrower_doc('00000000-0000-4000-8000-0000000000d1', 'Gift letter', 'needed');
  perform public.set_borrower_doc_note('00000000-0000-4000-8000-0000000000d1', '  Sending W2 tomorrow  ');
  select count(*) into n from public.borrower_doc_tracking where fub_person_id = 'docs-test-1' and notes = 'Sending W2 tomorrow';
  if n <> 1 then raise exception 'FAIL: note not saved trimmed'; end if;

  begin
    perform public.set_borrower_doc('00000000-0000-4000-8000-0000000000d1', '   ', 'needed');
    raise exception 'FAIL: blank doc name accepted';
  exception when others then
    if sqlerrm not like '%1-60%' then raise; end if;
  end;

  begin
    insert into public.borrower_docs (tracking_id, doc_type, status) values (1, 'Hack', 'needed');
    raise exception 'FAIL: direct insert allowed';
  exception when insufficient_privilege then null;
  end;
  raise notice 'owner docs: all checks passed';
end $$;

-- Assistant.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
do $$
declare r record;
begin
  perform public.set_borrower_doc('00000000-0000-4000-8000-0000000000d1', 'Paystubs', 'received');
  select d.* into r from public.borrower_docs d join public.borrower_doc_tracking t on t.id = d.tracking_id
   where t.fub_person_id = 'docs-test-1' and d.doc_type = 'Paystubs';
  if r.received_by_name is distinct from 'Test Assistant' then raise exception 'FAIL: assistant not recorded'; end if;

  begin
    perform public.set_borrower_doc('00000000-0000-4000-8000-0000000000d2', 'W2', 'needed');
    raise exception 'FAIL: assistant edited an MPG contact';
  exception when others then
    if sqlerrm not like '%Bayway contacts only%' then raise; end if;
  end;
  raise notice 'assistant docs: all checks passed';
end $$;

rollback;
