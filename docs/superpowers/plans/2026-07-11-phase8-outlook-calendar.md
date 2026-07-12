# Phase 8 — Outlook Calendar Sync + Agenda Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync two published Outlook ICS calendars into `calendar_events` (via an `outlook-sync` Edge Function) and render a merged, day-grouped agenda at `/calendar`, scoped by the business filter.

**Architecture:** Pure row-mapping (`_shared/ics-map.ts`) is split from the ical.js fetch/parse/recurrence-expansion (`_shared/ics.ts`) so the mapping is unit-testable. `outlook-sync/index.ts` runs both feeds, graceful when a URL is unset. `src/lib/calendar.js` holds pure day-grouping/label logic (tested). `src/pages/Calendar.jsx` renders the agenda. Cron via migration `0008`. Read-only.

**Tech Stack:** Supabase Edge Functions (Deno), ical.js (`https://esm.sh/ical.js@1.5.0`, confirmed reachable), React 18 + Vite + Tailwind, vitest, pg_cron.

**Spec:** `docs/superpowers/specs/2026-07-11-phase8-outlook-calendar-design.md`

**Repo:** `C:\Users\Chandler\.claude\projects\atkinson-sales-os-phase1` (Bash `/c/Users/Chandler/.claude/projects/atkinson-sales-os-phase1`). Linked Supabase `cnmipfxwqnbtkohfixkf`. Git author `chandleros-bit <chandler.dashboard@gmail.com>` — never override; push only in the final task.

**Reused (do not modify):** `_shared/db.ts` (`serviceClient()`, `logSync`). `calendar_events` table exists (id, source_account, external_id, title, starts_at, ends_at, location, is_all_day, raw). `SyncStatus.jsx` already defines `outlook-mpg` / `outlook-bayway` rows. `BusinessContext` `useBusiness()` → `{ biz, matches }` (`matches(b)` = biz==='all' || biz===b). `src/lib/overview.js`. Public anon key (cron bearer, safe to commit):
`eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubWlwZnh3cW5idGtvaGZpeGtmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2Mzc5NjYsImV4cCI6MjA5OTIxMzk2Nn0.tcOKs7O5gGAT2HsfiKKwI90TQ-CYVXSMB4yL9RvuxJU`

**Testability note:** `_shared/ics.ts` imports ical.js from an `https://esm.sh` URL, which vitest (Node) can't resolve, so `ics.ts` and the handler are NOT vitest-tested — they're verified on a real ICS feed (like the FUB/Zoho I/O). The pure `mapEvent` (no ical.js import) and all of `calendar.js` ARE unit-tested.

---

### Task 1: `_shared/ics-map.ts` — pure event mapping (TDD)

**Files:**
- Create: `supabase/functions/_shared/ics-map.ts`
- Test: `supabase/functions/_shared/ics-map.test.js`

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/_shared/ics-map.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { mapEvent } from './ics-map.ts'

describe('mapEvent', () => {
  it('maps a single event, external_id = uid', () => {
    expect(
      mapEvent({
        uid: 'abc',
        summary: 'Closing — Ramirez',
        location: '123 Main',
        startIso: '2026-07-15T19:00:00.000Z',
        endIso: '2026-07-15T20:00:00.000Z',
        isAllDay: false,
      }),
    ).toEqual({
      external_id: 'abc',
      title: 'Closing — Ramirez',
      starts_at: '2026-07-15T19:00:00.000Z',
      ends_at: '2026-07-15T20:00:00.000Z',
      location: '123 Main',
      is_all_day: false,
    })
  })
  it('suffixes external_id with the occurrence key for recurring instances', () => {
    const r = mapEvent({
      uid: 'weekly',
      summary: 'Follow-up Block',
      startIso: '2026-07-16T20:00:00.000Z',
      endIso: '2026-07-16T21:00:00.000Z',
      isAllDay: false,
      occurrenceKey: '2026-07-16T20:00:00.000Z',
    })
    expect(r.external_id).toBe('weekly_2026-07-16T20:00:00.000Z')
  })
  it('nulls missing title/location/end and coerces is_all_day', () => {
    const r = mapEvent({ uid: 'x', startIso: '2026-07-20', isAllDay: true })
    expect(r.title).toBe(null)
    expect(r.location).toBe(null)
    expect(r.ends_at).toBe(null)
    expect(r.is_all_day).toBe(true)
  })
})
```

- [ ] **Step 2: Run — verify fail**

Run: `npx vitest run supabase/functions/_shared/ics-map.test.js`
Expected: FAIL — cannot resolve `./ics-map.ts`.

- [ ] **Step 3: Implement `supabase/functions/_shared/ics-map.ts`**

```ts
// Pure mapping: normalized ICS event fields -> a calendar_events row.
// No ical.js import here so it stays unit-testable in vitest.

