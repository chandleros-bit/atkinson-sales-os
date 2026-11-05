# Lead Sources & ROI Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Analytics Lead sources card shows, per source and book, leads, progress, funded loans, commission, spend, cost per lead and cost per funded loan, with a Spend sheet for monthly spend, free sources and source merges.

**Architecture:** Two owner-only tables (`source_aliases`, `marketing_spend`, migration 0059). Pure maths in `src/lib/roi.js` builds on the existing `sourceTable` and the Arive loan helpers (`estComp`, `isScenario`). `src/lib/roiData.js` is the Supabase glue. `Analytics.jsx` loads loans and ROI inputs next to its current reads and renders `RoiTable`; `SpendSheet.jsx` edits spend and aliases.

**Tech Stack:** React 18, Vite, Tailwind 3, Supabase (Postgres RLS), vitest + jsdom.

**Spec:** `docs/superpowers/specs/2026-11-05-lead-sources-roi-design.md`

**Worktree:** `.claude/worktrees/lead-roi`, branch `feat/lead-roi` (node_modules junction and `supabase/.temp` already in place). Run every command from the worktree.

---

## File map

| File | Change | Responsibility |
|---|---|---|
| `supabase/migrations/0059_lead_roi.sql` | Create | Tables, owner-only RLS |
| `supabase/tests/lead_roi.sql` | Create | RLS check, rolls back |
| `src/lib/analytics.js` | Modify | Export `cleanSource` |
| `src/lib/roi.js` | Create | Aliases, spend proration, funded loans, ROI rows, KPIs, spend-sheet helpers, money format |
| `src/lib/roi.test.js` | Create | Unit tests |
| `src/lib/roiData.js` | Create | Reads and writes for aliases and spend |
| `src/components/SpendSheet.jsx` | Create | Month × source grid, free toggle, merge / unmerge |
| `src/components/SpendSheet.render.test.jsx` | Create | Sheet behaviour |
| `src/pages/Analytics.jsx` | Modify | Load loans + ROI inputs, `RoiTable`, KPI tiles, Spend button, error line |
| `src/pages/Analytics.render.test.jsx` | Modify | New columns, tiles, sheet, error line |

---

### Task 1: Migration and RLS test

**Files:**
- Create: `supabase/migrations/0059_lead_roi.sql`
- Create: `supabase/tests/lead_roi.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Lead Sources & ROI card (spec 2026-11-05-lead-sources-roi-design.md).
--   * source_aliases: merge raw lead sources under one label, and mark a
--     label free (no spend expected). raw is the cleaned source as the
--     Analytics table shows it.
--   * marketing_spend: one amount per book, label and month.
-- Owner only: Analytics is not on the assistant's pages.

create table if not exists public.source_aliases (
  id         uuid primary key default gen_random_uuid(),
  book       text not null check (book in ('bay', 'mpg')),
  raw        text not null,
  label      text not null check (length(trim(label)) > 0),
  is_free    boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (book, raw)
);

create table if not exists public.marketing_spend (
  id         uuid primary key default gen_random_uuid(),
  book       text not null check (book in ('bay', 'mpg')),
  source     text not null,
  month      date not null check (extract(day from month) = 1),
  amount     numeric(12, 2) not null check (amount >= 0),
  updated_at timestamptz not null default now(),
  unique (book, source, month)
);

alter table public.source_aliases enable row level security;
alter table public.marketing_spend enable row level security;

drop policy if exists "owner all source_aliases" on public.source_aliases;
create policy "owner all source_aliases" on public.source_aliases
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

drop policy if exists "owner all marketing_spend" on public.marketing_spend;
create policy "owner all marketing_spend" on public.marketing_spend
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
```

- [ ] **Step 2: Write the RLS test**

```sql
-- Lead ROI access (spec 2026-11-05-lead-sources-roi-design.md). Runs as
-- postgres, impersonates the owner and a fake assistant, and ROLLS BACK.
-- Run: npx supabase db query --linked -f supabase/tests/lead_roi.sql
begin;

insert into public.user_roles (user_id, role, books, name)
values ('00000000-0000-4000-8000-0000000000a4', 'assistant', array['bay'], 'ROI Assistant');

set local role authenticated;

-- Owner: read and write both tables.
select set_config('request.jwt.claims', '{"sub":"2cbf8825-be9d-429a-a4ed-3c3915d09c1d","role":"authenticated"}', true);
do $$
declare n int;
begin
  insert into public.source_aliases (book, raw, label, is_free) values ('bay', 'ROI Test Raw', 'ROI Test', true);
  insert into public.marketing_spend (book, source, month, amount) values ('bay', 'ROI Test', '2026-10-01', 310);
  select count(*) into n from public.marketing_spend where source = 'ROI Test';
  if n <> 1 then raise exception 'FAIL: owner reads % spend rows', n; end if;
  begin
    insert into public.marketing_spend (book, source, month, amount) values ('bay', 'ROI Test', '2026-10-02', 1);
    raise exception 'FAIL: mid-month spend accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.marketing_spend (book, source, month, amount) values ('bay', 'ROI Test', '2026-09-01', -5);
    raise exception 'FAIL: negative spend accepted';
  exception when check_violation then null;
  end;
  raise notice 'owner lead_roi: all checks passed';
end $$;

-- Assistant: sees nothing, writes nothing.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a4","role":"authenticated"}', true);
do $$
declare n int;
begin
  select count(*) into n from public.marketing_spend;
  if n <> 0 then raise exception 'FAIL: assistant reads % spend rows', n; end if;
  select count(*) into n from public.source_aliases;
  if n <> 0 then raise exception 'FAIL: assistant reads % aliases', n; end if;
  begin
    insert into public.marketing_spend (book, source, month, amount) values ('bay', 'Sneaky', '2026-10-01', 1);
    raise exception 'FAIL: assistant insert allowed';
  exception when insufficient_privilege then null;
  end;
  raise notice 'assistant lead_roi: all checks passed';
end $$;

rollback;
```

