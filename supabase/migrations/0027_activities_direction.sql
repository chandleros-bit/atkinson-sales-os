-- Direction of a call activity: 'outbound' | 'inbound' | null.
-- Only set for type='call' rows; null for every other activity type and for
-- calls whose CRM payload lacks a recognizable direction field. Nullable, so
-- existing rows stay valid and backfill happens on the next activity sync
-- (upsert on (source_crm, external_id) rewrites the column).
alter table activities add column if not exists direction text;
