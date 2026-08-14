# Outbound calls on Weekly & Monthly Reports tabs — Design

**Date:** 2026-08-14
**Status:** Approved, ready for implementation plan

## Problem

The auto-call-counts feature (shipped, PR #17) made the **daily** "Outbound calls"
metric auto-count synced outbound calls from `activities`. But `calls` is a
daily-only metric: the daily card shows *today* only, and the trend strip shows
the last 7 days. Historical call volume is invisible everywhere else — the
Weekly and Monthly tabs have no calls metric at all. A user with 29 synced
outbound calls spread across the past month sees "0" on the daily card (nothing
today) and nothing on Weekly/Monthly.

Goal: add an **Outbound calls** metric to the Weekly and Monthly tabs that
auto-sums outbound calls over the period, so historical call activity is
actually visible in the scoreboard.

## Decisions (locked)

- **Scope:** Add `calls` to the Weekly and Monthly tabs only. Daily is unchanged.
- **Count model:** Additive, matching the daily tab. Period value = synced
  outbound calls in the window **plus** manual daily `calls` entries rolled up
  over the window. No double-count: synced comes from `activities`, manual from
  `metrics_daily`.
- **Targets:** Weekly 500, Monthly 2000 (daily is 100). Editable at runtime via
  the existing Edit-targets modal.
- **Approach:** Widen the existing daily `callRows` query to cover the widest of
  the daily/weekly/monthly windows and reuse those rows across all three tabs
  (Approach A). No backend, no migration, no edge-function change — the data is
  already in `activities`. Frontend-only, ships on merge.

## Out of scope

- Any tab other than Weekly and Monthly (Daily, Revenue, Sprint unchanged).
- Inbound calls (still outbound-only, `direction='outbound'`).
- A scheduled rollup into `metrics_daily` (rejected Approach C).
- Backfilling more history into `activities` (separate concern; the data present
  is what shows).

## Design

### 1. Metrics (`src/lib/reports.js`)

Add two entries to `METRICS`, in the weekly and monthly sections:

```js
{ key: 'calls_weekly',  label: 'Outbound calls', tab: 'weekly',  biz: 'both', source: 'derived', unit: 'count' },
{ key: 'calls_monthly', label: 'Outbound calls', tab: 'monthly', biz: 'both', source: 'derived', unit: 'count' },
```

`source: 'derived'` matches the existing `weekly_conversations` entry (a computed
sum): it renders with the SNAPSHOT caveat badge and, critically, is **not**
picked up by the manual-entry form — `LogMetrics` filters to `source === 'manual'`,
so no redundant weekly/monthly calls input appears. `biz: 'both'` means the
metric shows under MPG, Bayway, and All.

Add targets to `DEFAULT_TARGETS`:

```js
calls_weekly: 500,
calls_monthly: 2000,
```

### 2. Pure helper (`src/lib/reports.js`)

```js
// rows: activity rows { occurred_at }, already filtered by the caller to
// type='call', direction='outbound', and the desired business. fromKey: a
// YYYY-MM-DD local day key (weekStart / monthWindow().from). Returns the count
// of rows whose local day (via dayKey) is on or after fromKey. No upper bound is
// needed — callers never fetch future-dated rows.
export function callsSince(rows, fromKey) {
  let n = 0
  for (const r of rows) {
    if (r.occurred_at && dayKey(r.occurred_at) >= fromKey) n++
  }
  return n
}
```

`dayKey` is already imported in `reports.js`. Local-day comparison matches
`metrics_daily.date` / `weekStart()` / `monthWindow()`, so synced and manual
align on the same day basis.

### 3. Widen the callRows query (`src/pages/Reports.jsx`)

The daily feature added a `callRows` query with `.gte('occurred_at', sevenAgoStartIso)`.
Widen its lower bound to the earliest of {7-days-ago, weekStart, monthStart} so a
single fetch feeds all three tabs. In `load`, compute:

```js
const wk = weekStart()               // already computed in load
const { from: monthFrom } = monthWindow()  // already computed in load
// earliest local-midnight ISO among the daily(7d), weekly, monthly windows
const earliestStartIso = (() => {
  const sevenAgo = new Date(); sevenAgo.setHours(0, 0, 0, 0); sevenAgo.setDate(sevenAgo.getDate() - 6)
  const wkStart = new Date(`${wk}T00:00:00`)
  const moStart = new Date(`${monthFrom}T00:00:00`)
  return new Date(Math.min(sevenAgo.getTime(), wkStart.getTime(), moStart.getTime())).toISOString()
})()
```

Change the `callRows` query's `.gte('occurred_at', sevenAgoStartIso)` to
`.gte('occurred_at', earliestStartIso)`. The `sevenAgoStartIso` variable is then
only used (if at all) to build `earliestStartIso`; fold it into the IIFE and
remove the standalone `sevenAgoStartIso` if it has no other reference. Everything
else about the query (`type='call'`, `direction='outbound'`, select
`occurred_at, business_id`) is unchanged. The daily value and 7-day trend still
filter these rows to their own window client-side, so they are unaffected by the
wider fetch.

### 4. Compute (`src/pages/Reports.jsx` `computeValues`)

Import `callsSince` from `../lib/reports`. Add the metric to the weekly and
monthly branches, biz-filtering `callRows` the same way the daily branch does.

Weekly branch — after the existing `manual` rollup:

```js
const bizCalls = biz === 'all' ? data.callRows : data.callRows.filter((r) => r.business_id === biz)
// ...existing weekly_conversations derivation...
calls_weekly: Number(manual.calls || 0) + callsSince(bizCalls, weekStart()),
```

Monthly branch — after the existing `manual` rollup:

```js
const bizCalls = biz === 'all' ? data.callRows : data.callRows.filter((r) => r.business_id === biz)
calls_monthly: Number(manual.calls || 0) + callsSince(bizCalls, monthWindow().from),
```

`manual.calls` in each branch is already the sum of `metrics_daily` `calls` rows
over that period (from `data.week` / `data.month`), i.e. the user's manual
"outside-CRM" daily entries. Adding the synced `callsSince` count gives the
additive total with no overlap.

### 5. UI

No new components. `MetricCard` renders `calls_weekly` / `calls_monthly` like any
other card (value / target, progress bar, SNAPSHOT badge). `LogMetrics` is
unaffected — the new metrics are `derived`, not `manual`, so no input row is
added. The Edit-targets modal already lists every metric for the tab, so the two
new targets are editable with no change.

### 6. No backend

No migration, no edge-function change, no cron change. `activities` already holds
the synced outbound calls with `direction`. This is a frontend-only change that
redeploys on merge (Vercel).

## Testing

Pure-function unit tests in `src/lib/reports.test.js`:

- `callsSince`: empty rows → 0; a row exactly on `fromKey` counts (inclusive
  boundary); a row before `fromKey` excluded; a row after included; rows with no
  `occurred_at` ignored; multiple businesses (caller pre-filters, so the helper
  just counts).

No brittle assertions break: the existing metric tests check tab membership,
key uniqueness, and `all.length >= bay.length` — all still hold with two added
`biz: 'both'` weekly/monthly entries.

`computeValues` lives in `Reports.jsx` (I/O-bound React, no unit test); verify
its wiring by keeping the suite green and by the demo-mode render (demo
`callRows` already carries bay/mpg rows dated today, so `calls_weekly` /
`calls_monthly` render non-zero).

## Files touched

- `src/lib/reports.js` — two `METRICS` entries, two `DEFAULT_TARGETS`, `callsSince` helper
- `src/lib/reports.test.js` — `callsSince` tests
- `src/pages/Reports.jsx` — widen `callRows` window, import + apply `callsSince` in weekly/monthly branches

## Risks / notes

- **Timezone:** `callsSince` compares local day keys, consistent with `weekStart`,
  `monthWindow`, and `metrics_daily.date`. No UTC/local skew between the synced
  count and the manual rollup.
- **Week spanning a month boundary:** the widened fetch starts at the earliest of
  the three window starts, so a current week that began in the previous month is
  still fully covered.
- **Visibility depends on synced history:** the metric only shows calls that are
  actually in `activities`. If the user wants deeper history, that's a separate
  backfill task, not this one.
