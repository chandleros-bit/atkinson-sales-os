# Phase 3 — Live Overview (Command Center) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder Overview with a live Command Center — alert banner, 4 KPI cards, and a Needs Attention workbench — reading real FollowUpBoss data through a new `v_active_pipeline` database view.

**Architecture:** A Postgres view (`security_invoker = on`) translates FUB import tags and person stages into clean pipeline rows; a pure-JS module (`src/lib/overview.js`) holds all KPI/alert/sort logic (unit-tested with vitest); `Overview.jsx` fetches three queries in parallel and renders. Read-only throughout.

**Tech Stack:** React 18 + Vite 5, Tailwind 3 (existing token classes), @supabase/supabase-js 2, vitest (new devDep), Supabase CLI for the migration.

**Spec:** `docs/superpowers/specs/2026-07-09-phase3-overview-design.md`

**Repo:** `C:\Users\Chandler\.claude\projects\atkinson-sales-os-phase1` (linked Supabase project `cnmipfxwqnbtkohfixkf`; git author must remain `chandleros-bit <chandler.dashboard@gmail.com>` — never override).

**Expected live values (as of 2026-07-09):** view rows 25 · Pre-Approved 15 · Waiting on Docs 10 · New Lead 0 · total contacts 822 · nurture footnote 797.

---

### Task 1: Add vitest

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install vitest**

Run: `npm install -D vitest`
Expected: exits 0, `vitest` appears in `devDependencies`.

- [ ] **Step 2: Add the test script**

In `package.json`, change the `scripts` block to:

```json
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
```

- [ ] **Step 3: Verify the runner works**

Run: `npx vitest run --passWithNoTests`
Expected: exits 0, reports "No test files found".

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "Phase 3: add vitest test runner"
```

---

### Task 2: Pure logic module `src/lib/overview.js` (TDD)

**Files:**
- Create: `src/lib/overview.js`
- Test: `src/lib/overview.test.js`

All Overview business rules live here, free of React and I/O: day math, attention sort, KPI reduction, alert derivation. Thresholds: sync stale after **45 minutes**, touch stale after **7 days** (per spec).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/overview.test.js`:

