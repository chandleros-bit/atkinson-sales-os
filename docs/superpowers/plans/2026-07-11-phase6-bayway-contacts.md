# Phase 6 — Bayway Contacts Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/bayway/contacts` placeholder with a read-only, searchable, filterable, sortable table of all 826 Bayway contacts, each showing an enriched pipeline stage.

**Architecture:** A new `v_bayway_contacts` view (migration `0006`) enriches every Bayway contact with its pipeline stage (via `v_active_pipeline`, defaulting to "Nurture"). A pure `src/lib/contacts.js` (`filterContacts`, `sortContacts`) holds the search/filter/sort logic (unit-tested, reuses `lastTouchLabel`). `src/pages/Contacts.jsx` loads all rows once and derives the view in memory. `App.jsx` swaps two routes. Read-only; no base-schema change.

**Tech Stack:** React 18 + Vite 5, Tailwind 3 (existing tokens), @supabase/supabase-js 2, vitest, Supabase CLI (migration).

**Spec:** `docs/superpowers/specs/2026-07-11-phase6-bayway-contacts-design.md`

**Repo:** `C:\Users\Chandler\.claude\projects\atkinson-sales-os-phase1` (Bash `/c/Users/Chandler/.claude/projects/atkinson-sales-os-phase1`). Linked Supabase `cnmipfxwqnbtkohfixkf`. Git author must remain `chandleros-bit <chandler.dashboard@gmail.com>` — never override; push only in the final task.

**Expected live values (2026-07-11):** `v_bayway_contacts` returns **826** rows; **Active** (stage ≠ Nurture) ≈ **29**; Nurture ≈ **797**.

**Reused (do not modify):** `src/lib/overview.js` (`lastTouchLabel(iso, now?)`, `daysSince`), `src/lib/supabase.js` (`supabase`, `isDemoMode`), the `v_active_pipeline` view (exposes `id, stage`). Tokens: `bg-panel`, `bg-panel2`, `border-line`, `border-line2`, `text-muted`, `text-dim`, `rounded-card`, `.num`; CSS vars `--bay`, `--bay-soft`, `--mpg`, `--mpg-soft`, `--dim`.

---

### Task 1: Migration `0006_bayway_contacts_view.sql`

**Files:**
- Create: `supabase/migrations/0006_bayway_contacts_view.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Phase 6: Bayway contacts view — every Bayway contact enriched with its
-- pipeline stage (Pre-Approved / Waiting on Docs / New Lead) via
-- v_active_pipeline, defaulting to 'Nurture' for everyone else.
-- security_invoker = on keeps the app's read-only RLS in force (as with
-- v_active_pipeline). One row per Bayway contact. No base-schema change.

create or replace view public.v_bayway_contacts
with (security_invoker = on) as
select
  c.id,
  c.name,
  c.email,
  c.phone,
  c.last_touch_at,
  coalesce(p.stage, 'Nurture') as stage
from contacts c
left join v_active_pipeline p on p.id = c.id
where c.business_id = 'bay';
```

- [ ] **Step 2: Push to the remote database**

Run (from repo root): `yes | supabase db push --linked`
Expected: "Applying migration 0006_bayway_contacts_view.sql... Finished supabase db push."

- [ ] **Step 3: Verify counts through the view**

Service-role key fetched at runtime — never write it to a file or echo it:

```bash
SR=$(supabase projects api-keys --project-ref cnmipfxwqnbtkohfixkf | python -c "import sys,json;d=json.load(sys.stdin);print(next(k['api_key'] for k in d['keys'] if k.get('id')=='service_role'))")
curl -s "https://cnmipfxwqnbtkohfixkf.supabase.co/rest/v1/v_bayway_contacts?select=stage" -H "apikey: $SR" -H "Authorization: Bearer $SR" -H "Range: 0-1999" | python -c "
import sys, json
from collections import Counter
rows = json.load(sys.stdin)
print('total:', len(rows))
active = sum(1 for r in rows if r['stage'] != 'Nurture')
print('active (stage != Nurture):', active)
for s, n in Counter(r['stage'] for r in rows).most_common(): print(f'  {n:4}  {s}')
"
```

