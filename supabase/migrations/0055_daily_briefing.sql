-- Daily briefing (spec 2026-11-03, section 3). Chandler's 7:30 AM email.
-- pg_cron runs in UTC, so two jobs cover both sides of DST (12:30 UTC in
-- CDT, 13:30 UTC in CST); a third at 14:30 UTC retries after a failed run.
-- The function sends only at 7:xx-8:xx in America/Chicago and only once per
-- day (briefing_sends claim).
-- Bearer is the public ANON key (as 0002 / 0038); the function runs with
-- --no-verify-jwt.

insert into public.settings (key, value)
values (
  'briefings',
  '{
    "enabled": true,
    "owner_email": "chandler@baywayhtx.com",
    "assistant_email": "shelby@baywayhtx.com",
    "app_url": "https://atkinson-sales-os.vercel.app"
  }'::jsonb
)
on conflict (key) do nothing;

-- One claim row per day and recipient: the function inserts it before sending
-- (a unique violation means already sent) and deletes it if the send fails, so
-- the 8:xx run can retry. Service role only: RLS on, no policies.
create table if not exists public.briefing_sends (
  day        date not null,
  recipient  text not null,
  claimed_at timestamptz not null default now(),
  primary key (day, recipient)
);
alter table public.briefing_sends enable row level security;

select cron.unschedule(jobname)
from cron.job
where jobname in ('daily-briefing-1230utc', 'daily-briefing-1330utc', 'daily-briefing-1430utc');

select cron.schedule(
  'daily-briefing-1230utc',
  '30 12 * * 1-5',
  $job$
  select net.http_post(
    url := 'https://cnmipfxwqnbtkohfixkf.supabase.co/functions/v1/daily-briefing',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubWlwZnh3cW5idGtvaGZpeGtmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2Mzc5NjYsImV4cCI6MjA5OTIxMzk2Nn0.tcOKs7O5gGAT2HsfiKKwI90TQ-CYVXSMB4yL9RvuxJU',
      'Content-Type', 'application/json'
    )
  );
  $job$
);

select cron.schedule(
  'daily-briefing-1330utc',
  '30 13 * * 1-5',
  $job$
  select net.http_post(
    url := 'https://cnmipfxwqnbtkohfixkf.supabase.co/functions/v1/daily-briefing',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubWlwZnh3cW5idGtvaGZpeGtmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2Mzc5NjYsImV4cCI6MjA5OTIxMzk2Nn0.tcOKs7O5gGAT2HsfiKKwI90TQ-CYVXSMB4yL9RvuxJU',
      'Content-Type', 'application/json'
    )
  );
  $job$
);

select cron.schedule(
  'daily-briefing-1430utc',
  '30 14 * * 1-5',
  $job$
  select net.http_post(
    url := 'https://cnmipfxwqnbtkohfixkf.supabase.co/functions/v1/daily-briefing',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubWlwZnh3cW5idGtvaGZpeGtmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2Mzc5NjYsImV4cCI6MjA5OTIxMzk2Nn0.tcOKs7O5gGAT2HsfiKKwI90TQ-CYVXSMB4yL9RvuxJU',
      'Content-Type', 'application/json'
    )
  );
  $job$
);
