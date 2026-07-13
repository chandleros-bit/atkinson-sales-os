-- Phase 11: index backing the Bayway activity feed's core query
-- (v_bayway_activity / Activity.jsx): filter by business_id, order by
-- occurred_at desc with an id tiebreaker, paginate with range(). Mirrors the
-- query-column indexes added in 0001. Safe/idempotent; apply alongside
-- 0009/0010.

create index if not exists idx_activities_bayway_feed
  on activities (business_id, occurred_at desc, id desc);
