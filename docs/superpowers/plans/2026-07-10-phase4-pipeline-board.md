# Phase 4 — Bayway Pipeline Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the `/bayway/pipeline` placeholder into a live read-only kanban board — stage columns of contact cards from the existing `v_active_pipeline` view — while `/mpg/pipeline` stays a placeholder.

**Architecture:** A new pure module `src/lib/pipeline.js` (`buildColumns`, `isLostStage`) groups pipeline rows into ordered columns and reuses `sortByAttention`/`lastTouchLabel` from `src/lib/overview.js`. A new `src/pages/Pipeline.jsx` renders columns (live/demo/MPG-placeholder). `src/App.jsx` swaps two routes. No database changes.

**Tech Stack:** React 18 + Vite 5, Tailwind 3 (existing tokens), @supabase/supabase-js 2, vitest.

**Spec:** `docs/superpowers/specs/2026-07-10-phase4-pipeline-board-design.md`

**Repo:** `C:\Users\Chandler\.claude\projects\atkinson-sales-os-phase1` (Bash path `/c/Users/Chandler/.claude/projects/atkinson-sales-os-phase1`). Linked Supabase `cnmipfxwqnbtkohfixkf`. Git author must remain `chandleros-bit <chandler.dashboard@gmail.com>` — never override, never push except in the final task.

**Expected live board (2026-07-10):** exactly 2 columns — Waiting on Docs (10), then Pre-Approved (15) — cards attention-sorted.

**Reused interfaces (already exist, do not modify):**
- `src/lib/overview.js` exports `sortByAttention(rows)`, `lastTouchLabel(iso, now?)`, `daysSince(iso, now?)`, `STALE_TOUCH_DAYS`.
- `src/lib/supabase.js` exports `supabase`, `isDemoMode`.
- `v_active_pipeline` columns: `id, business_id, name, email, phone, last_touch_at, stage`.
- Tailwind tokens: `bg-panel`, `bg-panel2`, `border-line`, `border-line2`, `text-muted`, `text-dim`, `rounded-card`, `.num`; CSS vars `--bay`, `--bay-soft`, `--bay-gold`, `--mpg`, `--mpg-soft`, `--dim`.

---

### Task 1: `src/lib/pipeline.js` — column logic (TDD)

**Files:**
- Create: `src/lib/pipeline.js`
- Test: `src/lib/pipeline.test.js`

Groups rows into ordered, populated-only columns. Order: known loan-flow stages first (by
`LOAN_FLOW_ORDER` index), then unknown non-lost stages alphabetically, then lost-like stages
(rightmost) alphabetically. Cards within a column sorted by attention (reused from overview.js).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/pipeline.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { buildColumns, isLostStage, LOAN_FLOW_ORDER } from './pipeline'

const row = (id, stage, last_touch_at = null) => ({ id, stage, last_touch_at })

describe('LOAN_FLOW_ORDER', () => {
  it('is the curated Bayway sequence', () => {
    expect(LOAN_FLOW_ORDER).toEqual([
      'New Lead',
      'Attempted',
      'App Sent',
      'Waiting on Docs',
      'Pre-Approved',
    ])
  })
})

describe('isLostStage', () => {
  it('flags lost-keyword stages case-insensitively', () => {
    expect(isLostStage('Lost')).toBe(true)
    expect(isLostStage('Dead Lead')).toBe(true)
    expect(isLostStage('Withdrawn')).toBe(true)
    expect(isLostStage('DISENGAGED')).toBe(true)
    expect(isLostStage('Denied')).toBe(true)
  })
  it('does not flag active stages', () => {
    expect(isLostStage('Pre-Approved')).toBe(false)
    expect(isLostStage('Waiting on Docs')).toBe(false)
    expect(isLostStage(null)).toBe(false)
  })
})

