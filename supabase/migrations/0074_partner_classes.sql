-- Class tracker, partner funnel and partners due today (Bayway Bot Engine doc,
-- Sales OS weeks 5-6). Classes and rosters live in Sales OS; stage changes are
-- logged so the funnel can count one-to-ones over any period. Owner-only.

create table if not exists public.partner_classes (
  id             uuid primary key default gen_random_uuid(),
  class_date     date not null,
  topic          text not null,
  host_brokerage text,
  location       text,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.class_attendance (
  class_id   uuid not null references public.partner_classes(id) on delete cascade,
  partner_id uuid not null references public.partner_profiles(id) on delete cascade,
  status     text not null default 'invited' check (status in ('invited', 'registered', 'attended', 'no_show')),
  updated_at timestamptz not null default now(),
  primary key (class_id, partner_id)
);

create table if not exists public.partner_stage_events (
  id         bigserial primary key,
  partner_id uuid not null references public.partner_profiles(id) on delete cascade,
  from_stage text,
  to_stage   text not null,
  at         timestamptz not null default now()
);
create index if not exists partner_stage_events_at_idx on public.partner_stage_events (at);

create or replace function public.log_partner_stage() returns trigger
language plpgsql as $$
begin
  if new.partner_stage is distinct from old.partner_stage then
    insert into public.partner_stage_events (partner_id, from_stage, to_stage) values (new.id, old.partner_stage, new.partner_stage);
  end if;
  return new;
end $$;

drop trigger if exists partner_stage_log on public.partner_profiles;
create trigger partner_stage_log after update of partner_stage on public.partner_profiles
  for each row execute function public.log_partner_stage();

alter table public.partner_classes enable row level security;
alter table public.class_attendance enable row level security;
alter table public.partner_stage_events enable row level security;
drop policy if exists "owner all partner_classes" on public.partner_classes;
create policy "owner all partner_classes" on public.partner_classes for all to authenticated using (public.is_owner()) with check (public.is_owner());
drop policy if exists "owner all class_attendance" on public.class_attendance;
create policy "owner all class_attendance" on public.class_attendance for all to authenticated using (public.is_owner()) with check (public.is_owner());
drop policy if exists "owner read partner_stage_events" on public.partner_stage_events;
create policy "owner read partner_stage_events" on public.partner_stage_events for select to authenticated using (public.is_owner());

-- Partner funnel for a date range (inclusive): invites, registered, attended,
-- one-to-ones (partners moved to One-to-one, Referring or Top Partner) and
-- referrals (Realtor Referral leads created).
create or replace function public.partner_funnel(p_from date, p_to date)
returns table (invited bigint, registered bigint, attended bigint, one_to_ones bigint, referrals bigint)
language sql stable security invoker set search_path = public as $$
  select
    (select count(distinct a.partner_id) from class_attendance a join partner_classes c on c.id = a.class_id
      where c.class_date between p_from and p_to),
    (select count(distinct a.partner_id) from class_attendance a join partner_classes c on c.id = a.class_id
      where c.class_date between p_from and p_to and a.status in ('registered', 'attended', 'no_show')),
    (select count(distinct a.partner_id) from class_attendance a join partner_classes c on c.id = a.class_id
      where c.class_date between p_from and p_to and a.status = 'attended'),
    (select count(distinct e.partner_id) from partner_stage_events e
      where e.to_stage in ('one_to_one', 'referring', 'top_partner')
        and coalesce(e.from_stage, '') not in ('one_to_one', 'referring', 'top_partner')
        and (e.at at time zone 'America/Chicago')::date between p_from and p_to),
    (select count(*) from contacts x where x.business_id = 'bay' and x.raw ->> 'source' = 'Realtor Referral'
      and (coalesce(x.raw ->> 'created', '') <> '') and (x.raw ->> 'created')::timestamptz::date between p_from and p_to)
$$;
grant execute on function public.partner_funnel(date, date) to authenticated;

-- Partners due today, for the briefing and the Partners page:
--   follow_up     next touch date is today or past
--   invite        Dream 20 not yet on the roster of the next class (within 30 days)
--   book_1on1     attended a class in the last 30 days, not yet at One-to-one
create or replace view public.v_partner_due_today with (security_invoker = true) as
with today as (select (now() at time zone 'America/Chicago')::date d),
next_class as (
  select c.* from public.partner_classes c, today t
  where c.class_date between t.d and t.d + 30 order by c.class_date limit 1
)
select 'follow_up'::text as kind, p.id as partner_id, p.name, p.brokerage,
       'next touch ' || to_char(p.next_touch_due, 'Mon DD') as detail
from public.partner_profiles p, today t
where p.next_touch_due is not null and p.next_touch_due <= t.d
union all
select 'invite', p.id, p.name, p.brokerage, 'invite to ' || n.topic || ' on ' || to_char(n.class_date, 'Mon DD')
from public.partner_profiles p cross join next_class n
where p.partner_stage = 'dream_20'
  and not exists (select 1 from public.class_attendance a where a.class_id = n.id and a.partner_id = p.id)
union all
select distinct on (p.id) 'book_1on1', p.id, p.name, p.brokerage, 'attended ' || c.topic || ' on ' || to_char(c.class_date, 'Mon DD')
from public.class_attendance a
join public.partner_classes c on c.id = a.class_id
join public.partner_profiles p on p.id = a.partner_id
cross join today t
where a.status = 'attended' and c.class_date between t.d - 30 and t.d
  and p.partner_stage in ('prospect', 'dream_20', 'invited', 'attended_class');