export function mapEvent({ uid, summary, location, startIso, endIso, isAllDay, occurrenceKey = null }) {
  return {
    external_id: occurrenceKey ? `${uid}_${occurrenceKey}` : String(uid),
    title: summary || null,
    starts_at: startIso,
    ends_at: endIso || null,
    location: location || null,
    is_all_day: !!isAllDay,
  }
}
```

- [ ] **Step 4: Run — verify pass, then full suite**

Run: `npx vitest run supabase/functions/_shared/ics-map.test.js` → PASS.
Run: `npm test` → all pass (new + pre-existing).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ics-map.ts supabase/functions/_shared/ics-map.test.js
git commit -m "Phase 8: pure ICS event mapping with tests"
```

---

### Task 2: `_shared/ics.ts` + `outlook-sync/index.ts`

**Files:**
- Create: `supabase/functions/_shared/ics.ts`
- Create: `supabase/functions/outlook-sync/index.ts`

- [ ] **Step 1: Create `supabase/functions/_shared/ics.ts`**

```ts
// ICS fetch + parse + recurrence expansion using ical.js.
// Not vitest-tested (esm.sh import); verified on a real feed. Read-only.
import ICAL from 'https://esm.sh/ical.js@1.5.0'
import { mapEvent } from './ics-map.ts'

const OCCURRENCE_CAP = 1000 // guard runaway RRULEs

// Fetch an ICS URL and return calendar_events rows whose start is within
// [windowStartMs, windowEndMs). Expands recurring events.
export async function fetchAndExpand(url, windowStartMs, windowEndMs) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`ICS fetch -> ${res.status}`)
  const text = await res.text()
  const comp = new ICAL.Component(ICAL.parse(text))
  const rows = []

  for (const ve of comp.getAllSubcomponents('vevent')) {
    const event = new ICAL.Event(ve)
    const isAllDay = event.startDate.isDate

    if (!event.isRecurring()) {
      const startMs = event.startDate.toJSDate().getTime()
      if (startMs >= windowStartMs && startMs < windowEndMs) {
        rows.push(
          mapEvent({
            uid: event.uid,
            summary: event.summary,
            location: event.location,
            startIso: event.startDate.toJSDate().toISOString(),
            endIso: event.endDate ? event.endDate.toJSDate().toISOString() : null,
            isAllDay,
          }),
        )
      }
      continue
    }

    const iter = event.iterator()
    let next
    let count = 0
    while ((next = iter.next()) && count < OCCURRENCE_CAP) {
      count++
      const startMs = next.toJSDate().getTime()
      if (startMs >= windowEndMs) break
      if (startMs < windowStartMs) continue
      const det = event.getOccurrenceDetails(next)
      rows.push(
        mapEvent({
          uid: event.uid,
          summary: event.summary,
          location: event.location,
          startIso: det.startDate.toJSDate().toISOString(),
          endIso: det.endDate ? det.endDate.toJSDate().toISOString() : null,
          isAllDay,
          occurrenceKey: det.startDate.toJSDate().toISOString(),
        }),
      )
    }
  }
  return rows
}
```

