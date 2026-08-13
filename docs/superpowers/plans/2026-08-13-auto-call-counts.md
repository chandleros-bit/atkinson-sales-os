# Auto Call Counts in Reports — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the daily "Outbound calls" metric on the Reports scoreboard auto-count outbound calls already synced from FollowUpBoss and Zoho into the `activities` table, added on top of any manually entered "calls made outside the CRM."

**Architecture:** Add a nullable `direction` column to `activities`, set by the two activity sync mappers (`fub-activity.ts`, `zoho-activity.ts`) from each CRM's direction field. Reports queries outbound call rows for the trailing 7-day window and buckets them by local day with a new pure helper, then adds today's synced count to the manual `calls` rollup and folds per-day synced counts into the trend strip. No new cron, no rollup snapshot — the number is computed live from `activities`.

**Tech Stack:** Supabase (Postgres migration + Deno edge functions in TypeScript), React (Vite), Vitest for unit tests.

**Spec:** `docs/superpowers/specs/2026-08-13-auto-call-counts-design.md`

---

## File Structure

- `supabase/migrations/0027_activities_direction.sql` (new) — adds `direction` column.
- `supabase/functions/_shared/fub-activity.ts` (modify) — `callDirection` helper + set `direction` in `mapActivity`.
- `supabase/functions/_shared/fub-activity.test.js` (modify) — tests for the above.
- `supabase/functions/_shared/zoho-activity.ts` (modify) — `callDirection` helper + set `direction` in `mapActivity`.
- `supabase/functions/_shared/zoho-activity.test.js` (modify) — tests for the above.
- `src/lib/reports.js` (modify) — new pure `callsByDay` helper.
- `src/lib/reports.test.js` (modify) — tests for `callsByDay`.
- `src/pages/Reports.jsx` (modify) — swap the `todayCalls` head-count query for a windowed outbound-call query, fold synced counts into the daily value + trend strip, update the hint line.

Tasks are ordered so each produces a self-contained, testable change. Tasks 1–3 are independent of each other; Task 4 depends on 1–3 being merged (it consumes the `direction` column and the `callsByDay` helper).

**Test command for this repo:** `npm test` runs `vitest run` over all `*.test.js` / `*.test.ts` files (see `package.json`). To run a single file: `npx vitest run <path>`.

---

## Task 1: `direction` column on `activities`

**Files:**
- Create: `supabase/migrations/0027_activities_direction.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0027_activities_direction.sql`:

```sql
-- Direction of a call activity: 'outbound' | 'inbound' | null.
-- Only set for type='call' rows; null for every other activity type and for
-- calls whose CRM payload lacks a recognizable direction field. Nullable, so
-- existing rows stay valid and backfill happens on the next activity sync
-- (upsert on (source_crm, external_id) rewrites the column).
alter table activities add column if not exists direction text;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0027_activities_direction.sql
git commit -m "feat: add direction column to activities"
```

> Note: this repo applies migrations via the Supabase CLI / dashboard out of band; there is no local DB in the test suite. No automated test for the DDL itself — Task 4's Reports query exercises the column against the live DB after deploy.

---

## Task 2: FUB call direction

**Files:**
- Modify: `supabase/functions/_shared/fub-activity.ts`
- Test: `supabase/functions/_shared/fub-activity.test.js`

- [ ] **Step 1: Write the failing tests**

In `supabase/functions/_shared/fub-activity.test.js`, update the import on line 2 to include `callDirection`:

```js
import { mapActivity, occurredAt, snippet, callDirection } from './fub-activity.ts'
```

Add this describe block after the existing `snippet` block (before `describe('mapActivity'`):

```js
describe('callDirection', () => {
  it('reads FUB isIncoming: false is outbound, true is inbound', () => {
    expect(callDirection({ isIncoming: false })).toBe('outbound')
    expect(callDirection({ isIncoming: true })).toBe('inbound')
  })
  it('returns null when isIncoming is missing or not a boolean', () => {
    expect(callDirection({})).toBe(null)
    expect(callDirection({ isIncoming: 'no' })).toBe(null)
  })
})
```

In the same file, add a `direction` assertion to the existing "namespaces external_id by type" test. The record on line ~39 has no `isIncoming`, so extend it and assert. Replace that test's record and `toMatchObject` with:

```js
  it('namespaces external_id by type and resolves contact_id from personId', () => {
    const row = mapActivity(
      { id: 12, personId: 501, created: '2026-07-12T14:00:00Z', note: 'Discussed FHA', isIncoming: false },
      'call',
      contactIdByExternal,
    )
    expect(row).toMatchObject({
      business_id: 'bay',
      source_crm: 'fub',
      external_id: 'call-12',
      type: 'call',
      contact_id: 'uuid-contact',
      occurred_at: '2026-07-12T14:00:00Z',
      notes: 'Discussed FHA',
      direction: 'outbound',
    })
    expect(row.raw).toEqual({ id: 12, personId: 501, created: '2026-07-12T14:00:00Z', note: 'Discussed FHA', isIncoming: false })
  })
```

Add one test at the end of the `mapActivity` block asserting non-call rows and directionless calls get `null`:

```js
  it('sets direction only for calls with a known direction', () => {
    expect(mapActivity({ id: 10, person: { id: 501 }, created: 'x' }, 'note', contactIdByExternal).direction).toBe(null)
    expect(mapActivity({ id: 11, personId: 501, created: 'x' }, 'call', contactIdByExternal).direction).toBe(null)
    expect(mapActivity({ id: 12, personId: 501, created: 'x', isIncoming: true }, 'call', contactIdByExternal).direction).toBe('inbound')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run supabase/functions/_shared/fub-activity.test.js`
Expected: FAIL — `callDirection is not a function`, and the `direction: 'outbound'` assertion fails (property missing).

- [ ] **Step 3: Implement `callDirection` and set `direction` in `mapActivity`**

In `supabase/functions/_shared/fub-activity.ts`, add this helper directly above `mapActivity` (after `snippet`):

```ts
// Direction of a FUB call. FUB call records carry `isIncoming` (boolean).
// VERIFY on first live payload that this field is present and named this way;
// if it differs, adjust here — an unrecognized shape returns null (the call is
// then excluded from the outbound count, failing safe rather than mis-counting).
export function callDirection(rec) {
  if (rec.isIncoming === false) return 'outbound'
  if (rec.isIncoming === true) return 'inbound'
  return null
}
```

In `mapActivity`, add a `direction` field to the returned object (place it right after `type`):

```ts
    type,
    direction: type === 'call' ? callDirection(rec) : null,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run supabase/functions/_shared/fub-activity.test.js`