The migration is applied in Task 7 (production change: ask Chandler first). Running the test before then fails on the missing tables, which is expected.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0059_lead_roi.sql supabase/tests/lead_roi.sql
git commit -m "feat: source aliases and marketing spend tables (owner only)"
```

---

### Task 2: `roi.js` core maths

**Files:**
- Modify: `src/lib/analytics.js:136` (export `cleanSource`)
- Create: `src/lib/roi.js`
- Create: `src/lib/roi.test.js`

- [ ] **Step 1: Export `cleanSource`**

In `src/lib/analytics.js` change

```js
const cleanSource = (s) => {
```

to

```js
export const cleanSource = (s) => {
```

- [ ] **Step 2: Write the failing tests**

`src/lib/roi.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { sourceTable } from './analytics'
import { DEFAULT_RATES } from './loans'
import { aliasMap, labelFor, isFree, windowKeys, spendInWindow, fundedInWindow, roiTable, kpis, formatUsd, NOT_LINKED } from './roi'

const NOW = new Date(2026, 10, 5, 10).getTime() // Thu 5 Nov 2026, 10:00 local
const LEADS = [
  { id: 'a', business_id: 'bay', source: 'Realtor', created: new Date(2026, 9, 20, 9).toISOString(), person_stage: 'Lead', tags: ['estimate sent'] },
  { id: 'b', business_id: 'bay', source: 'Realtor Referral', created: new Date(2026, 9, 25, 9).toISOString(), person_stage: 'Lead', tags: [] },
  { id: 'c', business_id: 'bay', source: 'Lendgo', created: new Date(2026, 9, 28, 9).toISOString(), person_stage: 'Lead', tags: [] },
  { id: 'd', business_id: 'bay', source: 'Lendgo', created: new Date(2026, 10, 1, 9).toISOString(), person_stage: 'Lead', tags: [] },
  { id: 'm', business_id: 'mpg', source: 'Web Research', created: new Date(2026, 10, 2, 9).toISOString(), person_stage: 'Open', tags: null },
]
const BY_ID = new Map(LEADS.map((l) => [l.id, l]))
const ALIASES = [
  { id: 'x1', book: 'bay', raw: 'Realtor', label: 'Realtor referral', is_free: true },
  { id: 'x2', book: 'bay', raw: 'Realtor Referral', label: 'Realtor referral', is_free: false },
]
const SPEND = [
  { id: 's1', book: 'bay', source: 'Lendgo', month: '2026-10-01', amount: 310 },
  { id: 's2', book: 'bay', source: 'Lendgo', month: '2026-11-01', amount: 300 },
  { id: 's3', book: 'bay', source: 'Facebook', month: '2026-10-01', amount: 31 },
  { id: 's4', book: 'mpg', source: 'Web Research', month: '2026-11-01', amount: 30 },
]
const loan = (o) => ({ business_id: 'bay', stage_group: 'funded', role: 'primary', scenario_auto: false, scenario_override: null, comp_override: null, ...o })
const LOANS = [
  loan({ id: 1, contact_id: 'c', funded_on: '2026-10-30', amount: 200000 }), // Lendgo, $2,500
  loan({ id: 2, contact_id: 'c', funded_on: '2026-10-01', amount: 500000 }), // before the window
  loan({ id: 3, contact_id: 'd', funded_on: '2026-11-02', amount: 400000, scenario_override: true }), // scenario
  loan({ id: 4, contact_id: null, funded_on: '2026-11-03', amount: 100000, role: 'assisted' }), // not linked, $750
  loan({ id: 5, contact_id: 'a', funded_on: '2026-11-02', amount: 300000, comp_override: 999 }), // Realtor, override
  loan({ id: 6, contact_id: 'b', funded_on: '2026-11-01', amount: 300000, stage_group: 'closing' }), // not funded
]
const keys = windowKeys(30, NOW)
const fromMs = NOW - 30 * 86400000

function bayRoi() {
  return roiTable(sourceTable(LEADS, 'bay', fromMs), {
    book: 'bay', contactsById: BY_ID, loans: LOANS, rates: DEFAULT_RATES, spendRows: SPEND, aliases: aliasMap(ALIASES), ...keys,
  })
}
const row = (t, source) => t.rows.find((r) => r.source === source)

describe('aliases', () => {
  const map = aliasMap(ALIASES)
  it('maps a raw source to its label, or keeps it', () => {
    expect(labelFor('Realtor', 'bay', map)).toBe('Realtor referral')
    expect(labelFor('Lendgo', 'bay', map)).toBe('Lendgo')
    expect(labelFor('Realtor', 'mpg', map)).toBe('Realtor')
  })
  it('a label is free when any of its alias rows is free', () => {
    expect(isFree('Realtor referral', 'bay', map)).toBe(true)
    expect(isFree('Lendgo', 'bay', map)).toBe(false)
  })
})

describe('windowKeys', () => {
  it('covers exactly N local days ending today', () => {
    expect(windowKeys(30, NOW)).toEqual({ fromKey: '2026-10-07', toKey: '2026-11-05' })
  })
})

describe('spendInWindow', () => {
  it('prorates each month by the days inside the window', () => {
    // Oct: 25 of 31 days -> 250. Nov: 5 of 30 days -> 50.
    expect(spendInWindow(SPEND, 'bay', 'Lendgo', keys.fromKey, keys.toKey)).toBe(300)
  })
  it('is null when the label has no spend in the window', () => {
    expect(spendInWindow(SPEND, 'bay', 'Realtor referral', keys.fromKey, keys.toKey)).toBe(null)
    expect(spendInWindow(SPEND, 'bay', 'Lendgo', '2026-12-01', '2026-12-31')).toBe(null)
  })
  it('counts an entered $0 as zero, not missing', () => {
    expect(spendInWindow([{ book: 'bay', source: 'X', month: '2026-11-01', amount: 0 }], 'bay', 'X', keys.fromKey, keys.toKey)).toBe(0)
  })
})

describe('fundedInWindow', () => {
  it('keeps Bayway funded, non-scenario loans funded in the window', () => {
    expect(fundedInWindow(LOANS, keys.fromKey, keys.toKey).map((l) => l.id)).toEqual([1, 4, 5])
  })
})

describe('roiTable (Bayway)', () => {
  it('merges aliased sources and recomputes the rate', () => {
    const r = row(bayRoi(), 'Realtor referral')
    expect(r.leads).toBe(2)
    expect(r.raws).toEqual(['Realtor', 'Realtor Referral'])
    expect(r.counts.apps).toBe(1)
    expect(r.rate).toBe(50)
  })
  it('credits funded loans and commission to the lead source', () => {
    const r = row(bayRoi(), 'Lendgo')
    expect(r).toMatchObject({ leads: 2, funded: 1, commission: 2500, spend: 300, costPerLead: 150, costPerFunded: 300 })
  })
  it('uses the comp override and shows free sources as free with no costs', () => {
    expect(row(bayRoi(), 'Realtor referral')).toMatchObject({ funded: 1, commission: 999, spend: 'free', costPerLead: null, costPerFunded: null })
  })
  it('puts a funded loan with no lead in "Not linked to a lead", last', () => {
    const t = bayRoi()
    expect(t.rows.at(-1)).toMatchObject({ source: NOT_LINKED, funded: 1, commission: 750, spend: null, notLinked: true })
  })
  it('shows spend on a source with no leads in the window', () => {
    expect(row(bayRoi(), 'Facebook')).toMatchObject({ leads: 0, spend: 25, costPerLead: null })
  })
  it('orders by leads, then name; no-lead rows and Not linked come after', () => {
    expect(bayRoi().rows.map((r) => r.source)).toEqual(['Lendgo', 'Realtor referral', 'Facebook', NOT_LINKED])
  })
  it('totals use the summed spend, leads and funded', () => {
    expect(bayRoi().total).toMatchObject({ source: 'Total', leads: 4, funded: 3, commission: 4249, spend: 325, costPerLead: 81.25, costPerFunded: 108.33 })
  })
})

describe('roiTable (MPG)', () => {
  it('has spend and cost per lead, no funded or commission', () => {
    const t = roiTable(sourceTable(LEADS, 'mpg', fromMs), {
      book: 'mpg', contactsById: BY_ID, loans: LOANS, rates: DEFAULT_RATES, spendRows: SPEND, aliases: aliasMap([]), ...keys,
    })
    expect(t.rows).toHaveLength(1)
    expect(t.rows[0]).toMatchObject({ source: 'Web Research', leads: 1, funded: null, commission: null, spend: 5, costPerLead: 5, costPerFunded: null })
  })
})

describe('kpis and formatUsd', () => {
  it('reads the tiles off the total', () => {
    expect(kpis(bayRoi())).toEqual({ leads: 4, spend: 325, costPerLead: 81.25, costPerFunded: 108.33 })
  })
  it('formats whole dollars, dashes and free', () => {
    expect(formatUsd(4249)).toBe('$4,249')
    expect(formatUsd(81.25)).toBe('$81')
    expect(formatUsd(null)).toBe('—')
    expect(formatUsd('free')).toBe('free')
  })
})
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx vitest run src/lib/roi.test.js`
Expected: FAIL, `Failed to resolve import "./roi"`.

- [ ] **Step 4: Write `src/lib/roi.js` (core)**

```js
// Lead Sources & ROI card (spec 2026-11-05-lead-sources-roi-design.md). Pure.
// Builds on sourceTable (analytics.js) and the Arive loan helpers (loans.js).
// Days are local calendar days on YYYY-MM-DD keys, so DST never skews spend.
import { SOURCE_COLUMNS, cleanSource } from './analytics'
import { estComp, isScenario } from './loans'
import { dayKey, keyDaysBetween } from './calendar'

export const NOT_LINKED = 'Not linked to a lead'

// source_aliases rows -> { bay: Map(raw -> { label, is_free }), mpg: Map }.
export function aliasMap(rows) {
  const out = { bay: new Map(), mpg: new Map() }
  for (const r of rows || []) {
    if (!out[r.book]) continue
    const label = String(r.label || '').trim() || r.raw
    out[r.book].set(r.raw, { label, is_free: !!r.is_free })
  }
  return out
}

export const labelFor = (raw, book, map) => map?.[book]?.get(raw)?.label || raw

export function isFree(label, book, map) {
  for (const v of map?.[book]?.values() || []) if (v.label === label && v.is_free) return true
  return false
}

// 'YYYY-MM-DD' + n days, on UTC midnights (date keys have no time zone).
export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

// The last `days` local calendar days, today included.
export function windowKeys(days, now = Date.now()) {
  const toKey = dayKey(now)
  return { fromKey: addDays(toKey, -(days - 1)), toKey }
}

const monthDays = (monthKey) => {
  const [y, m] = monthKey.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}
const nextMonth = (monthKey) => {
  const [y, m] = monthKey.split('-').map(Number)
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)
}

// Spend on `label` in [fromKey, toKey], each month prorated by its days in the
// window. null when no spend row overlaps (shown as "—", never $0).
export function spendInWindow(rows, book, label, fromKey, toKey) {
  const endExcl = addDays(toKey, 1)
  let sum = 0
  let any = false
  for (const r of rows || []) {
    if (r.book !== book || r.source !== label) continue
    const start = String(r.month).slice(0, 10)
    const lo = start > fromKey ? start : fromKey
    const monthEnd = nextMonth(start)
    const hi = monthEnd < endExcl ? monthEnd : endExcl
    const days = keyDaysBetween(lo, hi)
    if (days <= 0) continue
    any = true
    sum += (Number(r.amount) || 0) * (days / monthDays(start))
  }
  return any ? round2(sum) : null
}

const round2 = (n) => Math.round(n * 100) / 100

// Bayway loans that funded in the window. Scenario files are left out.
export function fundedInWindow(loans, fromKey, toKey) {
  return (loans || []).filter(
    (l) => l.business_id === 'bay' && l.stage_group === 'funded' && !isScenario(l) && l.funded_on && l.funded_on >= fromKey && l.funded_on <= toKey,
  )
}

const divide = (spend, n) => (typeof spend === 'number' && n > 0 ? round2(spend / n) : null)

// sourceTable output -> the ROI table: rows merged by alias label, each with
// funded, commission (Bayway; null on MPG), spend (number, null or 'free')
// and costs. Labels with only spend, and funded loans with no lead in this
// book ("Not linked to a lead"), get rows too, so no money is hidden.
export function roiTable(table, { book, contactsById, loans, rates, spendRows, aliases, fromKey, toKey }) {
  const bay = book === 'bay'
  const rateId = SOURCE_COLUMNS[book].rate
  const groups = new Map()
  const group = (label) => {
    if (!groups.has(label)) groups.set(label, { source: label, raws: [], leads: 0, counts: {}, funded: 0, commission: 0 })
    return groups.get(label)
  }
  for (const r of table.rows) {
    const g = group(labelFor(r.source, book, aliases))
    g.raws.push(r.source)
    g.leads += r.leads
    for (const [k, v] of Object.entries(r.counts)) g.counts[k] = (g.counts[k] || 0) + v
  }
  const notLinked = { source: NOT_LINKED, raws: [], leads: 0, counts: {}, funded: 0, commission: 0, notLinked: true }
  if (bay) {
    for (const l of fundedInWindow(loans, fromKey, toKey)) {
      const c = l.contact_id ? contactsById.get(l.contact_id) : null
      const g = c && c.business_id === book ? group(labelFor(cleanSource(c.source), book, aliases)) : notLinked
      g.funded += 1
      g.commission += estComp(l, rates) || 0
    }
  }
  for (const s of spendRows || []) {
    if (s.book === book && spendInWindow([s], book, s.source, fromKey, toKey) != null) group(s.source)
  }

  const finish = (g) => {
    const spend = g.notLinked ? null : isFree(g.source, book, aliases) ? 'free' : spendInWindow(spendRows, book, g.source, fromKey, toKey)
    return {
      ...g,
      raws: [...g.raws].sort(),
      rate: g.leads ? Math.round(((g.counts[rateId] || 0) / g.leads) * 100) : 0,
      funded: bay ? g.funded : null,
      commission: bay ? round2(g.commission) : null,
      spend,
      costPerLead: divide(spend, g.leads),
      costPerFunded: bay ? divide(spend, g.funded) : null,
    }
  }
  const rows = [...groups.values()]
    .map(finish)
    .sort((a, b) => (b.leads > 0) - (a.leads > 0) || b.leads - a.leads || a.source.localeCompare(b.source))
  if (notLinked.funded) rows.push(finish(notLinked))

  const spends = rows.map((r) => r.spend).filter((s) => typeof s === 'number')
  const totalSpend = spends.length ? round2(spends.reduce((a, b) => a + b, 0)) : null
  const funded = bay ? rows.reduce((a, r) => a + r.funded, 0) : null
  const total = {
    source: 'Total',
    raws: [],
    leads: table.total.leads,
    counts: table.total.counts,
    rate: table.total.rate,
    funded,
    commission: bay ? round2(rows.reduce((a, r) => a + r.commission, 0)) : null,
    spend: totalSpend,
    costPerLead: divide(totalSpend, table.total.leads),
    costPerFunded: bay ? divide(totalSpend, funded) : null,
  }
  return { cols: table.cols, rows, total }
}

export function kpis(roi) {
  const t = roi.total
  return { leads: t.leads, spend: t.spend, costPerLead: t.costPerLead, costPerFunded: t.costPerFunded }
}

// Whole dollars; null -> "—"; 'free' stays 'free'.
export function formatUsd(v) {
  if (v === 'free') return 'free'
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 })
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run src/lib/roi.test.js src/lib/analytics.test.js`
Expected: PASS (all).

Check the maths if one fails: Lendgo Oct 310 × 25/31 = 250 and Nov 300 × 5/30 = 50 (300); Facebook 31 × 25/31 = 25; MPG Nov 30 × 5/30 = 5; total spend 300 + 25 = 325 (Realtor referral is free, MPG is a separate book); 325 / 4 = 81.25; 325 / 3 = 108.33.

- [ ] **Step 6: Commit**

```bash
git add src/lib/analytics.js src/lib/roi.js src/lib/roi.test.js
git commit -m "feat: lead source ROI maths (aliases, prorated spend, funded commission)"
```

---

### Task 3: Spend-sheet helpers

**Files:**
- Modify: `src/lib/roi.js` (append)
- Modify: `src/lib/roi.test.js` (append)

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/roi.test.js`:

```js
import { lastMonths, sheetLabels, spendCells, spendChanges, mergeRows, freeRows } from './roi'

describe('spend sheet helpers', () => {
  it('lastMonths lists month keys newest first', () => {
    expect(lastMonths(3, NOW)).toEqual(['2026-11-01', '2026-10-01', '2026-09-01'])
    expect(lastMonths(2, new Date(2026, 0, 15).getTime())).toEqual(['2026-01-01', '2025-12-01'])
  })

  it('sheetLabels joins lead labels and spend labels, sorted', () => {
    const t = sourceTable(LEADS, 'bay', fromMs)
    expect(sheetLabels(t, 'bay', SPEND, aliasMap(ALIASES))).toEqual(['Facebook', 'Lendgo', 'Realtor referral'])
  })

  it('spendCells keys amounts by label and month', () => {
    expect(spendCells(SPEND, 'bay')).toEqual({ 'Lendgo|2026-10-01': '310', 'Lendgo|2026-11-01': '300', 'Facebook|2026-10-01': '31' })
  })

  it('spendChanges upserts edits, deletes cleared cells and skips unchanged ones', () => {
    const cells = { 'Lendgo|2026-10-01': '310', 'Lendgo|2026-11-01': '', 'Facebook|2026-10-01': '$45', 'Lendgo|2026-09-01': '1,200' }
    expect(spendChanges(SPEND, 'bay', cells)).toEqual({
      upserts: [
        { book: 'bay', source: 'Facebook', month: '2026-10-01', amount: 45 },
        { book: 'bay', source: 'Lendgo', month: '2026-09-01', amount: 1200 },
      ],
      deletes: ['s2'],
      problem: null,
    })
  })

  it('spendChanges refuses text and negative amounts', () => {
    expect(spendChanges(SPEND, 'bay', { 'Lendgo|2026-09-01': 'abc' }).problem).toBe('Enter a dollar amount for Lendgo, 2026-09.')
    expect(spendChanges(SPEND, 'bay', { 'Lendgo|2026-09-01': '-5' }).problem).toBe('Enter a dollar amount for Lendgo, 2026-09.')
  })

  it('mergeRows makes one alias row per raw source', () => {
    expect(mergeRows('bay', ['Chandler', 'Chandler Atkinson'], ' Self-sourced ')).toEqual([
      { book: 'bay', raw: 'Chandler', label: 'Self-sourced', is_free: false },
      { book: 'bay', raw: 'Chandler Atkinson', label: 'Self-sourced', is_free: false },
    ])
  })

  it('freeRows flips every alias row of a label, or adds a self-alias', () => {
    expect(freeRows('bay', 'Realtor referral', ALIASES, false)).toEqual([
      { book: 'bay', raw: 'Realtor', label: 'Realtor referral', is_free: false },
      { book: 'bay', raw: 'Realtor Referral', label: 'Realtor referral', is_free: false },
    ])
    expect(freeRows('bay', 'Lendgo', ALIASES, true)).toEqual([{ book: 'bay', raw: 'Lendgo', label: 'Lendgo', is_free: true }])
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/lib/roi.test.js`
Expected: FAIL, `lastMonths is not a function` (or not exported).

