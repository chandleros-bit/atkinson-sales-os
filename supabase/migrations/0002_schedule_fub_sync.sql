-- Phase 2: schedule the FollowUpBoss sync every 15 minutes via pg_cron.
-- pg_net makes the outbound HTTP call to the deployed fub-sync Edge Function.
-- The Authorization bearer below is the project's ANON key, which is public by
-- design (safe to commit) and only used to satisfy the functions gateway; the
-- function itself is deployed with --no-verify-jwt.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- cron.schedule upserts by job name, so re-running this is idempotent and will
-- not create duplicates if the job was already scheduled from the SQL editor.
select cron.schedule(
  'fub-sync-15min',
  '*/15 * * * *',
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
