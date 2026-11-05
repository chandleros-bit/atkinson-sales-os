-- Reference section (spec 2026-11-05-reference-section-design.md): lender AE
-- directory and quick links. Owner and assistant read and write everything,
-- comp notes included; any other login sees nothing.

create table if not exists public.reference_lenders (
  id              uuid primary key default gen_random_uuid(),
  lender          text not null,
  ae_name         text,
  ae_phone        text,
  ae_email        text,
  portal_url      text,
  programs        text[] not null default '{}',
  min_fico        int,
  max_ltv         numeric,
  turn_time       text,
  comp_notes      text,
  notes           text,
  updated_at      timestamptz not null default now(),
  updated_by_name text
);

create table if not exists public.reference_links (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  url          text not null check (url ~* '^https?://'),
  grp          text not null,
  sort         int not null default 0,
  copy_address boolean not null default false
);

alter table public.reference_lenders enable row level security;
alter table public.reference_links enable row level security;

drop policy if exists "owner or assistant all reference_lenders" on public.reference_lenders;
create policy "owner or assistant all reference_lenders" on public.reference_lenders
  for all to authenticated
  using (public.app_role() in ('owner', 'assistant'))
  with check (public.app_role() in ('owner', 'assistant'));

drop policy if exists "owner or assistant all reference_links" on public.reference_links;
create policy "owner or assistant all reference_links" on public.reference_links
  for all to authenticated
  using (public.app_role() in ('owner', 'assistant'))
  with check (public.app_role() in ('owner', 'assistant'));

create or replace function public.reference_lenders_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by_name := (select name from user_roles where user_id = auth.uid());
  return new;
end
$$;
revoke all on function public.reference_lenders_stamp() from public, anon, authenticated;

drop trigger if exists reference_lenders_stamp on public.reference_lenders;
create trigger reference_lenders_stamp
  before insert or update on public.reference_lenders
  for each row execute function public.reference_lenders_stamp();

-- Seed links once (editable afterwards). URLs checked 2026-11-05.
insert into public.reference_links (title, url, grp, sort, copy_address)
select * from (values
  ('HAR.com',                   'https://www.har.com/',                                                 'Property', 1, false),
  ('TitlePro247',               'https://www.titlepro247.com/',                                         'Property', 2, true),
  ('HCAD (Harris)',             'https://hcad.org/',                                                    'Property', 3, true),
  ('Fort Bend CAD',             'https://esearch.fbcad.org/',                                           'Property', 4, true),
  ('Montgomery CAD',            'https://mcad-tx.org/',                                                 'Property', 5, true),
  ('Galveston CAD',             'https://galvestoncad.org/',                                            'Property', 6, true),
  ('Brazoria CAD',              'https://brazoriacad.org/',                                             'Property', 7, true),
  ('FEMA flood map',            'https://msc.fema.gov/portal/search',                                   'Property', 8, false),
  ('USDA eligibility',          'https://eligibility.sc.egov.usda.gov/eligibility/welcomeAction.do',    'Property', 9, false),
  ('Texas SOS (SOSDirect)',     'https://www.sos.state.tx.us/corp/sosda/index.shtml',                   'Business checks', 1, false),
  ('Comptroller entity search', 'https://comptroller.texas.gov/taxes/franchise/account-status/search',  'Business checks', 2, false),
  ('NMLS Consumer Access',      'https://www.nmlsconsumeraccess.org/',                                  'Licensing', 1, false),
  ('TREC license search',       'https://www.trec.texas.gov/license-search',                            'Licensing', 2, false),
  ('Fannie Mae loan lookup',    'https://yourhome.fanniemae.com/calculators-tools/loan-lookup',         'Loan lookups', 1, false),
  ('Freddie Mac loan lookup',   'https://myhome.freddiemac.com/resources/loanlookup',                   'Loan lookups', 2, false)
) as v(title, url, grp, sort, copy_address)
where not exists (select 1 from public.reference_links);
