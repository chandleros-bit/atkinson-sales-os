-- Lead ROI access (spec 2026-11-05-lead-sources-roi-design.md). Runs as
-- postgres, impersonates the owner and a fake assistant, and ROLLS BACK.
-- Run: npx supabase db query --linked -f supabase/tests/lead_roi.sql
begin;

insert into public.user_roles (user_id, role, books, name)
values ('00000000-0000-4000-8000-0000000000a4', 'assistant', array['bay'], 'ROI Assistant');

set local role authenticated;

-- Owner: read and write both tables.
select set_config('request.jwt.claims', '{"sub":"2cbf8825-be9d-429a-a4ed-3c3915d09c1d","role":"authenticated"}', true);
do $$
declare n int;
begin
  insert into public.source_aliases (book, raw, label, is_free) values ('bay', 'ROI Test Raw', 'ROI Test', true);
  insert into public.marketing_spend (book, source, month, amount) values ('bay', 'ROI Test', '2026-10-01', 310);
  select count(*) into n from public.marketing_spend where source = 'ROI Test';
  if n <> 1 then raise exception 'FAIL: owner reads % spend rows', n; end if;
  begin
    insert into public.marketing_spend (book, source, month, amount) values ('bay', 'ROI Test', '2026-10-02', 1);
    raise exception 'FAIL: mid-month spend accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.marketing_spend (book, source, month, amount) values ('bay', 'ROI Test', '2026-09-01', -5);
    raise exception 'FAIL: negative spend accepted';
  exception when check_violation then null;
  end;
  raise notice 'owner lead_roi: all checks passed';
end $$;

-- Assistant: sees nothing, writes nothing.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a4","role":"authenticated"}', true);
do $$
declare n int;
begin
  select count(*) into n from public.marketing_spend;
  if n <> 0 then raise exception 'FAIL: assistant reads % spend rows', n; end if;
  select count(*) into n from public.source_aliases;
  if n <> 0 then raise exception 'FAIL: assistant reads % aliases', n; end if;
  begin
    insert into public.marketing_spend (book, source, month, amount) values ('bay', 'Sneaky', '2026-10-01', 1);
    raise exception 'FAIL: assistant insert allowed';
  exception when insufficient_privilege then null;
  end;
  raise notice 'assistant lead_roi: all checks passed';
end $$;

rollback;
