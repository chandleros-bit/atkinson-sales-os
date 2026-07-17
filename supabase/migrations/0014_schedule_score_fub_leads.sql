-- Phase 13: schedule score-fub-leads nightly via pg_cron.
-- Mirrors 0010/0008. pg_cron/pg_net already enabled. Bearer is the public
-- ANON key (safe to commit); score-fub-leads is deployed with --no-verify-jwt.
--
-- pg_cron runs in UTC. 09:00 UTC = 04:00 America/Chicago during CDT (summer);
-- it shifts to 03:00 CST in winter. Either way it finishes well before the
-- 8:45 AM target so the panel is current at the start of the workday. The
-- 15-minute fub-activity-sync keeps `activities` fresh, so by 4 AM the inputs
-- are up to date. When the deferred generate-lead-notes function ships, chain
-- its net.http_post after this one inside the same job body.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'score-fub-leads-nightly',
  '0 9 * * *',
  $job$
  select net.http_post(
    url := 'https://cnmipfxwqnbtkohfixkf.supabase.co/functions/v1/score-fub-leads',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubWlwZnh3cW5idGtvaGZpeGtmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2Mzc5NjYsImV4cCI6MjA5OTIxMzk2Nn0.tcOKs7O5gGAT2HsfiKKwI90TQ-CYVXSMB4yL9RvuxJU',
      'Content-Type', 'application/json'
    )
  );
  $job$
);
