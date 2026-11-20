-- Rate lock dates on loans (Bayway Bot Engine doc, Sales OS week 2). The
-- Arive Pipeline Report already carries "Lock Date" and "Lock Expiration";
-- the import now maps them, and this backfills rows already imported from
-- their raw CSV row. Arive writes either M/D/YYYY or YYYY-MM-DD, sometimes
-- with a time ("2026-11-10 11:59:22 PM"); the time is dropped.

alter table public.loans add column if not exists lock_date date;
alter table public.loans add column if not exists lock_expires_on date;

create or replace function public.arive_date(v text) returns date
language plpgsql immutable as $$
declare m text[];
begin
  if v is null then return null; end if;
  m := regexp_match(trim(v), '^(\d{4})-(\d{1,2})-(\d{1,2})');
  if m is not null then return make_date(m[1]::int, m[2]::int, m[3]::int); end if;
  m := regexp_match(trim(v), '^(\d{1,2})/(\d{1,2})/(\d{4})');
  if m is not null then return make_date(m[3]::int, m[1]::int, m[2]::int); end if;
  return null;
exception when others then
  return null;
end $$;

update public.loans
set lock_date = public.arive_date(raw ->> 'Lock Date'),
    lock_expires_on = public.arive_date(raw ->> 'Lock Expiration')
where raw ? 'Lock Expiration' or raw ? 'Lock Date';

create index if not exists loans_lock_expires_idx on public.loans (lock_expires_on) where lock_expires_on is not null;
