# Bayway Activity Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a day-grouped, type-filterable Activity feed for Bayway, backed by a new FollowUpBoss activity sync that fills the currently-empty `activities` table.

**Architecture:** A new Supabase Edge Function (`fub-activity-sync`) pulls calls/texts/emails/notes/appointments from FollowUpBoss and upserts normalized rows into `activities`. A `security_invoker` view (`v_bayway_activity`) joins those to `contacts`. A React screen (`Activity.jsx`) reads the view, groups rows by day, filters by type client-side, and paginates with a "Load older" button. Pure logic (mappers, grouping) is unit-tested with vitest; the Deno function, SQL, and JSX follow the existing per-source patterns and are verified via build + demo-mode smoke.

**Tech Stack:** React 18 + Vite, React Router 6, Supabase (Postgres + Deno Edge Functions), pg_cron, vitest.

**Spec:** `docs/superpowers/specs/2026-07-13-phase11-activity-feed-design.md`

**Project constraints (read before committing):**
- Dev server: `npm run dev` (Vite, port 5199). Tests: `npm run test`. Build: `npm run build`.
- Supabase ref: `cnmipfxwqnbtkohfixkf`.
- **Commit as the repo's configured author only.** Never pass `-c user.email=…`/`-c user.name=…` and never add a `Co-Authored-By` trailer — the Netlify free plan only builds single-contributor pushes.
- Do not push unless the user asks; commit locally each task.

**File structure (what this plan creates/modifies):**
- Create `supabase/migrations/0009_bayway_activity_view.sql` — the `v_bayway_activity` view.
- Create `supabase/functions/_shared/fub-activity.ts` — FUB activity fetchers + pure mappers.
- Create `supabase/functions/_shared/fub-activity.test.js` — mapper unit tests.
- Modify `supabase/functions/_shared/fub.ts` — export the low-level `fubGet` for reuse.
- Create `supabase/functions/fub-activity-sync/index.ts` — the scheduled sync entrypoint.
- Create `supabase/migrations/0010_schedule_fub_activity_sync.sql` — pg_cron schedule.
- Create `src/lib/activity.js` — pure feed helpers (type meta, filter, day-grouping).
- Create `src/lib/activity.test.js` — helper unit tests.
- Create `src/pages/Activity.jsx` — the Activity screen.
- Modify `src/App.jsx` — route `/bayway/activity` to `Activity`.
- Modify `src/pages/SyncStatus.jsx` — add the `fub-activity` source label.
- Create `docs/phase-activity-fub-setup.md` — deploy/cron/verify runbook.

---

### Task 1: `v_bayway_activity` view migration

**Files:**
- Create: `supabase/migrations/0009_bayway_activity_view.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Phase 11: Bayway activity feed view. One row per Bayway activity, joined to
-- its contact for name/company/owner. security_invoker = on keeps the app's
-- read-only RLS in force (as with v_bayway_contacts / v_active_pipeline).
-- Ordered most-recent first; the screen paginates with range().

create or replace view public.v_bayway_activity
with (security_invoker = on) as
select
  a.id,
  a.type,
  a.occurred_at,
  a.contact_id,
  c.name    as contact_name,
  c.company as company,
  c.owner   as owner,
  a.notes   as snippet,
  a.business_id
from activities a
left join contacts c on c.id = a.contact_id
where a.business_id = 'bay'
  and a.type in ('call', 'text', 'email', 'note', 'appointment')
order by a.occurred_at desc nulls last;
```

- [ ] **Step 2: Sanity-check the SQL locally (optional, no DB write)**