```js
import { describe, it, expect } from 'vitest'
import {
  daysSince,
  lastTouchLabel,
  sortByAttention,
  buildKpis,
  deriveAlert,
} from './overview'

// Fixed clock: 2026-07-09T12:00:00Z
const NOW = new Date('2026-07-09T12:00:00Z').getTime()
const daysAgo = (n) => new Date(NOW - n * 86_400_000).toISOString()

describe('daysSince', () => {
  it('returns null for missing timestamps', () => {
    expect(daysSince(null, NOW)).toBe(null)
  })
  it('returns whole days elapsed', () => {
    expect(daysSince(daysAgo(3), NOW)).toBe(3)
  })
  it('returns 0 for a touch earlier today', () => {
    expect(daysSince(daysAgo(0.25), NOW)).toBe(0)
  })
})

describe('lastTouchLabel', () => {
  it('shows an em dash when unknown', () => {
    expect(lastTouchLabel(null, NOW)).toBe('—')
  })
  it('shows "today" for touches under a day old', () => {
    expect(lastTouchLabel(daysAgo(0.5), NOW)).toBe('today')
  })
  it('shows day counts otherwise', () => {
    expect(lastTouchLabel(daysAgo(9), NOW)).toBe('9d ago')
  })
})

describe('sortByAttention', () => {
  it('puts unknown touches first, then oldest to newest', () => {
    const rows = [
      { id: 'fresh', last_touch_at: daysAgo(1) },
      { id: 'unknown', last_touch_at: null },
      { id: 'old', last_touch_at: daysAgo(10) },
    ]
    expect(sortByAttention(rows).map((r) => r.id)).toEqual(['unknown', 'old', 'fresh'])
  })
  it('does not mutate the input array', () => {
    const rows = [
      { id: 'a', last_touch_at: daysAgo(1) },
      { id: 'b', last_touch_at: null },
    ]
    sortByAttention(rows)
    expect(rows[0].id).toBe('a')
  })
})

describe('buildKpis', () => {
  const rows = [
    { stage: 'Pre-Approved', last_touch_at: daysAgo(1) },
    { stage: 'Pre-Approved', last_touch_at: daysAgo(2) },
    { stage: 'Waiting on Docs', last_touch_at: daysAgo(3) },
    { stage: 'New Lead', last_touch_at: daysAgo(1) },
  ]
  it('counts active loans (everything except New Lead)', () => {
    expect(buildKpis(rows, 10).activeLoans).toBe(3)
  })
  it('produces top-2 stage cards by count', () => {
    expect(buildKpis(rows, 10).stageCards).toEqual([
      { label: 'Pre-Approved', count: 2 },
      { label: 'Waiting on Docs', count: 1 },
    ])
  })
  it('counts New Lead separately', () => {
    expect(buildKpis(rows, 10).newLeads).toBe(1)
  })
  it('computes nurture as total contacts minus pipeline rows', () => {
    expect(buildKpis(rows, 10).nurture).toBe(6)
  })
  it('never returns negative nurture', () => {
    expect(buildKpis(rows, 2).nurture).toBe(0)
  })
})

describe('deriveAlert', () => {
  const freshRows = [{ stage: 'Pre-Approved', last_touch_at: daysAgo(1) }]
  const okSync = { status: 'ok', ran_at: new Date(NOW - 10 * 60_000).toISOString(), message: null }

  it('is red when FUB has never synced', () => {
    const a = deriveAlert({ latestSync: null, rows: freshRows, now: NOW })
    expect(a.level).toBe('red')
  })
  it('is red when the latest sync errored', () => {
    const a = deriveAlert({
      latestSync: { ...okSync, status: 'error', message: 'FUB GET /people -> 401' },
      rows: freshRows,
      now: NOW,
    })
    expect(a.level).toBe('red')
    expect(a.text).toContain('FUB GET /people -> 401')
  })
  it('is red when the last ok sync is older than 45 minutes', () => {
    const a = deriveAlert({
      latestSync: { ...okSync, ran_at: new Date(NOW - 50 * 60_000).toISOString() },
      rows: freshRows,
      now: NOW,
    })
    expect(a.level).toBe('red')
  })
  it('is amber when loans are stale 7+ days (sync healthy)', () => {
    const a = deriveAlert({
      latestSync: okSync,
      rows: [
        { stage: 'Pre-Approved', last_touch_at: daysAgo(9) },
        { stage: 'Waiting on Docs', last_touch_at: daysAgo(8) },
        { stage: 'Pre-Approved', last_touch_at: daysAgo(1) },
      ],
      now: NOW,
    })
    expect(a.level).toBe('amber')
    expect(a.text).toContain('2 active loans')
  })
  it('ignores null touches for the amber rule', () => {
    const a = deriveAlert({
      latestSync: okSync,
      rows: [{ stage: 'Pre-Approved', last_touch_at: null }],
      now: NOW,
    })
    expect(a).toBe(null)
  })
  it('is null when everything is healthy', () => {
    expect(deriveAlert({ latestSync: okSync, rows: freshRows, now: NOW })).toBe(null)
  })
  it('red takes precedence over amber', () => {
    const a = deriveAlert({
      latestSync: { ...okSync, status: 'error', message: 'boom' },
      rows: [{ stage: 'Pre-Approved', last_touch_at: daysAgo(30) }],
      now: NOW,
    })
    expect(a.level).toBe('red')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/overview.test.js`
Expected: FAIL — cannot resolve `./overview`.

- [ ] **Step 3: Implement `src/lib/overview.js`**

