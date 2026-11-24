-- Workbench v2, step 4 (spec 2026-11-23-workbench-v2-design.md, §11): the open
-- file's review steps, saved on the work item. { credit: true, income: true, ... }
-- (fileSheet.js REVIEW_STEPS). The app reads and writes it apart from the rest
-- of the row, so the Files list never depends on this column.
alter table public.work_items add column if not exists checklist jsonb not null default '{}'::jsonb;
