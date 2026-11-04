-- Lead temperature (spec 2026-11-03, section 1). Chandler's own read of a
-- lead after a conversation: Hot / Warm / Cold, plus an optional estimated
-- amount (Bayway) and expected close month. OS-owned; Bayway ratings are also
-- mirrored to FUB as a tag by crm-action set_temperature.
-- score_at_rating snapshots contacts.score whenever the temperature changes,
-- so the UI can flag "Cold, but active" (score rose since the rating).
-- RLS: any signed-in user, as the rest of the schema today. The assistant
-- login (spec section 3) tightens this.

create table if not exists public.lead_ratings (
  contact_id      uuid primary key references public.contacts(id) on delete cascade,
  business_id     text not null references public.businesses(id),
  temperature     text not null check (temperature in ('hot', 'warm', 'cold')),
  est_amount      numeric check (est_amount is null or est_amount > 0),
  close_month     date check (close_month is null or extract(day from close_month) = 1),
  rated_at        timestamptz not null default now(),
  rated_by        uuid not null default auth.uid(),
  score_at_rating int
);

create index if not exists lead_ratings_business_idx on public.lead_ratings (business_id);

alter table public.lead_ratings enable row level security;

drop policy if exists "authenticated read lead_ratings" on public.lead_ratings;
create policy "authenticated read lead_ratings" on public.lead_ratings
  for select to authenticated using (true);

drop policy if exists "authenticated insert lead_ratings" on public.lead_ratings;
create policy "authenticated insert lead_ratings" on public.lead_ratings
  for insert to authenticated with check (rated_by = auth.uid());

drop policy if exists "authenticated update lead_ratings" on public.lead_ratings;
create policy "authenticated update lead_ratings" on public.lead_ratings
  for update to authenticated using (true) with check (rated_by = auth.uid());

drop policy if exists "authenticated delete lead_ratings" on public.lead_ratings;
create policy "authenticated delete lead_ratings" on public.lead_ratings
  for delete to authenticated using (true);

create or replace function public.lead_ratings_snapshot()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' or new.temperature is distinct from old.temperature then
    new.score_at_rating := (select c.score from public.contacts c where c.id = new.contact_id);
  end if;
  return new;
end;
$$;

drop trigger if exists lead_ratings_snapshot on public.lead_ratings;
create trigger lead_ratings_snapshot
  before insert or update on public.lead_ratings
  for each row execute function public.lead_ratings_snapshot();

insert into public.settings (key, value)
values (
  'forecast',
  '{
    "temp_odds": { "hot": 60, "warm": 30, "cold": 10 },
    "arive_odds": { "prospect": 30, "processing": 75, "closing": 95 },
    "close_offset_months": { "hot": 1, "warm": 2, "cold": 3 },
    "mpg_est_residual_per_account": null
  }'::jsonb
)
on conflict (key) do nothing;
