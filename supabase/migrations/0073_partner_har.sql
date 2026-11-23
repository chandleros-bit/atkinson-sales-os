-- HAR import and partner scoring (Bayway Bot Engine doc, Sales OS weeks 3-4).
-- A CSV upload on the Partners tab (same flow as the Arive import) fills each
-- agent's 12-month production from HAR.com profiles; Sales OS scores 1 to 10 on
-- the doc's five factors. The Scout bot fills the same template in Phase 2.

alter table public.partner_profiles add column if not exists har_url text;
alter table public.partner_profiles add column if not exists closings_12mo int;
alter table public.partner_profiles add column if not exists volume_12mo numeric;
alter table public.partner_profiles add column if not exists avg_price numeric;
alter table public.partner_profiles add column if not exists buyer_side_pct numeric;
alter table public.partner_profiles add column if not exists areas text;
alter table public.partner_profiles add column if not exists preferred_lender text;
alter table public.partner_profiles add column if not exists score numeric;
alter table public.partner_profiles add column if not exists score_parts jsonb;
alter table public.partner_profiles add column if not exists har_updated_at timestamptz;

alter table public.partner_profiles drop constraint if exists partner_profiles_source_check;
alter table public.partner_profiles add constraint partner_profiles_source_check
  check (source in ('fub', 'arive', 'manual', 'har'));

-- p.* is expanded when a view is created, so recreate it to pick up the new columns.
drop view if exists public.v_partners;
create view public.v_partners with (security_invoker = true) as
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
