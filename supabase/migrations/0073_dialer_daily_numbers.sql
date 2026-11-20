-- Power Dialer phase 3: dials and connects count toward the daily numbers
-- (spec 2026-11-20, "Daily numbers"). The per-business daily targets read
-- metrics_daily ('calls', 'live_conversations'), so every dialer_calls row adds
-- one call to its business's day, and an outcome that counts as a connect adds
-- one conversation. Changing a logged outcome to or from a connect moves the
-- conversation count with it. The day is Chicago local, matching the app's
-- dayKey. Manual entries in Reports stay editable on top of these counts.

create or replace function public.dialer_metric_bump(biz text, day date, key text, delta numeric)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.metrics_daily (business_id, date, metric_key, value)
  values (biz, day, key, greatest(delta, 0))
  on conflict (business_id, date, metric_key)
  do update set value = greatest(public.metrics_daily.value + delta, 0)
$$;
revoke all on function public.dialer_metric_bump(text, date, text, numeric) from public, anon, authenticated;

create or replace function public.dialer_calls_metrics()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  day date := (new.dialed_at at time zone 'America/Chicago')::date;
begin
  if tg_op = 'INSERT' then
    perform public.dialer_metric_bump(new.business_id, day, 'calls', 1);
    if new.is_connect then
      perform public.dialer_metric_bump(new.business_id, day, 'live_conversations', 1);
    end if;
  elsif new.is_connect and not old.is_connect then
    perform public.dialer_metric_bump(new.business_id, day, 'live_conversations', 1);
  elsif old.is_connect and not new.is_connect then
    perform public.dialer_metric_bump(new.business_id, day, 'live_conversations', -1);
  end if;
  return null;
end
$$;

drop trigger if exists dialer_calls_metrics on public.dialer_calls;
create trigger dialer_calls_metrics
  after insert or update of outcome on public.dialer_calls
  for each row execute function public.dialer_calls_metrics();
