-- Partners tab, Sales OS week 1 (Bayway Bot Engine doc, "What to add to Sales
-- OS", item 1): partner_profiles plus a list view with stage and last touch.
-- Who's on it: every FUB contact at the Realtors stage (or carrying a partner
-- tag), plus agents found on Arive loans. Owner-only, like Opportunities.
-- HAR import, scoring and the class tracker come in later weeks.

create table if not exists public.partner_profiles (
  id             uuid primary key default gen_random_uuid(),
  contact_id     uuid unique references public.contacts(id) on delete set null,
  name           text not null,
  email          text,
  phone          text,
  brokerage      text,
  partner_type   text not null default 'realtor'
                 check (partner_type in ('realtor', 'investor_agent', 'property_manager')),
  partner_stage  text not null default 'prospect'
                 check (partner_stage in ('prospect', 'dream_20', 'invited', 'attended_class',
                                          'one_to_one', 'referring', 'top_partner')),
  stage_since    timestamptz not null default now(),
  source         text not null check (source in ('fub', 'arive', 'manual')),
  next_touch_due date,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- An agent without a FUB contact is kept once per email.
create unique index if not exists partner_profiles_email_uq
  on public.partner_profiles (lower(email)) where contact_id is null and email is not null;

alter table public.partner_profiles enable row level security;
drop policy if exists "owner all partner_profiles" on public.partner_profiles;
create policy "owner all partner_profiles" on public.partner_profiles
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- Last 10 digits of a phone, for matching.
create or replace function public.phone10(p text) returns text
language sql immutable as $$
  select nullif(right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 10), '')
$$;

-- Adds anyone missing; never changes a profile you've edited. Safe to run on
-- every page load. Starting stage comes from FUB tags: Top Partner, then
-- CA: Partner Dream 20, then CA: Partner Attended, else Prospect.
-- Runs as the caller, so RLS keeps it owner-only.
create or replace function public.sync_partner_profiles() returns integer
language plpgsql security invoker set search_path = public as $$
declare
  added integer := 0;
  n integer;
begin
  insert into partner_profiles (contact_id, name, email, phone, brokerage, partner_stage, source)
  select c.id,
         coalesce(nullif(trim(c.name), ''), 'Unknown'),
         nullif(trim(c.email), ''),
         nullif(trim(c.phone), ''),
         nullif(trim(c.company), ''),
         case
           when t.tags @> array['top partner'] then 'top_partner'
           when t.tags @> array['ca: partner dream 20'] then 'dream_20'
           when t.tags @> array['ca: partner attended'] then 'attended_class'
           else 'prospect'
         end,
         'fub'
  from contacts c
  cross join lateral (
    select coalesce(array_agg(lower(trim(x))), '{}') as tags
    from jsonb_array_elements_text(case when jsonb_typeof(c.raw -> 'tags') = 'array' then c.raw -> 'tags' else '[]'::jsonb end) x
  ) t
  where c.business_id = 'bay'
    and (c.person_stage = 'Realtors'
         or t.tags && array['top partner', 'ca: partner dream 20', 'ca: partner bench',
                            'ca: partner engaged', 'ca: partner attended'])
  on conflict (contact_id) do nothing;
  get diagnostics n = row_count;
  added := added + n;

  -- Agents on Arive loans who aren't on the list yet (matched by email, phone or name).
  insert into partner_profiles (name, email, phone, brokerage, source)
  select distinct on (coalesce(lower(a.email), lower(a.name)))
         a.name, a.email, a.phone, a.company, 'arive'
  from (
    select trim(buyer_agent_name) name, nullif(trim(buyer_agent_email), '') email,
           nullif(trim(buyer_agent_phone), '') phone, nullif(trim(buyer_agent_company), '') company, updated_at
    from loans where business_id = 'bay' and nullif(trim(buyer_agent_name), '') is not null
    union all
    select trim(seller_agent_name), nullif(trim(seller_agent_email), ''),
           nullif(trim(seller_agent_phone), ''), nullif(trim(seller_agent_company), ''), updated_at
    from loans where business_id = 'bay' and nullif(trim(seller_agent_name), '') is not null
  ) a
  where not exists (
    select 1 from partner_profiles p
    where (a.email is not null and lower(p.email) = lower(a.email))
       or (phone10(a.phone) is not null and phone10(p.phone) = phone10(a.phone))
       or lower(p.name) = lower(a.name)
  )
  order by coalesce(lower(a.email), lower(a.name)), a.updated_at desc nulls last
  on conflict do nothing;
  get diagnostics n = row_count;
  added := added + n;

  return added;
end $$;

grant execute on function public.sync_partner_profiles() to authenticated;

-- The list: profile plus last touch (from the FUB contact) and loans sent and
-- funded (agent named on a Bayway loan, by email, phone or name).
create or replace view public.v_partners with (security_invoker = true) as
select p.*,
       c.external_id as fub_id,
       nullif(greatest(coalesce(c.last_touch_at, '-infinity'), coalesce(c.last_activity_at, '-infinity')), '-infinity') as last_touch_at,
       coalesce(l.loans_sent, 0) as loans_sent,
       coalesce(l.loans_funded, 0) as loans_funded
from public.partner_profiles p
left join public.contacts c on c.id = p.contact_id
left join lateral (
  select count(*) as loans_sent,
         count(*) filter (where x.funded_on is not null) as loans_funded
  from public.loans x
  where x.business_id = 'bay'
    and (
      (p.email is not null and lower(p.email) in (lower(x.buyer_agent_email), lower(x.seller_agent_email)))
      or (public.phone10(p.phone) is not null
          and public.phone10(p.phone) in (public.phone10(x.buyer_agent_phone), public.phone10(x.seller_agent_phone)))
      or lower(p.name) in (lower(trim(x.buyer_agent_name)), lower(trim(x.seller_agent_name)))
    )
) l on true;

grant select on public.v_partners to authenticated;
