-- Dialer phase 3 (docs/superpowers/specs/2026-10-29-dialer-cadence-design.md,
-- Tuesday: borrower and agents).
--   * contact_relationships: the buyer's / seller's agents on a Bayway
--     borrower, mirrored from FUB Relationships by crm-action
--     `contact_relationships` (other relationship types are not stored).
--   * contact_relationship_syncs: when each borrower was last pulled, so FUB
--     is asked at most once an hour per borrower.
--   * v_loan_agents: each agent with the Realtor contact it matches (same
--     last-10 phone digits or same email), matched at read time so a realtor
--     added later links without a re-sync.
-- Both tables are written only by crm-action (service role).

create table if not exists public.contact_relationships (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  external_id text not null unique,
  kind text not null check (kind in ('buyer_agent', 'seller_agent')),
  type text,
  name text,
  phone text,
  email text,
  synced_at timestamptz not null default now()
);
create index if not exists contact_relationships_contact_idx on public.contact_relationships (contact_id);

create table if not exists public.contact_relationship_syncs (
  contact_id uuid primary key references public.contacts(id) on delete cascade,
  synced_at timestamptz not null default now()
);

alter table public.contact_relationships enable row level security;
alter table public.contact_relationship_syncs enable row level security;
drop policy if exists "authenticated read contact_relationships" on public.contact_relationships;
create policy "authenticated read contact_relationships" on public.contact_relationships
  for select to authenticated using (true);
drop policy if exists "authenticated read contact_relationship_syncs" on public.contact_relationship_syncs;
create policy "authenticated read contact_relationship_syncs" on public.contact_relationship_syncs
  for select to authenticated using (true);

create or replace view public.v_loan_agents
with (security_invoker = on) as
select
  r.id,
  r.contact_id,
  r.kind,
  r.name,
  r.phone,
  r.email,
  m.id as matched_contact_id,
  m.name as matched_name,
  m.phone as matched_phone,
  case when m.id is not null
    then 'https://baywayhtx.followupboss.com/2/people/view/' || m.external_id
  end as matched_url
from public.contact_relationships r
left join lateral (
  select c.id, c.name, c.phone, c.external_id
  from public.contacts c
  where c.business_id = 'bay'
    and (
      c.person_stage = 'Realtors'
      or (jsonb_typeof(c.raw->'tags') = 'array' and exists (
        select 1 from jsonb_array_elements_text(c.raw->'tags') t where lower(trim(t)) = 'top partner'))
    )
    and (
      (length(regexp_replace(coalesce(r.phone, ''), '\D', '', 'g')) >= 10
        and right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 10)
          = right(regexp_replace(r.phone, '\D', '', 'g'), 10))
      or (nullif(trim(r.email), '') is not null and lower(trim(c.email)) = lower(trim(r.email)))
    )
  order by c.name
  limit 1
) m on true;