- [ ] **Step 2: Create `supabase/functions/outlook-sync/index.ts`**

```ts
// Scheduled Outlook calendar sync via published ICS feeds.
// Triggered every 15 min by pg_cron (see docs/phase8-outlook-setup.md).
// Read-only: fetches ICS, writes to calendar_events. Never writes to Outlook.
import { serviceClient, logSync } from '../_shared/db.ts'
import { fetchAndExpand } from '../_shared/ics.ts'

const FEEDS = [
  { source: 'outlook-mpg', envVar: 'OUTLOOK_MPG_ICS_URL' },
  { source: 'outlook-bayway', envVar: 'OUTLOOK_BAYWAY_ICS_URL' },
]

const DAY = 86_400_000

Deno.serve(async () => {
  const db = serviceClient()
  const now = Date.now()
  const windowStart = now
  const windowEnd = now + 60 * DAY
  const result = {}

  for (const feed of FEEDS) {
    try {
      const url = Deno.env.get(feed.envVar)
      if (!url) throw new Error(`${feed.envVar} not set as a function secret`)
      const rows = (await fetchAndExpand(url, windowStart, windowEnd)).map((r) => ({
        ...r,
        source_account: feed.source,
      }))
      if (rows.length) {
        const { error } = await db
          .from('calendar_events')
          .upsert(rows, { onConflict: 'source_account,external_id' })
        if (error) throw new Error(`upsert: ${error.message}`)
      }
      await logSync(db, feed.source, 'ok', rows.length)
      result[feed.source] = rows.length
    } catch (err) {
      await logSync(db, feed.source, 'error', 0, String(err?.message || err))
      result[feed.source] = `error: ${String(err?.message || err)}`
    }
  }

  return new Response(JSON.stringify({ ok: true, ...result }), {
    headers: { 'content-type': 'application/json' },
  })
})
```

- [ ] **Step 3: Syntax-check both** (esbuild transpile; the esm.sh import and Deno globals resolve at runtime):

```bash
npx esbuild supabase/functions/_shared/ics.ts --loader:.ts=ts --format=esm > /dev/null && echo ICS_OK
npx esbuild supabase/functions/outlook-sync/index.ts --loader:.ts=ts --format=esm > /dev/null && echo HANDLER_OK
```
Expected: `ICS_OK` and `HANDLER_OK`.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/ics.ts supabase/functions/outlook-sync/index.ts
git commit -m "Phase 8: outlook-sync (ICS fetch + recurrence expansion, two feeds)"
```

---

### Task 3: `src/lib/calendar.js` — agenda logic (TDD)

**Files:**
- Create: `src/lib/calendar.js`
- Test: `src/lib/calendar.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/calendar.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { sourceToBiz, dayKey, dayLabel, timeLabel, groupByDay } from './calendar'

// Build local-time ISO strings so tests are deterministic regardless of env TZ.
const local = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).toISOString()

describe('sourceToBiz', () => {
  it('maps outlook sources to businesses', () => {
    expect(sourceToBiz('outlook-mpg')).toBe('mpg')
    expect(sourceToBiz('outlook-bayway')).toBe('bay')
    expect(sourceToBiz('something')).toBe(null)
  })
})

describe('dayKey', () => {
  it('is the local calendar date', () => {
    expect(dayKey(local(2026, 7, 15, 14, 0))).toBe('2026-07-15')
  })
})

describe('dayLabel', () => {
  const now = local(2026, 7, 11, 9, 0)
  it('says Today / Tomorrow / weekday·date', () => {
    expect(dayLabel(local(2026, 7, 11, 15, 0), now)).toBe('Today')
    expect(dayLabel(local(2026, 7, 12, 15, 0), now)).toBe('Tomorrow')
    expect(dayLabel(local(2026, 7, 15, 15, 0), now)).toBe('Wed · Jul 15')
  })
})

