-- Push Sales OS calls, meetings and timed follow-ups (contact_events) to
-- Google Calendar every 5 minutes via pg_cron. Mirrors 0008. Bearer is the
-- public ANON key (safe to commit); gcal-push is deployed with --no-verify-jwt.
-- Until GOOGLE_CALENDAR_ID is set (GOOGLE_SERVICE_ACCOUNT_JSON already is, for
-- the docs sync), each run logs a "not set" error row on the Sync Status screen.
-- Setup: docs/phase-gcal-push-setup.md.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('gcal-push-5min')
where exists (select 1 from cron.job where jobname = 'gcal-push-5min');

select cron.schedule(
  'gcal-push-5min',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url := 'https://cnmipfxwqnbtkohfixkf.supabase.co/functions/v1/gcal-push',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubWlwZnh3cW5idGtvaGZpeGtmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2Mzc5NjYsImV4cCI6MjA5OTIxMzk2Nn0.tcOKs7O5gGAT2HsfiKKwI90TQ-CYVXSMB4yL9RvuxJU',
      'Content-Type', 'application/json'
    )
  );
  $job$
);
