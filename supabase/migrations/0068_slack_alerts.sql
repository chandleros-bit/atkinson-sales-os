-- Slack pushes (Bayway Bot Engine doc, Sales OS item 7). slack_alerts_sent
-- remembers every alert key already pushed so each one goes out once.
-- slack-alerts runs every 5 minutes; it only posts 7 AM to 9 PM Central and
-- does nothing until the SLACK_WEBHOOK_BAY / SLACK_WEBHOOK_MPG secrets exist.
-- Bearer is the public ANON key, as in 0062 and 0066.

create table if not exists public.slack_alerts_sent (
  key     text primary key,
  book    text not null check (book in ('bay', 'mpg')),
  sent_at timestamptz not null default now()
);

alter table public.slack_alerts_sent enable row level security;
drop policy if exists "owner read slack_alerts_sent" on public.slack_alerts_sent;
create policy "owner read slack_alerts_sent" on public.slack_alerts_sent
  for select to authenticated using (public.is_owner());

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobname) from cron.job where jobname in ('slack-alerts-5min', 'slack-alerts-prune');

select cron.schedule('slack-alerts-5min', '*/5 * * * *', $job$
  select net.http_post(
    url := 'https://cnmipfxwqnbtkohfixkf.supabase.co/functions/v1/slack-alerts',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubWlwZnh3cW5idGtvaGZpeGtmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2Mzc5NjYsImV4cCI6MjA5OTIxMzk2Nn0.tcOKs7O5gGAT2HsfiKKwI90TQ-CYVXSMB4yL9RvuxJU',
      'Content-Type', 'application/json'),
    timeout_milliseconds := 60000);
$job$);

-- Keep 90 days of sent keys; older ones can't recur (they carry their dates).
select cron.schedule('slack-alerts-prune', '17 9 * * *', $job$
  delete from public.slack_alerts_sent where sent_at < now() - interval '90 days' and key <> 'hello';
$job$);
