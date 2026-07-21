-- Borrower document tracking, fed by sheets-docs-sync from a Google Sheet the
-- Bayway assistant maintains daily. Arive (the LOS) exposes no API and no
-- webhooks, so the sheet is the permanent source of truth for doc status.
--
-- Two tables on purpose: the presence of a borrower_doc_tracking row is what
-- lets a card distinguish "not tracked" from "tracked, owes nothing". One
-- table could not tell those apart.
--
-- Written by the service role; the app only SELECTs (read-only RLS, same shape
-- as tasks in 0017).

create table if not exists borrower_doc_tracking (
  id             bigserial primary key,
  fub_person_id  text not null unique,          -- contacts.external_id for source_crm='fub'
  contact_id     uuid references contacts(id),  -- null until that contact syncs
  notes          text,
  last_seen_at   timestamptz,
  removed_at     timestamptz,                   -- borrower dropped out of the sheet
  updated_at     timestamptz not null default now()
);

create table if not exists borrower_docs (
  id                  bigserial primary key,
  tracking_id         bigint not null references borrower_doc_tracking(id) on delete cascade,
  doc_type            text not null,            -- discovered from the sheet header row
  status              text not null check (status in ('needed', 'received')),
  first_requested_at  timestamptz,              -- stamped blank -> needed
  received_at         timestamptz,              -- stamped needed -> received
  removed_at          timestamptz,              -- doc column disappeared from the sheet
  updated_at          timestamptz not null default now(),
  unique (tracking_id, doc_type)
);

alter table borrower_doc_tracking enable row level security;
alter table borrower_docs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'borrower_doc_tracking'
      and policyname = 'authenticated read borrower_doc_tracking'
  ) then
    execute 'create policy "authenticated read borrower_doc_tracking" on borrower_doc_tracking for select to authenticated using (true)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'borrower_docs'
      and policyname = 'authenticated read borrower_docs'
  ) then
    execute 'create policy "authenticated read borrower_docs" on borrower_docs for select to authenticated using (true)';
  end if;
end $$;

-- The view's join key, and its outstanding-docs lateral.
create index if not exists idx_bdt_person  on borrower_doc_tracking (fub_person_id);
create index if not exists idx_bd_tracking on borrower_docs (tracking_id, status);
