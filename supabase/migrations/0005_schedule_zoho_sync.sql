-- Phase 5: schedule the Zoho (MPG) sync every 15 minutes via pg_cron.
-- Mirrors 0002 (fub-sync). pg_cron/pg_net are already enabled. The bearer is
-- the project's public ANON key (safe to commit) — it only satisfies the
-- functions gateway; zoho-sync is deployed with --no-verify-jwt.
-- Until the ZOHO_* function secrets are set, zoho-sync logs a "credentials not
-- set" error row each run; that is expected and visible on the Sync Status screen.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'zoho-sync-15min',
  '*/15 * * * *',
  $job$
  select net.http_post(
    url := 'https://cnmipfxwqnbtkohfixkf.supabase.co/functions/v1/zoho-sync',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubWlwZnh3cW5idGtvaGZpeGtmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2Mzc5NjYsImV4cCI6MjA5OTIxMzk2Nn0.tcOKs7O5gGAT2HsfiKKwI90TQ-CYVXSMB4yL9RvuxJU',
      'Content-Type', 'application/json'
    )
  );
  $job$
);