describe('timeLabel', () => {
  it('says All day for all-day events', () => {
    expect(timeLabel({ is_all_day: true, starts_at: local(2026, 7, 15) })).toBe('All day')
  })
  it('formats 12-hour time for timed events', () => {
    expect(timeLabel({ is_all_day: false, starts_at: local(2026, 7, 15, 14, 30) })).toBe('2:30 PM')
    expect(timeLabel({ is_all_day: false, starts_at: local(2026, 7, 15, 9, 5) })).toBe('9:05 AM')
  })
})

describe('groupByDay', () => {
  const now = local(2026, 7, 11, 9, 0)
  const evs = [
    { id: 'b', starts_at: local(2026, 7, 12, 10, 0) },
    { id: 'a', starts_at: local(2026, 7, 11, 16, 0) },
    { id: 'c', starts_at: local(2026, 7, 11, 8, 0) },
  ]
  it('groups by day in date order, events time-ordered within a day', () => {
    const g = groupByDay(evs, now)
    expect(g.map((x) => x.label)).toEqual(['Today', 'Tomorrow'])
    expect(g[0].events.map((e) => e.id)).toEqual(['c', 'a'])
    expect(g[1].events.map((e) => e.id)).toEqual(['b'])
  })
  it('does not mutate the input', () => {
    const copy = [...evs]
    groupByDay(evs, now)
    expect(evs).toEqual(copy)
  })
})
```

- [ ] **Step 2: Run — verify fail**

Run: `npx vitest run src/lib/calendar.test.js`
Expected: FAIL — cannot resolve `./calendar`.

- [ ] **Step 3: Implement `src/lib/calendar.js`**

```js
// Pure agenda helpers for the Calendar screen. No React, no I/O.
// Dates use the browser's local timezone (events are stored as UTC ISO).

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function sourceToBiz(source) {
  if (source === 'outlook-mpg') return 'mpg'
  if (source === 'outlook-bayway') return 'bay'
  return null
}

export function dayKey(iso) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function dayLabel(iso, now = Date.now()) {
  const key = dayKey(iso)
  const todayKey = dayKey(new Date(now).toISOString())
  const tmr = new Date(now)
  tmr.setDate(tmr.getDate() + 1)
  const tomorrowKey = dayKey(tmr.toISOString())
  if (key === todayKey) return 'Today'
  if (key === tomorrowKey) return 'Tomorrow'
  const d = new Date(iso)
  return `${DAYS[d.getDay()]} · ${MONTHS[d.getMonth()]} ${d.getDate()}`
}

export function timeLabel(ev) {
  if (ev.is_all_day) return 'All day'
  const d = new Date(ev.starts_at)
  const m = d.getMinutes()
  let h = d.getHours()
  const ap = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${String(m).padStart(2, '0')} ${ap}`
}

// events -> ordered [{ dayKey, label, events }]; events sorted by start.
export function groupByDay(events, now = Date.now()) {
  const sorted = [...events].sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
  const byKey = new Map()
  const groups = []
  for (const ev of sorted) {
    const key = dayKey(ev.starts_at)
    if (!byKey.has(key)) {
      const g = { dayKey: key, label: dayLabel(ev.starts_at, now), events: [] }
      byKey.set(key, g)
      groups.push(g)
    }
    byKey.get(key).events.push(ev)
  }
  return groups
}
```

- [ ] **Step 4: Run — verify pass, then full suite**

Run: `npx vitest run src/lib/calendar.test.js` → PASS.
Run: `npm test` → all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/calendar.js src/lib/calendar.test.js
git commit -m "Phase 8: calendar agenda grouping/label logic with tests"
```

---

### Task 4: `src/pages/Calendar.jsx` + route

**Files:**
- Create: `src/pages/Calendar.jsx`
- Modify: `src/App.jsx` (import + swap the `/calendar` route)

- [ ] **Step 1: Create `src/pages/Calendar.jsx`**

```jsx
import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase, isDemoMode } from '../lib/supabase'
import { useBusiness } from '../context/BusinessContext'
import { sourceToBiz, timeLabel, groupByDay } from '../lib/calendar'

