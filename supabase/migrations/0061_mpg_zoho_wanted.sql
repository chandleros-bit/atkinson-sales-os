-- MPG touch log, slice 2 (spec 2026-11-05, Promotion to Zoho).
-- zoho_wanted: the visit that last touched this prospect asked for it to go to
-- Zoho, and it isn't there yet. The Daily tracker shows "Not in Zoho yet ·
-- Retry" for these. crm-action promote_prospect clears it on success.
alter table public.mpg_prospects
  add column if not exists zoho_wanted boolean not null default false;

-- promoting_at: a short lease while crm-action promote_prospect runs for this
-- prospect, so two promotions at once (the auto-promote after Log visit and a
-- Retry, or two devices) can't both create a Zoho lead. Taken atomically
-- when it is null or older than 2 minutes; given back (null) when the run
-- ends, however it ends.
alter table public.mpg_prospects
  add column if not exists promoting_at timestamptz;
