-- Reference section access (spec 2026-11-05-reference-section-design.md).
-- Runs as postgres, impersonates the owner, a fake assistant and a login with
-- no role, and ROLLS BACK. Run: npx supabase db query --linked -f supabase/tests/reference.sql
begin;

insert into public.user_roles (user_id, role, books, name)
values ('00000000-0000-4000-8000-0000000000a3', 'assistant', array['bay'], 'Ref Assistant');

set local role authenticated;

-- Owner.
select set_config('request.jwt.claims', '{"sub":"2cbf8825-be9d-429a-a4ed-3c3915d09c1d","role":"authenticated"}', true);
do $$
declare n int; who text;
begin
  insert into public.reference_lenders (lender, ae_name, comp_notes) values ('Ref Test Lender', 'Ann AE', '1.25%');
  select updated_by_name into who from public.reference_lenders where lender = 'Ref Test Lender';
  if who is distinct from 'Chandler Atkinson' then raise exception 'FAIL: stamp gave %', who; end if;
  select count(*) into n from public.reference_links;
  if n < 10 then raise exception 'FAIL: owner sees % seeded links', n; end if;
  begin
    insert into public.reference_links (title, url, grp) values ('Bad', 'ftp://x', 'Test');
    raise exception 'FAIL: non-http link accepted';
  exception when check_violation then null;
  end;
  raise notice 'owner reference: all checks passed';
end $$;

-- Assistant: full read and write, comp included.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
do $$
declare n int; who text;
begin
  select count(*) into n from public.reference_lenders where lender = 'Ref Test Lender' and comp_notes = '1.25%';
  if n <> 1 then raise exception 'FAIL: assistant cannot read the lender and its comp'; end if;
  update public.reference_lenders set ae_phone = '7135550100' where lender = 'Ref Test Lender';
  select updated_by_name into who from public.reference_lenders where lender = 'Ref Test Lender';
  if who is distinct from 'Ref Assistant' then raise exception 'FAIL: assistant stamp gave %', who; end if;
  insert into public.reference_links (title, url, grp) values ('Ref Link', 'https://example.com', 'Test');
  delete from public.reference_links where title = 'Ref Link';
  delete from public.reference_lenders where lender = 'Ref Test Lender';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: assistant could not delete'; end if;
  raise notice 'assistant reference: all checks passed';
end $$;

-- No role: nothing.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000ff","role":"authenticated"}', true);
do $$
declare n int;
begin
  select count(*) into n from public.reference_links;
  if n <> 0 then raise exception 'FAIL: roleless login reads % links', n; end if;
  begin
    insert into public.reference_lenders (lender) values ('Sneaky');
    raise exception 'FAIL: roleless insert allowed';
  exception when insufficient_privilege then null;
  end;
  raise notice 'no-role reference: all checks passed';
end $$;

rollback;
