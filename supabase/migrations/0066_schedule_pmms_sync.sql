-- Weekly Freddie Mac PMMS load for the Database Opportunity Agent. Freddie Mac
-- publishes Thursdays at noon Eastern; this runs Thursdays at 18:30 UTC, after
-- that in both CST and CDT. The first run also seeds every week since 2018.
-- Bearer is the public ANON key (safe to commit); pmms-sync is deployed with
-- --no-verify-jwt. Mirrors 0062.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('pmms-sync-weekly')
where exists (select 1 from cron.job where jobname = 'pmms-sync-weekly');

select cron.schedule(
  'pmms-sync-weekly',
  '30 18 * * 4',
  $job$
  select net.http_post(
    url := 'https://cnmipfxwqnbtkohfixkf.supabase.co/functions/v1/pmms-sync',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubWlwZnh3cW5idGtvaGZpeGtmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2Mzc5NjYsImV4cCI6MjA5OTIxMzk2Nn0.tcOKs7O5gGAT2HsfiKKwI90TQ-CYVXSMB4yL9RvuxJU',
      'Content-Type', 'application/json'
    )
  );
  $job$
);
