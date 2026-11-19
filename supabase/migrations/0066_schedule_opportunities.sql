-- Schedules for the Database Opportunity Agent. Mirrors 0062. Bearer is the
-- public ANON key (safe to commit); both functions are deployed with
-- --no-verify-jwt. pg_cron runs in UTC, so each job runs at two UTC hours to
-- cover CST and CDT; both functions are safe to run twice.
--
-- pmms-refresh: Thursdays 8 PM Central (Fri 01:00 UTC in CDT, 02:00 UTC in CST).
--   The first run also seeds every PMMS week since 2018.
-- opportunity-nightly: weekdays before the 7:30 AM briefing
--   (11:00 UTC = 5 AM CST / 6 AM CDT, and 12:00 UTC = 6 AM CST / 7 AM CDT).

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobname) from cron.job
where jobname in ('pmms-refresh-weekly', 'opportunity-nightly-1100utc', 'opportunity-nightly-1200utc');

select cron.schedule('pmms-refresh-weekly', '0 1,2 * * 5', $job$
  select net.http_post(
    url := 'https://cnmipfxwqnbtkohfixkf.supabase.co/functions/v1/pmms-refresh',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubWlwZnh3cW5idGtvaGZpeGtmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2Mzc5NjYsImV4cCI6MjA5OTIxMzk2Nn0.tcOKs7O5gGAT2HsfiKKwI90TQ-CYVXSMB4yL9RvuxJU',
      'Content-Type', 'application/json'));
$job$);

select cron.schedule('opportunity-nightly-1100utc', '0 11 * * 1-5', $job$
  select net.http_post(
    url := 'https://cnmipfxwqnbtkohfixkf.supabase.co/functions/v1/opportunity-nightly',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubWlwZnh3cW5idGtvaGZpeGtmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2Mzc5NjYsImV4cCI6MjA5OTIxMzk2Nn0.tcOKs7O5gGAT2HsfiKKwI90TQ-CYVXSMB4yL9RvuxJU',
      'Content-Type', 'application/json'),
    timeout_milliseconds := 120000);
$job$);

select cron.schedule('opportunity-nightly-1200utc', '0 12 * * 1-5', $job$
  select net.http_post(
    url := 'https://cnmipfxwqnbtkohfixkf.supabase.co/functions/v1/opportunity-nightly',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubWlwZnh3cW5idGtvaGZpeGtmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2Mzc5NjYsImV4cCI6MjA5OTIxMzk2Nn0.tcOKs7O5gGAT2HsfiKKwI90TQ-CYVXSMB4yL9RvuxJU',
      'Content-Type', 'application/json'),
    timeout_milliseconds := 120000);
$job$);