- [ ] **Step 3: Append the helpers to `src/lib/roi.js`**

Add `import { parseAmount } from './calc/parse'` to the imports at the top, then append:

```js
// ---- Spend sheet ---------------------------------------------------------------

const pad2 = (n) => String(n).padStart(2, '0')

// The last n month keys ('YYYY-MM-01'), local calendar, newest first.
export function lastMonths(n, now = Date.now()) {
  const d = new Date(now)
  return Array.from({ length: n }, (_, i) => {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1)
    return `${m.getFullYear()}-${pad2(m.getMonth() + 1)}-01`
  })
}

// Grid rows: labels of the book's sources (a sourceTable, usually 12 months)
// plus every label that has spend, sorted.
export function sheetLabels(table, book, spendRows, map) {
  const set = new Set(table.rows.map((r) => labelFor(r.source, book, map)))
  for (const s of spendRows || []) if (s.book === book) set.add(s.source)
  return [...set].sort((a, b) => a.localeCompare(b))
}

const cellKey = (label, month) => `${label}|${month}`

// Spend rows -> { 'label|YYYY-MM-01': '310' } for the sheet's inputs.
export function spendCells(spendRows, book) {
  const out = {}
  for (const s of spendRows || []) if (s.book === book) out[cellKey(s.source, String(s.month).slice(0, 10))] = String(Number(s.amount))
  return out
}

// Edited cells vs saved rows -> { upserts, deletes (row ids), problem }.
// A blank cell deletes its row; unchanged cells are skipped.
export function spendChanges(spendRows, book, cells) {
  const saved = new Map()
  for (const s of spendRows || []) if (s.book === book) saved.set(cellKey(s.source, String(s.month).slice(0, 10)), s)
  const upserts = []
  const deletes = []
  for (const [key, value] of Object.entries(cells)) {
    const [source, month] = key.split('|')
    const row = saved.get(key)
    const text = String(value ?? '').trim()
    if (text === '') {
      if (row) deletes.push(row.id)
      continue
    }
    const amount = parseAmount(text)
    if (amount == null || amount < 0) return { upserts: [], deletes: [], problem: `Enter a dollar amount for ${source}, ${month.slice(0, 7)}.` }
    if (!row || Number(row.amount) !== amount) upserts.push({ book, source, month, amount })
  }
  return { upserts, deletes, problem: null }
}

export function mergeRows(book, raws, label) {
  return raws.map((raw) => ({ book, raw, label: label.trim(), is_free: false }))
}

// Alias rows (raw rows, not the map) -> upserts that set is_free on a label.
export function freeRows(book, label, aliasRows, free) {
  const mine = (aliasRows || []).filter((a) => a.book === book && a.label === label)
  if (!mine.length) return [{ book, raw: label, label, is_free: free }]
  return mine.map((a) => ({ book, raw: a.raw, label, is_free: free }))
}
```

- [ ] **Step 4: Run to see them pass**

Run: `npx vitest run src/lib/roi.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/roi.js src/lib/roi.test.js
git commit -m "feat: spend sheet helpers (months, cells, changes, merges, free)"
```

---

### Task 4: `roiData.js` Supabase glue

**Files:**
- Create: `src/lib/roiData.js`

No unit test of its own: it is a thin wrapper, exercised through the Analytics and SpendSheet render tests (which mock it or the client). The row-cap audit covers its reads.

- [ ] **Step 1: Write `src/lib/roiData.js`**

```js
// Supabase glue for the ROI card: source aliases and marketing spend (0059).
// Reads return { data, error } like a bare query. Before 0059 is applied the
// missing tables read as empty.
import { supabase } from './supabase'
import { isMissingTable } from './loansData'

const empty = (res) => (isMissingTable(res.error) ? { data: [], error: null } : res)

// -> { data: { aliases, spend }, error }
export async function fetchRoiInputs() {
  const [aliases, spend] = (
    await Promise.all([
      supabase.from('source_aliases').select('id, book, raw, label, is_free').order('id').limit(500),
      supabase.from('marketing_spend').select('id, book, source, month, amount').order('month', { ascending: false }).limit(2000),
    ])
  ).map(empty)
  const error = aliases.error || spend.error
  if (error) return { data: null, error }
  return { data: { aliases: aliases.data || [], spend: spend.data || [] }, error: null }
}

// { upserts, deletes } from spendChanges -> { error }
export async function saveSpend({ upserts, deletes }) {
  const now = new Date().toISOString()
  if (upserts.length) {
    const { error } = await supabase.from('marketing_spend').upsert(upserts.map((u) => ({ ...u, updated_at: now })), { onConflict: 'book,source,month' })
    if (error) return { error }
  }
  if (deletes.length) {
    const { error } = await supabase.from('marketing_spend').delete().in('id', deletes)
    if (error) return { error }
  }
  return { error: null }
}

export async function saveAliases(rows) {
  const now = new Date().toISOString()
  const { error } = await supabase.from('source_aliases').upsert(rows.map((r) => ({ ...r, updated_at: now })), { onConflict: 'book,raw' })
  return { error: error || null }
}

export async function removeAliases(ids) {
  const { error } = await supabase.from('source_aliases').delete().in('id', ids)
  return { error: error || null }
}
```

- [ ] **Step 2: Run the row-cap audit**

Run: `npx vitest run src/lib/rowCap.audit.test.js`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/roiData.js
git commit -m "feat: ROI aliases and spend reads and writes"
```

---

### Task 5: `SpendSheet` component

**Files:**
- Create: `src/components/SpendSheet.jsx`
- Create: `src/components/SpendSheet.render.test.jsx`

- [ ] **Step 1: Write the failing render test**

`src/components/SpendSheet.render.test.jsx`:

```jsx
// @vitest-environment jsdom
// Spend sheet: month x source grid, free sources, merges.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import React from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const saveSpend = vi.fn()
const saveAliases = vi.fn()
const removeAliases = vi.fn()
vi.mock('../lib/roiData', () => ({
  saveSpend: (...a) => saveSpend(...a),
  saveAliases: (...a) => saveAliases(...a),
  removeAliases: (...a) => removeAliases(...a),
}))

const { default: SpendSheet } = await import('./SpendSheet')