const DAY = 86_400_000

function startOfTodayMs() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

const demoRows = [
  { id: 'd1', source_account: 'outlook-bayway', title: 'Closing — Ramirez', starts_at: new Date(Date.now() + 3 * 3600000).toISOString(), location: 'Title Co.', is_all_day: false },
  { id: 'd2', source_account: 'outlook-mpg', title: 'Merchant demo — Craft Pita', starts_at: new Date(Date.now() + 26 * 3600000).toISOString(), location: null, is_all_day: false },
]

export default function Calendar() {
  const { biz, matches } = useBusiness()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(!isDemoMode)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    if (isDemoMode) return
    setLoading(true)
    setError(null)
    try {
      const startMs = startOfTodayMs()
      const { data, error: err } = await supabase
        .from('calendar_events')
        .select('id, source_account, title, starts_at, ends_at, location, is_all_day')
        .gte('starts_at', new Date(startMs).toISOString())
        .lt('starts_at', new Date(startMs + 30 * DAY).toISOString())
        .order('starts_at', { ascending: true })
      if (err) {
        setError(err.message)
        return
      }
      setRows(data || [])
    } catch (e) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const sourceRows = isDemoMode ? demoRows : rows
  const groups = useMemo(() => {
    const visible = sourceRows.filter((e) => matches(sourceToBiz(e.source_account)))
    return groupByDay(visible)
  }, [sourceRows, matches])

  const total = groups.reduce((n, g) => n + g.events.length, 0)

  return (
    <div>
      <div className="flex items-center gap-3">
        <h2 className="text-[26px] font-bold tracking-tight">Calendar</h2>
        {!loading && !error && <span className="num text-[12px] text-muted">{total} upcoming</span>}
      </div>
      <p className="mt-1 text-sm text-muted">
        {biz === 'mpg'
          ? 'MPG calendar — merchant meetings.'
          : biz === 'bay'
            ? 'Bayway calendar — closings and appointments.'
            : 'Upcoming across both Outlook calendars, colored by source.'}
      </p>

      {error && (
        <div className="mt-4 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading && <div className="mt-6 text-sm text-muted">Loading calendar…</div>}

      {!loading && !error && total === 0 && (
        <div className="mt-6 rounded-card border border-line bg-panel px-6 py-10 text-center text-sm text-muted">
          No upcoming events — connect Outlook (see docs/phase8-outlook-setup.md).
        </div>
      )}

      {!loading && !error && total > 0 && (
        <div className="mt-5 space-y-5">
          {groups.map((g) => (
            <div key={g.dayKey}>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-dim">{g.label}</div>
              <div className="overflow-hidden rounded-card border border-line bg-panel">
                {g.events.map((e) => {
                  const evBiz = sourceToBiz(e.source_account)
                  const dot = evBiz === 'mpg' ? 'var(--mpg)' : 'var(--bay)'
                  return (
                    <div
                      key={e.id}
                      className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0 hover:bg-hoverbg"
                    >
                      <span className="h-2 w-2 flex-none rounded-full" style={{ background: dot }} />
                      <div className="w-20 flex-none text-[12px] text-muted">{timeLabel(e)}</div>
                      <div className="min-w-0 flex-1 truncate text-[13px] font-semibold">{e.title || '(no title)'}</div>
                      {e.location && (
                        <div className="w-40 flex-none truncate text-right text-[11.5px] text-dim">{e.location}</div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Wire the route in `src/App.jsx`** — add after `import Contacts from './pages/Contacts'`:

```jsx
import Calendar from './pages/Calendar'
```

Then replace this exact block:

```jsx
              <Route
                path="/calendar"
                element={
                  <PagePlaceholder title="Calendar" phase="5">
                    Merged view of both Outlook accounts, events colored by source.
                  </PagePlaceholder>
                }
              />
```

with:

```jsx
              <Route path="/calendar" element={<Calendar />} />
```

Leave all other placeholder routes unchanged.

- [ ] **Step 3: Test and build**

Run: `npm test` → all pass.
Run: `npm run build` → exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Calendar.jsx src/App.jsx
git commit -m "Phase 8: merged Calendar agenda screen + route"
```

---

### Task 5: Cron migration `0008` + deploy the function

**Files:**
- Create: `supabase/migrations/0008_schedule_outlook_sync.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Phase 8: schedule the Outlook calendar sync every 15 minutes via pg_cron.
-- Mirrors 0002/0005. pg_cron/pg_net already enabled. Bearer is the public ANON
-- key (safe to commit); outlook-sync is deployed with --no-verify-jwt.
-- Until OUTLOOK_*_ICS_URL secrets are set, each feed logs a "not set" error row
-- per run; expected and visible on the Sync Status screen.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'outlook-sync-15min',
  '*/15 * * * *',
  $job$
  select net.http_post(
    url := 'https://cnmipfxwqnbtkohfixkf.supabase.co/functions/v1/outlook-sync',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubWlwZnh3cW5idGtvaGZpeGtmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2Mzc5NjYsImV4cCI6MjA5OTIxMzk2Nn0.tcOKs7O5gGAT2HsfiKKwI90TQ-CYVXSMB4yL9RvuxJU',
      'Content-Type', 'application/json'
    )
  );
  $job$
);
```

- [ ] **Step 2: Deploy the function**

Run: `supabase functions deploy outlook-sync --no-verify-jwt`
Expected: "Deployed Functions." (Docker warning is harmless.)

- [ ] **Step 3: Push the cron migration**

Run: `yes | supabase db push --linked`
Expected: "Applying migration 0008_schedule_outlook_sync.sql... Finished supabase db push."

- [ ] **Step 4: Trigger once and confirm graceful "not set" for both feeds**

```bash
ANON=$(supabase projects api-keys --project-ref cnmipfxwqnbtkohfixkf | python -c "import sys,json;d=json.load(sys.stdin);print(next(k['api_key'] for k in d['keys'] if k.get('id')=='anon'))")
curl -s -X POST "https://cnmipfxwqnbtkohfixkf.supabase.co/functions/v1/outlook-sync" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json"
echo
SR=$(supabase projects api-keys --project-ref cnmipfxwqnbtkohfixkf | python -c "import sys,json;d=json.load(sys.stdin);print(next(k['api_key'] for k in d['keys'] if k.get('id')=='service_role'))")
curl -s "https://cnmipfxwqnbtkohfixkf.supabase.co/rest/v1/sync_log?select=source,status,message&source=in.(outlook-mpg,outlook-bayway)&order=ran_at.desc&limit=2" -H "apikey: $SR" -H "Authorization: Bearer $SR"
```

Expected: response like `{"ok":true,"outlook-mpg":"error: OUTLOOK_MPG_ICS_URL not set as a function secret","outlook-bayway":"error: OUTLOOK_BAYWAY_ICS_URL not set as a function secret"}`, and two `sync_log` rows (outlook-mpg, outlook-bayway) with `status: error` and that message. This graceful state is the intended result.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0008_schedule_outlook_sync.sql
git commit -m "Phase 8: schedule outlook-sync every 15 min via pg_cron"
```

---

### Task 6: Setup doc `docs/phase8-outlook-setup.md`

**Files:**
- Create: `docs/phase8-outlook-setup.md`

- [ ] **Step 1: Create the file**

```markdown
# Phase 8 — Outlook calendar setup (published ICS feeds)

This connects your two Outlook calendars to the dashboard's Calendar screen using
**published calendar links** (ICS) — no Azure app, no OAuth, no passwords. Read-only:
the app only reads the feeds and never writes to Outlook.

Do this once per Outlook login (MPG and Bayway).

## 1. Publish each calendar and copy its ICS link

For **each** Outlook account:

1. Open **Outlook on the web** (outlook.office.com) signed in to that account.
2. **Settings (gear) → Calendar → Shared calendars**.
3. Under **Publish a calendar**, pick the calendar, set permission to
   **"Can view all details"**, click **Publish**.
4. Copy the **ICS** link (ends in `.ics`).

You'll end up with two links — one from the MPG login, one from the Bayway login.

## 2. Set the two links as function secrets

```bash
supabase secrets set OUTLOOK_MPG_ICS_URL="https://outlook.office365.com/owa/calendar/.../calendar.ics"
supabase secrets set OUTLOOK_BAYWAY_ICS_URL="https://outlook.office365.com/owa/calendar/.../calendar.ics"
```

(Keep these links private — anyone with the link can read that calendar.)

## 3. Trigger a sync and check

The function is deployed and runs every 15 minutes. Trigger one now:

```bash
curl -X POST https://cnmipfxwqnbtkohfixkf.supabase.co/functions/v1/outlook-sync \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

Open **Sync Status**: before the secrets are set, "Outlook — MPG" and "Outlook — Bayway"
show a "not set" error; after, they flip to a synced count. Then open **Calendar** to see
the merged agenda (use the All / MPG / Bayway filter to scope it).

## Notes

- **Refresh lag:** Microsoft updates a published ICS feed on its own schedule (often a few
  hours), so new Outlook events may take a while to appear. That's a limitation of published
  feeds, not the sync.
- **Window:** the sync pulls events for the next ~60 days and expands recurring events.
- **Only one login has calendars?** Set just the one URL; the other feed stays "not set" and
  is harmless.
```

- [ ] **Step 2: Commit**

```bash
git add docs/phase8-outlook-setup.md
git commit -m "Phase 8: Outlook ICS publish + setup guide"
```

---

### Task 7: Final verification and deploy

**Files:** none — verification and push only.

- [ ] **Step 1: Confirm the Calendar screen renders (empty state, no data yet)**

Dev server on 5199 (start `atkinson-sales-os` preview config if needed; sign-in required — ask
Chandler if the login screen shows). Navigate to `http://localhost:5199/calendar`. With no ICS
feeds synced, confirm the empty state: "No upcoming events — connect Outlook…". Switch the
All / MPG / Bayway filter — no errors. Check `read_console_messages` (errors) — none.

- [ ] **Step 2: Confirm Sync Status shows both Outlook rows**

Navigate to `http://localhost:5199/sync`. Confirm "Outlook — MPG" and "Outlook — Bayway" now
show an error state with the "not set" message (from Task 5) rather than "Not connected yet".

- [ ] **Step 3: (If Chandler sets the ICS secrets) confirm real events**

If the two `OUTLOOK_*_ICS_URL` secrets are set: trigger a run, reload `/calendar`, confirm
day-grouped events with source dots, and the business filter scoping. Otherwise skip — the
empty state is the expected shipped state.

- [ ] **Step 4: Screenshot proof**

Screenshot `/calendar` (and/or Sync Status showing the Outlook rows) and share.

- [ ] **Step 5: Push (deploys the frontend via Netlify)**

```bash
cd /c/Users/Chandler/.claude/projects/atkinson-sales-os-phase1
git log origin/main..HEAD --format='%an <%ae>' | sort -u   # only chandleros-bit
git push origin main
```

Expected: push succeeds; Netlify auto-builds.

---

## Out of scope (do not add)

- Microsoft Graph / OAuth; writing to Outlook; event detail/RSVP
- Month/week grid; the connected Google calendar
- Do not modify `Login.jsx`, other Edge Functions, `overview.js`, `pipeline.js`, `contacts.js`, or migrations 0001–0007