describe('buildColumns', () => {
  it('orders known stages by loan-flow order, not input order', () => {
    const cols = buildColumns([
      row(1, 'Pre-Approved'),
      row(2, 'New Lead'),
      row(3, 'Waiting on Docs'),
    ])
    expect(cols.map((c) => c.stage)).toEqual(['New Lead', 'Waiting on Docs', 'Pre-Approved'])
  })
  it('drops empty columns — only populated stages appear', () => {
    const cols = buildColumns([row(1, 'Pre-Approved')])
    expect(cols.map((c) => c.stage)).toEqual(['Pre-Approved'])
  })
  it('appends unknown stages after known ones, alphabetically', () => {
    const cols = buildColumns([row(1, 'Zebra'), row(2, 'Pre-Approved'), row(3, 'Apple')])
    expect(cols.map((c) => c.stage)).toEqual(['Pre-Approved', 'Apple', 'Zebra'])
  })
  it('routes lost-like stages to the rightmost columns', () => {
    const cols = buildColumns([row(1, 'Lost'), row(2, 'New Lead'), row(3, 'Zebra')])
    expect(cols.map((c) => c.stage)).toEqual(['New Lead', 'Zebra', 'Lost'])
    expect(cols.find((c) => c.stage === 'Lost').isLost).toBe(true)
    expect(cols.find((c) => c.stage === 'New Lead').isLost).toBe(false)
  })
  it('ignores blank / whitespace / null stages', () => {
    const cols = buildColumns([row(1, '   '), row(2, ''), row(3, null), row(4, 'Pre-Approved')])
    expect(cols.map((c) => c.stage)).toEqual(['Pre-Approved'])
  })
  it('groups multiple rows into one column', () => {
    const cols = buildColumns([row(1, 'Pre-Approved'), row(2, 'Pre-Approved')])
    expect(cols).toHaveLength(1)
    expect(cols[0].cards).toHaveLength(2)
  })
  it('sorts cards within a column by attention (null touch first, then oldest)', () => {
    const cols = buildColumns([
      row(1, 'Pre-Approved', '2026-07-09T00:00:00Z'),
      row(2, 'Pre-Approved', null),
      row(3, 'Pre-Approved', '2026-07-01T00:00:00Z'),
    ])
    expect(cols[0].cards.map((c) => c.id)).toEqual([2, 3, 1])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/pipeline.test.js`
Expected: FAIL — cannot resolve `./pipeline`.

- [ ] **Step 3: Implement `src/lib/pipeline.js`**

```js
// Pure helpers for the Bayway Pipeline board. No React, no I/O — unit-testable.
// Spec: docs/superpowers/specs/2026-07-10-phase4-pipeline-board-design.md
import { sortByAttention } from './overview'

export const LOAN_FLOW_ORDER = [
  'New Lead',
  'Attempted',
  'App Sent',
  'Waiting on Docs',
  'Pre-Approved',
]

export const LOST_KEYWORDS = ['lost', 'dead', 'disengaged', 'withdrawn', 'denied']

export function isLostStage(stage) {
  const s = (stage || '').toLowerCase()
  return LOST_KEYWORDS.some((k) => s.includes(k))
}

// rows: v_active_pipeline rows ({ id, stage, last_touch_at, ... }).
// Returns ordered [{ stage, isLost, cards }] for populated stages only.
export function buildColumns(rows) {
  const groups = new Map()
  for (const r of rows) {
    const stage = (r.stage || '').trim()
    if (!stage) continue
    if (!groups.has(stage)) groups.set(stage, [])
    groups.get(stage).push(r)
  }

  const columns = [...groups.entries()].map(([stage, cards]) => ({
    stage,
    isLost: isLostStage(stage),
    cards: sortByAttention(cards),
  }))

  // Sort key [group, secondary]. group: 0 known-active, 1 unknown-active, 2 lost.
  // secondary: flow index (number) for known, stage name (string) otherwise.
  const rank = (col) => {
    if (col.isLost) return [2, col.stage]
    const i = LOAN_FLOW_ORDER.indexOf(col.stage)
    return i >= 0 ? [0, i] : [1, col.stage]
  }

  return columns.sort((a, b) => {
    const [ga, sa] = rank(a)
    const [gb, sb] = rank(b)
    if (ga !== gb) return ga - gb
    if (typeof sa === 'number') return sa - sb
    return String(sa).localeCompare(String(sb))
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/pipeline.test.js`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pipeline.js src/lib/pipeline.test.js
git commit -m "Phase 4: pipeline column-building logic with tests"
```

---

### Task 2: `src/pages/Pipeline.jsx` — the board page

**Files:**
- Create: `src/pages/Pipeline.jsx`

Renders the board for `biz==='bay'`; MPG placeholder for `biz==='mpg'`; static demo board in
demo mode. Mirrors the hardened fetch pattern (try/catch/finally) and error strip from
`Overview.jsx`. Cards and columns reuse the design tokens.

- [ ] **Step 1: Create the file**

`src/pages/Pipeline.jsx`:

```jsx
import { useEffect, useState, useCallback } from 'react'
import { supabase, isDemoMode } from '../lib/supabase'
import { lastTouchLabel, daysSince, STALE_TOUCH_DAYS } from '../lib/overview'
import { buildColumns } from '../lib/pipeline'

function BizHeader({ biz, note }) {
  const isMpg = biz === 'mpg'
  return (
    <div>
      <div className="flex items-center gap-3">
        <h2 className="text-[26px] font-bold tracking-tight">Pipeline</h2>
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide"
          style={{
            color: isMpg ? 'var(--mpg)' : 'var(--bay)',
            background: isMpg ? 'var(--mpg-soft)' : 'var(--bay-soft)',
          }}
        >
          {isMpg ? 'MPG' : 'BAYWAY'}
        </span>
        {note}
      </div>
    </div>
  )
}

function Card({ r, lost }) {
  const d = daysSince(r.last_touch_at)
  const stale = d === null || d >= STALE_TOUCH_DAYS
  return (
    <div className="relative rounded-lg border border-line bg-panel2 px-3 py-2.5 pl-3.5">
      <span
        className="absolute bottom-2 left-0 top-2 w-[3px] rounded-sm"
        style={{ background: lost ? 'var(--dim)' : 'var(--bay)' }}
      />
      <div className="truncate text-[13px] font-semibold">{r.name || '(no name)'}</div>
      <div className="mt-0.5 truncate text-[11.5px] text-muted">
        {r.phone || r.email || 'no contact info'}
      </div>
      <div
        className={`mt-1 text-[11px] ${stale ? 'font-semibold' : 'text-dim'}`}
        style={stale ? { color: 'var(--bay-gold)' } : undefined}
      >
        {lastTouchLabel(r.last_touch_at)}
      </div>
    </div>
  )
}

function Column({ col }) {
  return (
    <div className="w-[280px] flex-none rounded-card border border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
        <span className={`text-[12.5px] font-semibold ${col.isLost ? 'text-dim' : ''}`}>
          {col.stage}
        </span>
        <span className="num text-[11px] text-muted">{col.cards.length}</span>
      </div>
      <div className="flex flex-col gap-2 p-2.5">
        {col.cards.map((r) => (
          <Card key={r.id} r={r} lost={col.isLost} />
        ))}
      </div>
    </div>
  )
}

function Board({ columns }) {
  return (
    <div className="mt-5 flex gap-3.5 overflow-x-auto pb-2">
      {columns.map((col) => (
        <Column key={col.stage} col={col} />
      ))}
    </div>
  )
}

const demoRows = [
  { id: 'd1', stage: 'Waiting on Docs', name: 'Ramirez · Purchase', phone: '(713) 555-0142', last_touch_at: null },
  { id: 'd2', stage: 'Pre-Approved', name: 'Nguyen · Refi', phone: '(281) 555-0195', last_touch_at: null },
  { id: 'd3', stage: 'Pre-Approved', name: 'Okafor · Purchase', phone: '(832) 555-0110', last_touch_at: null },
]

export default function Pipeline({ biz }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(!isDemoMode)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    if (isDemoMode || biz !== 'bay') return
    setLoading(true)
    setError(null)
    try {
      const { data, error: err } = await supabase
        .from('v_active_pipeline')
        .select('id, business_id, name, email, phone, last_touch_at, stage')
        .eq('business_id', 'bay')
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
  }, [biz])

  useEffect(() => {
    load()
  }, [load])

  if (biz === 'mpg') {
    return (
      <div>
        <BizHeader biz="mpg" />
        <div className="mt-5 rounded-card border border-line bg-panel px-6 py-10 text-center text-sm text-muted">
          Zoho CRM connects in an upcoming phase — the MPG pipeline will appear here.
        </div>
      </div>
    )
  }

  if (isDemoMode) {
    return (
      <div>
        <BizHeader biz="bay" note={<span className="text-xs text-dim">demo</span>} />
        <Board columns={buildColumns(demoRows)} />
      </div>
    )
  }

  const columns = buildColumns(rows)

  return (
    <div>
      <BizHeader
        biz="bay"
        note={!loading && !error && <span className="num text-[12px] text-muted">{rows.length} active</span>}
      />

      {error && (
        <div className="mt-4 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading && <div className="mt-6 text-sm text-muted">Loading pipeline…</div>}

      {!loading && !error && rows.length === 0 && (
        <div className="mt-6 rounded-card border border-line bg-panel px-6 py-10 text-center text-sm text-muted">
          No active loans — add stages in FollowUpBoss.
        </div>
      )}

      {!loading && !error && rows.length > 0 && <Board columns={columns} />}
    </div>
  )
}
```

- [ ] **Step 2: Syntax-check the new file**

The file isn't imported yet, so `vite build` would skip it (it only bundles files in the module
graph). Instead transpile it directly with esbuild (a Vite dependency) to catch syntax errors:

Run: `npx esbuild src/pages/Pipeline.jsx --loader:.jsx=jsx --format=esm > /dev/null && echo SYNTAX_OK`
Expected: prints `SYNTAX_OK` with no esbuild errors. (This transpiles the single file without
resolving imports; full integration build happens in Task 3 once the page is routed.)

- [ ] **Step 3: Commit**

```bash
git add src/pages/Pipeline.jsx
git commit -m "Phase 4: Pipeline board page (columns, cards, demo + MPG placeholder)"
```

---

### Task 3: Wire the routes in `src/App.jsx`

**Files:**
- Modify: `src/App.jsx` (add import; replace the two pipeline placeholder routes)

- [ ] **Step 1: Add the import**

In `src/App.jsx`, after the line `import SyncStatus from './pages/SyncStatus'`, add:

```jsx
import Pipeline from './pages/Pipeline'
```

- [ ] **Step 2: Replace the MPG pipeline route**

Replace this block:

```jsx
              <Route
                path="/mpg/pipeline"
                element={
                  <PagePlaceholder title="Pipeline" biz="mpg" phase="4">
                    Kanban board driven by Zoho deal stages.
                  </PagePlaceholder>
                }
              />
```

with:

```jsx
              <Route path="/mpg/pipeline" element={<Pipeline biz="mpg" />} />
```

- [ ] **Step 3: Replace the Bayway pipeline route**

Replace this block:

```jsx
              <Route
                path="/bayway/pipeline"
                element={
                  <PagePlaceholder title="Pipeline" biz="bay" phase="4">
                    Kanban board driven by FollowUpBoss stages.
                  </PagePlaceholder>
                }
              />
```

with:

```jsx
              <Route path="/bayway/pipeline" element={<Pipeline biz="bay" />} />
```

(Leave the `PagePlaceholder` import and all other placeholder routes — Activity, Contacts, Calendar, Reports, Settings — unchanged.)

- [ ] **Step 4: Test and build**

Run: `npm test`
Expected: all tests pass (Task 1's pipeline tests + the 20 overview tests).

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx
git commit -m "Phase 4: route /bayway/pipeline and /mpg/pipeline to the Pipeline page"
```

---

### Task 4: Live verification and deploy

**Files:** none — verification and push only.

The atkinson dev server runs on port 5199 (Vite, HMR). If it is not running, start it with the
preview tool config named `atkinson-sales-os`. The app requires sign-in; if the browser shows
the login screen, ask Chandler to sign in in the Browser pane — never ask for or enter his password.

- [ ] **Step 1: Open the Bayway pipeline**

Navigate the connected browser to `http://localhost:5199/bayway/pipeline`.

- [ ] **Step 2: Verify columns and cards against the database**

Read the page text/snapshot. Confirm:
- Exactly two columns, in order: **Waiting on Docs** (count 10), then **Pre-Approved** (count 15).
- Cards show name, phone/email, and a last-touch label; each column's cards are ordered with
  null/oldest touch first.
- Header shows "BAYWAY" and "25 active".

Cross-check with a direct count (service-role key fetched at runtime, never printed):

```bash
SR=$(cd /c/Users/Chandler/.claude/projects/atkinson-sales-os-phase1 && supabase projects api-keys --project-ref cnmipfxwqnbtkohfixkf | python -c "import sys,json;d=json.load(sys.stdin);print(next(k['api_key'] for k in d['keys'] if k.get('id')=='service_role'))")
curl -s "https://cnmipfxwqnbtkohfixkf.supabase.co/rest/v1/v_active_pipeline?select=stage&business_id=eq.bay" -H "apikey: $SR" -H "Authorization: Bearer $SR" -H "Range: 0-999" | python -c "
import sys, json
from collections import Counter
for s, n in Counter(r['stage'] for r in json.load(sys.stdin)).most_common(): print(f'{n:4}  {s}')"
```

Expected: `15  Pre-Approved` and `10  Waiting on Docs`. Screen counts must equal these
(order on screen is loan-flow: Waiting on Docs before Pre-Approved). If live data changed,
match the screen to the fresh counts.

- [ ] **Step 3: Verify MPG placeholder and console**

- Navigate to `http://localhost:5199/mpg/pipeline`; confirm the "Zoho CRM connects in an
  upcoming phase" placeholder (no columns).
- Check the browser console for errors — expected: none.

- [ ] **Step 4: Screenshot proof**

Screenshot the Bayway board and share it with Chandler.

- [ ] **Step 5: Push (deploys via Netlify)**

```bash
cd /c/Users/Chandler/.claude/projects/atkinson-sales-os-phase1
git log origin/main..HEAD --format='%an <%ae>' | sort -u   # must show only chandleros-bit
git push origin main
```

Expected: push succeeds; Netlify auto-builds.

---

## Out of scope (do not add)

- Drag-to-move or any write to FUB/Supabase
- Deal dollar values, MPG/Zoho data, calendar, per-card detail pages
- Do not modify `Login.jsx`, the Edge Functions, `overview.js`, or migrations 0001–0004