const NOW = new Date(2026, 10, 5, 10).getTime()
const LEADS = [
  { id: 'a', business_id: 'bay', source: 'Lendgo', created: new Date(2026, 9, 20).toISOString(), person_stage: 'Lead', tags: [] },
  { id: 'b', business_id: 'bay', source: 'Chandler', created: new Date(2026, 9, 21).toISOString(), person_stage: 'Lead', tags: [] },
  { id: 'c', business_id: 'bay', source: 'Chandler Atkinson', created: new Date(2026, 9, 22).toISOString(), person_stage: 'Lead', tags: [] },
]
const SPEND = [{ id: 's1', book: 'bay', source: 'Lendgo', month: '2026-11-01', amount: 300 }]
let onSaved
let onClose

async function mount(props = {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    createRoot(host).render(
      React.createElement(SpendSheet, { biz: 'bay', leads: LEADS, aliases: [], spend: SPEND, onClose, onSaved, nowMs: NOW, ...props }),
    )
  })
  return host
}
const input = (label) => document.querySelector(`input[aria-label="${label}"]`)
const button = (label) => document.querySelector(`button[aria-label="${label}"]`)
async function type(el, value) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  await act(async () => {
    set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  document.body.innerHTML = ''
  saveSpend.mockReset().mockResolvedValue({ error: null })
  saveAliases.mockReset().mockResolvedValue({ error: null })
  removeAliases.mockReset().mockResolvedValue({ error: null })
  onSaved = vi.fn().mockResolvedValue(undefined)
  onClose = vi.fn()
})

