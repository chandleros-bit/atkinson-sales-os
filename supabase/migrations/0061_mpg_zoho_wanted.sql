-- MPG touch log, slice 2 (spec 2026-11-05, Promotion to Zoho).
-- zoho_wanted: the visit that last touched this prospect asked for it to go to
-- Zoho, and it isn't there yet. The Daily tracker shows "Not in Zoho yet ·
-- Retry" for these. crm-action promote_prospect clears it on success.
alter table public.mpg_prospects
  add column if not exists zoho_wanted boolean not null default false;
