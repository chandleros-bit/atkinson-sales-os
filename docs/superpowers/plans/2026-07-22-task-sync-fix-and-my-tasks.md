# Task Completion Sync Fix + My Tasks Overview Section — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make FollowUpBoss task completions drop off the dashboard, and add a compact "My Tasks" card (overdue + today, top 5) to the Overview.

**Architecture:** Two independent slices. (1) Sync fix: after the existing incremental upsert, `fub-task-sync` fetches the full set of currently-open FUB task ids and marks any of our still-open `fub` rows not in that set completed — self-healing, guarded against false mass-clear because the open-fetch throws (aborting the run) on any API error. (2) Feature: a self-contained `MyTasks` component mirroring the existing `CalendarRail` pattern — fetches `v_tasks`, filters by the active business via `useBusiness().matches`, runs a pure `buildMyTasks` helper, renders above Needs Attention in all three live Overview views.

**Tech Stack:** Deno Edge Functions (Supabase), Postgres, React 18 + react-router-dom, Vitest, Tailwind.

**Spec:** `docs/superpowers/specs/2026-07-22-task-sync-fix-and-my-tasks-design.md`

---

## File Structure

- `supabase/functions/_shared/fub-tasks.ts` — **modify.** Add pure `reconcileCompleted(openExternalIds, ourOpenRows)`.
- `supabase/functions/_shared/fub-tasks.test.js` — **modify.** Tests for `reconcileCompleted`.
- `supabase/functions/fub-task-sync/index.ts` — **modify.** Wire the reconciliation pass in after the upsert loop.
- `src/lib/overview.js` — **modify.** Add pure `buildMyTasks(rows, now)`.
- `src/lib/overview.test.js` — **modify.** Tests for `buildMyTasks`.
- `src/components/MyTasks.jsx` — **create.** Self-contained card component.
- `src/pages/Overview.jsx` — **modify.** Render `<MyTasks />` above Needs Attention in `AllOverview`, `BayOverview`, `MpgOverview`.

> **Deviation from spec (intentional):** The spec sketched folding a `v_tasks` query into each view's `Promise.all`. The plan instead uses a self-contained `<MyTasks />` component that fetches `v_tasks` once and filters client-side via `matches(r.business_id)` — this mirrors the established `CalendarRail` component exactly (dropped into every view, self-filtering), keeps `Overview.jsx` from growing three near-identical query blocks, and is DRYer. Net behavior is identical.

---

## Task 1: `reconcileCompleted` pure helper

**Files:**
- Modify: `supabase/functions/_shared/fub-tasks.ts`
- Test: `supabase/functions/_shared/fub-tasks.test.js`

- [ ] **Step 1: Write the failing test**

Append to `supabase/functions/_shared/fub-tasks.test.js`. First add `reconcileCompleted` to the existing import on line 2 so it reads:

```js
import { mapTask, taskDueAt, taskTitle, taskIsCompleted, reconcileCompleted } from './fub-tasks.ts'
```

Then append this block to the end of the file:

```js
describe('reconcileCompleted', () => {
  it('returns ids of our rows no longer open in FUB', () => {
    const open = new Set(['77', '78'])
    const rows = [
      { id: 'u1', external_id: '77' }, // still open
      { id: 'u2', external_id: '79' }, // completed in FUB
    ]
    expect(reconcileCompleted(open, rows)).toEqual(['u2'])
  })

  it('returns empty when every row is still open', () => {
    const open = new Set(['77', '78'])
    expect(reconcileCompleted(open, [{ id: 'u1', external_id: '77' }])).toEqual([])
  })

  it('marks all rows when the open set is empty (everything done)', () => {
    const rows = [
      { id: 'u1', external_id: '77' },
      { id: 'u2', external_id: '78' },
    ]
    expect(reconcileCompleted(new Set(), rows)).toEqual(['u1', 'u2'])
  })

  it('returns empty for no rows', () => {
    expect(reconcileCompleted(new Set(['77']), [])).toEqual([])
  })

  it('compares external_id as a string on both sides', () => {
    expect(reconcileCompleted(new Set(['77']), [{ id: 'u1', external_id: 77 }])).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- fub-tasks`
Expected: FAIL — `reconcileCompleted is not a function` (or an import/undefined error).

- [ ] **Step 3: Write the minimal implementation**

Append to `supabase/functions/_shared/fub-tasks.ts` (after `mapTask`, at end of file):