Expected: PASS (all tests, including the new `callDirection` block).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/fub-activity.ts supabase/functions/_shared/fub-activity.test.js
git commit -m "feat: map FUB call direction onto activity rows"
```

---

## Task 3: Zoho call direction

**Files:**
- Modify: `supabase/functions/_shared/zoho-activity.ts`
- Test: `supabase/functions/_shared/zoho-activity.test.js`

- [ ] **Step 1: Write the failing tests**

In `supabase/functions/_shared/zoho-activity.test.js`, update the import on line 2 to include `callDirection`:

```js
import { mapActivity, occurredAt, snippet, contactExternalId, callDirection } from './zoho-activity.ts'
```

Add this describe block after the existing `snippet` block (before `describe('contactExternalId'`):

```js
describe('callDirection', () => {
  it('reads Zoho Call_Type prefix, case-insensitively', () => {
    expect(callDirection({ Call_Type: 'Outbound' })).toBe('outbound')
    expect(callDirection({ Call_Type: 'Outbound Call' })).toBe('outbound')
    expect(callDirection({ Call_Type: 'inbound' })).toBe('inbound')
    expect(callDirection({ Call_Type: 'Inbound Call' })).toBe('inbound')
  })
  it('returns null when Call_Type is missing or unrecognized', () => {
    expect(callDirection({})).toBe(null)
    expect(callDirection({ Call_Type: 'Missed' })).toBe(null)
  })
})
```

Extend the existing "namespaces external_id by type and resolves contact_id from Who_Id" test to include and assert direction. Replace its record and `toMatchObject` with:

```js
  it('namespaces external_id by type and resolves contact_id from Who_Id', () => {
    const row = mapActivity(
      { id: 12, Who_Id: { id: '77' }, Call_Start_Time: '2026-07-12T14:00:00Z', Description: 'Pricing Q', Call_Type: 'Outbound' },
      'call',
      contactIdByExternal,
    )
    expect(row).toMatchObject({
      business_id: 'mpg',
      source_crm: 'zoho',
      external_id: 'call-12',
      type: 'call',
      contact_id: 'uuid-contact',
      occurred_at: '2026-07-12T14:00:00Z',
      notes: 'Pricing Q',
      direction: 'outbound',
    })
    expect(row.raw.id).toBe(12)
  })
```

Add one test at the end of the `mapActivity` block:

```js
  it('sets direction only for calls with a known direction', () => {
    expect(mapActivity({ id: 10, Parent_Id: { id: '77' }, $se_module: 'Contacts', Note_Content: 'x' }, 'note', contactIdByExternal).direction).toBe(null)
    expect(mapActivity({ id: 11, Who_Id: { id: '77' } }, 'call', contactIdByExternal).direction).toBe(null)
    expect(mapActivity({ id: 12, Who_Id: { id: '77' }, Call_Type: 'Inbound Call' }, 'call', contactIdByExternal).direction).toBe('inbound')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run supabase/functions/_shared/zoho-activity.test.js`
Expected: FAIL — `callDirection is not a function`, and the `direction: 'outbound'` assertion fails.

- [ ] **Step 3: Implement `callDirection` and set `direction` in `mapActivity`**

In `supabase/functions/_shared/zoho-activity.ts`, add this helper directly above `mapActivity`:

```ts
// Direction of a Zoho call. Zoho Calls carry `Call_Type`, whose value may be
// 'Outbound'/'Inbound' or 'Outbound Call'/'Inbound Call' depending on layout,
// so match on a case-insensitive prefix. VERIFY the field name and value casing
// against a live Calls record; an unrecognized value returns null (excluded
// from the outbound count, failing safe).
export function callDirection(rec) {
  const t = String(rec.Call_Type || '').toLowerCase()
  if (t.startsWith('outbound')) return 'outbound'
  if (t.startsWith('inbound')) return 'inbound'
  return null
}
```

In `mapActivity`, add a `direction` field to the returned object right after `type`:

```ts
    type,
    direction: type === 'call' ? callDirection(rec) : null,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run supabase/functions/_shared/zoho-activity.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/zoho-activity.ts supabase/functions/_shared/zoho-activity.test.js
git commit -m "feat: map Zoho call direction onto activity rows"
```

---

## Task 4a: `callsByDay` pure helper

**Files:**
- Modify: `src/lib/reports.js`
- Test: `src/lib/reports.test.js`

- [ ] **Step 1: Write the failing test**

Add to `src/lib/reports.test.js`. First ensure `callsByDay` is in the import from `./reports` at the top of the file (add it to the existing import list). Then add:

```js
describe('callsByDay', () => {
  it('returns an empty object for no rows', () => {
    expect(callsByDay([])).toEqual({})
  })
  it('counts one row on its local day key', () => {
    // 2026-08-13T14:00:00Z is 2026-08-13 in negative-UTC-offset zones and UTC.
    expect(callsByDay([{ occurred_at: '2026-08-13T14:00:00Z' }])).toEqual({ '2026-08-13': 1 })
  })
  it('sums multiple rows per day and separates days', () => {
    const rows = [
      { occurred_at: '2026-08-13T14:00:00Z' },
      { occurred_at: '2026-08-13T18:30:00Z' },
      { occurred_at: '2026-08-12T09:00:00Z' },
    ]
    expect(callsByDay(rows)).toEqual({ '2026-08-13': 2, '2026-08-12': 1 })
  })
  it('ignores rows with no occurred_at', () => {
    expect(callsByDay([{ occurred_at: null }, { occurred_at: '2026-08-13T14:00:00Z' }])).toEqual({ '2026-08-13': 1 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/reports.test.js`
Expected: FAIL — `callsByDay is not a function`.

- [ ] **Step 3: Implement `callsByDay`**

In `src/lib/reports.js`, add this helper (place it after `dailySeries`, near the other rollup helpers). `dayKey` is already imported at the top of the file.

```js
// rows: activity rows { occurred_at }, already filtered by the caller to
// type='call', direction='outbound', and the desired business. Returns
// { [YYYY-MM-DD]: count } using local day keys (same basis as
// metrics_daily.date via dayKey), so synced counts line up with manual entries.
export function callsByDay(rows) {
  const out = {}
  for (const r of rows) {
    if (!r.occurred_at) continue
    const key = dayKey(r.occurred_at)
    out[key] = (out[key] || 0) + 1
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/reports.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reports.js src/lib/reports.test.js
git commit -m "feat: callsByDay helper buckets synced calls by local day"
```

---

## Task 4b: Wire synced calls into Reports

**Files:**
- Modify: `src/pages/Reports.jsx`

No unit test — `Reports.jsx` is I/O-bound React with a live Supabase query. Verified manually in the browser preview (steps at the end). The pure logic it relies on (`callsByDay`) is already covered by Task 4a.

- [ ] **Step 1: Import `callsByDay`**

In `src/pages/Reports.jsx`, add `callsByDay` to the existing import from `../lib/reports` (the block spanning lines 4–9):

```js
import {
  DEFAULT_TARGETS, metricsForTab, resolveTargets, buildTabModel,
  weekStart, monthWindow, rollupMetrics, dailySeries,
  sumWon, countWon, deriveStageCounts, pipelineValue, periodDateFor,
  sprintRows, sprintWindow, MPG_SPRINT, callsByDay,
} from '../lib/reports'
```

- [ ] **Step 2: Replace the `todayCalls` query with a windowed outbound-call query**

In the `load` callback, the current last element of the `Promise.all` array is a head-count `todayCalls` query (around lines 234–237). Replace that query so it fetches outbound call rows for the same 7-day window the trend strip uses. Change the `todayCalls` entry in the `Promise.all` from:

```js
        supabase.from('activities')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', 'bay').eq('type', 'call').gte('occurred_at', todayStartIso),
```

to:

```js
        supabase.from('activities')
          .select('occurred_at, business_id')
          .eq('type', 'call').eq('direction', 'outbound').gte('occurred_at', sevenAgoStartIso),
```

Add `sevenAgoStartIso` next to the existing `todayStartIso` definition (around line 222):

```js
      const todayStartIso = new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
      const sevenAgoStartIso = (() => {
        const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 6)
        return d.toISOString()
      })()
```

`todayStartIso` is now unused; delete its line.

- [ ] **Step 3: Store synced call rows in state instead of a scalar count**

The destructured result variable is still named `todayCalls`; it now holds `{ data, error }` of call rows. Rename it to `callRows` at the destructuring site and in the error union, and replace the `todayCalls` field in `setData` with the raw rows. In the `Promise.all` destructuring (around line 224), rename the last variable `todayCalls` → `callRows`. In the error check (around line 238–239) rename `todayCalls.error` → `callRows.error`. In `setData` (around line 252), replace:

```js
        todayCalls: todayCalls.count || 0,
```

with:

```js
        callRows: callRows.data || [],
```

- [ ] **Step 4: Provide `callRows` in demo data**

In `demoReportsData()`, replace the trailing `todayCalls: 24,` field (around line 444) with demo call rows so demo mode shows a synced count. Use today's date:

```js
    callRows: [
      { occurred_at: new Date().toISOString(), business_id: 'bay' },
      { occurred_at: new Date().toISOString(), business_id: 'bay' },
      { occurred_at: new Date().toISOString(), business_id: 'mpg' },
    ],
```

- [ ] **Step 5: Fold synced calls into the daily value**

In `computeValues`, the `daily` branch currently returns just the manual rollup. Replace the `if (tab === 'daily')` block with one that adds today's synced outbound count for the active business:

```js
  if (tab === 'daily') {
    const today = data.series.filter((r) => r.date === todayKey())
    const manual = rollupMetrics(bizFilter(today))
    const syncedRows = biz === 'all' ? data.callRows : data.callRows.filter((r) => r.business_id === biz)
    const syncedToday = callsByDay(syncedRows)[todayKey()] || 0
    return { ...manual, calls: Number(manual.calls || 0) + syncedToday }
  }
```

- [ ] **Step 6: Fold per-day synced calls into the trend strip**

The `TrendStrip` is fed by `dailySeries(...)` computing manual `calls` for 7 days (around lines 346–351). Wrap that manual series by adding the synced per-day counts. Replace the `<TrendStrip ... />` block with:

```jsx
      {!loading && !error && data && tab === 'daily' && (() => {
        const manualSeries = dailySeries(
          biz === 'all' ? data.series : data.series.filter((r) => r.business_id === biz),
          'calls', todayKey(), 7,
        )
        const syncedRows = biz === 'all' ? data.callRows : data.callRows.filter((r) => r.business_id === biz)
        const byDay = callsByDay(syncedRows)
        const start = new Date(); start.setDate(start.getDate() - 6)
        const pad = (n) => String(n).padStart(2, '0')
        const combined = manualSeries.map((v, i) => {
          const d = new Date(start); d.setDate(start.getDate() + i)
          const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
          return v + (byDay[key] || 0)
        })
        return <TrendStrip series={combined} />
      })()}
```

- [ ] **Step 7: Update the calls hint line and its prop**

The `LogMetrics` component takes a `todayCalls` prop and renders a bay-only hint (around lines 87, 117–121, 359). Replace the prop with the synced count for the selected business, covering both books.

In the `LogMetrics` signature (line 87) change `todayCalls` to `syncedCalls`:

```jsx
function LogMetrics({ tab, biz, values, syncedCalls, onSave, saving }) {
```

Replace the bay-only hint (lines 117–121) with a book-agnostic one:

```jsx
            {m.key === 'calls' && (
              <span className="mt-1 block text-[10.5px] text-dim">
                Auto: {syncedCalls} outbound calls synced today — add any made outside the CRM
              </span>
            )}
```

At the `<LogMetrics ... />` call site (around line 359), replace `todayCalls={data.todayCalls}` with a computed synced count:

```jsx
          syncedCalls={(() => {
            const rows = biz === 'all' ? data.callRows : data.callRows.filter((r) => r.business_id === biz)
            return callsByDay(rows)[todayKey()] || 0
          })()}
```

- [ ] **Step 8: Run the full test suite**

Run: `npm test`
Expected: PASS — no test imports `todayCalls`; the change is confined to `Reports.jsx` runtime wiring, and `callsByDay` tests pass.

- [ ] **Step 9: Verify in the browser preview**

Start the dev server and confirm the Reports daily tab renders without console errors, the calls hint reads "Auto: N outbound calls synced today — add any made outside the CRM", and switching the business filter (MPG / Bayway / All) changes N. In demo mode N should be 2 for Bayway, 1 for MPG, 3 for All.

- [ ] **Step 10: Commit**

```bash
git add src/pages/Reports.jsx
git commit -m "feat: auto-add synced outbound calls to Reports daily count and trend"
```

---

## Post-implementation (manual, out of band)

Not code steps — record here so they are not forgotten:

1. Apply migration `0027_activities_direction.sql` to the Supabase project.
2. Deploy the two updated edge functions (`fub-activity-sync`, `zoho-activity-sync`).
3. Manually invoke both sync functions once to backfill `direction` on existing call rows (otherwise it fills in on the next scheduled run).
4. **VERIFY the direction fields against live payloads:** confirm FUB `/calls` carry `isIncoming` (boolean) and Zoho Calls carry `Call_Type` with `Outbound*`/`Inbound*` values. If either differs, adjust the one `callDirection` helper in that CRM's `_shared/*-activity.ts` — no other code changes needed.

---

## Self-Review Notes

- **Spec coverage:** data model (Task 1), FUB mapper + direction (Task 2), Zoho mapper + direction (Task 3), `callsByDay` helper (Task 4a), additive daily value + trend strip + hint UI (Task 4b), backfill + VERIFY (post-implementation section). All spec sections mapped.
- **Additive / no double-count:** synced count and manual entry are separate addends in Step 5; manual is labeled "made outside the CRM."
- **Type consistency:** `callDirection(rec)` and `callsByDay(rows)` signatures identical across every task that references them; `direction` values limited to `'outbound' | 'inbound' | null` throughout.
- **Fail-safe:** unknown/missing direction fields → `null` → excluded from the outbound count, never mis-counted.