Expected: total **826**; active ≈ **29** (15 Pre-Approved + 11 Waiting on Docs + 3 New Lead); the rest Nurture (~797). If live data has shifted, the shape must hold: total = all bay contacts, active = the `v_active_pipeline` count.

- [ ] **Step 4: Confirm RLS (anon cannot read)**

```bash
ANON=$(supabase projects api-keys --project-ref cnmipfxwqnbtkohfixkf | python -c "import sys,json;d=json.load(sys.stdin);print(next(k['api_key'] for k in d['keys'] if k.get('id')=='anon'))")
curl -s "https://cnmipfxwqnbtkohfixkf.supabase.co/rest/v1/v_bayway_contacts?select=id&limit=1" -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
```

Expected: `[]` (anon has no select policy on `contacts`) — NOT contact rows. If rows come back, STOP and report (security issue).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0006_bayway_contacts_view.sql
git commit -m "Phase 6: v_bayway_contacts view (contacts enriched with pipeline stage)"
```

---

### Task 2: `src/lib/contacts.js` — filter/sort logic (TDD)

**Files:**
- Create: `src/lib/contacts.js`
- Test: `src/lib/contacts.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/contacts.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { filterContacts, sortContacts, NURTURE } from './contacts'

const rows = [
  { id: 1, name: 'Alice Adams', email: 'alice@x.com', phone: '281-000-0001', stage: 'Pre-Approved', last_touch_at: '2026-07-10T00:00:00Z' },
  { id: 2, name: 'Bob Brown', email: 'bob@y.com', phone: '832-000-0002', stage: 'Nurture', last_touch_at: '2026-07-01T00:00:00Z' },
  { id: 3, name: 'Carol Clark', email: null, phone: '713-555-9999', stage: 'Waiting on Docs', last_touch_at: null },
  { id: 4, name: 'Dave Diaz', email: 'dave@z.com', phone: '469-000-0004', stage: 'Nurture', last_touch_at: '2026-07-05T00:00:00Z' },
]

describe('filterContacts', () => {
  it('empty query keeps all rows', () => {
    expect(filterContacts(rows, { query: '', stageFilter: 'all' })).toHaveLength(4)
  })
  it('matches name case-insensitively', () => {
    const r = filterContacts(rows, { query: 'alice', stageFilter: 'all' })
    expect(r.map((x) => x.id)).toEqual([1])
  })
  it('matches email and phone substrings', () => {
    expect(filterContacts(rows, { query: 'bob@y', stageFilter: 'all' }).map((x) => x.id)).toEqual([2])
    expect(filterContacts(rows, { query: '555-9999', stageFilter: 'all' }).map((x) => x.id)).toEqual([3])
  })
  it('trims and lowercases the query', () => {
    expect(filterContacts(rows, { query: '  CAROL ', stageFilter: 'all' }).map((x) => x.id)).toEqual([3])
  })
  it('stageFilter active keeps non-Nurture', () => {
    expect(filterContacts(rows, { query: '', stageFilter: 'active' }).map((x) => x.id)).toEqual([1, 3])
  })
  it('stageFilter nurture keeps Nurture only', () => {
    expect(filterContacts(rows, { query: '', stageFilter: 'nurture' }).map((x) => x.id)).toEqual([2, 4])
  })
  it('combines query and stageFilter', () => {
    expect(filterContacts(rows, { query: 'a', stageFilter: 'active' }).map((x) => x.id)).toEqual([1, 3])
  })
  it('does not mutate the input', () => {
    const copy = [...rows]
    filterContacts(rows, { query: 'alice', stageFilter: 'all' })
    expect(rows).toEqual(copy)
  })
})

