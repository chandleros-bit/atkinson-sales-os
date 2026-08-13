# Auto call counts in Reports — Design

**Date:** 2026-08-13
**Status:** Approved, ready for implementation plan

## Problem

Call logs already sync from both CRMs into the `activities` table on a cron:
FollowUpBoss → `business_id='bay'`, `source_crm='fub'`, `type='call'`; Zoho CRM →
`business_id='mpg'`, `source_crm='zoho'`, `type='call'`. But the Reports
scoreboard's **Outbound calls** metric is `source: 'manual'` — the user types the
count by hand each day. Reports already counts today's FUB calls, but only
surfaces it as a hint string ("FUB logged N today") under the manual input; it is
not wired into the metric value.

Goal: make the daily **Outbound calls** number auto-count from the already-synced
call activity, so the report updates itself, while still letting the user add
calls made outside the CRM.

## Decisions (locked)

- **Scope:** Calls only. No other metrics change in this work.
- **Reconciliation:** Auto **+ manual added**. Final `calls` = synced outbound
  call count **plus** any manual entry. Manual entry becomes "extra calls not in
  the CRM." Must not double-count.
- **Direction:** Outbound only, to match the "Outbound calls" label. Inbound and
  direction-unknown calls are excluded from the count.
- **Approach:** Live client-side count backed by a new `direction` column
  (Approach A). No scheduled rollup, no snapshotting. The number always reflects
  the latest synced rows.

## Out of scope

- Any metric other than daily Outbound calls (live_conversations, followups,
  new_contacts, weekly/monthly/sprint metrics).
- Counting inbound calls.
- Text / email / note / appointment-backed metrics.
- Historical rollup snapshots into `metrics_daily` (rejected Approach B).
- Filtering `raw` payloads in the React layer (rejected Approach C).

## Design

### 1. Data model

Add a nullable column to `activities`:

```sql
-- supabase/migrations/0027_activities_direction.sql
alter table activities add column if not exists direction text;
-- 'outbound' | 'inbound' | null. Only set for type='call'; null everywhere else.
```

Nullable → all existing rows stay valid with `direction = null`; no data
migration step. The unique key `(source_crm, external_id)` is unchanged, so the
existing upsert path fills `direction` in on the next sync.

### 2. Sync mappers

Both activity mappers gain a pure, unit-tested direction helper and set
`direction` on the row they emit.

`supabase/functions/_shared/fub-activity.ts`:
- New `callDirection(rec)` → `'outbound'` when `rec.isIncoming === false`,
  `'inbound'` when `rec.isIncoming === true`, else `null`.
  **VERIFY on first live payload** that FUB `/calls` records carry `isIncoming`
  (boolean) — same verify convention the file header already documents. If the
  field is named differently (e.g. `direction`), adjust this one helper.
- `mapActivity(rec, type, …)`: set `direction: type === 'call' ? callDirection(rec) : null`.

`supabase/functions/_shared/zoho-activity.ts`:
- New `callDirection(rec)` → inspect `rec.Call_Type`: value starting with
  `'Outbound'` → `'outbound'`, starting with `'Inbound'` → `'inbound'`, else
  `null`. Case-insensitive prefix match tolerates `'Outbound Call'` vs
  `'Outbound'`. **VERIFY** the field name `Call_Type` and its value casing
  against a live Zoho Calls record.
- `mapActivity(rec, type, …)`: set `direction: type === 'call' ? callDirection(rec) : null`.

Non-call activity rows always carry `direction: null`.

**Backfill:** because the sync upserts on `(source_crm, external_id)`, the next
scheduled run of each function rewrites existing call rows with the new
`direction`. No separate backfill script. Optional: manually invoke both
`fub-activity-sync` and `zoho-activity-sync` once after deploy to backfill
immediately rather than waiting for the cron.

### 3. Reports computation

`src/lib/reports.js` — new pure helper (unit-tested):

```
// rows: activity rows { occurred_at, business_id } already filtered to
// type='call', direction='outbound'. Returns { [YYYY-MM-DD]: count } in the
// caller's local day buckets (matches metrics_daily.date / dayKey).
callsByDay(rows)
```

`src/pages/Reports.jsx`:
- Replace the current single `todayCalls` head-count query with one that fetches
  outbound call rows for the trend window:
  `activities.select('occurred_at, business_id').eq('type','call').eq('direction','outbound').gte('occurred_at', sevenAgoStartIso)`.
  Volume is low (calls per week), so bucket client-side via `callsByDay`.
- `computeValues` daily: `calls = manualRollup.calls + syncedOutbound[todayKey]`,
  applying the active business filter (`bay` / `mpg` / `all`) to the activity
  rows the same way manual rows are filtered.
- Trend strip (`dailySeries` for `calls`): each day's bar = manual daily sum +
  synced outbound count for that day.

Business filter derives naturally from `activities.business_id` — no extra query
branching per book.

### 4. UI

- Keep the manual **Outbound calls** input on the "Log today" form.
- Replace the current bay-only hint line ("FUB logged N today") with a
  book-agnostic line under the calls input:
  "Auto: N outbound calls synced today — add any made outside the CRM."
  `N` = synced outbound count for the selected business today.
- `calls` stays `source: 'manual'` in `METRICS` (the value is still partly
  user-entered, so the existing MANUAL badge is not misleading). No new badge in
  this scope.

### 5. Testing

Pure-function unit tests only; no live CRM calls in tests.

- `fub-activity.test.js`: `callDirection` outbound / inbound / missing-field
  branches; extend an existing `mapActivity` call-row assertion to check
  `direction`.
- `zoho-activity.test.js`: `callDirection` for `'Outbound Call'`, `'Inbound
  Call'`, missing/unknown `Call_Type`; extend a `mapActivity` call-row assertion.
- `reports.test.js`: `callsByDay` — empty input, single day, multiple days,
  rows spanning day boundaries in local time, business mixing (caller
  pre-filters, so helper just buckets).

## Files touched

- `supabase/migrations/0027_activities_direction.sql` (new)
- `supabase/functions/_shared/fub-activity.ts`
- `supabase/functions/_shared/fub-activity.test.js`
- `supabase/functions/_shared/zoho-activity.ts`
- `supabase/functions/_shared/zoho-activity.test.js`
- `src/lib/reports.js`
- `src/lib/reports.test.js`
- `src/pages/Reports.jsx`

## Risks / notes

- **Direction field names are VERIFY items** for both CRMs — the mappers already
  carry this convention. If a field is absent, that CRM's calls fall to
  `direction=null` and are simply excluded from the outbound count (fails safe:
  under-counts rather than mis-counts), and the manual input still works.
- **Timezone:** bucket synced calls by local day using the same `dayKey` basis as
  `metrics_daily.date`, so auto and manual land on the same day key.
- **No double-count:** synced count and manual entry are distinct addends; manual
  is explicitly "outside the CRM," so the same call is never in both.