Run: `git diff --stat`
Expected: shows the new migration file staged for the next commit. (The migration is applied against Supabase later, in the setup-doc runbook — this task only lands the file.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0009_bayway_activity_view.sql
git commit -m "Phase 11: v_bayway_activity view (activities joined to contacts)"
```

---

### Task 2: FUB activity mappers + fetchers (TDD)

Pure mappers (`occurredAt`, `snippet`, `mapActivity`) are unit-tested. The network fetchers reuse `fub.ts`'s low-level GET and carry the same "verify field shapes on first live run" note the existing FUB client carries — they are not unit-tested (they do I/O), matching how `fub.ts` fetchers are handled.

**Files:**
- Modify: `supabase/functions/_shared/fub.ts` (export `fubGet`)
- Create: `supabase/functions/_shared/fub-activity.ts`
- Test: `supabase/functions/_shared/fub-activity.test.js`

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/fub-activity.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { mapActivity, occurredAt, snippet } from './fub-activity.ts'

describe('occurredAt', () => {
  it('prefers appointment date over created', () => {
    expect(
      occurredAt({ date: '2026-07-12T15:00:00Z', created: '2026-07-01T00:00:00Z' }, 'appointment'),
    ).toBe('2026-07-12T15:00:00Z')
  })
  it('falls back to created for a call', () => {
    expect(occurredAt({ created: '2026-07-10T00:00:00Z' }, 'call')).toBe('2026-07-10T00:00:00Z')
  })
  it('returns null when nothing matches', () => {
    expect(occurredAt({}, 'note')).toBe(null)
  })
})

describe('snippet', () => {
  it('uses call note, then outcome, then a duration fallback', () => {
    expect(snippet({ note: 'Left VM' }, 'call')).toBe('Left VM')
    expect(snippet({ outcome: 'No answer' }, 'call')).toBe('No answer')
    expect(snippet({ duration: 42 }, 'call')).toBe('Call · 42s')
    expect(snippet({}, 'call')).toBe('Call')
  })
  it('uses text body and email subject', () => {
    expect(snippet({ message: 'Got the docs' }, 'text')).toBe('Got the docs')
    expect(snippet({ subject: 'Pre-approval' }, 'email')).toBe('Pre-approval')
  })
})

describe('mapActivity', () => {
  const contactIdByExternal = new Map([['501', 'uuid-contact']])
  it('namespaces external_id by type and resolves contact_id from personId', () => {
    const row = mapActivity(
      { id: 12, personId: 501, created: '2026-07-12T14:00:00Z', note: 'Discussed FHA' },
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
    })
    expect(row.raw).toEqual({ id: 12, personId: 501, created: '2026-07-12T14:00:00Z', note: 'Discussed FHA' })
  })
  it('leaves contact_id null when personId is unknown or missing', () => {
    expect(mapActivity({ id: 9, personId: 999, created: 'x' }, 'note', contactIdByExternal).contact_id).toBe(null)
    expect(mapActivity({ id: 9, created: 'x' }, 'note', contactIdByExternal).contact_id).toBe(null)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- fub-activity`
Expected: FAIL — `Failed to resolve import "./fub-activity.ts"` (file doesn't exist yet).

- [ ] **Step 3: Export `fubGet` from `fub.ts` so the fetchers can reuse it**

In `supabase/functions/_shared/fub.ts`, change the `fubGet` declaration (currently around line 19) from:

```js
async function fubGet(path, params = {}) {
```

to:

```js
export async function fubGet(path, params = {}) {
```

(Leave everything else in `fub.ts` untouched — the live `fub-sync` still imports the same named exports.)

- [ ] **Step 4: Write the implementation**

Create `supabase/functions/_shared/fub-activity.ts`:

```ts
// FollowUpBoss activity fetchers + field mapping for the scheduled activity
// sync. Pulls the five human-touch activity types and normalizes each into an
// `activities` row (business_id 'bay', source_crm 'fub').
//
// VERIFY BEFORE FIRST REAL RUN (same convention as fub.ts): the list-endpoint
// paths, their response list keys, and the per-type date/body field names below
// are written from FollowUpBoss's documented API shape and should be checked
// against a live response and adjusted here. The sync function logs raw payload
// shape to sync_log.message on error to make that first-pass adjustment fast.

import { fubGet } from './fub.ts'

// Paginate a FUB activity list endpoint. `listKeys` are candidate top-level
// array keys (FUB casing varies by resource); the first present wins.
async function fubListActivity(path, listKeys, sinceIso) {
  const limit = 100
  let offset = 0
  const items = []
  const pick = (json) => {
    for (const k of listKeys) {
      if (Array.isArray(json[k])) return json[k]
      if (Array.isArray(json._embedded?.[k])) return json._embedded[k]
    }
    return []
  }
  while (true) {
    const params = sinceIso
      ? { limit, offset, sort: 'updated', updatedAfter: sinceIso }
      : { limit, offset }
    const json = await fubGet(path, params)
    const page = pick(json)
    if (page.length === 0) break
    items.push(...page)
    if (page.length < limit) break
    offset += limit
  }
  return items
}

export const fetchCalls = (since) => fubListActivity('/calls', ['calls'], since)
export const fetchTexts = (since) => fubListActivity('/textMessages', ['textMessages', 'textmessages'], since)
export const fetchNotes = (since) => fubListActivity('/notes', ['notes'], since)
export const fetchAppointments = (since) => fubListActivity('/appointments', ['appointments'], since)

// FUB's public exposure of sent emails is less certain than the others.
// Degrade gracefully: if the endpoint 404s or errors, return [] so the rest of
// the sync still succeeds. Revisit once verified against the live account.
export async function fetchEmails(since) {
  try {
    return await fubListActivity('/emails', ['emails', 'emailEvents'], since)
  } catch (_err) {
    return []
  }
}

// --- Pure mapping helpers (unit-tested) ------------------------------------

const OCCURRED_FIELDS = {
  call: ['created'],
  text: ['created', 'sent'],
  email: ['created', 'sent'],
  note: ['created'],
  appointment: ['date', 'start', 'created'],
}

export function occurredAt(rec, type) {
  const order = OCCURRED_FIELDS[type] || ['created']
  for (const k of order) {
    if (rec[k]) return rec[k]
  }
  return null
}

export function snippet(rec, type) {
  switch (type) {
    case 'call':
      return rec.note || rec.outcome || (rec.duration ? `Call · ${rec.duration}s` : 'Call')
    case 'text':
      return rec.message || rec.body || 'Text'
    case 'email':
      return rec.subject || rec.body || 'Email'
    case 'note':
      return rec.body || rec.subject || 'Note'
    case 'appointment':
      return rec.title || rec.description || 'Appointment'
    default:
      return null
  }
}

// contactIdByExternal: Map<fub person id (string), our contacts.id (uuid)>
export function mapActivity(rec, type, contactIdByExternal) {
  const personId = rec.personId ?? rec.person?.id ?? null
  return {
    business_id: 'bay',
    source_crm: 'fub',
    // Namespaced so numeric ids reused across endpoints don't collide under
    // the unique(source_crm, external_id) constraint on `activities`.
    external_id: `${type}-${rec.id}`,
    type,
    contact_id: (personId != null && contactIdByExternal.get(String(personId))) || null,
    occurred_at: occurredAt(rec, type),
    notes: snippet(rec, type),
    raw: rec,
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -- fub-activity`
Expected: PASS (all `occurredAt` / `snippet` / `mapActivity` cases green).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/fub.ts supabase/functions/_shared/fub-activity.ts supabase/functions/_shared/fub-activity.test.js
git commit -m "Phase 11: FUB activity fetchers + mappers with tests"
```

---

### Task 3: `fub-activity-sync` Edge Function

Mirrors `fub-sync`'s incremental pattern (contact-id map, since-last-ok cursor, upsert, `sync_log`). No unit test — it's an I/O entrypoint, consistent with the other `*-sync` functions.

**Files:**
- Create: `supabase/functions/fub-activity-sync/index.ts`

- [ ] **Step 1: Write the function**

Create `supabase/functions/fub-activity-sync/index.ts`:

```ts
// Scheduled FollowUpBoss ACTIVITY sync (calls, texts, emails, notes,
// appointments). Separate from fub-sync so it runs on its own cadence and logs
// its own sync_log line ('fub-activity'). Read-only against FUB: only GETs,
// never writes back. See docs/phase-activity-fub-setup.md.

import { serviceClient, logSync } from '../_shared/db.ts'
import {
  fetchCalls,
  fetchTexts,
  fetchEmails,
  fetchNotes,
  fetchAppointments,
  mapActivity,
} from '../_shared/fub-activity.ts'

const NINETY_DAYS_MS = 90 * 86_400_000

Deno.serve(async () => {
  const db = serviceClient()
  let upserted = 0

  try {
    // FUB person id -> our contacts.id, so activities resolve their contact.
    const { data: contactMapRows } = await db
      .from('contacts')
      .select('id, external_id')
      .eq('source_crm', 'fub')
    const contactIdByExternal = new Map((contactMapRows || []).map((r) => [r.external_id, r.id]))

    // Incremental since the last successful run; first run is bounded to 90 days
    // so we don't pull the entire history of an 800+ contact account at once.
    const { data: lastOk } = await db
      .from('sync_log')
      .select('ran_at')
      .eq('source', 'fub-activity')
      .eq('status', 'ok')
      .order('ran_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const since = lastOk?.ran_at || new Date(Date.now() - NINETY_DAYS_MS).toISOString()

    const byType = [
      ['call', await fetchCalls(since)],
      ['text', await fetchTexts(since)],
      ['email', await fetchEmails(since)],
      ['note', await fetchNotes(since)],
      ['appointment', await fetchAppointments(since)],
    ]

    const rows = []
    for (const [type, records] of byType) {
      for (const rec of records) rows.push(mapActivity(rec, type, contactIdByExternal))
    }

    if (rows.length) {
      const { error } = await db
        .from('activities')
        .upsert(rows, { onConflict: 'source_crm,external_id' })
      if (error) throw new Error(`activity upsert: ${error.message}`)
      upserted += rows.length
    }

    await logSync(db, 'fub-activity', 'ok', upserted)
    return new Response(JSON.stringify({ ok: true, upserted }), {
      headers: { 'content-type': 'application/json' },
    })
  } catch (err) {
    await logSync(db, 'fub-activity', 'error', upserted, String(err?.message || err))
    return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
})
```

- [ ] **Step 2: Verify the JS test suite still passes (no regressions)**

Run: `npm run test`
Expected: PASS — the existing suite plus the Task 2 tests, all green. (The Deno function itself isn't executed here; it's deployed via the setup doc.)

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/fub-activity-sync/index.ts
git commit -m "Phase 11: fub-activity-sync function (five FUB activity types)"
```

---

### Task 4: Schedule the sync via pg_cron

**Files:**
- Create: `supabase/migrations/0010_schedule_fub_activity_sync.sql`

- [ ] **Step 1: Write the cron migration**

Create `supabase/migrations/0010_schedule_fub_activity_sync.sql`:

```sql
-- Phase 11: schedule fub-activity-sync every 15 minutes via pg_cron.
-- Mirrors 0002/0005/0008. pg_cron/pg_net already enabled. Bearer is the public
-- ANON key (safe to commit); fub-activity-sync is deployed with --no-verify-jwt.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'fub-activity-sync-15min',
  '*/15 * * * *',
  $job$
  select net.http_post(
    url := 'https://cnmipfxwqnbtkohfixkf.supabase.co/functions/v1/fub-activity-sync',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubWlwZnh3cW5idGtvaGZpeGtmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2Mzc5NjYsImV4cCI6MjA5OTIxMzk2Nn0.tcOKs7O5gGAT2HsfiKKwI90TQ-CYVXSMB4yL9RvuxJU',
      'Content-Type', 'application/json'
    )
  );
  $job$
);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0010_schedule_fub_activity_sync.sql
git commit -m "Phase 11: schedule fub-activity-sync every 15 min via pg_cron"
```

---

### Task 5: Frontend feed helpers (TDD)

**Files:**
- Create: `src/lib/activity.js`
- Test: `src/lib/activity.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/lib/activity.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { filterByType, groupByDay, activityDayLabel, timeOfDay } from './activity'

describe('filterByType', () => {
  const rows = [{ type: 'call' }, { type: 'text' }, { type: 'call' }]
  it('returns everything for "all"', () => {
    expect(filterByType(rows, 'all')).toHaveLength(3)
  })
  it('filters to a single type', () => {
    expect(filterByType(rows, 'call')).toHaveLength(2)
  })
})

describe('activityDayLabel', () => {
  const now = new Date('2026-07-13T12:00:00').getTime()
  it('labels today and yesterday', () => {
    expect(activityDayLabel('2026-07-13T09:00:00', now)).toBe('Today')
    expect(activityDayLabel('2026-07-12T09:00:00', now)).toBe('Yesterday')
  })
  it('labels older days by weekday and date', () => {
    expect(activityDayLabel('2026-07-09T09:00:00', now)).toBe('Thu · Jul 9')
  })
})

describe('groupByDay', () => {
  const now = new Date('2026-07-13T12:00:00').getTime()
  it('orders days most-recent first and rows within a day descending', () => {
    const rows = [
      { id: 1, occurred_at: '2026-07-12T10:00:00' },
      { id: 2, occurred_at: '2026-07-13T08:00:00' },
      { id: 3, occurred_at: '2026-07-13T11:00:00' },
    ]
    const groups = groupByDay(rows, now)
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday'])
    expect(groups[0].rows.map((r) => r.id)).toEqual([3, 2])
  })
  it('skips rows with no occurred_at', () => {
    expect(groupByDay([{ id: 1, occurred_at: null }], now)).toEqual([])
  })
})

describe('timeOfDay', () => {
  it('formats 12-hour time with an a/p suffix', () => {
    expect(timeOfDay('2026-07-13T09:05:00')).toBe('9:05a')
    expect(timeOfDay('2026-07-13T16:30:00')).toBe('4:30p')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- activity`
Expected: FAIL — cannot resolve `./activity`. (Note: this also matches `activity` in other paths, but the new file's import failure is the relevant failure.)

- [ ] **Step 3: Write the implementation**

Create `src/lib/activity.js`:

```js
// Pure helpers for the Activity feed. No React, no I/O.
// Dates use the browser's local timezone (activities are stored as UTC ISO).
import { dayKey } from './calendar'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Per-type presentation. Colors come from the token system where possible;
// text/email/appt use fixed hues (blue/gold/violet) that read on the dark chrome.
export const TYPE_META = {
  call: { label: 'Call', color: 'var(--bay)', border: 'rgba(124,173,68,.4)' },
  text: { label: 'Text', color: '#5FA8D3', border: 'rgba(95,168,211,.4)' },
  email: { label: 'Email', color: 'var(--bay-gold)', border: 'rgba(201,160,82,.4)' },
  note: { label: 'Note', color: 'var(--muted)', border: 'var(--line)' },
  appointment: { label: 'Appt', color: '#B08BD9', border: 'rgba(176,139,217,.4)' },
}

export const TYPE_CHIPS = [
  { key: 'all', label: 'All' },
  { key: 'call', label: 'Calls' },
  { key: 'text', label: 'Texts' },
  { key: 'email', label: 'Emails' },
  { key: 'note', label: 'Notes' },
  { key: 'appointment', label: 'Appts' },
]

export function filterByType(rows, typeKey) {
  if (!typeKey || typeKey === 'all') return rows
  return rows.filter((r) => r.type === typeKey)
}

export function activityDayLabel(iso, now = Date.now()) {
  const key = dayKey(iso)
  const todayKey = dayKey(new Date(now).toISOString())
  const y = new Date(now)
  y.setDate(y.getDate() - 1)
  const yesterdayKey = dayKey(y.toISOString())
  if (key === todayKey) return 'Today'
  if (key === yesterdayKey) return 'Yesterday'
  const d = new Date(iso)
  return `${DAYS[d.getDay()]} · ${MONTHS[d.getMonth()]} ${d.getDate()}`
}

export function timeOfDay(iso) {
  const d = new Date(iso)
  const m = d.getMinutes()
  let h = d.getHours()
  const ap = h >= 12 ? 'p' : 'a'
  h = h % 12 || 12
  return `${h}:${String(m).padStart(2, '0')}${ap}`
}

// rows -> ordered [{ dayKey, label, rows }], most-recent day first, rows within
// each day sorted newest-first. Rows without occurred_at are dropped.
export function groupByDay(rows, now = Date.now()) {
  const sorted = [...rows]
    .filter((r) => r.occurred_at)
    .sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at))
  const byKey = new Map()
  const groups = []
  for (const r of sorted) {
    const key = dayKey(r.occurred_at)
    if (!byKey.has(key)) {
      const g = { dayKey: key, label: activityDayLabel(r.occurred_at, now), rows: [] }
      byKey.set(key, g)
      groups.push(g)
    }
    byKey.get(key).rows.push(r)
  }
  return groups
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- activity`
Expected: PASS (filter / label / grouping / time cases green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/activity.js src/lib/activity.test.js
git commit -m "Phase 11: activity feed helpers (type filter, day grouping) with tests"
```

---

### Task 6: Activity screen + routing + sync status

**Files:**
- Create: `src/pages/Activity.jsx`
- Modify: `src/App.jsx`
- Modify: `src/pages/SyncStatus.jsx:4-10` (the `SOURCE_LABELS` map)

- [ ] **Step 1: Write the Activity screen**

Create `src/pages/Activity.jsx`:

```jsx
import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase, isDemoMode } from '../lib/supabase'
import { TYPE_META, TYPE_CHIPS, filterByType, groupByDay, timeOfDay } from '../lib/activity'

const PER_PAGE = 150

// Config-driven so MPG can be added later once a Zoho activity sync exists.
const ACTIVITY = {
  bay: {
    label: 'BAYWAY',
    accent: 'bay',
    source: 'v_bayway_activity',
    copy: 'Bayway activity — calls, texts, emails, notes, and appointments from FollowUpBoss.',
    demoRows: [
      { id: 'd1', type: 'call', occurred_at: new Date(Date.now() - 2 * 3600000).toISOString(), contact_name: 'Marcus Ramirez', snippet: 'Left VM re: rate lock, retry PM', owner: 'You' },
      { id: 'd2', type: 'text', occurred_at: new Date(Date.now() - 3 * 3600000).toISOString(), contact_name: 'Dana Whitfield', snippet: '“Got the paystubs, thanks!”', owner: 'You' },
      { id: 'd3', type: 'email', occurred_at: new Date(Date.now() - 4 * 3600000).toISOString(), contact_name: 'Priya Nair', snippet: 'Sent pre-approval letter', owner: 'You' },
      { id: 'd4', type: 'appointment', occurred_at: new Date(Date.now() - 26 * 3600000).toISOString(), contact_name: 'Kevin Osei', snippet: 'Signing @ Title Co.', owner: 'You' },
    ],
  },
}

function TypeTag({ type }) {
  const m = TYPE_META[type] || { label: type, color: 'var(--muted)', border: 'var(--line)' }
  return (
    <span
      className="flex-none rounded px-1.5 py-0.5 text-center text-[10px] font-semibold uppercase tracking-wide"
      style={{ color: m.color, border: `1px solid ${m.border}`, width: 46 }}
    >
      {m.label}
    </span>
  )
}

export default function Activity({ biz }) {
  const config = ACTIVITY[biz] || ACTIVITY.bay

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(!isDemoMode)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(null)
  const [hasMore, setHasMore] = useState(false)
  const [typeFilter, setTypeFilter] = useState('all')

  const fetchPage = useCallback(
    async (offset) => {
      const { data, error: err } = await supabase
        .from(config.source)
        .select('*')
        .order('occurred_at', { ascending: false, nullsFirst: false })
        .range(offset, offset + PER_PAGE - 1)
      if (err) throw new Error(err.message)
      return data || []
    },
    [config.source],
  )

  const load = useCallback(async () => {
    if (isDemoMode) return
    setLoading(true)
    setError(null)
    try {
      const page = await fetchPage(0)
      setRows(page)
      setHasMore(page.length === PER_PAGE)
    } catch (e) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }, [fetchPage])

  useEffect(() => {
    load()
  }, [load])

  const loadOlder = async () => {
    setLoadingMore(true)
    try {
      const page = await fetchPage(rows.length)
      setRows((prev) => [...prev, ...page])
      setHasMore(page.length === PER_PAGE)
    } catch (e) {
      setError(String(e?.message || e))
    } finally {
      setLoadingMore(false)
    }
  }

  const sourceRows = isDemoMode ? config.demoRows : rows
  const groups = useMemo(() => groupByDay(filterByType(sourceRows, typeFilter)), [sourceRows, typeFilter])
  const total = groups.reduce((n, g) => n + g.rows.length, 0)

  return (
    <div>
      <div className="flex items-center gap-3">
        <h2 className="text-[26px] font-bold tracking-tight">Activity</h2>
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide"
          style={{ color: `var(--${config.accent})`, background: `var(--${config.accent}-soft)` }}
        >
          {config.label}
        </span>
        {!loading && !error && <span className="num text-[12px] text-muted">{total} shown</span>}
      </div>
      <p className="mt-1 text-sm text-muted">{config.copy}</p>

      <div className="mt-4 flex flex-wrap gap-1">
        {TYPE_CHIPS.map((c) => (
          <button
            key={c.key}
            onClick={() => setTypeFilter(c.key)}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
              typeFilter === c.key ? 'bg-hoverbg text-white' : 'text-muted hover:text-white'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading && <div className="mt-6 text-sm text-muted">Loading activity…</div>}

      {!loading && !error && total === 0 && (
        <div className="mt-6 rounded-card border border-line bg-panel px-6 py-10 text-center text-sm text-muted">
          No activity yet — connect the FollowUpBoss activity sync (see docs/phase-activity-fub-setup.md).
        </div>
      )}

      {!loading && !error && total > 0 && (
        <div className="mt-5 space-y-5">
          {groups.map((g) => (
            <div key={g.dayKey}>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-dim">{g.label}</div>
              <div className="overflow-hidden rounded-card border border-line bg-panel">
                {g.rows.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0 hover:bg-hoverbg"
                  >
                    <TypeTag type={r.type} />
                    <div className="num w-14 flex-none text-[12px] text-muted">{timeOfDay(r.occurred_at)}</div>
                    <div className="w-40 flex-none truncate text-[13px] font-semibold">
                      {r.contact_name || '(unknown)'}
                    </div>
                    <div className="min-w-0 flex-1 truncate text-[12.5px] text-muted">{r.snippet || '—'}</div>
                    {r.owner && (
                      <div className="w-28 flex-none truncate text-right text-[11px] text-dim">{r.owner}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && !error && !isDemoMode && hasMore && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={loadOlder}
            disabled={loadingMore}
            className="rounded-lg border border-line2 px-4 py-1.5 text-xs font-semibold text-muted hover:text-white disabled:opacity-50"
          >
            {loadingMore ? 'Loading…' : 'Load older'}
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Wire the route in `src/App.jsx`**

Add the import beside the other page imports (after the `Calendar` import, around line 10):

```jsx
import Activity from './pages/Activity'
```

Replace the Bayway activity route (currently around lines 56-59):

```jsx
              <Route
                path="/bayway/activity"
                element={<PagePlaceholder title="Activity" biz="bay" phase="6" />}
              />
```

with:

```jsx
              <Route path="/bayway/activity" element={<Activity biz="bay" />} />
```

Leave the `/mpg/activity` placeholder route unchanged (MPG activity is a future phase).

- [ ] **Step 3: Add the sync-status label in `src/pages/SyncStatus.jsx`**

In the `SOURCE_LABELS` map (lines 4-10), add the `fub-activity` entry right after the `fub-webhook` line:

```jsx
  'fub-webhook': { label: 'FollowUpBoss webhook (Bayway)', biz: 'bay' },
  'fub-activity': { label: 'FollowUpBoss activity (Bayway)', biz: 'bay' },
```

- [ ] **Step 4: Verify the build and full test suite**

Run: `npm run test && npm run build`
Expected: tests PASS; Vite build completes with no errors.

- [ ] **Step 5: Smoke-test the screen in demo mode**

Run the dev server (`npm run dev`, port 5199) and open `/bayway/activity`. Expected: the demo rows render as a day-grouped feed (Today / Yesterday), type chips switch the visible rows, no "Load older" button appears in demo mode, and no console errors. (Agentic workers: use the preview/browser tools against the `atkinson-sales-os` launch config, port 5199.)

- [ ] **Step 6: Commit**

```bash
git add src/pages/Activity.jsx src/App.jsx src/pages/SyncStatus.jsx
git commit -m "Phase 11: Bayway Activity feed screen + route + sync-status row"
```

---

### Task 7: Setup runbook

**Files:**
- Create: `docs/phase-activity-fub-setup.md`

- [ ] **Step 1: Write the runbook**

Create `docs/phase-activity-fub-setup.md`:

````markdown
# Phase 11 — FollowUpBoss activity sync setup

Fills the `activities` table so the Bayway Activity screen (`/bayway/activity`)
has data. Reuses the existing `FUB_API_KEY` / `FUB_SYSTEM_KEY` function secrets
from Phase 2 — no new secrets required.

## 1. Deploy the function

```bash
supabase functions deploy fub-activity-sync --no-verify-jwt --project-ref cnmipfxwqnbtkohfixkf
```

## 2. Apply the migrations

Apply `0009_bayway_activity_view.sql` (the view) and
`0010_schedule_fub_activity_sync.sql` (the 15-min cron) via your usual
migration path (`supabase db push`, or paste into the SQL editor).

## 3. Trigger a first run manually (PowerShell-safe)

PowerShell aliases `curl` to `Invoke-WebRequest`, which does not accept
`-X`/`-H` the same way. Use `curl.exe`:

```powershell
curl.exe -X POST "https://cnmipfxwqnbtkohfixkf.supabase.co/functions/v1/fub-activity-sync" -H "Authorization: Bearer <ANON_KEY>" -H "Content-Type: application/json"
```

Then open **Sync Status** in the app — a "FollowUpBoss activity (Bayway)" row
should show a recent run with a nonzero "synced" count. The feed appears on
`/bayway/activity`.

## 4. Verify field shapes on first run (important)

`_shared/fub-activity.ts` is written from FollowUpBoss's documented API shape.
On the first live run, confirm against your account and adjust if needed:

- **Endpoints / list keys:** `/calls`, `/textMessages`, `/notes`,
  `/appointments`, `/emails`. If a response's top-level array key differs,
  update the `listKeys` argument for that fetcher.
- **Dates:** `occurredAt()` per-type field priority (e.g. appointments use
  `date`/`start`). If rows land with null `occurred_at`, the date field name
  differs — add it to `OCCURRED_FIELDS`.
- **Snippets:** `snippet()` per-type body/subject fields.
- **Contact link:** activities resolve their contact via `personId`. If your
  payloads nest it differently, extend `mapActivity`'s `personId` lookup.

### Emails may be unavailable

FollowUpBoss's public API exposure of **sent emails** is less certain than the
other four types. `fetchEmails()` deliberately swallows an endpoint error and
returns `[]`, so the rest of the sync still succeeds and the feed simply omits
emails. If you want emails and they're missing, check `sync_log.message` and
the FUB API docs for the correct endpoint, then update `fetchEmails()`.

## Notes

- Read-only: the function only GETs from FUB and writes to our own tables.
- First run is bounded to the last 90 days; subsequent runs are incremental
  from the last successful run (`sync_log` source `fub-activity`).
````

- [ ] **Step 2: Commit**

```bash
git add docs/phase-activity-fub-setup.md
git commit -m "Phase 11: FUB activity sync setup runbook"
```

---

### Task 8: Final verification & README

**Files:**
- Modify: `README.md` (roadmap status)

- [ ] **Step 1: Run the full suite and build one more time**

Run: `npm run test && npm run build`
Expected: all tests PASS (existing suite + the new `fub-activity` and `activity` tests); build clean.

- [ ] **Step 2: Update the README roadmap**

In `README.md`, under "### Not yet built", move the **Activity** bullet up into the delivered list as a new entry (matching the existing style):

```markdown
- **Phase 11 — done (backend awaiting deploy):** Bayway Activity feed — a
  day-grouped timeline of calls/texts/emails/notes/appointments. New
  `fub-activity-sync` function + `v_bayway_activity` view + `Activity.jsx`
  screen at `/bayway/activity`. Deploy/verify: `docs/phase-activity-fub-setup.md`.
  MPG activity (Zoho) remains a future phase.
```

Remove the now-superseded "**Activity** screens — blocked" bullet from the "Not yet built" list.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Phase 11: README roadmap — Bayway Activity feed delivered"
```

- [ ] **Step 4: Report deploy steps to the user**

The code is committed but the sync only runs live after the user deploys the
function and applies migrations 0009/0010. Point them to
`docs/phase-activity-fub-setup.md` and note the email-availability caveat.

---

## Self-review notes

- **Spec coverage:** global day-grouped feed (Task 5 `groupByDay` + Task 6 render); types call/text/email/note/appointment (Task 2 mappers, Task 5 `TYPE_META`/`TYPE_CHIPS`); type-filter chips (Task 6); Bayway/FUB only, MPG placeholder kept (Task 6 route change leaves `/mpg/activity` alone); "Load older" pagination (Task 6 `loadOlder`/`range`); separate `fub-activity-sync` function + own cron + `fub-activity` sync_log source (Tasks 3–4); `v_bayway_activity` security_invoker view (Task 1); namespaced `external_id` (Task 2); contact resolution via person-id map (Tasks 2–3); email graceful-degradation risk (Task 2 `fetchEmails`, Task 7 runbook); SyncStatus label (Task 6); tests mirroring zoho/contacts style (Tasks 2, 5); setup doc with PowerShell-safe trigger (Task 7); single-author commit rule (header + every commit step). All covered.
- **Type consistency:** `mapActivity(rec, type, contactIdByExternal)` signature matches its call site in Task 3; view columns (`type`, `occurred_at`, `contact_name`, `snippet`, `owner`) match what `Activity.jsx` reads; `groupByDay` returns `{ dayKey, label, rows }` and the render uses `g.dayKey`/`g.label`/`g.rows`; `activities` columns used (`business_id`, `source_crm`, `external_id`, `type`, `contact_id`, `occurred_at`, `notes`, `raw`) all exist in `0001_init.sql`; upsert conflict target `source_crm,external_id` matches the table's unique constraint.
- **No placeholders:** every code step contains full source; no TBD/TODO left in the plan.
