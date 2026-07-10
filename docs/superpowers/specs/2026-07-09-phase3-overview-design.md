# Phase 3 — Live Overview ("Command Center") Design

**Date:** 2026-07-09
**Status:** Approved by Chandler (layout option C; smart-database-view approach)
**Depends on:** Phase 2 FUB sync (deployed, verified: 822 contacts, 11 stages, 0 deals synced)

## Context and data reality

The Bayway FollowUpBoss account does not use FUB deal records. The synced data is:

- 822 contacts, all imported 2026-07-09 (`source: Import`; timestamps clustered at import time)
- Person stages: 799 `Nurture`, 23 `Lead`
- 25 contacts carry real loan statuses as tags: `Imported Stage: Pre-Approved` (15),
  `Imported Stage: Waiting on Docs` (10) — confirmed by Chandler as his actual active loans
- 0 deals, no activity history, no calendar data
- MPG/Zoho: not connected until a later phase

Consequence: the Overview is built on **people and stages**, not deals. Deal-based KPIs
(pipeline value, closed this month) are explicitly out of scope until deal data exists.

## Screen design (layout C — Command Center)

### Alert banner (top; hidden when nothing is wrong)

- **Red — sync trouble:** the latest `fub` row in `sync_log` has `status = 'error'`,
  or the newest `fub` row is older than 45 minutes (three missed 15-min cycles).
  Banner text includes the error message or the staleness.
- **Amber — slipping loans:** one or more active-pipeline people have
  `last_touch_at` older than 7 days. Text: "N active loans have had no touch in 7+ days."
- Red takes precedence if both fire. No banner otherwise.

### KPI row (4 cards)

| Card | Value today | Source |
|---|---|---|
| Active loans | 25 | count of view rows with an imported-stage tag |
| Pre-Approved | 15 | view rows with stage `Pre-Approved` |
| Waiting on Docs | 10 | view rows with stage `Waiting on Docs` |
| New leads | 23 | view rows with stage `New Lead` |

Below the row, a footnote line: "799 in nurture · MPG connects with Zoho in a later phase."
(Nurture count queried live, not hardcoded.)

Note: stage-name KPI cards (Pre-Approved / Waiting on Docs) render from whatever stages the
view returns, so new imported-stage tags appear without code changes; the two named cards
are today's data, not a hardcoded list. If more than ~4 distinct stages appear, the row
keeps the top stages by count.

### Needs Attention workbench

- Rows: every active-pipeline person (deduplicated union of tagged + `Lead` people).
- Sort: `last_touch_at` ascending, nulls first (unknown = needs attention most).
- Row contents: name, phone or email, stage pill (`Pre-Approved` / `Waiting on Docs` /
  `New Lead`), "last touch Xd ago" (or "—" when null).
- All rows are Bayway: green stripe + BAYWAY badge, per the spec color rules
  (row color always from the row's own business, never the filter).

### Business filter behavior

- **All** and **Bayway**: full Command Center as above.
- **MPG**: a placeholder panel — "Zoho CRM connects in an upcoming phase" — instead of
  an empty dashboard.

## Architecture: smart database view (approach chosen over in-app logic and sync-time mapping)

Migration `0003_active_pipeline_view.sql` creates:

```sql
create view v_active_pipeline as
  -- one row per contact in the active pipeline, with:
  --   stage: from 'Imported Stage: X' tag if present (strip prefix, use X),
  --          else 'New Lead' when person_stage = 'Lead'
  --   name, email, phone, last_touch_at, business_id
  -- excludes Nurture-only contacts
```

Rules:

1. Tag `Imported Stage: X` → stage `X`. Generic prefix-strip: new imported-stage values
   flow through with no code change.
2. Else `person_stage = 'Lead'` → stage `New Lead`.
3. Else: excluded from the view (counted only in the nurture footnote).
4. View uses `security_invoker = on` so the app's read-only RLS applies unchanged.

Rationale: the stage rule will change when Chandler starts managing stages directly in
FUB (instead of import tags). With a view, that is a single migration — every screen
(this Overview, the Phase 4 pipeline board) picks it up with no app redeploy.

The app (`Overview.jsx`) issues four reads: the view, the nurture count, the latest
`sync_log` rows for `fub`, done in parallel on page load. No new dependencies. No writes.

## Edge cases

- **Demo mode** (no Supabase env): current placeholder content renders; no queries run.
- **Empty pipeline** (tags cleaned up in FUB): workbench shows
  "No active loans — add stages in FollowUpBoss," not an empty panel.
- **Null `last_touch_at`**: display "—", sort first.
- **Query error**: compact inline error strip (same pattern as SyncStatus.jsx), page
  still renders chrome.

## Out of scope (deferred until data exists)

- Pipeline dollar value, closed-this-month (no deal amounts / closings in FUB)
- MPG data (Zoho phase), calendar (Outlook phase)
- Any writes to FUB or Supabase from the app

## Verification plan

1. `npm run build` passes.
2. Run against the live database in the preview browser; confirm on-screen numbers
   match direct database counts exactly (25 / 15 / 10 / 23 / 799 as of design date).
3. Business filter: MPG shows placeholder; All/Bayway show live data.
4. Demo mode (env vars absent) renders without errors.
5. Screenshot shared as proof.
