# Calendar Rail Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a today-only calendar rail widget to the Overview dashboard that shows today's Outlook events, tagged and filtered by business (MPG/Bayway), reading from the already-synced `calendar_events` table.

**Architecture:** The sync backend already exists and is out of scope — `supabase/functions/outlook-sync` pulls two published ICS feeds every 15 min (pg_cron migration `0008`) and upserts into `calendar_events`. This plan builds **only the front-end widget**: a new pure-logic module (`src/lib/calendarRail.js`, unit-tested with vitest) plus a thin presentational component (`src/components/CalendarRail.jsx`) wired into all four Overview views. Rows are read-only/non-clickable, matching the existing `src/pages/Calendar.jsx`.

**Tech Stack:** React 18, Vite, Tailwind, Supabase JS client, vitest. No new dependencies.

---

## Decisions locked (differ from the original design spec)

The design spec (`2026-07-17-calendar-rail-widget-design.md`) assumed a greenfield Microsoft Graph OAuth build and a new table. The codebase already diverged; these were confirmed with the user on 2026-07-19:

1. **Sync backend = existing ICS feeds**, not Graph OAuth. No auth work in this plan. The two feeds are read via function secrets `OUTLOOK_MPG_ICS_URL` / `OUTLOOK_BAYWAY_ICS_URL` (see Prerequisites).
2. **Rows are non-clickable.** ICS feeds don't carry reliable per-event deep links, so `outlook_url` is dropped. The widget is display-only, exactly like the existing Calendar page.
3. **Reuse the existing `calendar_events` schema** — no migration. Columns in play: `id`, `source_account` (`'outlook-mpg'` | `'outlook-bayway'`), `title`, `starts_at`, `ends_at`, `location`, `is_all_day`. Business is derived from `source_account` via the existing `sourceToBiz()` helper (`outlook-mpg` → `mpg`, `outlook-bayway` → `bay`). The spec's `business`/`start_time`/`all_day`/`last_synced_at` column names do **not** exist and are not needed.
4. **Staleness** is derived from `sync_log` (`ran_at` of the latest `status='ok'` outlook row), not a `last_synced_at` column.

## Colors (open item from the design spec, now resolved)

Design tokens already exist in `src/index.css` and match the spec's intent:
- MPG (blue): `var(--mpg)` = `#26ABE0`
- Bayway (green): `var(--bay)` = `#7CAD44`

Note the business key is `bay` in code (not `bayway`); `source_account` is `outlook-bayway`.

## What already exists (do not rebuild)

- `supabase/functions/outlook-sync/index.ts` — the 15-min sync (ICS → `calendar_events`).
- `supabase/functions/_shared/ics.ts`, `_shared/ics-map.ts` — ICS parse/expand/map.
- `supabase/migrations/0008_schedule_outlook_sync.sql` — pg_cron schedule.
- `src/pages/Calendar.jsx` + `src/lib/calendar.js` — the full **multi-day** calendar page. Reuse its helpers `sourceToBiz` and `timeLabel`; do **not** modify this page.
- `src/context/BusinessContext.jsx` — `useBusiness()` exposes `matches(rowBiz)` for the All/MPG/Bayway toggle.

## File Structure

| File | Responsibility |
|------|----------------|
| `src/lib/calendarRail.js` (create) | Pure logic: filter to today, order all-day-first, staleness calc. No React/I-O. |
| `src/lib/calendarRail.test.js` (create) | vitest unit tests for the above. |
| `src/components/CalendarRail.jsx` (create) | Presentational widget: self-fetches today's events + latest sync, applies business filter, renders the card (loading / error / empty / stale / list). Handles demo mode. |
| `src/pages/Overview.jsx` (modify) | Import and render `<CalendarRail />` in all four views (All, Bay, MPG, Demo). |

---

## Prerequisites (ops — one-time, not code, do NOT block the build)

The widget builds and demos without these; live data needs them. These are manual dashboard steps, so they aren't a testable task.

- [ ] In the Supabase project (`cnmipfxwqnbtkohfixkf`) → Edge Functions → `outlook-sync` → Secrets, set `OUTLOOK_MPG_ICS_URL` and `OUTLOOK_BAYWAY_ICS_URL` to the two published Outlook ICS calendar links. Reference: `docs/phase8-outlook-setup.md`.
- [ ] Confirm a sync ran: SyncStatus page shows `outlook-mpg` / `outlook-bayway` rows with `status='ok'`. Until secrets are set, each run logs a "not set" error row (expected).

---

## Task 1: Pure rail logic (`calendarRail.js`) — TDD

