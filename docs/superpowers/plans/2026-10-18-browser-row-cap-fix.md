# Browser Row-Cap Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the browser from silently dropping rows past PostgREST's 1,000-row cap, and add a test that turns any future unbounded read into a red build.

**Architecture:** A browser copy of the edge functions' `fetchAll` pages any query in 1,000-row `.range()` steps. A `fetchAllSettled` wrapper resolves to the same `{ data, error }` shape a bare `await query` gives, so every call site swaps one expression and keeps its downstream handling. A text-scanning Vitest audit fails on any Supabase `.from(` read that is neither bounded nor paged.

**Tech Stack:** React 18, Vite 5, Vitest 4, `@supabase/supabase-js` 2.45, Supabase Edge Functions (Deno).

**Spec:** `docs/superpowers/specs/2026-10-16-row-cap-fix-and-quick-actions-design.md`, Part 1 only. Part 2 (Quick Actions) gets its own plan after Part 1 is merged and verified live.

---

## Where this plan differs from the spec (read first)

Found while checking the spec against the code on 2026-10-18:

1. **Two more unbounded reads.** `src/pages/Pipeline.jsx` `load()` (`v_active_pipeline` / `v_mpg_contacts`) and `src/pages/PriorityLeads.jsx` `load()` (`v_priority_leads`) are bare selects. The spec's table missed them. Both are fixed here.
2. **Paging needs a stable order.** `.range()` on an unordered query lets Postgres return rows in a different order per page, so pages can overlap or skip rows. Every `fetchAll` query ends with `.order('id')` (or a tiebreak `.order('id')` after its existing sort). Every table and view involved has an `id` column. The audit enforces this.
3. **HOT tags are not pushed down.** `isHot` in `src/lib/overview.js` matches `"hot"` case-insensitively after trimming. A server-side `cs '["HOT"]'` filter is exact-match and would drop `"Hot"` or `"hot "`. `bayTagged` uses `fetchAll` (the spec's fallback) instead. It only selects six small columns, so the payload stays small.
4. **Two date-windowed reads can still pass 1,000 rows.** The spec counts any date window as bounded. Two are not, in practice:
   - `Reports.jsx` `callRows` reads outbound calls for up to 31 days. At ~40 calls a day across both books that is ~1,250 rows.
   - `Overview.jsx` `metrics` and `Reports.jsx` `sprintMetrics` start at `MPG_SPRINT.from` (2026-07-30), so they cover ~90 days × 2 books × every metric key.

   All three go through `fetchAll`. The short windows (week, month, 7-day series, calendar month) stay as they are.
5. **The audit has to skip writes.** `Reports.jsx` upserts into `metrics_daily` and `settings` with no bound. Chains containing `.insert(` / `.upsert(` / `.update(` / `.delete(` are not reads and are skipped.

---

## File map

| File | Change |
|---|---|
| `src/lib/fetchAll.js` | **Create.** `fetchAll`, `fetchAllSettled`. |
| `src/lib/fetchAll.test.js` | **Create.** Unit tests with a fake builder. |
| `src/pages/Contacts.jsx` | `load()` goes through `fetchAllSettled`. |
| `src/pages/Pipeline.jsx` | `load()` goes through `fetchAllSettled`. |
| `src/pages/PriorityLeads.jsx` | `load()` goes through `fetchAllSettled`. |
| `src/components/MyTasks.jsx` | `v_tasks` read goes through `fetchAllSettled`. |
| `src/pages/Overview.jsx` | `metrics`, `tasks`, `bayPipe`, `bayTagged`, `deals`, `leads`, `mpgLeads` go through `fetchAllSettled`. |
| `src/pages/Overview.render.test.jsx` | Fake query builder gains `range`. |
| `src/pages/Reports.jsx` | `deals`, `active`, `sprintMetrics`, `callRows` go through `fetchAllSettled`. |
| `src/lib/rowCap.audit.test.js` | **Create.** Scanner, scanner unit tests, and a scan of `src/`. |
| `supabase/functions/fub-webhook/index.ts` | Fail closed when `FUB_WEBHOOK_SECRET` is missing (spec's "ship alongside"). |

---

### Task 0: Branch

- [ ] **Step 1: Create the branch from an up-to-date `main`**

```bash
git checkout main
git pull
git checkout -b fix/browser-row-cap
```

---

### Task 1: `fetchAll` helper

**Files:**
- Create: `src/lib/fetchAll.js`
- Test: `src/lib/fetchAll.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/fetchAll.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { fetchAll, fetchAllSettled } from './fetchAll'

// A fake data source. Each makeQuery() call returns a fresh builder whose
// .range() resolves the next scripted page and records the offsets it got.
function fakeSource(pages) {
  const ranges = []
  let calls = 0
  let next = 0
  const makeQuery = () => {
    calls++
    return {
      range(from, to) {
        ranges.push([from, to])
        return Promise.resolve(pages[next++] ?? { data: [], error: null })
      },
    }
  }
  return { makeQuery, ranges, calls: () => calls }
}

const rows = (n, start = 0) => Array.from({ length: n }, (_, i) => ({ id: start + i }))

describe('fetchAll', () => {
  it('returns a single short page as-is', async () => {
    const src = fakeSource([{ data: rows(37), error: null }])
    expect(await fetchAll(src.makeQuery)).toEqual(rows(37))
    expect(src.ranges).toEqual([[0, 999]])
  })

  it('asks for one more page after exactly 1,000 rows', async () => {
    const src = fakeSource([
      { data: rows(1000), error: null },
      { data: [], error: null },
    ])
    const out = await fetchAll(src.makeQuery)
    expect(out).toHaveLength(1000)
    expect(src.ranges).toEqual([[0, 999], [1000, 1999]])
  })

  it('pages 1,000 + 1,000 + 37 into 2,037 rows with the right offsets', async () => {
    const src = fakeSource([
      { data: rows(1000, 0), error: null },
      { data: rows(1000, 1000), error: null },
      { data: rows(37, 2000), error: null },
    ])
    const out = await fetchAll(src.makeQuery)
    expect(out).toHaveLength(2037)
    expect(out[0].id).toBe(0)
    expect(out[2036].id).toBe(2036)
    expect(src.ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
  })

  it('builds a fresh query for every page', async () => {
    const src = fakeSource([
      { data: rows(1000), error: null },
      { data: rows(5), error: null },
    ])
    await fetchAll(src.makeQuery)
    expect(src.calls()).toBe(2)
  })

  it('throws on an error in page 2 instead of returning page 1', async () => {
    const src = fakeSource([
      { data: rows(1000), error: null },
      { data: null, error: { message: 'boom' } },
    ])
    await expect(fetchAll(src.makeQuery)).rejects.toThrow('boom')
  })

  it('treats null data as an empty last page', async () => {
    const src = fakeSource([{ data: null, error: null }])
    expect(await fetchAll(src.makeQuery)).toEqual([])
  })

  it('honors a custom pageSize', async () => {
    const src = fakeSource([
      { data: rows(2), error: null },
      { data: rows(1, 2), error: null },
    ])
    expect(await fetchAll(src.makeQuery, { pageSize: 2 })).toHaveLength(3)
    expect(src.ranges).toEqual([[0, 1], [2, 3]])
  })
})

describe('fetchAllSettled', () => {
  it('resolves { data, error: null } on success', async () => {
    const src = fakeSource([{ data: rows(3), error: null }])
    expect(await fetchAllSettled(src.makeQuery)).toEqual({ data: rows(3), error: null })
  })

  it('resolves { data: null, error } with a message on failure', async () => {
    const src = fakeSource([{ data: null, error: { message: 'nope' } }])
    const res = await fetchAllSettled(src.makeQuery)
    expect(res.data).toBeNull()
    expect(res.error.message).toBe('nope')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/fetchAll.test.js`
Expected: FAIL, `Failed to resolve import "./fetchAll"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/fetchAll.js`:

```js
// PostgREST caps a single response at 1,000 rows and does not error when it
// truncates: a read past the cap just comes back short. This is the browser
// copy of fetchAll in supabase/functions/_shared/db.ts (that file imports
// supabase-js from esm.sh for Deno, so the app cannot import it).
//
// makeQuery: () => a fresh query builder with no .range() applied. It has to
// be a factory because a builder can only be awaited once. It must also end
// with .order() on a unique column (usually 'id'), or Postgres can return rows
// in a different order on each page and the pages overlap or skip rows.
// src/lib/rowCap.audit.test.js enforces both.
export const PAGE_SIZE = 1000

export async function fetchAll(makeQuery, { pageSize = PAGE_SIZE } = {}) {
  const rows = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await makeQuery().range(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    const page = data || []
    rows.push(...page)
    if (page.length < pageSize) return rows
  }
}

// Same { data, error } shape a bare `await query` gives, so call sites that
// destructure the result or check res.error keep working unchanged.
export function fetchAllSettled(makeQuery, opts) {
  return fetchAll(makeQuery, opts).then(
    (data) => ({ data, error: null }),
    (error) => ({ data: null, error }),
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/fetchAll.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fetchAll.js src/lib/fetchAll.test.js
git commit -m "feat: browser fetchAll helper that pages past the 1,000-row cap"
```

---

### Task 2: Single-query pages (Contacts, Pipeline, Priority Leads, My Tasks)

**Files:**
- Modify: `src/pages/Contacts.jsx` (imports, `load()` near line 146)
- Modify: `src/pages/Pipeline.jsx` (imports, `load()` near line 203)
- Modify: `src/pages/PriorityLeads.jsx` (imports, `load()` near line 156)
- Modify: `src/components/MyTasks.jsx` (imports, effect near line 33)

These have no component tests. The audit in Task 5 covers them statically and Task 7 covers them live. Every page sorts its rows client-side (`sortContacts`, `groupByTier`/`sortByScore`, the pipeline column sort, `buildMyTasks`), so adding `.order('id')` does not change what the user sees.

- [ ] **Step 1: Contacts**

In `src/pages/Contacts.jsx`, add next to the existing `supabase` import:

```js
import { fetchAllSettled } from '../lib/fetchAll'
```

Replace:

```js
      const { data, error: err } = await supabase.from(config.source).select('*')
```

with:

```js
      const { data, error: err } = await fetchAllSettled(() =>
        supabase.from(config.source).select('*').order('id'),
      )
```

(`config.source` is `v_bayway_contacts` or `v_mpg_contacts`. Both views expose `id`.)

- [ ] **Step 2: Pipeline**

In `src/pages/Pipeline.jsx`, add the same import. Replace:

```js
      let q = supabase.from(cfg.view).select(cfg.columns)
      if (biz === 'bay') q = q.eq('business_id', 'bay')
      const { data, error: err } = await q
```

with:

```js
      const { data, error: err } = await fetchAllSettled(() => {
        const q = supabase.from(cfg.view).select(cfg.columns).order('id')
        return biz === 'bay' ? q.eq('business_id', 'bay') : q
      })
```

(The `.order()` goes on the same line as `.from(` so the audit sees it. supabase-js allows `.eq()` after `.order()`.)

- [ ] **Step 3: Priority Leads**

In `src/pages/PriorityLeads.jsx`, add the import. Replace:

```js
      const { data, error: err } = await supabase
        .from('v_priority_leads')
        .select(COLUMNS)
        .eq('business_id', 'bay')
```

with:

```js
      const { data, error: err } = await fetchAllSettled(() =>
        supabase
          .from('v_priority_leads')
          .select(COLUMNS)
          .eq('business_id', 'bay')
          .order('id'),
      )
```

- [ ] **Step 4: My Tasks**

In `src/components/MyTasks.jsx`, add `import { fetchAllSettled } from '../lib/fetchAll'`. Replace:

```js
        const { data, error: err } = await supabase
          .from('v_tasks')
          .select('id, business_id, task_type, title, due_at, contact_name, crm_profile_url')
          .order('due_at', { ascending: true, nullsFirst: false })
```

with:

```js
        const { data, error: err } = await fetchAllSettled(() =>
          supabase
            .from('v_tasks')
            .select('id, business_id, task_type, title, due_at, contact_name, crm_profile_url')
            .order('due_at', { ascending: true, nullsFirst: false })
            .order('id', { ascending: true }),
        )
```

(Same tiebreak `Tasks.jsx` already uses.)

- [ ] **Step 5: Run the full suite and the build**

Run: `npm test`
Expected: PASS, no change in test count from `main` plus Task 1's 9.

Run: `npm run build`
Expected: build succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Contacts.jsx src/pages/Pipeline.jsx src/pages/PriorityLeads.jsx src/components/MyTasks.jsx
git commit -m "fix: page Contacts, Pipeline, Priority Leads, My Tasks reads past 1,000 rows"
```

---

### Task 3: Overview

**Files:**
- Modify: `src/pages/Overview.jsx` (imports, the `q` object near lines 865-915)
- Modify: `src/pages/Overview.render.test.jsx:57` (fake builder methods)

- [ ] **Step 1: Teach the render test's fake builder `.range()`**

`fetchAll` calls `.range()` on every query. The fake in `src/pages/Overview.render.test.jsx` doesn't have it yet, so the test has to fail first. Run it now on the unchanged Overview to confirm it passes (baseline):

Run: `npx vitest run src/pages/Overview.render.test.jsx`
Expected: PASS.

Then change line 57 from:

```js
  for (const m of ['select', 'eq', 'gte', 'lt', 'in', 'order', 'limit']) q[m] = () => q
```

to:

```js
  for (const m of ['select', 'eq', 'gte', 'lt', 'in', 'order', 'limit', 'range']) q[m] = () => q
```

(Each fixture has fewer than 1,000 rows, so `fetchAll` stops after one page.)

- [ ] **Step 2: Rewrite the Overview queries**

In `src/pages/Overview.jsx`, add `import { fetchAllSettled } from '../lib/fetchAll'` next to the `supabase` import. Inside the effect, replace the `metrics` entry:

```js
          metrics: supabase
            .from('metrics_daily')
            .select('date, business_id, metric_key, value')
            .gte('date', metricsFrom),
```

with:

```js
          // metricsFrom reaches back to MPG_SPRINT.from, so this window holds
          // ~90 days x 2 books x every metric key: page it.
          metrics: fetchAllSettled(() =>
            supabase
              .from('metrics_daily')
              .select('date, business_id, metric_key, value')
              .gte('date', metricsFrom)
              .order('id'),
          ),
```

Replace the `tasks` entry:

```js
          tasks:
            biz === 'all'
              ? supabase.from('v_tasks').select('id, business_id, due_at')
              : supabase.from('v_tasks').select('id, business_id, due_at').eq('business_id', biz),
```

with:

```js
          tasks: fetchAllSettled(() => {
            const t = supabase.from('v_tasks').select('id, business_id, due_at').order('id')
            return biz === 'all' ? t : t.eq('business_id', biz)
          }),
```

Replace the whole `if (wantsBay) { ... }` and `if (wantsMpg) { ... }` blocks with:

```js
        if (wantsBay) {
          q.bayPipe = fetchAllSettled(() =>
            supabase
              .from('v_active_pipeline')
              .select('id, business_id, name, email, phone, last_touch_at, stage')
              .eq('business_id', 'bay')
              .order('id'),
          )
          // Not pushed down to a server-side tag filter: isHot matches "hot"
          // case-insensitively after trimming, and a jsonb `cs` filter is exact.
          q.bayTagged = fetchAllSettled(() =>
            supabase
              .from('contacts')
              .select('id, name, email, phone, last_touch_at, external_id, tags:raw->tags')
              .eq('business_id', 'bay')
              .order('id'),
          )
          q.bayCount = supabase
            .from('contacts')
            .select('id', { count: 'exact', head: true })
            .eq('business_id', 'bay')
          q.deals = fetchAllSettled(() =>
            supabase
              .from('deals')
              .select('status, value, expected_close, business_id')
              .eq('business_id', 'bay')
              .order('id'),
          )
          q.leads = fetchAllSettled(() =>
            supabase
              .from('v_priority_leads')
              .select('id, name, score, tier, last_activity_at, fub_profile_url')
              .eq('business_id', 'bay')
              .order('id'),
          )
        }
        if (wantsMpg) {
          q.mpgLeads = fetchAllSettled(() =>
            supabase
              .from('v_mpg_contacts')
              .select('id, name, company, email, phone, last_touch_at, stage, crm_profile_url')
              .order('id'),
          )
        }
```

Leave the rest unchanged: `settings`, `sync`, `bayCount`, and the `Promise.all` / `res[k].error` / `res[k].data` handling. `Promise.all` accepts a mix of promises and thenable builders, and every entry still resolves to `{ data, error }` (plus `count` on `bayCount`).

- [ ] **Step 3: Run the render test and the full suite**

Run: `npx vitest run src/pages/Overview.render.test.jsx`
Expected: PASS (all cases, including the `78` combined-calls check, which proves `metrics` still flows through).

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Overview.jsx src/pages/Overview.render.test.jsx
git commit -m "fix: page Overview reads past 1,000 rows"
```

---

### Task 4: Reports

**Files:**
- Modify: `src/pages/Reports.jsx` (imports, `Promise.all` near lines 229-242)

- [ ] **Step 1: Rewrite the four unbounded or long-window entries**

Add `import { fetchAllSettled } from '../lib/fetchAll'` next to the `supabase` import. Inside the `Promise.all([...])`, replace these entries (leave the others exactly as they are):

```js
        supabase.from('deals').select('status, value, expected_close, business_id'),
        supabase.from('v_active_pipeline').select('stage, business_id').eq('business_id', 'bay'),
```

with:

```js
        fetchAllSettled(() => supabase.from('deals').select('status, value, expected_close, business_id').order('id')),
        fetchAllSettled(() => supabase.from('v_active_pipeline').select('stage, business_id').eq('business_id', 'bay').order('id')),
```

Replace:

```js
        supabase.from('metrics_daily').select('date, business_id, metric_key, value').gte('date', sprint.from).lt('date', sprint.to),
```

with:

```js
        // The sprint window is ~90 days: page it.
        fetchAllSettled(() => supabase.from('metrics_daily').select('date, business_id, metric_key, value').gte('date', sprint.from).lt('date', sprint.to).order('id')),
```

Replace:

```js
        supabase.from('activities')
          .select('occurred_at, business_id')
          .eq('type', 'call').eq('direction', 'outbound').gte('occurred_at', earliestStartIso),
```

with:

```js
        // Up to 31 days of outbound calls across both books can pass 1,000.
        fetchAllSettled(() => supabase.from('activities')
          .select('occurred_at, business_id')
          .eq('type', 'call').eq('direction', 'outbound').gte('occurred_at', earliestStartIso)
          .order('id')),
```

The destructuring `const [deals, active, ..., callRows] = await Promise.all([...])` and the `deals.error || active.error || ...` check stay unchanged. `fetchAllSettled` gives the same `{ data, error }` shape.

- [ ] **Step 2: Run the full suite and the build**

Run: `npm test`
Expected: PASS.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Reports.jsx
git commit -m "fix: page Reports reads past 1,000 rows"
```

---

### Task 5: Row-cap audit test

**Files:**
- Create: `src/lib/rowCap.audit.test.js`

- [ ] **Step 1: Write the scanner unit tests first (scanner not written yet)**

Create `src/lib/rowCap.audit.test.js` with only the imports, constants, and unit tests below. Add the scanner functions in Step 3.

```js
// Guard against PostgREST's silent 1,000-row cap (see src/lib/fetchAll.js).
// Scans every browser source file for a Supabase .from( read that is neither
// bounded nor paged. Crude by design: it reads text, not an AST.
//
// A chain passes when it is a write, carries a bound (.range / .limit /
// .maybeSingle / .single / head: true / .gte / .lte), or sits inside
// fetchAll / fetchAllSettled within the three lines above it. A fetchAll
// chain must also .order(): paging an unordered query can skip or repeat
// rows. For a genuinely small table (businesses, stages, settings), put
// `// rowcap-ok: <reason>` within the three lines above the .from(.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const BOUNDS = ['.range(', '.limit(', '.maybeSingle(', '.single(', 'head: true', '.gte(', '.lte(']
const WRITES = ['.insert(', '.upsert(', '.update(', '.delete(']
const LOOKBACK_LINES = 3
const UNBOUNDED = 'unbounded read: wrap in fetchAllSettled or add a bound'
const NO_ORDER = 'fetchAll query has no .order(): pages can skip or repeat rows'

describe('findUnboundedReads', () => {
  it('flags a bare select on contacts', () => {
    const src = "const { data } = await supabase.from('contacts').select('*')\n"
    expect(findUnboundedReads(src)).toEqual([{ line: 1, reason: UNBOUNDED }])
  })

  it('flags a bare multi-line chain on the .from( line', () => {
    const src = [
      'const { data } = await supabase',
      "  .from('v_tasks')",
      "  .select('id')",
      "  .order('due_at')",
      '',
    ].join('\n')
    expect(findUnboundedReads(src)).toEqual([{ line: 2, reason: UNBOUNDED }])
  })

  it('passes bounded reads', () => {
    const src = [
      "supabase.from('a').select('*').range(0, 49)",
      "supabase.from('b').select('*').limit(1)",
      "supabase.from('c').select('*').eq('key', 'x').maybeSingle()",
      "supabase.from('d').select('id', { count: 'exact', head: true })",
      "supabase.from('e').select('*').gte('date', from)",
      '',
    ].join('\n')
    expect(findUnboundedReads(src)).toEqual([])
  })

  it('passes writes', () => {
    const src = [
      'await supabase',
      "  .from('metrics_daily')",
      "  .upsert(rows, { onConflict: 'business_id,date,metric_key' })",
      '',
    ].join('\n')
    expect(findUnboundedReads(src)).toEqual([])
  })

  it('passes an ordered fetchAll chain', () => {
    const src = [
      'const { data } = await fetchAllSettled(() =>',
      '  supabase',
      "    .from('contacts')",
      "    .select('*')",
      "    .order('id'),",
      ')',
      '',
    ].join('\n')
    expect(findUnboundedReads(src)).toEqual([])
  })

  it('flags a fetchAll chain with no order', () => {
    const src = "const r = await fetchAllSettled(() => supabase.from('contacts').select('*'))\n"
    expect(findUnboundedReads(src)).toEqual([{ line: 1, reason: NO_ORDER }])
  })

  it('does not let a fetchAll on the line above cover the next query', () => {
    const src = [
      'await Promise.all([',
      "  fetchAllSettled(() => supabase.from('deals').select('*').order('id')),",
      "  supabase.from('contacts').select('*'),",
      '])',
      '',
    ].join('\n')
    expect(findUnboundedReads(src)).toEqual([{ line: 3, reason: UNBOUNDED }])
  })

  it('checks each branch of a ternary separately', () => {
    const src = [
      'const q = all',
      "  ? supabase.from('v_tasks').select('id').limit(5)",
      "  : supabase.from('v_tasks').select('id')",
      '',
    ].join('\n')
    expect(findUnboundedReads(src)).toEqual([{ line: 3, reason: UNBOUNDED }])
  })

  it('honors a rowcap-ok comment', () => {
    const src = [
      '// rowcap-ok: two rows, one per book',
      "const { data } = await supabase.from('businesses').select('*')",
      '',
    ].join('\n')
    expect(findUnboundedReads(src)).toEqual([])
  })

  it('ignores Array.from and other non-Supabase .from( calls', () => {
    const src = 'const xs = Array.from({ length: 8 }, (_, i) => i)\n'
    expect(findUnboundedReads(src)).toEqual([])
  })

  it('handles CRLF line endings', () => {
    const src = "const a = 1\r\nconst { data } = await supabase.from('contacts').select('*')\r\n"
    expect(findUnboundedReads(src)).toEqual([{ line: 2, reason: UNBOUNDED }])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/rowCap.audit.test.js`
Expected: FAIL, `ReferenceError: findUnboundedReads is not defined`.

- [ ] **Step 3: Add the scanner and the `src/` scan**

In the same file, insert below the constants (above the first `describe`):

```js
// The builder text from `start` (the index of ".from(") to where the
// expression ends: a , or ; or an unmatched closer at depth 0, or a newline
// whose next line does not continue the chain with ".".
function chainAt(src, start) {
  let depth = 0
  let quote = null
  for (let i = start; i < src.length; i++) {
    const c = src[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') quote = c
    else if ('([{'.includes(c)) depth++
    else if (')]}'.includes(c)) {
      if (depth === 0) return src.slice(start, i)
      depth--
    } else if (depth === 0) {
      if (c === ',' || c === ';') return src.slice(start, i)
      if (c === '\n' && !src.slice(i + 1).trimStart().startsWith('.')) return src.slice(start, i)
    }
  }
  return src.slice(start)
}

// A Supabase .from( follows `supabase` or starts its own line (a chain
// continuation). This skips Array.from( and friends.
function isQueryFrom(src, idx) {
  const lineStart = src.lastIndexOf('\n', idx - 1) + 1
  return /supabase\s*$/.test(src.slice(Math.max(0, idx - 40), idx)) || src.slice(lineStart, idx).trim() === ''
}

// The text before `idx`: the rest of its own line plus LOOKBACK_LINES lines
// above, cut after any earlier .from( so a neighbouring query's fetchAll or
// comment doesn't count for this one.
function lookback(src, idx) {
  let cut = idx
  for (let n = 0; n <= LOOKBACK_LINES && cut > 0; n++) cut = src.lastIndexOf('\n', cut - 1)
  const ctx = src.slice(cut + 1, idx)
  const prev = ctx.lastIndexOf('.from(')
  return prev === -1 ? ctx : ctx.slice(prev + 1)
}

function findUnboundedReads(src) {
  const problems = []
  const re = /\.from\(/g
  let m
  while ((m = re.exec(src))) {
    if (!isQueryFrom(src, m.index)) continue
    const chain = chainAt(src, m.index)
    const ctx = lookback(src, m.index)
    const line = src.slice(0, m.index).split('\n').length
    if (ctx.includes('rowcap-ok:')) continue
    if (WRITES.some((w) => chain.includes(w))) continue
    if (ctx.includes('fetchAll')) {
      if (!chain.includes('.order(')) problems.push({ line, reason: NO_ORDER })
      continue
    }
    if (BOUNDS.some((b) => chain.includes(b))) continue
    problems.push({ line, reason: UNBOUNDED })
  }
  return problems
}

const SRC_DIR = fileURLToPath(new URL('..', import.meta.url))

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    if (e.isDirectory()) return sourceFiles(p)
    return /\.jsx?$/.test(e.name) && !/\.test\.jsx?$/.test(e.name) ? [p] : []
  })
}
```

At the end of the file, add the real scan:

```js
describe('row-cap audit: src/', () => {
  it('has no unbounded Supabase reads', () => {
    const found = sourceFiles(SRC_DIR).flatMap((file) =>
      findUnboundedReads(readFileSync(file, 'utf8')).map(
        (p) => `${relative(SRC_DIR, file)}:${p.line} ${p.reason}`,
      ),
    )
    expect(found).toEqual([])
  })
})
```

- [ ] **Step 4: Run the audit**

Run: `npx vitest run src/lib/rowCap.audit.test.js`
Expected: PASS, 12 tests. If the `src/` scan fails, the message lists `file:line reason`. Fix that call site (wrap it in `fetchAllSettled` with `.order('id')`, or add a real bound). Do not loosen the scanner.

- [ ] **Step 5: Prove the guard bites on real code**

Temporarily revert the Contacts fix. In `src/pages/Contacts.jsx` change the `fetchAllSettled(...)` call back to `await supabase.from(config.source).select('*')`.

Run: `npx vitest run src/lib/rowCap.audit.test.js`
Expected: FAIL, with `pages\Contacts.jsx:<line> unbounded read: wrap in fetchAllSettled or add a bound` (`pages/` on macOS/Linux).

Restore it:

```bash
git checkout src/pages/Contacts.jsx
```

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/rowCap.audit.test.js
git commit -m "test: audit src/ for Supabase reads that can hit the 1,000-row cap"
```

---

### Task 6: `fub-webhook` fails closed (ship alongside)

**Files:**
- Modify: `supabase/functions/fub-webhook/index.ts:23-26`

Today a missing `FUB_WEBHOOK_SECRET` means *any* request is accepted. The fix makes a missing secret reject everything.

- [ ] **Step 1: Confirm the secret is set before changing anything**

Run: `supabase secrets list --project-ref cnmipfxwqnbtkohfixkf`
Expected: `FUB_WEBHOOK_SECRET` appears. **If it does not, stop and tell Chandler.** Deploying the fix without the secret would make FUB's webhook calls fail with 401 until the secret is set and the FUB webhook URL carries `?secret=<value>`.

- [ ] **Step 2: Make the change**

Replace:

```ts
  const expected = Deno.env.get('FUB_WEBHOOK_SECRET')
  if (expected && url.searchParams.get('secret') !== expected) {
    return new Response('unauthorized', { status: 401 })
  }
```

with:

```ts
  const expected = Deno.env.get('FUB_WEBHOOK_SECRET')
  // Fail closed: with no secret configured, reject everything rather than
  // accept unauthenticated writes from anyone who finds the URL.
  if (!expected || url.searchParams.get('secret') !== expected) {
    return new Response('unauthorized', { status: 401 })
  }
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/fub-webhook/index.ts
git commit -m "fix: fub-webhook rejects requests when FUB_WEBHOOK_SECRET is unset"
```

- [ ] **Step 4: Deploy (Chandler's go-ahead first)**

Ask before deploying. Then:

```bash
supabase functions deploy fub-webhook --no-verify-jwt --project-ref cnmipfxwqnbtkohfixkf
```

Verify: a request with no `secret` gets 401:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST "https://cnmipfxwqnbtkohfixkf.supabase.co/functions/v1/fub-webhook" -d "{}"
```

Expected: `401`. Then check that the next FUB webhook event still lands. Look in Supabase function logs for a 200 on the next real event, or in `sync_log`.

---

### Task 7: Live verification and PR

- [ ] **Step 1: Run the app against live Supabase**

Start the dev server (`npm run dev`, or the preview config in `.claude/launch.json`) and sign in.

- [ ] **Step 2: Acceptance 1, Contacts total**

In the Supabase SQL editor:

```sql
select count(*) from contacts where business_id = 'bay';
select count(*) from v_bayway_contacts;
```

Both numbers should match each other and the Bayway Contacts page total. Repeat for MPG with `business_id = 'mpg'` and `v_mpg_contacts`. In the browser network panel, if the count is over 1,000, confirm two or more `v_bayway_contacts` requests went out, each with `offset=` and `limit=` query params (that is how supabase-js sends `.range()`).

- [ ] **Step 3: Acceptance 2, rows past position 1,000**

```sql
select id, name from contacts
where business_id = 'bay'
order by id
offset 1000 limit 5;
```

If this returns rows, search for one of those names on the Contacts page and confirm it appears. If the HOT-tagged or priority-lead sets are under 1,000 rows today, this is covered by the unit tests and the network check in Step 2. Say so in the PR rather than claiming it was seen live.

- [ ] **Step 4: Overview, Reports, Pipeline, Priority Leads, My Tasks still render**

Open each page in all three business filters (All, Bayway, MPG). No error banners, and numbers match what `main` showed before the change (the combined Outbound Calls KPI, pipeline counts, task counts). Check the console for errors.

- [ ] **Step 5: Supabase Auth signups (spec's "ship alongside", manual)**

In the Supabase dashboard, open Authentication, then Sign In / Providers, then Email. Confirm "Allow new users to sign up" is **off**. Report what was found. Changing it is Chandler's call.

- [ ] **Step 6: Final suite and push**

Run: `npm test`
Expected: PASS.

```bash
git push -u origin fix/browser-row-cap
gh pr create --title "fix: page browser reads past the 1,000-row cap" --body "<summary of Tasks 1-6, what was verified live in Task 7, and anything that could not be verified live>"
```