```ts
// Open-set reconciliation for completed tasks. An incremental updatedAfter pull
// does not reliably re-fetch a task once it's completed in FUB, so the board
// (v_tasks filters is_completed=false) would never drop it. Given the set of
// external_ids currently OPEN in FUB and our still-open fub rows, return the
// ids of the rows to mark completed: those no longer present in the open set.
//
// openExternalIds: Set<string> of external_ids currently open in FUB.
// ourOpenRows:     [{ id, external_id }] — our fub rows still is_completed=false.
export function reconcileCompleted(openExternalIds, ourOpenRows) {
  return ourOpenRows
    .filter((r) => !openExternalIds.has(String(r.external_id)))
    .map((r) => r.id)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- fub-tasks`
Expected: PASS — all `reconcileCompleted` cases green, existing `mapTask`/`taskDueAt` cases still green.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/fub-tasks.ts supabase/functions/_shared/fub-tasks.test.js
git commit -m "feat: reconcileCompleted helper for FUB task open-set reconciliation"
```

---

## Task 2: Wire reconciliation into `fub-task-sync`

**Files:**
- Modify: `supabase/functions/fub-task-sync/index.ts`

No unit test — this is I/O wiring around the pure helper from Task 1 (which is tested). It is verified end-to-end in Task 5 (manual live check). Keep the change minimal and mechanical.

- [ ] **Step 1: Extend the import**

In `supabase/functions/fub-task-sync/index.ts`, line 7 currently reads:

```ts
import { fetchOpenTasks, fetchTasksUpdatedSince, mapTask } from '../_shared/fub-tasks.ts'
```

Change it to add `reconcileCompleted`:

```ts
import { fetchOpenTasks, fetchTasksUpdatedSince, mapTask, reconcileCompleted } from '../_shared/fub-tasks.ts'
```

- [ ] **Step 2: Add the reconciliation pass after the upsert loop**

The upsert loop ends at line 79 (`}` closing the `for` that increments `upserted`). Immediately after that closing brace and BEFORE the `const summary = [` line, insert:

```ts
    // Reconcile completions FUB didn't hand back through the incremental window.
    // Fetch the full set of currently-open FUB task ids and mark any of our
    // still-open fub rows not in that set completed, so they drop from v_tasks.
    // fetchOpenTasks -> fubGet THROWS on any non-2xx response, so a transient
    // FUB failure aborts this whole run here — before any reconciliation write —
    // and can never wrongly mark all open tasks completed. On the first run
    // `records` already IS the open-task list, so reuse it and skip a fetch.
    const openRecords = since ? await fetchOpenTasks() : records
    const openExternalIds = new Set(
      openRecords.filter((rec) => rec.id != null).map((rec) => String(rec.id)),
    )
    const { data: ourOpen, error: ourOpenErr } = await db
      .from('tasks')
      .select('id, external_id')
      .eq('source_crm', 'fub')
      .eq('is_completed', false)
    if (ourOpenErr) throw new Error(`open rows: ${ourOpenErr.message}`)

    const staleIds = reconcileCompleted(openExternalIds, ourOpen || [])
    let reconciled = 0
    if (staleIds.length > 0) {
      const { error: reapErr } = await db
        .from('tasks')
        .update({ is_completed: true, updated_at: new Date().toISOString() })
        .in('id', staleIds)
      if (reapErr) throw new Error(`reconcile completed: ${reapErr.message}`)
      reconciled = staleIds.length
    }
```

- [ ] **Step 3: Surface the count in the summary line**

The `summary` array (was line 81–86) currently is:

```ts
    const summary = [
      since ? 'incremental' : 'first run (open only)',
      `fetched:${records.length} upserted:${upserted}`,
      skippedNoId ? `skipped ${skippedNoId} with no id` : '',
      droppedCompleted ? `dropped ${droppedCompleted} already-completed` : '',
    ]
      .filter(Boolean)
      .join(' | ')
```

Add a `reconciled` entry so the Sync Status message reports it:

```ts
    const summary = [
      since ? 'incremental' : 'first run (open only)',
      `fetched:${records.length} upserted:${upserted}`,
      reconciled ? `reconciled-completed:${reconciled}` : '',
      skippedNoId ? `skipped ${skippedNoId} with no id` : '',
      droppedCompleted ? `dropped ${droppedCompleted} already-completed` : '',
    ]
      .filter(Boolean)
      .join(' | ')
```

- [ ] **Step 4: Sanity-check the file parses**

Run: `npx vitest run supabase/functions/_shared/fub-tasks.test.js`
Expected: PASS (this confirms the shared module the function imports is still valid; the Deno function itself is not part of the vitest suite). Also visually confirm `reconciled` is declared before it is read in the summary array and that the new block sits inside the `try`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/fub-task-sync/index.ts
git commit -m "fix: reconcile completed FUB tasks so completions drop off the board"
```

---

## Task 3: `buildMyTasks` pure helper

**Files:**
- Modify: `src/lib/overview.js`
- Test: `src/lib/overview.test.js`

- [ ] **Step 1: Write the failing test**

Add `buildMyTasks` to the existing import block at the top of `src/lib/overview.test.js` (lines 2–11) so the list includes it:

```js
import {
  daysSince,
  lastTouchLabel,
  sortByAttention,
  buildKpis,
  buildCombinedKpis,
  deriveAlert,
  isHot,
  isMpgOpen,
  buildMyTasks,
} from './overview'
```

Then append this block to the end of the file. Uses the same local-time (no `Z`) clock convention as `tasks.test.js` so bucketing is timezone-stable:

```js
describe('buildMyTasks', () => {
  const T = new Date('2026-07-19T12:00:00').getTime()
  const rows = [
    { id: 'a', due_at: '2026-07-17T09:00:00' }, // 2 days overdue
    { id: 'b', due_at: '2026-07-18T09:00:00' }, // yesterday, overdue
    { id: 'c', due_at: '2026-07-19T16:00:00' }, // today
    { id: 'e', due_at: '2026-07-20T09:00:00' }, // tomorrow — excluded
    { id: 'f', due_at: '2026-07-25T09:00:00' }, // upcoming — excluded
    { id: 'g', due_at: null }, // no due date — excluded
  ]

  it('keeps only overdue and today, overdue first, most-overdue on top', () => {
    expect(buildMyTasks(rows, T).map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('tags each row with its bucket', () => {
    const out = buildMyTasks(rows, T)
    expect(out.find((r) => r.id === 'a').bucket).toBe('overdue')
    expect(out.find((r) => r.id === 'c').bucket).toBe('today')
  })

  it('caps the result at 5', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: `o${i}`,
      due_at: '2026-07-18T09:00:00',
    }))
    expect(buildMyTasks(many, T)).toHaveLength(5)
  })

  it('returns empty for no rows', () => {
    expect(buildMyTasks([], T)).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- overview`
Expected: FAIL — `buildMyTasks is not a function`.

- [ ] **Step 3: Write the minimal implementation**

At the top of `src/lib/overview.js`, add an import for the board's bucketing helper (the file currently has no imports — add this as the first line, after the leading comment block on lines 1–3):

```js
import { bucketByDue } from './tasks'
```

Then append to the end of `src/lib/overview.js`:

```js
// The Overview "My Tasks" card: up to 5 dated tasks that need attention now.
// rows: v_tasks rows for the current view (open tasks only).
// Returns overdue (most-overdue first) then today, each tagged with a `bucket`
// of 'overdue' | 'today' for the row's due-cell rendering, capped at 5. Built
// on bucketByDue so this can never disagree with the Tasks board's date logic.
export function buildMyTasks(rows, now = Date.now()) {
  const byKey = Object.fromEntries(bucketByDue(rows, now).map((g) => [g.key, g.rows]))
  const overdue = byKey.overdue.map((r) => ({ ...r, bucket: 'overdue' }))
  const today = byKey.today.map((r) => ({ ...r, bucket: 'today' }))
  return [...overdue, ...today].slice(0, 5)
}
```

Note: `bucketByDue` always returns all five buckets (see `BUCKETS` in `tasks.js`), so `byKey.overdue` and `byKey.today` are always defined arrays.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- overview`
Expected: PASS — the four `buildMyTasks` cases green, existing overview cases still green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/overview.js src/lib/overview.test.js
git commit -m "feat: buildMyTasks helper for the Overview My Tasks card"
```

---

## Task 4: `MyTasks` component + wire into the Overview views

**Files:**
- Create: `src/components/MyTasks.jsx`
- Modify: `src/pages/Overview.jsx`

No vitest — the project tests pure `src/lib` helpers only, not React components (see `MyTasks` logic is already covered by `buildMyTasks` tests in Task 3). Rendering is verified in Task 5 via the browser preview.

- [ ] **Step 1: Create the component**

Create `src/components/MyTasks.jsx` with exactly this content. It mirrors `CalendarRail.jsx`: self-contained fetch, `isDemoMode` guard, client-side `matches()` filter, same card shell.

```jsx
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, isDemoMode } from '../lib/supabase'
import { useBusiness } from '../context/BusinessContext'
import { buildMyTasks } from '../lib/overview'
import { dueLabel, dueTimeOfDay, BUCKET_META } from '../lib/tasks'
import CrmLink from './CrmLink'

// 46px-wide business chip, same as the Tasks board (src/pages/Tasks.jsx).
function BizTag({ business_id }) {
  const mpg = business_id === 'mpg'
  return (
    <span
      className="flex-none rounded px-1.5 py-0.5 text-center text-[9.5px] font-bold tracking-wide"
      style={{
        color: mpg ? 'var(--mpg)' : 'var(--bay)',
        background: mpg ? 'var(--mpg-soft)' : 'var(--bay-soft)',
        width: 46,
      }}
    >
      {mpg ? 'MPG' : 'BAYWAY'}
    </span>
  )
}

export default function MyTasks() {
  const { matches } = useBusiness()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(!isDemoMode)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (isDemoMode) return
    let alive = true
    ;(async () => {
      setLoading(true)
      setError(null)
      const { data, error: err } = await supabase
        .from('v_tasks')
        .select('id, business_id, task_type, title, due_at, priority, contact_name, crm_profile_url')
        .order('due_at', { ascending: true, nullsFirst: false })
      if (!alive) return
      if (err) setError(err.message)
      else setRows(data || [])
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [])

  // In demo mode the fetch is skipped, so rows stays [] and the empty state
  // shows — the live Overview views never render this in demo anyway.
  const tasks = useMemo(
    () => buildMyTasks(rows.filter((r) => matches(r.business_id)), Date.now()),
    [rows, matches],
  )

  return (
    <div className="mt-5 rounded-card border border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line px-4 py-3.5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          My Tasks
          {!loading && !error && (
            <span className="num text-[11px] font-medium text-muted">{tasks.length}</span>
          )}
        </div>
        <Link to="/tasks" className="text-xs font-semibold text-muted hover:text-white">
          Show all →
        </Link>
      </div>

      {loading && <div className="px-6 py-8 text-center text-sm text-muted">Loading tasks…</div>}

      {error && (
        <div className="m-3 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {!loading && !error && tasks.length === 0 && (
        <div className="px-6 py-8 text-center text-sm text-muted">
          You&apos;re clear — nothing due today.
        </div>
      )}

      {!loading && !error && tasks.length > 0 && (
        <div>
          {tasks.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0 hover:bg-hoverbg"
            >
              <BizTag business_id={t.business_id} />
              <div
                className="num w-24 flex-none text-[12px]"
                style={{ color: t.bucket === 'overdue' ? BUCKET_META.overdue.color : 'var(--muted)' }}
              >
                {t.bucket === 'overdue' ? dueLabel(t.due_at) : dueTimeOfDay(t.due_at)}
              </div>
              <div className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                {t.title || '(untitled task)'}
                {t.task_type && (
                  <span className="ml-2 text-[11px] font-normal text-dim">{t.task_type}</span>
                )}
              </div>
              <div className="w-40 flex-none truncate text-right text-[12.5px] text-muted">
                <CrmLink url={t.crm_profile_url}>{t.contact_name || '—'}</CrmLink>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Import `MyTasks` into the Overview**

In `src/pages/Overview.jsx`, the import block (lines 1–18) already imports `CalendarRail` on line 5:

```js
import CalendarRail from '../components/CalendarRail'
```

Add directly below it:

```js
import MyTasks from '../components/MyTasks'
```

- [ ] **Step 3: Render it above Needs Attention in the "All" view**

In `AllOverview`, the render currently is (around lines 276–282):

```jsx
          <AttentionCard
            rows={merged}
            dotClass="grad-dual"
            empty="No HOT Bayway or open MPG contacts right now."
          />
          <CalendarRail />
```

Insert `<MyTasks />` immediately before `<AttentionCard`:

```jsx
          <MyTasks />
          <AttentionCard
            rows={merged}
            dotClass="grad-dual"
            empty="No HOT Bayway or open MPG contacts right now."
          />
          <CalendarRail />
```

- [ ] **Step 4: Render it above Needs Attention in the Bayway view**

In `BayOverview` (around lines 387–392):

```jsx
          <AttentionCard
            rows={workbench}
            dotStyle={{ background: 'var(--bay)' }}
            empty="No HOT-tagged contacts — tag a lead HOT in FollowUpBoss."
          />
          <CalendarRail />
```

Insert `<MyTasks />` immediately before `<AttentionCard`:

```jsx
          <MyTasks />
          <AttentionCard
            rows={workbench}
            dotStyle={{ background: 'var(--bay)' }}
            empty="No HOT-tagged contacts — tag a lead HOT in FollowUpBoss."
          />
          <CalendarRail />
```

- [ ] **Step 5: Render it above Needs Attention in the MPG view**

In `MpgOverview` (around lines 470–474):

```jsx
          <AttentionCard
            rows={workbench}
            dotStyle={{ background: 'var(--mpg)' }}
            empty="No open MPG leads — set a lead to Open in Zoho CRM."
          />
          <CalendarRail />
```

Insert `<MyTasks />` immediately before `<AttentionCard`:

```jsx
          <MyTasks />
          <AttentionCard
            rows={workbench}
            dotStyle={{ background: 'var(--mpg)' }}
            empty="No open MPG leads — set a lead to Open in Zoho CRM."
          />
          <CalendarRail />
```

> Do **not** add `<MyTasks />` to `DemoOverview` — demo stays unchanged per spec.

- [ ] **Step 6: Verify the build compiles**

Run: `npm run build`
Expected: Build succeeds with no errors (this catches a bad import path or JSX typo across the three edits).

- [ ] **Step 7: Commit**

```bash
git add src/components/MyTasks.jsx src/pages/Overview.jsx
git commit -m "feat: My Tasks card on the Overview above Needs Attention"
```

---

## Task 5: Full-suite check + manual verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: All suites pass — `fub-tasks`, `overview`, `tasks`, and every existing suite green.

- [ ] **Step 2: Visually verify the Overview card (browser preview)**

Start the dev server (via the preview tool / `npm run dev`) and open the app. On the Overview, across the All / Bayway / MPG business filters, confirm:
- A "My Tasks" card renders **above** Needs Attention.
- It lists at most 5 rows, overdue first (gold due label), then today (time of day).
- The header count matches the visible rows; "Show all →" navigates to the Tasks page (`/tasks`).
- With no overdue/today tasks in a filter, the card shows "You're clear — nothing due today."

- [ ] **Step 3: Verify the sync fix against live FUB (acceptance for the bug)**

- In FollowUpBoss, complete a task that currently appears on the dashboard's Tasks board.
- On the Sync Status screen, click "Run FollowUpBoss sync now" (or wait for the 15-min cron), then reload the Tasks board.
- Expected: the completed task is gone from the board. On the Sync Status "FollowUpBoss tasks" row, the message includes `reconciled-completed:N` (N ≥ 1) for the run that caught it.
- Also confirm any previously-stuck completed tasks cleared in the same run.

- [ ] **Step 4: Final commit (if any doc/status tweaks were made)**

```bash
git add -A
git commit -m "chore: verify task sync fix and My Tasks card"
```

(Skip if nothing changed in this task.)

---

## Self-Review Notes

- **Spec coverage:** Sync fix (open-set reconciliation + guard + summary line) → Tasks 1–2, 5. `reconcileCompleted` pure + tested → Task 1. `buildMyTasks` pure + tested → Task 3. My Tasks card, all three live views, above Needs Attention, ≤5 overdue+today, Show-all → `/tasks`, empty state, overdue gold accent → Task 4. Acceptance criteria 1–5 → Task 5. Zoho parity is explicitly out of scope (spec) — no task, correct.
- **Type consistency:** `reconcileCompleted(openExternalIds: Set, ourOpenRows: [{id, external_id}]) -> id[]` used identically in Task 1 and Task 2. `buildMyTasks(rows, now) -> rows w/ .bucket` used identically in Task 3 and consumed in Task 4 (`t.bucket`, `t.due_at`, `t.business_id`, `t.title`, `t.task_type`, `t.contact_name`, `t.crm_profile_url` — all present in the Task 4 `v_tasks` select and in `v_tasks` per migration 0018).
- **No placeholders:** every code step shows full code; every run step shows the command and expected result.