**Files:**
- Create: `src/lib/calendarRail.js`
- Test: `src/lib/calendarRail.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/lib/calendarRail.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { todayEvents, isSyncStale, SYNC_INTERVAL_MS } from './calendarRail'

// Local-time ISO so tests are deterministic regardless of env TZ.
const local = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).toISOString()

describe('todayEvents', () => {
  const now = local(2026, 7, 19, 9, 0)
  const rows = [
    { id: 'yesterday', is_all_day: false, starts_at: local(2026, 7, 18, 10, 0) },
    { id: 'timed-pm', is_all_day: false, starts_at: local(2026, 7, 19, 14, 0) },
    { id: 'timed-am', is_all_day: false, starts_at: local(2026, 7, 19, 8, 30) },
    { id: 'allday', is_all_day: true, starts_at: local(2026, 7, 19, 0, 0) },
    { id: 'tomorrow', is_all_day: false, starts_at: local(2026, 7, 20, 9, 0) },
  ]

  it('keeps only today, all-day first, then by start time', () => {
    const out = todayEvents(rows, now)
    expect(out.map((e) => e.id)).toEqual(['allday', 'timed-am', 'timed-pm'])
  })

  it('does not mutate the input', () => {
    const copy = [...rows]
    todayEvents(rows, now)
    expect(rows).toEqual(copy)
  })

  it('drops rows without a start time', () => {
    expect(todayEvents([{ id: 'x', starts_at: null }], now)).toEqual([])
  })
})

describe('isSyncStale', () => {
  const now = local(2026, 7, 19, 12, 0)
  const nowMs = new Date(now).getTime()

  it('is stale when there is no successful sync', () => {
    expect(isSyncStale(null, nowMs)).toBe(true)
  })

  it('is fresh within one interval past due', () => {
    // 20 min ago: next run was due at +15, only 5 min late — still fresh.
    expect(isSyncStale(nowMs - 20 * 60 * 1000, nowMs)).toBe(false)
  })

  it('is stale once a full cycle is missed', () => {
    // 40 min ago > 2 intervals (30 min) — a cycle was missed.
    expect(isSyncStale(nowMs - 40 * 60 * 1000, nowMs)).toBe(true)
  })

  it('exposes the 15-minute interval', () => {
    expect(SYNC_INTERVAL_MS).toBe(15 * 60 * 1000)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix C:/Users/Chandler/.claude/projects/atkinson-sales-os-phase1 -- src/lib/calendarRail.test.js`
Expected: FAIL — `Failed to resolve import "./calendarRail"` / functions not defined.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/calendarRail.js`:

```js
// Pure helpers for the Overview calendar rail (today-only agenda).
// No React, no I/O. Events are stored as UTC ISO; day math is browser-local,
// matching src/lib/calendar.js. Reuses dayKey so "today" means the same thing
// here as on the full Calendar page.
import { dayKey } from './calendar'

// Matches the outlook-sync pg_cron cadence (migration 0008: every 15 min).
export const SYNC_INTERVAL_MS = 15 * 60 * 1000

// Today's events only, all-day first, then ascending by start time.
// Rows without starts_at are dropped. Input is not mutated.
export function todayEvents(rows, now = Date.now()) {
  const today = dayKey(new Date(now).toISOString())
  return [...rows]
    .filter((e) => e.starts_at && dayKey(e.starts_at) === today)
    .sort((a, b) => {
      if (!!a.is_all_day !== !!b.is_all_day) return a.is_all_day ? -1 : 1
      return new Date(a.starts_at) - new Date(b.starts_at)
    })
}