```js
// Pure helpers for the Overview (Command Center) screen.
// No React, no I/O — everything here is unit-testable.
// Spec: docs/superpowers/specs/2026-07-09-phase3-overview-design.md

export const NEW_LEAD = 'New Lead'
export const STALE_TOUCH_DAYS = 7
export const SYNC_STALE_MINUTES = 45

const DAY_MS = 86_400_000

export function daysSince(iso, now = Date.now()) {
  if (!iso) return null
  return Math.floor((now - new Date(iso).getTime()) / DAY_MS)
}

export function lastTouchLabel(iso, now = Date.now()) {
  const d = daysSince(iso, now)
  if (d === null) return '—'
  if (d < 1) return 'today'
  return `${d}d ago`
}

// Unknown touch first (assume it needs attention most), then oldest to newest.
export function sortByAttention(rows) {
  return [...rows].sort((a, b) => {
    if (!a.last_touch_at && !b.last_touch_at) return 0
    if (!a.last_touch_at) return -1
    if (!b.last_touch_at) return 1
    return new Date(a.last_touch_at) - new Date(b.last_touch_at)
  })
}

// rows: v_active_pipeline rows. totalContacts: count of the contacts table.
export function buildKpis(rows, totalContacts) {
  const counts = new Map()
  for (const r of rows) counts.set(r.stage, (counts.get(r.stage) || 0) + 1)
  const stageCards = [...counts.entries()]
    .filter(([stage]) => stage !== NEW_LEAD)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 2)
    .map(([label, count]) => ({ label, count }))
  return {
    activeLoans: rows.filter((r) => r.stage !== NEW_LEAD).length,
    stageCards,
    newLeads: counts.get(NEW_LEAD) || 0,
    nurture: Math.max(0, totalContacts - rows.length),
  }
}

// latestSync: newest sync_log row for source 'fub' (or null if none).
// Returns { level: 'red'|'amber', text } or null. Red wins over amber.
export function deriveAlert({ latestSync, rows, now = Date.now() }) {
  if (!latestSync) {
    return { level: 'red', text: 'FollowUpBoss has never synced — check the Sync Status screen.' }
  }
  if (latestSync.status === 'error') {
    return { level: 'red', text: `FollowUpBoss sync failed: ${latestSync.message || 'unknown error'}` }
  }
  const ageMin = Math.floor((now - new Date(latestSync.ran_at).getTime()) / 60_000)
  if (ageMin > SYNC_STALE_MINUTES) {
    return {
      level: 'red',
      text: `FollowUpBoss last synced ${ageMin} minutes ago — the 15-minute schedule may be stuck.`,
    }
  }
  const stale = rows.filter((r) => {
    const d = daysSince(r.last_touch_at, now)
    return d !== null && d >= STALE_TOUCH_DAYS
  }).length
  if (stale > 0) {
    return {
      level: 'amber',
      text: `${stale} active loan${stale === 1 ? '' : 's'} ${stale === 1 ? 'has' : 'have'} had no touch in ${STALE_TOUCH_DAYS}+ days.`,
    }
  }
  return null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/overview.test.js`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/overview.js src/lib/overview.test.js
git commit -m "Phase 3: overview KPI/alert/sort logic with tests"
```

---

### Task 3: Migration — `v_active_pipeline` view

**Files:**
- Create: `supabase/migrations/0003_active_pipeline_view.sql`

Stage rules (spec): tag `Imported Stage: X` → stage `X` (generic prefix-strip, new tag values flow through); else `person_stage = 'Lead'` → `New Lead`; else excluded. `security_invoker = on` keeps the app's read-only RLS in force.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0003_active_pipeline_view.sql`:

```sql
-- Phase 3: active-pipeline view for the Overview and later pipeline screens.
-- Translates FUB import tags / person stages into a clean stage per contact.
-- security_invoker = on: queries run with the caller's rights, so the app's
-- read-only RLS (authenticated select) applies unchanged.

create or replace view public.v_active_pipeline
with (security_invoker = on) as
select id, business_id, name, email, phone, last_touch_at, stage
from (
  select
    c.id,
    c.business_id,
    c.name,
    c.email,
    c.phone,
    c.last_touch_at,
    coalesce(
      (
        select replace(t.tag, 'Imported Stage: ', '')
        from jsonb_array_elements_text(coalesce(c.raw->'tags', '[]'::jsonb)) as t(tag)
        where t.tag like 'Imported Stage: %'
        limit 1
      ),
      case when c.person_stage = 'Lead' then 'New Lead' end
    ) as stage
  from contacts c
) s
where stage is not null;
```

- [ ] **Step 2: Push to the remote database**

Run (from repo root): `yes | supabase db push --linked`
Expected: "Applying migration 0003_active_pipeline_view.sql... Finished supabase db push."

- [ ] **Step 3: Verify live counts through the view**

The service-role key is fetched at runtime — never write it into any file.

