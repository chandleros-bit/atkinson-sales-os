-- Schedule sheets-docs-sync every 15 minutes via pg_cron.
-- Mirrors 0002/0005/0008/0010/0019. pg_cron/pg_net already enabled. Bearer is
-- the public ANON key (safe to commit); the function is deployed --no-verify-jwt.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'sheets-docs-sync-15min',
  '*/15 * * * *',
  $job$
  select net.http_post(
    url := 'https://cnmipfxwqnbtkohfixkf.supabase.co/functions/v1/sheets-docs-sync',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubWlwZnh3cW5idGtvaGZpeGtmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2Mzc5NjYsImV4cCI6MjA5OTIxMzk2Nn0.tcOKs7O5gGAT2HsfiKKwI90TQ-CYVXSMB4yL9RvuxJU',
      'Content-Type', 'application/json'
    )
  );
  $job$
);