describe('sortContacts', () => {
  it('sorts by name ascending', () => {
    expect(sortContacts(rows, { key: 'name', dir: 'asc' }).map((x) => x.id)).toEqual([1, 2, 3, 4])
  })
  it('sorts by name descending', () => {
    expect(sortContacts(rows, { key: 'name', dir: 'desc' }).map((x) => x.id)).toEqual([4, 3, 2, 1])
  })
  it('sorts by last_touch_at descending with nulls last', () => {
    expect(sortContacts(rows, { key: 'last_touch_at', dir: 'desc' }).map((x) => x.id)).toEqual([1, 4, 2, 3])
  })
  it('sorts by last_touch_at ascending with nulls still last', () => {
    expect(sortContacts(rows, { key: 'last_touch_at', dir: 'asc' }).map((x) => x.id)).toEqual([2, 4, 1, 3])
  })
  it('sorts by stage ascending', () => {
    expect(sortContacts(rows, { key: 'stage', dir: 'asc' }).map((x) => x.stage)).toEqual([
      'Nurture', 'Nurture', 'Pre-Approved', 'Waiting on Docs',
    ])
  })
  it('does not mutate the input', () => {
    const copy = [...rows]
    sortContacts(rows, { key: 'name', dir: 'asc' })
    expect(rows).toEqual(copy)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/contacts.test.js`
Expected: FAIL — cannot resolve `./contacts`.

- [ ] **Step 3: Implement `src/lib/contacts.js`**

```js
// Pure search/filter/sort helpers for the Bayway Contacts table.
// No React, no I/O — unit-testable.
// Spec: docs/superpowers/specs/2026-07-11-phase6-bayway-contacts-design.md

export const NURTURE = 'Nurture'

// rows: v_bayway_contacts rows. Returns a new filtered array (non-mutating).
export function filterContacts(rows, { query, stageFilter }) {
  const q = (query || '').trim().toLowerCase()
  return rows.filter((r) => {
    if (stageFilter === 'active' && r.stage === NURTURE) return false
    if (stageFilter === 'nurture' && r.stage !== NURTURE) return false
    if (!q) return true
    const hay = `${r.name || ''} ${r.email || ''} ${r.phone || ''}`.toLowerCase()
    return hay.includes(q)
  })
}

// key: 'name' | 'stage' | 'last_touch_at'. dir: 'asc' | 'desc'.
// Returns a new sorted array (non-mutating). last_touch_at nulls always last.
export function sortContacts(rows, { key, dir }) {
  const factor = dir === 'desc' ? -1 : 1
  return [...rows].sort((a, b) => {
    if (key === 'last_touch_at') {
      const av = a.last_touch_at
      const bv = b.last_touch_at
      if (!av && !bv) return 0
      if (!av) return 1 // nulls last regardless of dir
      if (!bv) return -1
      return (new Date(av) - new Date(bv)) * factor
    }
    const av = (a[key] || '').toString().toLowerCase()
    const bv = (b[key] || '').toString().toLowerCase()
    return av.localeCompare(bv) * factor
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/contacts.test.js`
Expected: PASS — all tests green.

- [ ] **Step 5: Run the full suite (no regressions)**

Run: `npm test`
Expected: all pre-existing tests still pass, plus the new contacts tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/contacts.js src/lib/contacts.test.js
git commit -m "Phase 6: contacts filter/sort logic with tests"
```

---

### Task 3: `src/pages/Contacts.jsx` — the table page

**Files:**
- Create: `src/pages/Contacts.jsx`

- [ ] **Step 1: Create the file**

```jsx
import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase, isDemoMode } from '../lib/supabase'
import { lastTouchLabel } from '../lib/overview'
import { filterContacts, sortContacts, NURTURE } from '../lib/contacts'

const PER_PAGE = 50

function BizHeader({ biz, note }) {
  const isMpg = biz === 'mpg'
  return (
    <div className="flex items-center gap-3">
      <h2 className="text-[26px] font-bold tracking-tight">Contacts</h2>
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
  )
}

function stagePillStyle(stage) {
  if (stage === NURTURE) return { background: 'transparent', color: 'var(--dim)' }
  if (stage === 'Waiting on Docs') return { background: 'rgba(232,180,95,.14)', color: 'var(--bay-gold)' }
  return { background: 'var(--bay-soft)', color: 'var(--bay)' }
}

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'nurture', label: 'Nurture' },
]

const demoRows = [
  { id: 'd1', name: 'Ramirez · Purchase', email: null, phone: '(713) 555-0142', stage: 'Pre-Approved', last_touch_at: null },
  { id: 'd2', name: 'Nguyen · Refi', email: 'nguyen@example.com', phone: '(281) 555-0195', stage: NURTURE, last_touch_at: null },
]

export default function Contacts({ biz }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(!isDemoMode)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [stageFilter, setStageFilter] = useState('all')
  const [sortKey, setSortKey] = useState('last_touch_at')
  const [sortDir, setSortDir] = useState('desc')
  const [page, setPage] = useState(1)

  const load = useCallback(async () => {
    if (isDemoMode || biz !== 'bay') return
    setLoading(true)
    setError(null)
    try {
      const { data, error: err } = await supabase
        .from('v_bayway_contacts')
        .select('id, name, email, phone, last_touch_at, stage')
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

  const sourceRows = isDemoMode ? demoRows : rows
  const filtered = useMemo(
    () => sortContacts(filterContacts(sourceRows, { query, stageFilter }), { key: sortKey, dir: sortDir }),
    [sourceRows, query, stageFilter, sortKey, sortDir],
  )
  const pageCount = Math.max(1, Math.ceil(filtered.length / PER_PAGE))
  const safePage = Math.min(page, pageCount)
  const pageRows = filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE)

  const setSort = (key) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir(key === 'last_touch_at' ? 'desc' : 'asc')
    }
    setPage(1)
  }
  const onQuery = (v) => {
    setQuery(v)
    setPage(1)
  }
  const onFilter = (k) => {
    setStageFilter(k)
    setPage(1)
  }

  if (biz === 'mpg') {
    return (
      <div>
        <BizHeader biz="mpg" />
        <div className="mt-5 rounded-card border border-line bg-panel px-6 py-10 text-center text-sm text-muted">
          Zoho CRM connects in an upcoming phase — MPG contacts will appear here.
        </div>
      </div>
    )
  }

  const arrow = (key) => (key === sortKey ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '')

  return (
    <div>
      <BizHeader
        biz="bay"
        note={
          !loading &&
          !error && (
            <span className="num text-[12px] text-muted">
              {sourceRows.length} contacts · showing {filtered.length}
            </span>
          )
        }
      />

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search name, email, or phone…"
          className="w-64 rounded-lg border border-line bg-panel2 px-3 py-1.5 text-[13px] outline-none placeholder:text-dim focus:border-line2"
        />
        <div className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => onFilter(f.key)}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
                stageFilter === f.key ? 'bg-hoverbg text-white' : 'text-muted hover:text-white'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading && <div className="mt-6 text-sm text-muted">Loading contacts…</div>}

      {!loading && !error && (
        <div className="mt-4 overflow-hidden rounded-card border border-line bg-panel">
          <div className="flex items-center gap-3 border-b border-line px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-dim">
            <button onClick={() => setSort('name')} className="flex-1 text-left hover:text-white">
              Name{arrow('name')}
            </button>
            <button onClick={() => setSort('stage')} className="w-32 text-left hover:text-white">
              Stage{arrow('stage')}
            </button>
            <div className="w-40">Contact</div>
            <button onClick={() => setSort('last_touch_at')} className="w-24 text-right hover:text-white">
              Last touch{arrow('last_touch_at')}
            </button>
          </div>

          {pageRows.length === 0 && (
            <div className="px-6 py-8 text-center text-sm text-muted">No contacts match.</div>
          )}

          {pageRows.map((r) => (
            <div key={r.id} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0 hover:bg-hoverbg">
              <div className="min-w-0 flex-1 truncate text-[13px] font-semibold">{r.name || '(no name)'}</div>
              <div className="w-32">
                <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={stagePillStyle(r.stage)}>
                  {r.stage}
                </span>
              </div>
              <div className="w-40 truncate text-[11.5px] text-muted">
                {r.phone || r.email || 'no contact info'}
              </div>
              <div className="w-24 text-right text-[11.5px] text-muted">{lastTouchLabel(r.last_touch_at)}</div>
            </div>
          ))}
        </div>
      )}

      {!loading && !error && pageCount > 1 && (
        <div className="mt-3 flex items-center justify-end gap-3 text-xs text-muted">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage <= 1}
            className="rounded-lg border border-line px-2.5 py-1 disabled:opacity-40"
          >
            Prev
          </button>
          <span className="num">
            Page {safePage} / {pageCount}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            disabled={safePage >= pageCount}
            className="rounded-lg border border-line px-2.5 py-1 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Syntax-check the file** (not routed yet, so `vite build` would skip it):

Run: `npx esbuild src/pages/Contacts.jsx --loader:.jsx=jsx --format=esm > /dev/null && echo SYNTAX_OK`
Expected: prints `SYNTAX_OK`.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Contacts.jsx
git commit -m "Phase 6: Contacts table page (search, filter, sort, paginate)"
```

---

### Task 4: Wire routes in `src/App.jsx`

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Add the import** — after `import Pipeline from './pages/Pipeline'`, add:

```jsx
import Contacts from './pages/Contacts'
```

- [ ] **Step 2: Replace the MPG contacts route** — replace this exact block:

```jsx
              <Route
                path="/mpg/contacts"
                element={
                  <PagePlaceholder title="Contacts" biz="mpg" phase="6">
                    Read-only table synced from Zoho CRM.
                  </PagePlaceholder>
                }
              />
```

with:

```jsx
              <Route path="/mpg/contacts" element={<Contacts biz="mpg" />} />
```

- [ ] **Step 3: Replace the Bayway contacts route** — replace this exact block:

```jsx
              <Route
                path="/bayway/contacts"
                element={
                  <PagePlaceholder title="Contacts" biz="bay" phase="6">
                    Read-only table synced from FollowUpBoss.
                  </PagePlaceholder>
                }
              />
```

with:

```jsx
              <Route path="/bayway/contacts" element={<Contacts biz="bay" />} />
```

Leave the `PagePlaceholder` import and all other placeholder routes (Activity, Calendar, Reports, Settings) unchanged.

- [ ] **Step 4: Test and build**

Run: `npm test`
Expected: all tests pass (contacts + prior suites).

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx
git commit -m "Phase 6: route /bayway/contacts and /mpg/contacts to the Contacts page"
```

---

### Task 5: Live verification and deploy

**Files:** none — verification and push only.

The atkinson dev server runs on port 5199 (start via the `atkinson-sales-os` preview config if
needed; it requires sign-in — if the login screen shows, ask Chandler to sign in in the Browser
pane, never enter his password).

- [ ] **Step 1: Open the Bayway contacts page**

Navigate the connected browser to `http://localhost:5199/bayway/contacts`.

- [ ] **Step 2: Verify against the database**

Read the page. Confirm:
- Header count reads "826 contacts · showing 826" (or current bay total).
- Default sort is Last touch, descending (most-recent first; "—" rows at the bottom).
- Stage pills render (Pre-Approved / Waiting on Docs / New Lead / Nurture).
- Pagination shows "Page 1 / 17" (826 / 50 = 17 pages) with working Prev/Next.

Cross-check the totals (service key at runtime, not printed):

```bash
SR=$(supabase projects api-keys --project-ref cnmipfxwqnbtkohfixkf | python -c "import sys,json;d=json.load(sys.stdin);print(next(k['api_key'] for k in d['keys'] if k.get('id')=='service_role'))")
curl -s "https://cnmipfxwqnbtkohfixkf.supabase.co/rest/v1/v_bayway_contacts?select=stage" -H "apikey: $SR" -H "Authorization: Bearer $SR" -H "Range: 0-1999" | python -c "
import sys, json
rows = json.load(sys.stdin)
print('total', len(rows), 'active', sum(1 for r in rows if r['stage'] != 'Nurture'))"
```

- [ ] **Step 3: Verify search and filters**

- Type a known contact's name in the search box; confirm the list narrows and the "showing N"
  count drops.
- Click **Active**; confirm "showing N" ≈ the active count (~29) and no Nurture pills appear.
- Click **Nurture**; confirm only Nurture rows. Click **All** to reset.
- Check `read_console_messages` (errors only) — expected none.

- [ ] **Step 4: Screenshot proof**

Screenshot the Bayway contacts table (All view) and share it.

- [ ] **Step 5: Push (deploys via Netlify)**

```bash
cd /c/Users/Chandler/.claude/projects/atkinson-sales-os-phase1
git log origin/main..HEAD --format='%an <%ae>' | sort -u   # must show only chandleros-bit
git push origin main
```

Expected: push succeeds; Netlify auto-builds.

---

## Out of scope (do not add)

- Editing / any write; per-contact detail pages; MPG contacts screen (beyond the placeholder)
- CSV export; column customization; server-side pagination
- Do not modify `Login.jsx`, the Edge Functions, `overview.js`, `pipeline.js`, or migrations 0001–0005
