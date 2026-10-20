-- Tier 1 slice 9: fresher FollowUpBoss data without webhooks (only the FUB
-- account owner can register those). The people sync and the activity sync
-- move from every 15 minutes to every 2, so a new lead or a call made in the
-- FUB app reaches the dashboard (speed-to-lead timers, Up Next) in about
-- 2 minutes. Measured 2026-10-20: incremental runs take ~5 s (p90 under 9 s),
-- the hourly full people pass ~15 s (p90 20 s), well inside 2 minutes.
-- shouldFullPeopleRefresh() now keys the hourly full pass to the :00 run.
-- People on even minutes, activity on odd minutes, so the two don't overlap.
-- Tasks, Zoho, Outlook and Sheets stay on 15 minutes.
-- Bearer is the public ANON key (as 0002 / 0010); both functions run with
-- --no-verify-jwt.

select cron.unschedule(jobname)
from cron.job
where jobname in ('fub-sync-15min', 'fub-activity-sync-15min');

select cron.schedule(
  'fub-sync-2min',
  '*/2 * * * *',
  $job$
  select net.http_post(
    url := 'https://cnmipfxwqnbtkohfixkf.supabase.co/functions/v1/fub-sync',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubWlwZnh3cW5idGtvaGZpeGtmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2Mzc5NjYsImV4cCI6MjA5OTIxMzk2Nn0.tcOKs7O5gGAT2HsfiKKwI90TQ-CYVXSMB4yL9RvuxJU',
      'Content-Type', 'application/json'
    )
  );
  $job$
);

select cron.schedule(
  'fub-activity-sync-2min',
  '1-59/2 * * * *',
  $job$
  select net.http_post(
    url := 'https://cnmipfxwqnbtkohfixkf.supabase.co/functions/v1/fub-activity-sync',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubWlwZnh3cW5idGtvaGZpeGtmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2Mzc5NjYsImV4cCI6MjA5OTIxMzk2Nn0.tcOKs7O5gGAT2HsfiKKwI90TQ-CYVXSMB4yL9RvuxJU',
      'Content-Type', 'application/json'
    )
  );
  $job$
);