```bash
SR=$(supabase projects api-keys --project-ref cnmipfxwqnbtkohfixkf | python -c "import sys,json;d=json.load(sys.stdin);print(next(k['api_key'] for k in d['keys'] if k.get('id')=='service_role'))")
curl -s "https://cnmipfxwqnbtkohfixkf.supabase.co/rest/v1/v_active_pipeline?select=stage" \
  -H "apikey: $SR" -H "Authorization: Bearer $SR" -H "Range: 0-999" | python -c "
import sys, json
from collections import Counter
rows = json.load(sys.stdin)
print('total:', len(rows))
for s, n in Counter(r['stage'] for r in rows).most_common():
    print(f'{n:4}  {s}')
"
```

Expected output (as of 2026-07-09):

```
total: 25
  15  Pre-Approved
  10  Waiting on Docs
```

(No `New Lead` line — all current Leads carry import tags. If counts drift slightly because FUB data changed since design, that is fine; the shape must match: only imported-tag stages, total = tagged-or-Lead union.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0003_active_pipeline_view.sql
git commit -m "Phase 3: v_active_pipeline view (stage from import tags / person stage)"
```

---

### Task 4: Rewrite `src/pages/Overview.jsx`

**Files:**
- Modify: `src/pages/Overview.jsx` (full replacement below)

Design notes: demo mode keeps the existing Phase 1 placeholder content (moved into a `DemoOverview` component, unchanged rows). MPG filter shows a placeholder panel. Live path fetches three queries in parallel. Stage pills: `Waiting on Docs` renders gold (`--bay-gold`), everything else Bayway green — rows are always Bayway-striped (color from the row's business, never the filter). Errors render the same compact strip pattern as `SyncStatus.jsx`.

- [ ] **Step 1: Replace the file contents**

`src/pages/Overview.jsx` becomes:

```jsx
import { useEffect, useState, useCallback } from 'react'
import { supabase, isDemoMode } from '../lib/supabase'
import { useBusiness } from '../context/BusinessContext'
import BizBadge from '../components/BizBadge'
import {
  buildKpis,
  deriveAlert,
  sortByAttention,
  lastTouchLabel,
  daysSince,
  STALE_TOUCH_DAYS,
} from '../lib/overview'

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function stagePillStyle(stage) {
  if (stage === 'Waiting on Docs') {
    return { background: 'rgba(232,180,95,.14)', color: 'var(--bay-gold)' }
  }
  return { background: 'var(--bay-soft)', color: 'var(--bay)' }
}

export default function Overview() {
  const { biz } = useBusiness()
  const [rows, setRows] = useState([])
  const [totalContacts, setTotalContacts] = useState(0)
  const [latestSync, setLatestSync] = useState(null)
  const [loading, setLoading] = useState(!isDemoMode)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    if (isDemoMode) return
    setLoading(true)
    setError(null)
    const [pipeline, contactCount, sync] = await Promise.all([
      supabase
        .from('v_active_pipeline')
        .select('id, name, email, phone, last_touch_at, stage'),
      supabase.from('contacts').select('id', { count: 'exact', head: true }),
      supabase
        .from('sync_log')
        .select('ran_at, status, message')
        .eq('source', 'fub')
        .order('ran_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    const err = pipeline.error || contactCount.error || sync.error
    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }
    setRows(pipeline.data || [])
    setTotalContacts(contactCount.count || 0)
    setLatestSync(sync.data)
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (isDemoMode) return <DemoOverview />
  if (biz === 'mpg') return <MpgPlaceholder />

  const kpis = buildKpis(rows, totalContacts)
  const alert = deriveAlert({ latestSync, rows })
  const workbench = sortByAttention(rows)

  return (
    <div>
      <h2 className="text-[28px] font-bold tracking-tight">{greeting()}, Chandler</h2>
      <p className="mt-1 text-sm text-muted">
        {biz === 'bay'
          ? 'Bayway view — mortgage only.'
          : 'Here is what is happening across MPG and Bayway today.'}
      </p>

      {alert && (
        <div
          className={`mt-4 rounded-lg border px-3 py-2 text-xs ${
            alert.level === 'red'
              ? 'border-red-900/60 bg-red-950/40 text-red-300'
              : 'border-[rgba(232,180,95,.4)] bg-[rgba(232,180,95,.1)] text-[#e8b45f]'
          }`}
        >
          {alert.text}
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading && <div className="mt-6 text-sm text-muted">Loading pipeline…</div>}

      {!loading && !error && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3.5 xl:grid-cols-4">
            <Kpi label="Active loans" value={kpis.activeLoans} />
            {kpis.stageCards.map((c) => (
              <Kpi key={c.label} label={c.label} value={c.count} accent />
            ))}
            <Kpi label="New leads" value={kpis.newLeads} />
          </div>
          <p className="mt-2.5 text-[11.5px] text-dim">
            <span className="num font-semibold text-muted">{kpis.nurture}</span> in nurture
            · MPG connects with Zoho in a later phase
          </p>

          <div className="mt-5 rounded-card border border-line bg-panel">
            <div className="flex items-center justify-between border-b border-line px-4 py-3.5">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <span className="h-[7px] w-[7px] rounded-full" style={{ background: 'var(--bay)' }} />
                Needs Attention
                <span className="num text-[11px] font-medium text-muted">{workbench.length}</span>
              </div>
              <span className="text-xs text-dim">Sorted by longest since last touch</span>
            </div>
            {workbench.length === 0 && (
              <div className="px-6 py-8 text-center text-sm text-muted">
                No active loans — add stages in FollowUpBoss.
              </div>
            )}
            {workbench.map((r) => {
              const d = daysSince(r.last_touch_at)
              const stale = d === null || d >= STALE_TOUCH_DAYS
              return (
                <div
                  key={r.id}
                  className="relative flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0 hover:bg-hoverbg"
                >
                  <span
                    className="absolute bottom-2 left-0 top-2 w-[3px] rounded-sm"
                    style={{ background: 'var(--bay)' }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-semibold">{r.name || '(no name)'}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11.5px] text-muted">
                      <BizBadge biz="bay" />
                      {r.phone || r.email || 'no contact info'}
                    </div>
                  </div>
                  <span
                    className="whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold"
                    style={stagePillStyle(r.stage)}
                  >
                    {r.stage}
                  </span>
                  <span
                    className={`w-20 whitespace-nowrap text-right text-[11.5px] ${
                      stale ? 'font-semibold' : 'text-muted'
                    }`}
                    style={stale ? { color: 'var(--bay-gold)' } : undefined}
                  >
                    {lastTouchLabel(r.last_touch_at)}
                  </span>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function MpgPlaceholder() {
  return (
    <div>
      <h2 className="text-[28px] font-bold tracking-tight">{greeting()}, Chandler</h2>
      <p className="mt-1 text-sm text-muted">MPG view — merchant services only.</p>
      <div className="mt-6 rounded-card border border-line bg-panel px-6 py-10 text-center text-sm text-muted">
        Zoho CRM connects in an upcoming phase — MPG data will appear here.
      </div>
    </div>
  )
}

function Kpi({ label, value, accent }) {
  return (
    <div className="rounded-card border border-line bg-panel p-4">
      <div
        className="num text-[30px] font-bold leading-none tracking-tight"
        style={accent ? { color: 'var(--bay)' } : undefined}
      >
        {value}
      </div>
      <div className="mt-1.5 text-xs text-muted">{label}</div>
    </div>
  )
}

// ---- Demo mode: the Phase 1 placeholder content, unchanged -----------------

const placeholderDeals = [
  { id: 1, biz: 'mpg', title: 'Bayou City Auto Repair', sub: 'Merchant services · est. $310/mo', stage: 'Discovery / Statement', date: 'Today' },
  { id: 2, biz: 'bay', title: 'Ramirez · $340K Purchase', sub: 'Conventional · ref: K. Pham', stage: 'Clear to Close', date: 'Feb 26' },
  { id: 3, biz: 'mpg', title: 'Lone Star BBQ Supply', sub: 'Displacement · est. $520/mo', stage: 'Analysis & Proposal', date: 'Feb 25' },
  { id: 4, biz: 'bay', title: 'Nguyen · $215K Refi', sub: 'Rate/term · ref: direct', stage: 'Processing', date: 'Feb 27' },
]

function DemoOverview() {
  const { biz, matches } = useBusiness()
  const deals = placeholderDeals.filter((d) => matches(d.biz))
  return (
    <div>
      <h2 className="text-[28px] font-bold tracking-tight">{greeting()}, Chandler</h2>
      <p className="mt-1 text-sm text-muted">
        Demo mode — connect Supabase to see live pipeline data here.
      </p>
      <div className="mt-6 grid grid-cols-2 gap-3.5 xl:grid-cols-4">
        <Kpi label="Active deals" value={deals.length} />
        <Kpi label="Pipeline value" value="—" />
        <Kpi label="Follow-ups due today" value="—" />
        <Kpi label="Closed this month" value="—" />
      </div>
      <div className="mt-5 rounded-card border border-line bg-panel">
        <div className="flex items-center justify-between border-b border-line px-4 py-3.5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <span className="grad-dual h-[7px] w-[7px] rounded-full" />
            Active Workbench
            <span className="num text-[11px] font-medium text-muted">
              {deals.length} / {placeholderDeals.length}
            </span>
          </div>
          <span className="text-xs text-dim">Placeholder rows — demo mode</span>
        </div>
        {deals.map((d) => (
          <div
            key={d.id}
            className="relative flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0 hover:bg-hoverbg"
          >
            <span
              className="absolute bottom-2 left-0 top-2 w-[3px] rounded-sm"
              style={{ background: d.biz === 'mpg' ? 'var(--mpg)' : 'var(--bay)' }}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13.5px] font-semibold">{d.title}</div>
              <div className="mt-0.5 flex items-center gap-2 text-[11.5px] text-muted">
                <BizBadge biz={d.biz} />
                {d.sub}
              </div>
            </div>
            <span
              className="whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold"
              style={{
                background: d.biz === 'mpg' ? 'var(--mpg-soft)' : 'var(--bay-soft)',
                color: d.biz === 'mpg' ? 'var(--mpg)' : 'var(--bay)',
              }}
            >
              {d.stage}
            </span>
            <span
              className={`w-16 whitespace-nowrap text-right text-[11.5px] ${
                d.date === 'Today' ? 'font-semibold' : 'text-muted'
              }`}
              style={d.date === 'Today' ? { color: 'var(--bay-gold)' } : undefined}
            >
              {d.date}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Run the unit tests (regression)**

Run: `npm test`
Expected: PASS — all `src/lib/overview.test.js` tests green.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: exits 0, "✓ built in …".

- [ ] **Step 4: Commit**

```bash
git add src/pages/Overview.jsx
git commit -m "Phase 3: live Command Center overview (alerts, KPIs, needs-attention workbench)"
```

---

### Task 5: Live verification and deploy

**Files:** none created — verification and push only.

- [ ] **Step 1: Start the dev server and open the app**

Use the preview tools: `preview_start` with name `atkinson-sales-os` (from `.claude/launch.json`, port 5199). The app requires sign-in; if a session already exists in the preview browser it goes straight to the Overview. If the login screen shows instead, ask Chandler to sign in in the Browser pane — do not ask for his password.

- [ ] **Step 2: Verify on-screen numbers against the database**

On `/` (Overview) with filter **All**, using `preview_snapshot` (text) — confirm:
- KPI cards: Active loans **25**, Pre-Approved **15**, Waiting on Docs **10**, New leads **0**
- Footnote contains "**797** in nurture"
- Workbench header "Needs Attention **25**", rows sorted with oldest touch first
- No red banner (sync is on a 15-min schedule, so it should be under 45 min old). If a red banner shows, check the Sync Status screen before proceeding — that is a real finding, not a display bug.

If FUB data changed since design, re-run the Task 3 Step 3 count query and compare against *those* numbers instead — screen must equal database, not the design-date snapshot.

- [ ] **Step 3: Verify the business filter**

- Click the MPG segment (`preview_click`), confirm the placeholder: "Zoho CRM connects in an upcoming phase".
- Click Bayway, confirm the live pipeline renders.
- Check `preview_console_logs` (level: error) — expected: no errors.

- [ ] **Step 4: Screenshot proof**

`preview_screenshot` of the All view; share it with Chandler.

- [ ] **Step 5: Push (deploys via Netlify)**

```bash
git push origin main
```

Expected: push succeeds; Netlify auto-builds. Confirm author on all new commits is `chandleros-bit` (`git log --format='%an %ae' origin/main..HEAD` must be empty after push; spot-check with `git log -3 --format='%an <%ae>'`).

---

## Out of scope reminders (do not add)

- No dollar-value or closed-this-month KPIs (no deal data exists in FUB)
- No MPG/Zoho or calendar queries
- No writes to Supabase or FUB from the app
- Do not modify `Login.jsx` (contains the Phase 1 redirect fix), the Edge Functions, or migrations 0001/0002
