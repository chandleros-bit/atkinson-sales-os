-- Applications to Review: a reviewed application returns after 3 days, or
-- sooner when its missing-docs count changes (a doc came in, or a new one
-- was asked for). review_docs is that count when it was marked reviewed;
-- null on rows reviewed before this column (only the 3 days apply there).
alter table work_items add column if not exists review_docs integer;
