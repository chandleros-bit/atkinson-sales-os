-- Phase 12: Reports scoreboard needs the app (authenticated role) to write two
-- things it only ever read before: manual activity metrics into metrics_daily,
-- and the editable target set into settings under key 'metric_targets'.
-- Everything else stays read-only. Service-role Edge Function writes bypass RLS.

-- metrics_daily: manual trackers upsert on (business_id, date, metric_key).
create policy "authenticated insert metrics_daily" on metrics_daily
  for insert to authenticated with check (true);
create policy "authenticated update metrics_daily" on metrics_daily
  for update to authenticated using (true) with check (true);

-- settings: only the metric_targets row is app-writable.
create policy "authenticated insert metric_targets" on settings
  for insert to authenticated with check (key = 'metric_targets');
create policy "authenticated update metric_targets" on settings
  for update to authenticated using (key = 'metric_targets') with check (key = 'metric_targets');