// Stale when the newest successful outlook sync is more than one full interval
// past due (a cycle was missed). latestRanAtMs is null when no ok sync exists.
export function isSyncStale(latestRanAtMs, now = Date.now()) {
  if (!latestRanAtMs) return true
  return now - latestRanAtMs > 2 * SYNC_INTERVAL_MS
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --prefix C:/Users/Chandler/.claude/projects/atkinson-sales-os-phase1 -- src/lib/calendarRail.test.js`
Expected: PASS — 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/calendarRail.js src/lib/calendarRail.test.js
git commit -m "feat: add pure calendar-rail helpers (todayEvents, isSyncStale)"
```

---

## Task 2: CalendarRail component

No unit test — the repo tests pure logic only (no React Testing Library / jsdom is installed). The component is verified live in Task 4. Keep all branching logic thin and delegated to Task 1's helpers.

**Files:**
- Create: `src/components/CalendarRail.jsx`

- [ ] **Step 1: Write the component**

Create `src/components/CalendarRail.jsx`:

```jsx
import { useEffect, useMemo, useState } from 'react'
import { supabase, isDemoMode } from '../lib/supabase'
import { useBusiness } from '../context/BusinessContext'
import { sourceToBiz, timeLabel } from '../lib/calendar'
import { todayEvents, isSyncStale } from '../lib/calendarRail'

const DAY = 86_400_000
const OUTLOOK_SOURCES = ['outlook-mpg', 'outlook-bayway']

function startOfTodayMs() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// Demo rows so the widget renders in demo mode (isDemoMode) without Supabase.
const demoRows = [
  { id: 'c1', source_account: 'outlook-mpg', title: 'Quarterly planning', starts_at: new Date(startOfTodayMs()).toISOString(), location: null, is_all_day: true },
  { id: 'c2', source_account: 'outlook-mpg', title: 'Merchant demo — Craft Pita', starts_at: new Date(startOfTodayMs() + 10.5 * 3600000).toISOString(), location: 'Zoom', is_all_day: false },
  { id: 'c3', source_account: 'outlook-bayway', title: 'Closing — Ramirez', starts_at: new Date(startOfTodayMs() + 15 * 3600000).toISOString(), location: 'Title Co.', is_all_day: false },
]

export default function CalendarRail() {
  const { matches } = useBusiness()
  const [rows, setRows] = useState([])
  const [lastSync, setLastSync] = useState(null)
  const [loading, setLoading] = useState(!isDemoMode)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (isDemoMode) return
    let alive = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const startMs = startOfTodayMs()
        const [evRes, syncRes] = await Promise.all([
          supabase
            .from('calendar_events')
            .select('id, source_account, title, starts_at, ends_at, location, is_all_day')
            .gte('starts_at', new Date(startMs).toISOString())
            .lt('starts_at', new Date(startMs + DAY).toISOString())
            .order('starts_at', { ascending: true }),
          supabase
            .from('sync_log')
            .select('ran_at, status')
            .in('source', OUTLOOK_SOURCES)
            .eq('status', 'ok')
            .order('ran_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ])
        if (!alive) return
        // A failed sync never deletes rows, so on error we still show whatever
        // calendar_events last held — the widget never goes blank on stale data.
        if (evRes.error) {
          setError(evRes.error.message)
          return
        }
        setRows(evRes.data || [])
        setLastSync(syncRes.data?.ran_at ? new Date(syncRes.data.ran_at).getTime() : null)
      } catch (e) {
        if (alive) setError(String(e?.message || e))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const sourceRows = isDemoMode ? demoRows : rows
  const events = useMemo(
    () => todayEvents(sourceRows).filter((e) => matches(sourceToBiz(e.source_account))),
    [sourceRows, matches],
  )
  const stale = !isDemoMode && !loading && !error && isSyncStale(lastSync)

  return (
    <div className="mt-5 rounded-card border border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line px-4 py-3.5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          Today
          {!loading && !error && (
            <span className="num text-[11px] font-medium text-muted">{events.length}</span>
          )}
        </div>
        {stale && (
          <span
            className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
            style={{ background: 'rgba(232,180,95,.14)', color: 'var(--bay-gold)' }}
            title="Outlook sync is behind — showing the last synced data."
          >
            Stale
          </span>
        )}
      </div>

      {loading && <div className="px-6 py-8 text-center text-sm text-muted">Loading calendar…</div>}

      {error && (
        <div className="px-4 py-3 text-xs text-red-300">{error}</div>
      )}

      {!loading && !error && events.length === 0 && (
        <div className="px-6 py-8 text-center text-sm text-muted">No events today</div>
      )}

      {!loading && !error && events.length > 0 && (
        <div>
          {events.map((e) => {
            const evBiz = sourceToBiz(e.source_account)
            const dot = evBiz === 'mpg' ? 'var(--mpg)' : 'var(--bay)'
            return (
              <div
                key={e.id}
                className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0"
              >
                <span className="h-2 w-2 flex-none rounded-full" style={{ background: dot }} />
                <div className="w-20 flex-none text-[12px] text-muted">{timeLabel(e)}</div>
                <div className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                  {e.title || '(no title)'}
                </div>
                {e.location && (
                  <div className="w-40 flex-none truncate text-right text-[11.5px] text-dim">
                    {e.location}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify it compiles (lint/build clean)**

Run: `npm run build --prefix C:/Users/Chandler/.claude/projects/atkinson-sales-os-phase1`
Expected: build succeeds, no unresolved imports.

- [ ] **Step 3: Commit**

```bash
git add src/components/CalendarRail.jsx
git commit -m "feat: add CalendarRail today-only widget component"
```

---

## Task 3: Wire CalendarRail into the Overview

`src/pages/Overview.jsx` dispatches to four views (`AllOverview`, `BayOverview`, `MpgOverview`, `DemoOverview`). Render the rail directly below the `Needs Attention` / workbench card in each, so it appears under every business filter.

**Files:**
- Modify: `src/pages/Overview.jsx`

- [ ] **Step 1: Add the import**

At the top of `src/pages/Overview.jsx`, below the existing `import BizBadge from '../components/BizBadge'` line, add:

```jsx
import CalendarRail from '../components/CalendarRail'
```

- [ ] **Step 2: Render in `AllOverview`**

In `AllOverview`'s returned JSX, immediately after the `<AttentionCard ... />` block (the one with `dotClass="grad-dual"`), add:

```jsx
          <CalendarRail />
```

- [ ] **Step 3: Render in `BayOverview`**

In `BayOverview`, immediately after its `<AttentionCard ... empty="No HOT-tagged contacts — tag a lead HOT in FollowUpBoss." />`, add:

```jsx
          <CalendarRail />
```

- [ ] **Step 4: Render in `MpgOverview`**

In `MpgOverview`, immediately after its `<AttentionCard ... empty="No open MPG leads — set a lead to Open in Zoho CRM." />`, add:

```jsx
          <CalendarRail />
```

- [ ] **Step 5: Render in `DemoOverview`**

In `DemoOverview`, add `<CalendarRail />` as the last child inside the outer `<div>`, immediately after the closing `</div>` of the Active Workbench card:

```jsx
      <CalendarRail />
```

- [ ] **Step 6: Verify build**

Run: `npm run build --prefix C:/Users/Chandler/.claude/projects/atkinson-sales-os-phase1`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/pages/Overview.jsx
git commit -m "feat: mount CalendarRail on all Overview views"
```

---

## Task 4: Verify live in the browser

No RTL in the repo, so behavior is verified against the running app (dev port 5199). Use the preview/browser tools; do not ask the user to check manually.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev --prefix C:/Users/Chandler/.claude/projects/atkinson-sales-os-phase1` (port 5199), then open the Overview.

- [ ] **Step 2: Demo mode** — confirm the `Today` card renders with 3 demo rows (one "All day" first), blue dot for MPG rows, green for the Bayway row.

- [ ] **Step 3: Business toggle** — switch the All/MPG/Bayway filter. MPG hides the Bayway closing; Bayway hides both MPG rows; All shows all three. Count in the header updates.

- [ ] **Step 4: Empty state** — filter to a business with no events today (or a day with none) and confirm "No events today".

- [ ] **Step 5: Live mode (if secrets set)** — with real ICS data, confirm today's real events appear, sorted all-day-first then by time, and that locations render on the right.

- [ ] **Step 6: Stale state** — confirm the "Stale" badge is absent right after a successful sync. (Optional manual check: it appears when the newest `status='ok'` outlook `sync_log` row is >30 min old.)

- [ ] **Step 7: Screenshot** the Overview with the rail for the record, then stop the dev server.

---

## Self-Review (author checklist — completed)

**Spec coverage:**
- Today's events only, sorted, all-day first → `todayEvents` (Task 1) + render (Task 2). ✓
- Business color tag blue/green → `var(--mpg)`/`var(--bay)` dots (Task 2). ✓
- Respects All/MPG/Bayway toggle → `matches(sourceToBiz(...))` (Task 2). ✓
- Empty state "No events today" → Task 2. ✓
- Keeps last synced data on failure; never blank → widget reads `calendar_events` regardless of sync outcome; comment in Task 2. ✓
- Stale indicator past one interval → `isSyncStale` + badge (Tasks 1–2). ✓
- Lives on the Overview → Task 3 (all four views). ✓
- Tap-to-open in Outlook → **intentionally dropped** (decision 2); rows non-clickable. ✓
- Data source / sync / storage → **pre-existing, out of scope** (decisions 1 & 3). ✓
- Graph OAuth / new table / `outlook_url` / `last_synced_at` → **not built** by decision. ✓

**Placeholder scan:** none — all code and commands are concrete.

**Type consistency:** `todayEvents`, `isSyncStale`, `SYNC_INTERVAL_MS` names match across `calendarRail.js`, its test, and the component. Event shape (`source_account`, `starts_at`, `is_all_day`, `title`, `location`) matches the `calendar_events` schema and the reused `sourceToBiz`/`timeLabel` helpers.
