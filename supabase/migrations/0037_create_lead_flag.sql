-- Tier 1 slice 8: on/off switch for "+ New -> New lead" (crm-action
-- create_contact). A book also needs writeback_enabled on, so MPG stays off
-- until its write-back is switched on (Zoho re-authorization). Turn a book
-- off here to hide the form and refuse creates without a deploy.
insert into settings (key, value)
values ('create_lead_enabled', '{"bay": true, "mpg": true}')
on conflict (key) do nothing;
