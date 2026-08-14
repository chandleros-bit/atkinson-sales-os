# Weekly & Monthly Outbound Call Metrics — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show an auto-derived "Outbound calls" metric on the Reports Weekly and Monthly tabs, summing synced outbound calls over the period plus the manual daily `calls` rollup (additive, matching the daily tab).

**Architecture:** Two new `METRICS` entries (`calls_weekly`, `calls_monthly`, `source: 'derived'`) with targets, plus a pure `callsSince(rows, fromKey)` helper in `src/lib/reports.js`. `Reports.jsx` widens its existing `callRows` fetch to cover the month window and computes the two values in the weekly/monthly branches of `computeValues`, biz-filtering the rows with the `bizFilter` already in scope. No backend, no migration — the data is already in `activities`.

**Tech Stack:** React (Vite), Supabase JS client, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-14-weekly-monthly-call-metrics-design.md`

**Branch:** `feat/weekly-monthly-call-metrics` (already created; spec committed there).

---

## File Structure

- `src/lib/reports.js` (modify) — add 2 `METRICS` entries, 2 `DEFAULT_TARGETS`, `callsSince` helper.
- `src/lib/reports.test.js` (modify) — `callsSince` unit tests.
- `src/pages/Reports.jsx` (modify) — widen `callRows` window; import + apply `callsSince` in the weekly and monthly branches of `computeValues`.

Task 1 (pure lib + tests) is independent and lands first. Task 2 (page wiring) depends on Task 1's `callsSince` export and the two metric keys.

**Test commands:** `npm test` runs the whole vitest suite (349 currently green). Single file: `npx vitest run src/lib/reports.test.js`.

---

## Task 1: Metrics, targets, and `callsSince` helper

**Files:**
- Modify: `src/lib/reports.js`
- Test: `src/lib/reports.test.js`

- [ ] **Step 1: Write the failing test**

In `src/lib/reports.test.js`, add `callsSince` to the existing import from `./reports` (the block starting `import {` near the top — add `callsSince` to the identifier list; do NOT add a second import statement). Then add this describe block near the other rollup/series tests (e.g. right after the `callsByDay` block):

```js
describe('callsSince', () => {
  it('returns 0 for no rows', () => {
    expect(callsSince([], '2026-08-01')).toBe(0)
  })
  it('counts a row exactly on fromKey (inclusive)', () => {
    expect(callsSince([{ occurred_at: '2026-08-01T15:00:00Z' }], '2026-08-01')).toBe(1)
  })
  it('excludes rows before fromKey and includes rows after', () => {
    const rows = [
      { occurred_at: '2026-07-31T23:00:00Z' }, // before (local day 2026-07-31 in UTC/negative offsets)
      { occurred_at: '2026-08-05T10:00:00Z' }, // after
      { occurred_at: '2026-08-01T00:00:01Z' }, // on boundary
    ]
    expect(callsSince(rows, '2026-08-01')).toBe(2)
  })
  it('ignores rows with no occurred_at', () => {
    expect(callsSince([{ occurred_at: null }, { occurred_at: '2026-08-02T12:00:00Z' }], '2026-08-01')).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/reports.test.js`
Expected: FAIL — `callsSince is not a function`.

- [ ] **Step 3: Add the `callsSince` helper**

In `src/lib/reports.js`, add this export right after the `callsByDay` function (it uses the already-imported `dayKey`; do NOT re-import):

```js
// rows: activity rows { occurred_at }, already filtered by the caller to
// type='call', direction='outbound', and the desired business. fromKey: a
// YYYY-MM-DD local day key (weekStart() / monthWindow().from). Returns the count
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

- [ ] **Step 4: Add the two METRICS entries**

In `src/lib/reports.js`, in the `METRICS` array: add the weekly entry to the Weekly section (alongside `weekly_conversations`) and the monthly entry to the Monthly section (alongside `realtor_meetings` etc.):

Weekly section — add:
```js
  { key: 'calls_weekly',  label: 'Outbound calls', tab: 'weekly',  biz: 'both', source: 'derived', unit: 'count' },
```
Monthly section — add:
```js
  { key: 'calls_monthly', label: 'Outbound calls', tab: 'monthly', biz: 'both', source: 'derived', unit: 'count' },
```

- [ ] **Step 5: Add the two targets**

In `src/lib/reports.js`, in `DEFAULT_TARGETS`, add:
```js
  calls_weekly: 500, calls_monthly: 2000,
```
(Place near the other weekly/monthly target lines; exact position is cosmetic.)

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS. The `callsSince` tests pass; the existing metric tests still hold (they check tab membership ∈ {daily,weekly,monthly,revenue,sprint}, key uniqueness, and `all.length >= bay.length` — all true with two added `biz:'both'` entries). No count assertion is hard-coded.

- [ ] **Step 7: Commit**

```bash
git add src/lib/reports.js src/lib/reports.test.js
git commit -m "feat: weekly/monthly outbound call metrics + callsSince helper"
```

---

## Task 2: Wire the metrics into Reports.jsx

**Files:**
- Modify: `src/pages/Reports.jsx`

No unit test — `computeValues` is I/O-bound React. Verify by keeping `npm test` green and confirming the two keys resolve. Depends on Task 1 being committed on the branch.

- [ ] **Step 1: Import `callsSince`**

In `src/pages/Reports.jsx`, add `callsSince` to the existing import from `../lib/reports` (the block that already imports `callsByDay`, `weekStart`, `monthWindow`, etc.). Result ends:

```js
  sprintRows, sprintWindow, MPG_SPRINT, callsByDay, callsSince,
} from '../lib/reports'
```

- [ ] **Step 2: Widen the `callRows` fetch window**

In the `load` callback, the current code (lines ~217-225) defines both `sevenAgo` (a YYYY-MM-DD key used by the `series` query) and `sevenAgoStartIso` (an ISO timestamp used only by the `callRows` query). Keep `sevenAgo` untouched. Replace the `sevenAgoStartIso` IIFE:

```js
      const sevenAgoStartIso = (() => {
        const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 6)
        return d.toISOString()
      })()
```

with an `earliestStartIso` that covers the widest of the daily(7d)/weekly/monthly windows (`wk` and `from` are already in scope above):

```js
      const earliestStartIso = (() => {
        const sevenAgoMidnight = new Date(); sevenAgoMidnight.setHours(0, 0, 0, 0); sevenAgoMidnight.setDate(sevenAgoMidnight.getDate() - 6)
        const wkStart = new Date(`${wk}T00:00:00`)
        const moStart = new Date(`${from}T00:00:00`)
        return new Date(Math.min(sevenAgoMidnight.getTime(), wkStart.getTime(), moStart.getTime())).toISOString()
      })()
```

Then, in the `callRows` query, change `.gte('occurred_at', sevenAgoStartIso)` to `.gte('occurred_at', earliestStartIso)`:

```js
        supabase.from('activities')
          .select('occurred_at, business_id')
          .eq('type', 'call').eq('direction', 'outbound').gte('occurred_at', earliestStartIso),
```

After this edit, `sevenAgoStartIso` must have ZERO remaining references in the file.

- [ ] **Step 3: Compute `calls_weekly` in the weekly branch**

In `computeValues`, the weekly branch currently returns manual + `weekly_conversations`. `bizFilter` is already defined at the top of the function (line ~469). Replace the weekly branch:

```js
  if (tab === 'weekly') {
    const manual = rollupMetrics(bizFilter(data.week))
    return {
      ...manual,
      weekly_conversations:
        Number(manual.realtor_convos || 0) + Number(manual.bizowner_convos || 0),
    }
  }
```

with:

```js
  if (tab === 'weekly') {
    const manual = rollupMetrics(bizFilter(data.week))
    return {
      ...manual,
      weekly_conversations:
        Number(manual.realtor_convos || 0) + Number(manual.bizowner_convos || 0),
      calls_weekly: Number(manual.calls || 0) + callsSince(bizFilter(data.callRows), weekStart()),
    }
  }
```

- [ ] **Step 4: Compute `calls_monthly` in the monthly branch**

In `computeValues`, the monthly branch already computes `win = monthWindow()`. Add `calls_monthly` to its returned object. Change the monthly return object from:

```js
    return {
      ...manual,
      pre_approvals: stageCounts['Pre-Approved'],
      applications: stageCounts['App Sent'],
      loans_closed: countWon(bayDeals, win),
      loan_volume: sumWon(bayDeals, win),
      pipeline_value: pipelineValue(bayDeals),
      db_total: dbTotal,
    }
```

to:

```js
    return {
      ...manual,
      pre_approvals: stageCounts['Pre-Approved'],
      applications: stageCounts['App Sent'],
      loans_closed: countWon(bayDeals, win),
      loan_volume: sumWon(bayDeals, win),
      pipeline_value: pipelineValue(bayDeals),
      db_total: dbTotal,
      calls_monthly: Number(manual.calls || 0) + callsSince(bizFilter(data.callRows), win.from),
    }
```

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS (349+). No test references the new keys directly; this is runtime wiring.

- [ ] **Step 6: Stale-reference check**

Grep `src/pages/Reports.jsx` for `sevenAgoStartIso` — expect ZERO occurrences. Report the result.

- [ ] **Step 7: Commit**

```bash
git add src/pages/Reports.jsx
git commit -m "feat: show outbound calls on Weekly and Monthly Reports tabs"
```

---

## Post-implementation (verification, no code)

- Demo mode renders the new cards: `demoReportsData().callRows` already has 2 bay + 1 mpg rows dated now, so `calls_weekly` and `calls_monthly` show non-zero on the Weekly/Monthly tabs (bay=2, mpg=1, all=3) plus any manual `calls` rollup.
- Live: after merge, the Vercel prod build shows real synced call volume per period (e.g. Bayway monthly ≈ 16, weekly per the current-week subset).

---

## Self-Review Notes

- **Spec coverage:** metrics + targets (Task 1 Steps 4-5), `callsSince` (Task 1 Steps 1-3), widened fetch (Task 2 Step 2), weekly compute (Task 2 Step 3), monthly compute (Task 2 Step 4), UI/no-backend (no code needed — `derived` source auto-excludes manual input, `MetricCard`/Edit-targets already generic), testing (Task 1 Steps 1-2, 6). All mapped.
- **Additive / no double count:** `manual.calls` (from `metrics_daily` rollup) + `callsSince(callRows)` (from `activities`) — independent sources.
- **Type consistency:** `callsSince(rows, fromKey)` signature identical in helper, tests, and both call sites. Keys `calls_weekly`/`calls_monthly` match between `METRICS`, `DEFAULT_TARGETS`, and `computeValues`.
- **No placeholders:** every step has concrete code and commands.