describe('SpendSheet', () => {
  it('shows a row per source and a column per month, with saved amounts', async () => {
    await mount()
    expect(document.querySelector('[role="dialog"][aria-label="Marketing spend"]')).not.toBe(null)
    expect(input('Lendgo Nov 26').value).toBe('300')
    expect(input('Chandler Oct 26').value).toBe('')
    expect(document.querySelectorAll('[data-spend-row]')).toHaveLength(3)
  })

  it('saves edited and cleared cells, then reloads and closes', async () => {
    await mount()
    await type(input('Lendgo Oct 26'), '450')
    await type(input('Lendgo Nov 26'), '')
    await act(async () => button('Save spend').click())
    expect(saveSpend).toHaveBeenCalledWith({ upserts: [{ book: 'bay', source: 'Lendgo', month: '2026-10-01', amount: 450 }], deletes: ['s1'] })
    expect(onSaved).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('keeps the sheet open with the message when a save fails', async () => {
    saveSpend.mockResolvedValue({ error: { message: 'permission denied' } })
    await mount()
    await type(input('Lendgo Oct 26'), '450')
    await act(async () => button('Save spend').click())
    expect(document.querySelector('[role="dialog"]').textContent).toContain('permission denied')
    expect(onClose).not.toHaveBeenCalled()
    expect(input('Lendgo Oct 26').value).toBe('450')
  })

  it('refuses a non-number amount without saving', async () => {
    await mount()
    await type(input('Lendgo Oct 26'), 'abc')
    await act(async () => button('Save spend').click())
    expect(saveSpend).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]').textContent).toContain('Enter a dollar amount for Lendgo, 2026-10.')
  })

  it('merges picked sources under one label', async () => {
    await mount()
    await act(async () => input('Merge Chandler').click())
    await act(async () => input('Merge Chandler Atkinson').click())
    await type(input('Merged label'), 'Self-sourced')
    await act(async () => button('Merge sources').click())
    expect(saveAliases).toHaveBeenCalledWith([
      { book: 'bay', raw: 'Chandler', label: 'Self-sourced', is_free: false },
      { book: 'bay', raw: 'Chandler Atkinson', label: 'Self-sourced', is_free: false },
    ])
    expect(onSaved).toHaveBeenCalled()
  })

  it('marks a source free', async () => {
    await mount()
    await act(async () => input('Free Lendgo').click())
    expect(saveAliases).toHaveBeenCalledWith([{ book: 'bay', raw: 'Lendgo', label: 'Lendgo', is_free: true }])
  })

  it('unmerges a merged label', async () => {
    const aliases = [
      { id: 'x1', book: 'bay', raw: 'Chandler', label: 'Self-sourced', is_free: false },
      { id: 'x2', book: 'bay', raw: 'Chandler Atkinson', label: 'Self-sourced', is_free: false },
    ]
    await mount({ aliases })
    await act(async () => button('Unmerge Self-sourced').click())
    expect(removeAliases).toHaveBeenCalledWith(['x1', 'x2'])
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/components/SpendSheet.render.test.jsx`
Expected: FAIL, `Failed to resolve import "./SpendSheet"`.

- [ ] **Step 3: Write `src/components/SpendSheet.jsx`**

```jsx
import { useMemo, useState } from 'react'
import { Sheet } from './QuickActions'
import { sourceTable } from '../lib/analytics'
import { aliasMap, isFree, labelFor, lastMonths, sheetLabels, spendCells, spendChanges, mergeRows, freeRows } from '../lib/roi'
import { saveSpend, saveAliases, removeAliases } from '../lib/roiData'

// Spend sheet (spec 2026-11-05-lead-sources-roi-design.md, UI): monthly spend
// per source label for the last 12 months, free sources, and source merges.
const BOOKS = { bay: { name: 'Bayway', accent: 'var(--bay)' }, mpg: { name: 'MPG', accent: 'var(--mpg)' } }
const monthLabel = (m) => new Date(`${m}T12:00:00`).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }).replace(" '", ' ')
const BOX = 'w-[72px] rounded-[8px] border border-line2 bg-panel2 px-1.5 py-1 text-right text-[12.5px] outline-none'

export default function SpendSheet({ biz, leads, aliases, spend, onClose, onSaved, nowMs }) {
  const [now] = useState(() => nowMs ?? Date.now())
  const [book, setBook] = useState(biz === 'mpg' ? 'mpg' : 'bay')
  const [cells, setCells] = useState(() => ({ bay: spendCells(spend, 'bay'), mpg: spendCells(spend, 'mpg') }))
  const [picked, setPicked] = useState([])
  const [mergeLabel, setMergeLabel] = useState('')
  const [problem, setProblem] = useState(null)
  const [busy, setBusy] = useState(false)

  const months = useMemo(() => lastMonths(12, now), [now])
  const map = useMemo(() => aliasMap(aliases), [aliases])
  const table = useMemo(() => sourceTable(leads, book, now - 365 * 86400000), [leads, book, now])
  const labels = sheetLabels(table, book, spend, map)
  const paid = labels.filter((l) => !isFree(l, book, map))
  const free = labels.filter((l) => isFree(l, book, map))
  const raws = [...new Set([...table.rows.map((r) => r.source), ...aliases.filter((a) => a.book === book).map((a) => a.raw)])].sort((a, b) => a.localeCompare(b))
  const merges = Object.entries(
    aliases
      .filter((a) => a.book === book && a.raw !== a.label)
      .reduce((acc, a) => ({ ...acc, [a.label]: [...(acc[a.label] || []), a] }), {}),
  )
  const mine = cells[book]

  const run = async (action, after) => {
    setBusy(true)
    const { error } = await action()
    setBusy(false)
    if (error) return setProblem(error.message || String(error))
    setProblem(null)
    await onSaved()
    if (after) after()
  }

  const saveGrid = () => {
    const { upserts, deletes, problem: bad } = spendChanges(spend, book, mine)
    if (bad) return setProblem(bad)
    if (!upserts.length && !deletes.length) return onClose()
    return run(() => saveSpend({ upserts, deletes }), onClose)
  }

  const merge = () => {
    if (picked.length < 2) return setProblem('Pick two or more sources to merge.')
    if (!mergeLabel.trim()) return setProblem('Enter a label for the merged sources.')
    return run(() => saveAliases(mergeRows(book, picked, mergeLabel)), () => {
      setPicked([])
      setMergeLabel('')
    })
  }

  const setCell = (key, value) => setCells((c) => ({ ...c, [book]: { ...c[book], [key]: value } }))

  return (
    <Sheet title="Marketing spend" subtitle={`${BOOKS[book].name} · monthly, by source`} t={{ accent: BOOKS[book].accent }} onClose={onClose}>
      {biz === 'all' && (
        <div role="tablist" aria-label="Book" className="mb-3 flex gap-1 rounded-xl bg-panel2 p-1">
          {Object.entries(BOOKS).map(([id, b]) => (
            <button key={id} type="button" role="tab" aria-selected={book === id} onClick={() => setBook(id)} className={`flex-1 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ${book === id ? 'bg-panel' : 'text-muted'}`}>
              {b.name}
            </button>
          ))}
        </div>
      )}

      <div className="-mx-5 overflow-x-auto px-5">
        <table className="text-[12.5px]">
          <thead>
            <tr className="text-[11px] text-muted">
              <th className="sticky left-0 bg-panel py-1 pr-2 text-left font-semibold">Source</th>
              <th className="px-1 font-semibold">Free</th>
              {months.map((m) => (
                <th key={m} className="px-1 text-right font-semibold">
                  {monthLabel(m)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paid.map((label) => (
              <tr key={label} data-spend-row={label}>
                <td className="sticky left-0 max-w-[140px] truncate bg-panel py-1 pr-2">{label}</td>
                <td className="px-1 text-center">
                  <input type="checkbox" aria-label={`Free ${label}`} checked={false} disabled={busy} onChange={() => run(() => saveAliases(freeRows(book, label, aliases, true)))} />
                </td>
                {months.map((m) => {
                  const key = `${label}|${m}`
                  return (
                    <td key={m} className="px-1 py-0.5">
                      <input aria-label={`${label} ${monthLabel(m)}`} inputMode="decimal" value={mine[key] ?? ''} onChange={(e) => setCell(key, e.target.value)} className={BOX} />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {free.length > 0 && (
        <div className="mt-3 text-[12.5px]">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-dim">Free sources</div>
          {free.map((label) => (
            <label key={label} data-spend-row={label} className="mr-3 inline-flex items-center gap-1.5">
              <input type="checkbox" aria-label={`Free ${label}`} checked disabled={busy} onChange={() => run(() => saveAliases(freeRows(book, label, aliases, false)))} />
              {label}
            </label>
          ))}
        </div>
      )}

      <div className="mt-4 border-t border-line pt-3 text-[12.5px]">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-dim">Merge sources</div>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {raws.map((raw) => (
            <label key={raw} className="inline-flex items-center gap-1.5">
              <input type="checkbox" aria-label={`Merge ${raw}`} checked={picked.includes(raw)} onChange={() => setPicked((p) => (p.includes(raw) ? p.filter((x) => x !== raw) : [...p, raw]))} />
              {raw}
              {labelFor(raw, book, map) !== raw && <span className="text-dim">→ {labelFor(raw, book, map)}</span>}
            </label>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input aria-label="Merged label" placeholder="Self-sourced" value={mergeLabel} onChange={(e) => setMergeLabel(e.target.value)} className="flex-1 rounded-[8px] border border-line2 bg-panel2 px-2.5 py-1.5 text-[13px] outline-none" />
          <button type="button" aria-label="Merge sources" disabled={busy} onClick={merge} className="rounded-[8px] border border-line2 px-3 py-1.5 font-semibold">
            Merge
          </button>
        </div>
        {merges.map(([label, rows]) => (
          <div key={label} className="mt-1.5 flex items-center gap-2 text-muted">
            <span>
              {label}: {rows.map((r) => r.raw).join(', ')}
            </span>
            <button type="button" aria-label={`Unmerge ${label}`} disabled={busy} onClick={() => run(() => removeAliases(rows.map((r) => r.id)))} className="text-[#1d4ed8]">
              Unmerge
            </button>
          </div>
        ))}
      </div>

      {problem && <div className="mt-3 text-[12px] text-[#b42318]">{problem}</div>}
      <button type="button" aria-label="Save spend" disabled={busy} onClick={saveGrid} className="btn-primary mt-4 rounded-[10px] px-4 py-2 text-[13px] font-semibold">
        {busy ? 'Saving…' : 'Save'}
      </button>
    </Sheet>
  )
}
```

`monthLabel('2026-11-01')` gives "Nov 26" (en-US `month: 'short', year: '2-digit'` renders "Nov 26"; the `.replace` covers engines that render "Nov '26").

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run src/components/SpendSheet.render.test.jsx`
Expected: PASS (7 tests).

If `input('Lendgo Nov 26')` is null, print `[...document.querySelectorAll('input')].map((i) => i.getAttribute('aria-label'))` and match the month label format the test environment produces; fix `monthLabel`, not the test.

- [ ] **Step 5: Commit**

```bash
git add src/components/SpendSheet.jsx src/components/SpendSheet.render.test.jsx
git commit -m "feat: Spend sheet with monthly grid, free sources and merges"
```

---

### Task 6: Analytics card

**Files:**
- Modify: `src/pages/Analytics.jsx`
- Modify: `src/pages/Analytics.render.test.jsx`

- [ ] **Step 1: Write the failing render tests**

In `src/pages/Analytics.render.test.jsx`:

Replace the `DATA` line and the `query` function with:

```js
const DATA = { activities: [], contacts: [], loans: [], source_aliases: [], marketing_spend: [], sync_log: [] }
const ERRORS = {}
let filter = 'all'

function query(table) {
  let from = 0
  let to = 999
  const q = {}
  for (const m of ['select', 'eq', 'gte', 'order', 'limit', 'in']) q[m] = () => q
  q.range = (a, b) => {
    from = a
    to = b
    return q
  }
  q.maybeSingle = async () => ({ data: table === 'settings' ? { value: { calls: 10 } } : null, error: null })
  q.then = (resolve) => resolve(ERRORS[table] ? { data: null, error: ERRORS[table] } : { data: (DATA[table] || []).slice(from, to + 1), error: null })
  return q
}
```

In `beforeEach`, give the contacts ids and add loans and spend. Replace the `DATA.contacts = [...]` block with:

```js
  for (const k of Object.keys(ERRORS)) delete ERRORS[k]
  DATA.contacts = [
    { id: 'c1', business_id: 'bay', person_stage: 'Lead', bay_source: 'LendingFlow', bay_created: daysAgo(10), tags: ['estimate sent'] },
    { id: 'c2', business_id: 'bay', person_stage: 'Lead', bay_source: 'LendingFlow', bay_created: daysAgo(20), tags: [] },
    { id: 'c3', business_id: 'bay', person_stage: 'Lead', bay_source: 'Old', bay_created: daysAgo(200), tags: [] },
    { id: 'c4', business_id: 'mpg', person_stage: 'Qualified', mpg_source: 'Web', mpg_created: daysAgo(5), tags: null },
  ]
  const d = new Date()
  const key = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
  const lastMonth = new Date(d.getFullYear(), d.getMonth() - 1, 1)
  DATA.loans = [{ id: 1, business_id: 'bay', stage_group: 'funded', funded_on: key(new Date(Date.now() - 3 * 86400000)), amount: 300000, role: 'primary', contact_id: 'c1', scenario_auto: false, scenario_override: null, comp_override: null }]
  DATA.source_aliases = []
  DATA.marketing_spend = [{ id: 's1', book: 'bay', source: 'LendingFlow', month: key(lastMonth), amount: 300 }]
```

Add these tests inside `describe('Analytics', ...)`:

```js
  it('shows funded loans, commission, spend and costs per source, with KPI tiles', async () => {
    const host = await mount()
    const bay = host.querySelector('[aria-label="Bayway · FollowUpBoss"]')
    const lf = bay.querySelector('[data-source="LendingFlow"]')
    expect(lf.querySelector('[data-funded]').textContent).toBe('1')
    expect(lf.querySelector('[data-commission]').textContent).toBe('$3,750')
    expect(lf.querySelector('[data-spend]').textContent).toBe('$300')
    expect(lf.querySelector('[data-cpl]').textContent).toBe('$150')
    expect(lf.querySelector('[data-cpf]').textContent).toBe('$300')
    expect(bay.querySelector('[data-kpi="cpl"]').textContent).toContain('$150')
    const mpg = host.querySelector('[aria-label="MPG · Zoho"]')
    expect(mpg.querySelector('[data-kpi="cpf"]')).toBeNull()
    expect(mpg.querySelector('[data-source="Web"] [data-spend]').textContent).toBe('—')
  })

  it('opens the Spend sheet', async () => {
    const host = await mount()
    await act(async () => host.querySelector('button[aria-label="Spend"]').click())
    expect(document.querySelector('[role="dialog"][aria-label="Marketing spend"]')).not.toBe(null)
  })

  it('keeps the lead rows and says so when spend cannot load', async () => {
    ERRORS.marketing_spend = { message: 'boom' }
    const host = await mount()
    expect(host.textContent).toContain("Couldn't load spend or loans: boom")
    expect(host.querySelector('[aria-label="Bayway · FollowUpBoss"] [data-source="LendingFlow"] [data-rate]').textContent).toBe('50%')
  })
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/pages/Analytics.render.test.jsx`
Expected: the three new tests FAIL (no `[data-funded]`, no Spend button, no error line); the three old tests still PASS.

- [ ] **Step 3: Update `src/pages/Analytics.jsx` imports**

After `import { heatmap, countByDay, sourceTable } from '../lib/analytics'` add:

```js
import { fetchLoanBundle } from '../lib/loansData'
import { fetchRoiInputs } from '../lib/roiData'
import { aliasMap, roiTable, kpis, windowKeys, formatUsd } from '../lib/roi'
import SpendSheet from '../components/SpendSheet'
```

Change the header comment's first lines to mention ROI: replace

```js
// which lead sources turn into
// applications (Bayway) or qualified merchants (MPG). Both follow the business
// filter. Logic lives in lib/analytics.js.
```

with

```js
// which lead sources turn into
// applications, funded loans and commission (Bayway) or qualified merchants
// (MPG), against what each source cost. Both follow the business filter.
// Logic lives in lib/analytics.js and lib/roi.js.
```

- [ ] **Step 4: Replace `SourceTable` with `RoiTable`**

Replace the whole `function SourceTable({ title, rateLabel, table, ink }) { ... }` (from `function SourceTable(` down to the closing `}` just above `// contacts rows ->`) with:

```jsx
const money = (v) => formatUsd(v)

function RoiTable({ title, book, rateLabel, roi, ink }) {
  const bay = book === 'bay'
  const k = kpis(roi)
  const tiles = [
    ['leads', 'New leads', String(k.leads)],
    ['spend', 'Spend', money(k.spend)],
    ['cpl', 'Cost per lead', money(k.costPerLead)],
    ...(bay ? [['cpf', 'Cost per funded', money(k.costPerFunded)]] : []),
  ]
  return (
    <section aria-label={title} className="rounded-card border border-line bg-panel p-4 sm:p-5">
      <h3 className="text-[15px] font-bold">{title}</h3>
      <div className={`mt-3 grid grid-cols-2 gap-2 ${bay ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
        {tiles.map(([id, label, value]) => (
          <div key={id} data-kpi={id} className="rounded-xl bg-panel2 px-3 py-2">
            <div className="text-[11.5px] text-muted">{label}</div>
            <div className="num text-[17px] font-bold">{value}</div>
          </div>
        ))}
      </div>
      {roi.rows.length === 0 ? (
        <div className="mt-3 text-[13px] text-muted">No leads, loans or spend in this window.</div>
      ) : (
        <div className="-mx-4 mt-3 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <table className={`w-full text-[13px] ${bay ? 'min-w-[860px]' : 'min-w-[640px]'}`}>
            <thead>
              <tr className="border-b border-line text-left text-[11.5px] text-muted">
                <th className="py-2 pr-3 font-semibold">Source</th>
                <th className="num py-2 pr-3 text-right font-semibold">Leads</th>
                {roi.cols.map((c) => (
                  <th key={c.id} className="py-2 pr-3 text-right font-semibold">
                    {c.label}
                  </th>
                ))}
                <th className="py-2 pr-3 text-right font-semibold">{rateLabel}</th>
                {bay && <th className="py-2 pr-3 text-right font-semibold">Funded</th>}
                {bay && <th className="py-2 pr-3 text-right font-semibold">Commission</th>}
                <th className="py-2 pr-3 text-right font-semibold">Spend</th>
                <th className="py-2 pr-3 text-right font-semibold">Per lead</th>
                {bay && <th className="py-2 text-right font-semibold">Per funded</th>}
              </tr>
            </thead>
            <tbody>
              {[...roi.rows, roi.total].map((r) => {
                const total = r === roi.total
                const dash = r.notLinked
                return (
                  <tr key={r.source} data-source={r.source} className={`border-b border-line last:border-b-0 ${total ? 'font-bold' : ''} ${dash ? 'text-muted' : ''}`}>
                    <td className="max-w-[240px] truncate py-2 pr-3">
                      {r.source}
                      {r.raws.length > 1 && <span className="ml-1 text-[11.5px] font-normal text-dim">({r.raws.length} merged)</span>}
                    </td>
                    <td className="num py-2 pr-3 text-right">{dash ? '—' : r.leads}</td>
                    {roi.cols.map((c) => (
                      <td key={c.id} className="num py-2 pr-3 text-right text-muted">
                        {dash ? '—' : r.counts[c.id] || 0}
                      </td>
                    ))}
                    <td className="py-2 pr-3">
                      {dash ? (
                        <div className="text-right">—</div>
                      ) : (
                        <div className="flex items-center justify-end gap-2">
                          <div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-line sm:block">
                            <div className="h-full rounded-full" style={{ width: `${r.rate}%`, background: ink }} />
                          </div>
                          <span className="num w-10 text-right" data-rate>
                            {r.rate}%
                          </span>
                        </div>
                      )}
                    </td>
                    {bay && (
                      <td className="num py-2 pr-3 text-right" data-funded>
                        {r.funded}
                      </td>
                    )}
                    {bay && (
                      <td className="num py-2 pr-3 text-right" data-commission>
                        {money(r.commission)}
                      </td>
                    )}
                    <td className={`num py-2 pr-3 text-right ${r.spend === 'free' ? 'text-dim' : ''}`} data-spend>
                      {money(r.spend)}
                    </td>
                    <td className="num py-2 pr-3 text-right" data-cpl>
                      {money(r.costPerLead)}
                    </td>
                    {bay && (
                      <td className="num py-2 text-right" data-cpf>
                        {money(r.costPerFunded)}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 5: Replace the page body**

Replace everything from `// contacts rows -> { business_id, source, created, person_stage, tags }.` to the end of the file with:

```jsx
// contacts rows -> { id, business_id, source, created, person_stage, tags }.
const toLead = (c) => ({
  id: c.id,
  business_id: c.business_id,
  person_stage: c.person_stage,
  tags: c.tags,
  source: c.business_id === 'bay' ? c.bay_source : c.mpg_source,
  created: c.business_id === 'bay' ? c.bay_created : c.mpg_created,
})

export default function Analytics() {
  const { biz } = useBusiness() || { biz: 'all' }
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [days, setDays] = useState(90)
  const [spendOpen, setSpendOpen] = useState(false)

  const reloadRoi = async () => {
    const roi = await fetchRoiInputs()
    setData((d) => ({ ...d, aliases: roi.data?.aliases || [], spend: roi.data?.spend || [], roiError: roi.error?.message || d.loanError || null }))
  }

  useEffect(() => {
    if (isDemoMode) return
    let cancelled = false
    ;(async () => {
      const since = new Date()
      since.setHours(0, 0, 0, 0)
      since.setDate(since.getDate() - WEEKS * 7)
      const [calls, contacts, settings, loans, roi] = await Promise.all([
        // Six months of calls across both books passes 1,000 rows: paged.
        fetchAllSettled(() =>
          supabase.from('activities').select('occurred_at, business_id').eq('type', 'call').eq('direction', 'outbound').gte('occurred_at', since.toISOString()).order('id'),
        ),
        fetchAllSettled(() =>
          supabase
            .from('contacts')
            .select('id, business_id, person_stage, bay_source:raw->>source, mpg_source:raw->>Lead_Source, bay_created:raw->>created, mpg_created:raw->>Created_Time, tags:raw->tags')
            .order('id'),
        ),
        supabase.from('settings').select('value').eq('key', 'metric_targets').maybeSingle(),
        fetchLoanBundle(),
        fetchRoiInputs(),
      ])
      if (cancelled) return
      const err = calls.error || contacts.error || settings.error
      if (err) return setError(err.message)
      // Loans and spend never blank the page: lead counts still show.
      const loanError = loans.error?.message || null
      setData({
        calls: calls.data || [],
        leads: (contacts.data || []).map(toLead),
        goal: resolveTargets(DEFAULT_TARGETS, settings.data?.value).calls,
        loans: loans.data?.loans || [],
        rates: loans.data?.rates,
        aliases: roi.data?.aliases || [],
        spend: roi.data?.spend || [],
        loanError,
        roiError: roi.error?.message || loanError,
      })
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const inBook = (b) => biz === 'all' || b === biz
  const ink = biz === 'mpg' ? 'var(--mpg)' : biz === 'bay' ? 'var(--bay)' : 'var(--text)'
  const model = useMemo(() => {
    if (!data) return null
    const calls = data.calls.filter((r) => biz === 'all' || r.business_id === biz)
    return heatmap(countByDay(calls), { weeks: WEEKS, goal: data.goal })
  }, [data, biz])
  const tables = useMemo(() => {
    if (!data) return null
    const now = Date.now()
    const fromMs = now - days * 86400000
    const keys = windowKeys(days, now)
    const contactsById = new Map(data.leads.map((l) => [l.id, l]))
    const aliases = aliasMap(data.aliases)
    const build = (book) =>
      roiTable(sourceTable(data.leads, book, fromMs), { book, contactsById, loans: data.loans, rates: data.rates, spendRows: data.spend, aliases, ...keys })
    return { bay: build('bay'), mpg: build('mpg') }
  }, [data, days])

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Analytics" subtitle="How consistently you call, and which lead sources turn into business." />
      {isDemoMode && (
        <div className="rounded-card border border-line bg-panel px-6 py-8 text-center text-sm text-muted">Demo mode — connect Supabase to see analytics.</div>
      )}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      {!isDemoMode && !error && !data && <div className="text-sm text-muted">Loading analytics…</div>}

      {model && <Heatmap model={model} goal={data.goal} ink={ink} />}

      {data && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-[17px] font-bold">Lead sources and ROI</h3>
              <p className="mt-0.5 text-[12.5px] text-muted">
                Leads created and loans funded in the window. Spend prorated by day. A lead that applied and later went Lost counts as Lost.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div role="tablist" aria-label="Window" className="flex gap-1 rounded-xl bg-panel2 p-1">
                {WINDOWS.map((w) => (
                  <button
                    key={w.days}
                    type="button"
                    role="tab"
                    aria-selected={days === w.days}
                    onClick={() => setDays(w.days)}
                    className={`min-h-[34px] rounded-lg px-3 text-[12.5px] font-semibold ${days === w.days ? 'bg-panel text-[color:var(--text)]' : 'text-muted'}`}
                  >
                    {w.label}
                  </button>
                ))}
              </div>
              <button type="button" aria-label="Spend" onClick={() => setSpendOpen(true)} className="min-h-[34px] rounded-lg border border-line2 px-3 text-[12.5px] font-semibold">
                Spend
              </button>
            </div>
          </div>
          {data.roiError && <div className="text-[12px] text-[#b42318]">Couldn&apos;t load spend or loans: {data.roiError}</div>}
          {inBook('bay') && <RoiTable title="Bayway · FollowUpBoss" book="bay" rateLabel="To app / estimate" roi={tables.bay} ink="var(--bay)" />}
          {inBook('mpg') && <RoiTable title="MPG · Zoho" book="mpg" rateLabel="To qualified" roi={tables.mpg} ink="var(--mpg)" />}
          {spendOpen && (
            <SpendSheet biz={biz} leads={data.leads} aliases={data.aliases} spend={data.spend} onClose={() => setSpendOpen(false)} onSaved={reloadRoi} />
          )}
        </>
      )}
    </div>
  )
}
```

`rates` falls back inside `estComp` only if defined: `fetchLoanBundle` always returns rates on success. On a loans error `rates` is undefined and `loans` is `[]`, so `estComp` never runs.

- [ ] **Step 6: Run the Analytics tests**

Run: `npx vitest run src/pages/Analytics.render.test.jsx`
Expected: PASS (6 tests).

Check: LendingFlow has 2 leads in 90 days; the loan funded 3 days ago at $300,000 primary gives $3,750 (1.25%); last month's $300 sits fully inside the 90-day window, so cost per lead $150 and per funded $300.

- [ ] **Step 7: Commit**

```bash
git add src/pages/Analytics.jsx src/pages/Analytics.render.test.jsx
git commit -m "feat: Analytics lead sources card shows funded, commission, spend and costs"
```

---

### Task 7: Verify and roll out

- [ ] **Step 1: Full suite, lint and build**

Run: `npx vitest run`
Expected: all files pass; the only unhandled errors are the 2 known mock errors (Workbench contactNotes refresh, PriorityLeads useSyncHealth `.limit`).

Run: `npm run lint` (if the script exists) and `npm run build`
Expected: no new lint errors; build succeeds.

- [ ] **Step 2: Apply the migration (ask Chandler first; production change)**

```bash
npx supabase db push --dry-run
npx supabase db push
```

Expected: the dry run lists only `0059_lead_roi.sql`.

- [ ] **Step 3: Run the RLS test**

Run: `npx supabase db query --linked -f supabase/tests/lead_roi.sql`
Expected: notices "owner lead_roi: all checks passed" and "assistant lead_roi: all checks passed"; nothing persists (rollback).

- [ ] **Step 4: Live check in the preview**

Start the dev server, open `/analytics` signed in as Chandler, and check:
- the Bayway table shows Funded / Commission for the Lendgo and Realtor Referral loans, and a "Not linked to a lead" row for the third funded loan;
- Spend opens, and the window tabs still switch;
- at 375px width there's no page overflow (the table scrolls inside its card).

Don't save real spend unless Chandler asks; the sheet's writes are covered by tests.

- [ ] **Step 5: Push and open the PR (on Chandler's go-ahead)**

```bash
git push -u origin feat/lead-roi
gh pr create --base main --head feat/lead-roi --title "feat: lead sources and ROI card (growth 1a)"
```

---

## Self-review

- **Spec coverage:** tables and RLS (Task 1); aliases, proration, funded loans, Not linked row, spend-only rows, totals, KPIs (Task 2); sheet grid, free, merge, unmerge, save errors (Tasks 3 and 5); reads with `.limit()` and missing-table handling (Task 4); card columns, tiles, Spend button, error line, window picker unchanged (Task 6); RLS test, full suite, build (Task 7). Out-of-scope items (Overview card, partner share, MPG funded) have no tasks.
- **Spec deviation:** `fundedInWindow` takes date keys (`fromKey`, `toKey`) instead of ms, matching `funded_on` (a date) and `windowKeys`; lead counts keep the existing `fromMs`.
- **Names:** `aliasMap`, `labelFor`, `isFree`, `windowKeys`, `spendInWindow`, `fundedInWindow`, `roiTable`, `kpis`, `formatUsd`, `NOT_LINKED`, `lastMonths`, `sheetLabels`, `spendCells`, `spendChanges`, `mergeRows`, `freeRows`, `fetchRoiInputs`, `saveSpend`, `saveAliases`, `removeAliases` are used the same way in every task.
