# Reports / KPI Scoreboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/reports` placeholder with a four-tab KPI scoreboard (Daily / Weekly / Monthly / Revenue) that pairs live Supabase data with manual trackers, comparing each metric from the Atkinson Reports doc against an editable target.

**Architecture:** A single pure, I/O-free lib (`src/lib/reports.js`) owns everything testable: the metric registry (each KPI tagged `live | derived | manual`), the doc's default targets, window math, the `metrics_daily` rollup, the live deal/stage selectors, and the card view-model. `Reports.jsx` fetches from Supabase (same pattern as `Overview.jsx`), computes a `values` map, and renders cards from `buildTabModel`. Manual metrics upsert into the existing-but-empty `metrics_daily`; targets live in `settings.metric_targets`. All logic is unit-tested with vitest against seeded arrays (repo convention — no jsdom/rendering tests); JSX is verified via `npm run build` + browser preview.

**Tech Stack:** React 18 + Vite, React Router 6, Tailwind (dark theme, `.num` tabular-nums, tokens `--bay`/`--mpg`/`--bay-gold`), Supabase (Postgres, `security_invoker` RLS), vitest.

**Spec:** `docs/superpowers/specs/2026-07-13-phase12-reports-design.md`

**Supersedes:** the never-executed `docs/superpowers/plans/2026-07-13-phase12-overview-goal-metrics.md` draft (its `goal_targets` table / `goals.js` / Overview band were never created — this plan uses `settings.metric_targets` and a dedicated Reports page instead). Migration `0012` is free.

**Project constraints (read before committing):**
- Dev server: `npm run dev` (Vite, port 5199). Tests: `npm run test` (vitest). Build: `npm run build`.
- Supabase ref: `cnmipfxwqnbtkohfixkf`. Migrations are applied out-of-band (Supabase SQL editor / CLI) — this plan only writes the migration file; it does not run it.
- **Commit as the repo's configured author only.** Never pass `-c user.email=…`/`-c user.name=…` and never add a `Co-Authored-By` trailer — the Netlify free plan only builds single-contributor pushes.
- Do not push unless the user asks; commit locally after each task.
- Pure helpers live in `src/lib/*.js` with a colocated `*.test.js`; import shared date helpers from `./calendar` (`dayKey`) as `activity.js` already does.

**File structure (what this plan creates/modifies):**
- Create `supabase/migrations/0012_reports_rls.sql` — authenticated upsert policies on `metrics_daily` and the `settings` `metric_targets` row.
- Create `src/lib/reports.js` — registry, `DEFAULT_TARGETS`, window math, rollup, deal/stage selectors, view-model.
- Create `src/lib/reports.test.js` — vitest unit tests for all of the above.
- Create `src/pages/Reports.jsx` — tab shell, data fetch, four tab bodies, manual-log inputs, edit-targets modal.
- Modify `src/App.jsx:42-49` — swap the `/reports` placeholder for `<Reports />`.

---

### Task 1: Migration — enable authenticated writes for metrics + targets

**Files:**
- Create: `supabase/migrations/0012_reports_rls.sql`

- [ ] **Step 1: Write the migration**

`metrics_daily` and `settings` already have `authenticated read` policies (0001) and the unique constraints upsert needs (`metrics_daily(business_id,date,metric_key)`, `settings(key)` PK). This adds insert+update for the signed-in user; `settings` writes are scoped to the `metric_targets` key so nothing else in `settings` becomes writable. Edge Functions use the service role and are unaffected.

```sql
-- Phase 12: Reports scoreboard needs the app (authenticated role) to write two
-- things it only ever read before: manual activity metrics into metrics_daily,
-- and the editable target set into settings under key 'metric_targets'.
-- Everything else stays read-only. Service-role Edge Function writes bypass RLS.

-- metrics_daily: manual trackers upsert on (business_id, date, metric_key).
create policy "authenticated insert metrics_daily" on metrics_daily
  for insert to authenticated with check (true);
create policy "authenticated update metrics_daily" on metrics_daily
  for update to authenticated using (true) with check (true);

-- settings: only the metric_targets row is app-writable.
create policy "authenticated insert metric_targets" on settings
  for insert to authenticated with check (key = 'metric_targets');
create policy "authenticated update metric_targets" on settings
  for update to authenticated using (key = 'metric_targets') with check (key = 'metric_targets');
```

- [ ] **Step 2: Verify the file is valid SQL by eye**

Run: `git diff --stat supabase/migrations/0012_reports_rls.sql`
Expected: one new file, ~15 lines. (Application to Supabase happens out-of-band per the project constraints; no local DB run.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0012_reports_rls.sql
git commit -m "feat(reports): migration 0012 — authenticated upsert for metrics_daily + metric_targets"
```

---

### Task 2: Metric registry, default targets, and selection

**Files:**
- Create: `src/lib/reports.js`
- Test: `src/lib/reports.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest'
import { METRICS, DEFAULT_TARGETS, metricsForTab, resolveTargets } from './reports'

describe('METRICS registry', () => {
  it('every metric has a default target', () => {
    for (const m of METRICS) {
      expect(DEFAULT_TARGETS[m.key], `target for ${m.key}`).toBeTypeOf('number')
    }
  })
  it('uses only known tabs, sources, biz, units', () => {
    for (const m of METRICS) {
      expect(['daily', 'weekly', 'monthly', 'revenue']).toContain(m.tab)
      expect(['live', 'derived', 'manual']).toContain(m.source)
      expect(['mpg', 'bay', 'both']).toContain(m.biz)
      expect(['count', 'currency', 'minutes']).toContain(m.unit)
    }
  })
  it('has unique keys', () => {
    const keys = METRICS.map((m) => m.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('metricsForTab', () => {
  it('returns only the tab, and filters by business when not "all"', () => {
    const bay = metricsForTab('daily', 'bay')
    expect(bay.every((m) => m.tab === 'daily' && (m.biz === 'bay' || m.biz === 'both'))).toBe(true)
    const all = metricsForTab('daily', 'all')
    expect(all.length).toBeGreaterThanOrEqual(bay.length)
  })
})

describe('resolveTargets', () => {
  it('overlays saved values over the defaults', () => {
    const merged = resolveTargets({ calls: 100, followups: 25 }, { calls: 80 })
    expect(merged).toEqual({ calls: 80, followups: 25 })
  })
  it('ignores a null/non-object saved value', () => {
    expect(resolveTargets({ calls: 100 }, null)).toEqual({ calls: 100 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- reports`
Expected: FAIL — `Cannot find module './reports'`.

- [ ] **Step 3: Write the registry and helpers**

Add to the top of `src/lib/reports.js`:

```js
// Pure helpers for the Reports scoreboard. No React, no I/O — unit-testable.
// Spec: docs/superpowers/specs/2026-07-13-phase12-reports-design.md
import { dayKey } from './calendar'

// One row per KPI in the Atkinson Reports doc.
// source: 'live' (computed from synced data) | 'derived' (live but caveated,
// e.g. a current-stage snapshot) | 'manual' (entered into metrics_daily).
// biz: which book the metric belongs to ('both' = personal, cross-business).
export const METRICS = [
  // ---- Daily -------------------------------------------------------------
  { key: 'calls',             label: 'Outbound calls',        tab: 'daily', biz: 'both', source: 'manual', unit: 'count' },
  { key: 'live_conversations',label: 'Live conversations',    tab: 'daily', biz: 'both', source: 'manual', unit: 'count' },
  { key: 'followups',         label: 'Follow-ups completed',  tab: 'daily', biz: 'both', source: 'manual', unit: 'count' },
  { key: 'new_contacts',      label: 'New contacts added',    tab: 'daily', biz: 'both', source: 'manual', unit: 'count' },
  { key: 'referral_asks',     label: 'Referral asks',         tab: 'daily', biz: 'both', source: 'manual', unit: 'count' },
  { key: 'social_minutes',    label: 'Social engagement',     tab: 'daily', biz: 'both', source: 'manual', unit: 'minutes' },
  // ---- Weekly ------------------------------------------------------------
  { key: 'realtor_convos',       label: 'Realtor conversations',       tab: 'weekly', biz: 'bay', source: 'manual', unit: 'count' },
  { key: 'bizowner_convos',      label: 'Business-owner conversations',tab: 'weekly', biz: 'mpg', source: 'manual', unit: 'count' },
  { key: 'past_client_touches',  label: 'Past-client touches',         tab: 'weekly', biz: 'bay', source: 'manual', unit: 'count' },
  { key: 'new_referral_partners',label: 'New referral partners',       tab: 'weekly', biz: 'both',source: 'manual', unit: 'count' },
  { key: 'merchant_proposals',   label: 'Merchant proposals',          tab: 'weekly', biz: 'mpg', source: 'manual', unit: 'count' },
  { key: 'mortgage_consults',    label: 'Mortgage consultations',      tab: 'weekly', biz: 'bay', source: 'manual', unit: 'count' },
  // ---- Monthly: pipeline + database -------------------------------------
  { key: 'realtor_meetings',   label: 'Realtor meetings',      tab: 'monthly', biz: 'bay', source: 'manual',  unit: 'count' },
  { key: 'pre_approvals',      label: 'In pre-approval (now)', tab: 'monthly', biz: 'bay', source: 'derived', unit: 'count' },
  { key: 'applications',       label: 'In application (now)',  tab: 'monthly', biz: 'bay', source: 'derived', unit: 'count' },
  { key: 'loans_closed',       label: 'Loans closed (MTD)',    tab: 'monthly', biz: 'bay', source: 'live',    unit: 'count' },
  { key: 'loan_volume',        label: 'Loan volume (MTD)',     tab: 'monthly', biz: 'bay', source: 'live',    unit: 'currency' },
  { key: 'businesses_contacted',label: 'Businesses contacted', tab: 'monthly', biz: 'mpg', source: 'manual', unit: 'count' },
  { key: 'owner_conversations',label: 'Owner conversations',   tab: 'monthly', biz: 'mpg', source: 'manual',  unit: 'count' },
  { key: 'merchant_proposals_delivered', label: 'Proposals delivered', tab: 'monthly', biz: 'mpg', source: 'manual', unit: 'count' },
  { key: 'new_merchant_accounts',label: 'New merchant accounts',tab: 'monthly', biz: 'mpg', source: 'manual', unit: 'count' },
  { key: 'new_residual',       label: 'New residual (MTD)',    tab: 'monthly', biz: 'mpg', source: 'manual',  unit: 'currency' },
  { key: 'db_total',           label: 'Total database',        tab: 'monthly', biz: 'both',source: 'live',     unit: 'count' },
  { key: 'db_realtors',        label: 'Realtors',              tab: 'monthly', biz: 'bay', source: 'manual',  unit: 'count' },
  { key: 'db_past_clients',    label: 'Past clients',          tab: 'monthly', biz: 'bay', source: 'manual',  unit: 'count' },
  { key: 'db_business_owners', label: 'Business owners',       tab: 'monthly', biz: 'mpg', source: 'manual',  unit: 'count' },
  { key: 'db_prospects',       label: 'Prospects',             tab: 'monthly', biz: 'both',source: 'manual',   unit: 'count' },
  // ---- Revenue -----------------------------------------------------------
  { key: 'rev_closings',        label: 'Closings (MTD)',        tab: 'revenue', biz: 'bay', source: 'live',    unit: 'count' },
  { key: 'rev_loan_volume',     label: 'Loan volume (MTD)',     tab: 'revenue', biz: 'bay', source: 'live',    unit: 'currency' },
  { key: 'rev_gross_commission',label: 'Gross commission (MTD)',tab: 'revenue', biz: 'bay', source: 'manual',  unit: 'currency' },
  { key: 'rev_active_merchants',label: 'Active merchants',      tab: 'revenue', biz: 'mpg', source: 'manual',  unit: 'count' },
  { key: 'rev_monthly_residual',label: 'Monthly residual',      tab: 'revenue', biz: 'mpg', source: 'manual',  unit: 'currency' },
  { key: 'rev_combined_income', label: 'Combined monthly income',tab: 'revenue',biz: 'both',source: 'derived', unit: 'currency' },
]

// Defaults straight from the doc. Editable at runtime via settings.metric_targets.
export const DEFAULT_TARGETS = {
  calls: 100, live_conversations: 20, followups: 25, new_contacts: 5,
  referral_asks: 3, social_minutes: 30,
  realtor_convos: 50, bizowner_convos: 50, past_client_touches: 25,
  new_referral_partners: 10, merchant_proposals: 5, mortgage_consults: 5,
  realtor_meetings: 10, pre_approvals: 20, applications: 15, loans_closed: 5,
  loan_volume: 2_000_000, businesses_contacted: 1000, owner_conversations: 200,
  merchant_proposals_delivered: 20, new_merchant_accounts: 5, new_residual: 1000,
  db_total: 5000, db_realtors: 500, db_past_clients: 1000,
  db_business_owners: 2000, db_prospects: 1500,
  rev_closings: 5, rev_loan_volume: 2_000_000, rev_gross_commission: 17_500,
  rev_active_merchants: 100, rev_monthly_residual: 10_000,
  rev_combined_income: 27_500,
}

export function metricsForTab(tab, biz) {
  return METRICS.filter(
    (m) => m.tab === tab && (biz === 'all' || m.biz === 'both' || m.biz === biz),
  )
}

export function resolveTargets(defaults, savedValue) {
  const saved = savedValue && typeof savedValue === 'object' ? savedValue : {}
  return { ...defaults, ...saved }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- reports`
Expected: PASS (registry + metricsForTab + resolveTargets suites green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/reports.js src/lib/reports.test.js
git commit -m "feat(reports): metric registry, default targets, tab selection"
```

---

### Task 3: Card view-model — pace, formatting, buildTabModel

**Files:**
- Modify: `src/lib/reports.js`
- Test: `src/lib/reports.test.js`

- [ ] **Step 1: Write the failing test (append to reports.test.js)**

```js
import { pace, formatValue, metricCardView, buildTabModel } from './reports'

describe('pace', () => {
  it('is "none" when value or target is missing, or target <= 0', () => {
    expect(pace(null, 10)).toBe('none')
    expect(pace(5, null)).toBe('none')
    expect(pace(5, 0)).toBe('none')
  })
  it('is "on" at/above target, "behind" below', () => {
    expect(pace(10, 10)).toBe('on')
    expect(pace(11, 10)).toBe('on')
    expect(pace(4, 10)).toBe('behind')
  })
})

describe('formatValue', () => {
  it('renders dash for null', () => expect(formatValue(null, 'count')).toBe('—'))
  it('renders currency with commas', () => expect(formatValue(17500, 'currency')).toBe('$17,500'))
  it('renders minutes with an m', () => expect(formatValue(30, 'minutes')).toBe('30m'))
  it('renders plain counts', () => expect(formatValue(12, 'count')).toBe('12'))
})

describe('metricCardView', () => {
  const metric = { key: 'calls', label: 'Outbound calls', source: 'manual', unit: 'count' }
  it('caps pct at 100 and reports pace', () => {
    const v = metricCardView(metric, 120, 100)
    expect(v.pct).toBe(100)
    expect(v.pace).toBe('on')
    expect(v.valueText).toBe('120')
    expect(v.targetText).toBe('100')
  })
  it('handles no-data (null value)', () => {
    const v = metricCardView(metric, null, 100)
    expect(v.pace).toBe('none')
    expect(v.pct).toBe(0)
    expect(v.valueText).toBe('—')
  })
})

describe('buildTabModel', () => {
  it('maps metrics to card view-models, target overrides winning', () => {
    const metrics = [{ key: 'calls', label: 'Calls', source: 'manual', unit: 'count' }]
    const cards = buildTabModel(metrics, { calls: 50 }, { calls: 80 })
    expect(cards[0].valueText).toBe('50')
    expect(cards[0].targetText).toBe('80')
    expect(cards[0].pace).toBe('behind')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- reports`
Expected: FAIL — `pace is not a function` (or the new suites erroring on missing exports).

- [ ] **Step 3: Implement (append to reports.js)**

```js
export function pace(value, target) {
  if (value == null || target == null || target <= 0) return 'none'
  return value >= target ? 'on' : 'behind'
}

export function formatValue(value, unit) {
  if (value == null) return '—'
  if (unit === 'currency') return '$' + Math.round(value).toLocaleString('en-US')
  if (unit === 'minutes') return `${value}m`
  return String(value)
}

// metric: a METRICS entry. value: number | null. target: number | undefined.
export function metricCardView(metric, value, target) {
  const t = target ?? null
  const pct = value != null && t > 0 ? Math.min(100, Math.round((value / t) * 100)) : 0
  return {
    key: metric.key,
    label: metric.label,
    source: metric.source,
    unit: metric.unit,
    valueText: formatValue(value, metric.unit),
    targetText: t != null ? formatValue(t, metric.unit) : '—',
    pct,
    pace: pace(value, t),
  }
}

// metrics: METRICS subset. values: { [key]: number|null }. targets: { [key]: number }.
export function buildTabModel(metrics, values, targets = {}) {
  return metrics.map((m) => metricCardView(m, values[m.key] ?? null, targets[m.key]))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- reports`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reports.js src/lib/reports.test.js
git commit -m "feat(reports): pace, value formatting, card view-model"
```

---

### Task 4: Window math + metrics_daily rollup

**Files:**
- Modify: `src/lib/reports.js`
- Test: `src/lib/reports.test.js`

- [ ] **Step 1: Write the failing test (append)**

```js
import { weekStart, monthWindow, rollupMetrics } from './reports'

// Fixed clock: Wednesday 2026-07-15T12:00:00 local.
const NOW = new Date(2026, 6, 15, 12, 0, 0).getTime()

describe('weekStart', () => {
  it('returns the most-recent Monday as a YYYY-MM-DD key', () => {
    expect(weekStart(NOW)).toBe('2026-07-13') // Monday of that week
  })
  it('returns the same day when now is a Monday', () => {
    const mon = new Date(2026, 6, 13, 9, 0, 0).getTime()
    expect(weekStart(mon)).toBe('2026-07-13')
  })
})

describe('monthWindow', () => {
  it('spans the 1st of this month to the 1st of next', () => {
    expect(monthWindow(NOW)).toEqual({ from: '2026-07-01', to: '2026-08-01' })
  })
  it('rolls the year over in December', () => {
    const dec = new Date(2026, 11, 20, 12, 0, 0).getTime()
    expect(monthWindow(dec)).toEqual({ from: '2026-12-01', to: '2027-01-01' })
  })
})

describe('rollupMetrics', () => {
  it('sums value per metric_key, coercing strings', () => {
    const rows = [
      { metric_key: 'calls', value: 30 },
      { metric_key: 'calls', value: '20' },
      { metric_key: 'followups', value: 5 },
    ]
    expect(rollupMetrics(rows)).toEqual({ calls: 50, followups: 5 })
  })
  it('returns an empty object for no rows', () => {
    expect(rollupMetrics([])).toEqual({})
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- reports`
Expected: FAIL — missing exports `weekStart` / `monthWindow` / `rollupMetrics`.

- [ ] **Step 3: Implement (append)**

```js
// Most-recent Monday (local), as a YYYY-MM-DD key matching metrics_daily.date.
export function weekStart(now = Date.now()) {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  const sinceMonday = (d.getDay() + 6) % 7 // Sun=0 -> 6, Mon=1 -> 0, ...
  d.setDate(d.getDate() - sinceMonday)
  return dayKey(d.toISOString())
}

// { from, to } as YYYY-MM-DD keys: 1st of this month .. 1st of next month.
export function monthWindow(now = Date.now()) {
  const d = new Date(now)
  const pad = (n) => String(n).padStart(2, '0')
  const from = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`
  const n = new Date(d.getFullYear(), d.getMonth() + 1, 1)
  const to = `${n.getFullYear()}-${pad(n.getMonth() + 1)}-01`
  return { from, to }
}

// rows: metrics_daily rows ({ metric_key, value }). -> { [metric_key]: sum }.
export function rollupMetrics(rows) {
  const out = {}
  for (const r of rows) out[r.metric_key] = (out[r.metric_key] || 0) + Number(r.value || 0)
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- reports`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reports.js src/lib/reports.test.js
git commit -m "feat(reports): week/month window math + metrics_daily rollup"
```

---

### Task 5: Live deal + stage selectors

**Files:**
- Modify: `src/lib/reports.js`
- Test: `src/lib/reports.test.js`

- [ ] **Step 1: Write the failing test (append)**

```js
import { sumWon, countWon, pipelineValue, deriveStageCounts } from './reports'

const WIN = { from: '2026-07-01', to: '2026-08-01' }
const deals = [
  { status: 'won',  value: 300000, expected_close: '2026-07-05' },
  { status: 'won',  value: 250000, expected_close: '2026-07-20' },
  { status: 'won',  value: 999999, expected_close: '2026-06-30' }, // out of window
  { status: 'open', value: 400000, expected_close: null },
  { status: 'lost', value: 100000, expected_close: '2026-07-10' },
]

describe('sumWon / countWon', () => {
  it('sums won deal value within the window', () => {
    expect(sumWon(deals, WIN)).toBe(550000)
    expect(countWon(deals, WIN)).toBe(2)
  })
})

describe('pipelineValue', () => {
  it('sums open deal value only', () => {
    expect(pipelineValue(deals)).toBe(400000)
  })
})

describe('deriveStageCounts', () => {
  it('counts rows per named stage, zero-filling absent stages', () => {
    const rows = [{ stage: 'App Sent' }, { stage: 'App Sent' }, { stage: 'New Lead' }]
    expect(deriveStageCounts(rows, ['App Sent', 'Pre-Approved'])).toEqual({
      'App Sent': 2,
      'Pre-Approved': 0,
    })
  })
})

describe('dailySeries', () => {
  it('returns `days` daily sums ending at endKey, oldest first, zero-filling gaps', () => {
    const rows = [
      { date: '2026-07-15', metric_key: 'calls', value: 12 },
      { date: '2026-07-13', metric_key: 'calls', value: 5 },
      { date: '2026-07-13', metric_key: 'followups', value: 9 }, // other key ignored
    ]
    expect(dailySeries(rows, 'calls', '2026-07-15', 3)).toEqual([5, 0, 12])
  })
})
```

Note the import at the top of this block also needs `dailySeries`:

```js
import { sumWon, countWon, pipelineValue, deriveStageCounts, dailySeries } from './reports'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- reports`
Expected: FAIL — missing exports.

- [ ] **Step 3: Implement (append)**

```js
// dateStr: an ISO date/timestamp. from/to: YYYY-MM-DD keys. [from, to).
export function inWindow(dateStr, from, to) {
  if (!dateStr) return false
  const k = dayKey(new Date(dateStr).toISOString())
  return k >= from && k < to
}

export function sumWon(deals, { from, to }) {
  return deals
    .filter((d) => d.status === 'won' && inWindow(d.expected_close, from, to))
    .reduce((s, d) => s + Number(d.value || 0), 0)
}

export function countWon(deals, { from, to }) {
  return deals.filter((d) => d.status === 'won' && inWindow(d.expected_close, from, to)).length
}

export function pipelineValue(deals) {
  return deals.filter((d) => d.status === 'open').reduce((s, d) => s + Number(d.value || 0), 0)
}

// rows: objects with a .stage string. stageNames: array of stages to count.
export function deriveStageCounts(rows, stageNames) {
  const out = {}
  for (const name of stageNames) out[name] = 0
  for (const r of rows) {
    if (r.stage && Object.prototype.hasOwnProperty.call(out, r.stage)) out[r.stage] += 1
  }
  return out
}

// rows: metrics_daily rows ({ date, metric_key, value }), already biz-filtered.
// Returns `days` daily sums for metricKey, oldest first, ending at endKey
// (YYYY-MM-DD). Days with no matching row are 0. Powers the Daily trend strip.
export function dailySeries(rows, metricKey, endKey, days = 7) {
  const byDate = {}
  for (const r of rows) {
    if (r.metric_key !== metricKey) continue
    byDate[r.date] = (byDate[r.date] || 0) + Number(r.value || 0)
  }
  const end = new Date(endKey + 'T00:00:00')
  const pad = (n) => String(n).padStart(2, '0')
  const out = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end)
    d.setDate(d.getDate() - i)
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    out.push(byDate[key] || 0)
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- reports`
Expected: PASS. Then run the full file once: `npm run test -- reports` — all suites green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reports.js src/lib/reports.test.js
git commit -m "feat(reports): live deal + stage selectors + daily trend series"
```

---

### Task 6: Reports page shell, route swap, Daily + Weekly tabs (read-only)

**Files:**
- Create: `src/pages/Reports.jsx`
- Modify: `src/App.jsx` (import + route)

This task renders the tab shell and the Daily/Weekly tabs from live + rollup data. Manual entry (writing) lands in Task 7; the "Log today" inputs are added there. Uses the global `useBusiness()` filter and mirrors `Overview.jsx`'s fetch/`isDemoMode` pattern.

- [ ] **Step 1: Create the page**

```jsx
import { useEffect, useMemo, useState } from 'react'
import { supabase, isDemoMode } from '../lib/supabase'
import { useBusiness } from '../context/BusinessContext'
import {
  DEFAULT_TARGETS, metricsForTab, resolveTargets, buildTabModel,
  weekStart, monthWindow, rollupMetrics,
  sumWon, countWon, pipelineValue, deriveStageCounts,
} from '../lib/reports'

const TABS = [
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'revenue', label: 'Revenue' },
]

const PACE_STYLE = {
  on: { color: 'var(--bay)', bar: 'var(--bay)' },
  behind: { color: 'var(--bay-gold)', bar: 'var(--bay-gold)' },
  none: { color: 'var(--muted)', bar: 'var(--line2)' },
}

function MetricCard({ card }) {
  const s = PACE_STYLE[card.pace]
  return (
    <div className="rounded-card border border-line bg-panel p-4">
      <div className="flex items-baseline justify-between">
        <div className="num text-[26px] font-bold leading-none tracking-tight" style={{ color: s.color }}>
          {card.valueText}
        </div>
        <div className="num text-[12px] text-dim">/ {card.targetText}</div>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
        {card.label}
        {card.source !== 'live' && (
          <span
            className="rounded px-1 py-px text-[9px] font-semibold tracking-wide"
            style={{ background: 'var(--hoverbg)', color: 'var(--dim)' }}
          >
            {card.source === 'manual' ? 'MANUAL' : 'SNAPSHOT'}
          </span>
        )}
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--line)' }}>
        <div className="h-full rounded-full" style={{ width: `${card.pct}%`, background: s.bar }} />
      </div>
    </div>
  )
}

function CardGrid({ cards }) {
  if (cards.length === 0) {
    return <p className="mt-6 text-sm text-muted">No metrics for this view.</p>
  }
  return (
    <div className="mt-6 grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((c) => <MetricCard key={c.key} card={c} />)}
    </div>
  )
}

export default function Reports() {
  const { biz } = useBusiness()
  const [tab, setTab] = useState('daily')
  const [data, setData] = useState(null) // { deals, activeRows, contacts, week, month, targets }
  const [loading, setLoading] = useState(!isDemoMode)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (isDemoMode) return
    let alive = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const wk = weekStart()
        const { from } = monthWindow()
        const [deals, active, contacts, week, month, settings] = await Promise.all([
          supabase.from('deals').select('status, value, expected_close, business_id'),
          supabase.from('v_active_pipeline').select('stage, business_id'),
          supabase.from('contacts').select('id, business_id', { count: 'exact', head: false }),
          supabase.from('metrics_daily').select('business_id, metric_key, value').gte('date', wk),
          supabase.from('metrics_daily').select('business_id, metric_key, value').gte('date', from),
          supabase.from('settings').select('value').eq('key', 'metric_targets').maybeSingle(),
        ])
        if (!alive) return
        const err = deals.error || active.error || contacts.error || week.error || month.error || settings.error
        if (err) { setError(err.message); return }
        setData({
          deals: deals.data || [],
          activeRows: active.data || [],
          contacts: contacts.data || [],
          week: week.data || [],
          month: month.data || [],
          targets: resolveTargets(DEFAULT_TARGETS, settings.data?.value),
        })
      } catch (e) {
        if (alive) setError(String(e?.message || e))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  const cards = useMemo(() => {
    if (!data) return []
    const values = computeValues(tab, biz, data)
    return buildTabModel(metricsForTab(tab, biz), values, data.targets)
  }, [tab, biz, data])

  return (
    <div>
      <h2 className="text-[28px] font-bold tracking-tight">Reports</h2>
      <p className="mt-1 text-sm text-muted">
        Your scoreboard against the Atkinson KPI targets. Live where data is wired; manual otherwise.
      </p>

      <div className="mt-5 flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-[13px] ${
              tab === t.key ? 'border-white font-semibold text-white' : 'border-transparent text-muted hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}
      {isDemoMode && (
        <div className="mt-4 rounded-lg border border-line bg-panel px-3 py-2 text-xs text-muted">
          Demo mode — connect Supabase to see live scoreboard data.
        </div>
      )}
      {loading && <div className="mt-6 text-sm text-muted">Loading scoreboard…</div>}
      {!loading && !error && !isDemoMode && <CardGrid cards={cards} />}
    </div>
  )
}

// Pure-ish value resolver kept in-file: maps each tab's metric keys to a number.
// Manual keys come from the metrics_daily rollup; live/derived are computed here.
function computeValues(tab, biz, data) {
  const bizFilter = (rows) => (biz === 'all' ? rows : rows.filter((r) => r.business_id === biz))
  if (tab === 'daily') {
    // Daily manual metrics are not week-scoped; Task 7 replaces this with a
    // today-scoped fetch. For read-only v1, show week-to-date rollup as a proxy.
    return rollupMetrics(bizFilter(data.week))
  }
  if (tab === 'weekly') {
    return rollupMetrics(bizFilter(data.week))
  }
  if (tab === 'monthly') {
    const manual = rollupMetrics(bizFilter(data.month))
    const bayDeals = data.deals.filter((d) => d.business_id === 'bay')
    const win = monthWindow()
    const bayActive = data.activeRows.filter((r) => r.business_id === 'bay')
    const stageCounts = deriveStageCounts(bayActive, ['App Sent', 'Pre-Approved'])
    return {
      ...manual,
      pre_approvals: stageCounts['Pre-Approved'],
      applications: stageCounts['App Sent'],
      loans_closed: countWon(bayDeals, win),
      loan_volume: sumWon(bayDeals, win),
      db_total: bizFilter(data.contacts).length,
    }
  }
  // revenue
  const manual = rollupMetrics(bizFilter(data.month))
  const bayDeals = data.deals.filter((d) => d.business_id === 'bay')
  const win = monthWindow()
  const combined = Number(manual.rev_gross_commission || 0) + Number(manual.rev_monthly_residual || 0)
  return {
    ...manual,
    rev_closings: countWon(bayDeals, win),
    rev_loan_volume: sumWon(bayDeals, win),
    rev_combined_income: combined,
  }
}
```

- [ ] **Step 2: Swap the route in App.jsx**

Add the import after line 11 (`import Activity from './pages/Activity'`):

```jsx
import Reports from './pages/Reports'
```

Replace the placeholder route block (`src/App.jsx:42-49`) with:

```jsx
              <Route path="/reports" element={<Reports />} />
```

- [ ] **Step 3: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds, no unresolved imports.

- [ ] **Step 4: Smoke-test in the browser preview**

Start the dev server via preview_start `{name: "atkinson"}` (or add a `.claude/launch.json` entry running `npm run dev` on port 5199), open `/reports`, and confirm: four tabs render, clicking a tab switches content, the MPG/Bayway/All sidebar filter re-slices the cards, and the Monthly tab shows a non-dash `Total database` value. Capture a screenshot.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Reports.jsx src/App.jsx
git commit -m "feat(reports): tab shell, route, Daily/Weekly/Monthly/Revenue read views"
```

---

### Task 7: Daily manual entry — "Log today" upsert into metrics_daily

**Files:**
- Modify: `src/pages/Reports.jsx`

Adds a today-scoped fetch and a Daily "Log today" editor whose values upsert into `metrics_daily`. Writing requires the biz filter to resolve to a single book (metrics_daily rows need a concrete `business_id`); when the filter is "All", entry is disabled with a hint to pick MPG or Bayway.

- [ ] **Step 1: Add the `todayKey` helper**

Add this helper near the top of `Reports.jsx` (used by the fetch, the editor, and the trend strip):

```jsx
function todayKey() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
```

- [ ] **Step 2: Add the log editor, and replace the fetch with a reusable `load()`**

First add the `LogToday` component (rendered above `<CardGrid>` on the daily tab):

```jsx
function LogToday({ biz, values, onSave, saving }) {
  const metrics = metricsForTab('daily', biz).filter((m) => m.source === 'manual')
  const [draft, setDraft] = useState({})
  if (biz === 'all') {
    return (
      <div className="mt-6 rounded-card border border-line bg-panel p-4 text-sm text-muted">
        Pick <b className="text-white">MPG</b> or <b className="text-white">Bayway</b> in the sidebar to log today’s activity.
      </div>
    )
  }
  return (
    <div className="mt-6 rounded-card border border-line bg-panel p-4">
      <div className="mb-3 text-sm font-semibold">Log today</div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {metrics.map((m) => (
          <label key={m.key} className="text-xs text-muted">
            {m.label}
            <input
              type="number"
              min="0"
              defaultValue={values[m.key] ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, [m.key]: e.target.value }))}
              className="mt-1 w-full rounded-md border border-line2 bg-panel2 px-2 py-1.5 text-sm text-white"
            />
          </label>
        ))}
      </div>
      <button
        disabled={saving}
        onClick={() => onSave(draft)}
        className="mt-3 rounded-md bg-white px-3 py-1.5 text-[13px] font-semibold text-[#07120b] disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save today'}
      </button>
    </div>
  )
}
```

To let `saveToday` re-fetch, extract the `useEffect` body into a reusable `load()`. Replace the whole `useEffect(...)` from Task 6 with the version below (adds `saving` state, the `load` callback, `saveToday`, and two extra queries — `series` for the 7-day strip and `todayCalls` for the live FUB cross-count):

```jsx
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (isDemoMode) return
    setLoading(true)
    setError(null)
    try {
      const wk = weekStart()
      const { from } = monthWindow()
      const sevenAgo = (() => {
        const d = new Date(); d.setDate(d.getDate() - 6)
        const pad = (n) => String(n).padStart(2, '0')
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      })()
      const [deals, active, contacts, week, month, series, settings, todayCalls] = await Promise.all([
        supabase.from('deals').select('status, value, expected_close, business_id'),
        supabase.from('v_active_pipeline').select('stage, business_id'),
        supabase.from('contacts').select('id, business_id'),
        supabase.from('metrics_daily').select('business_id, metric_key, value').gte('date', wk),
        supabase.from('metrics_daily').select('business_id, metric_key, value').gte('date', from),
        supabase.from('metrics_daily').select('date, business_id, metric_key, value').gte('date', sevenAgo),
        supabase.from('settings').select('value').eq('key', 'metric_targets').maybeSingle(),
        supabase.from('activities')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', 'bay').eq('type', 'call').gte('occurred_at', todayKey()),
      ])
      const err = deals.error || active.error || contacts.error || week.error ||
        month.error || series.error || settings.error || todayCalls.error
      if (err) { setError(err.message); return }
      setData({
        deals: deals.data || [],
        activeRows: active.data || [],
        contacts: contacts.data || [],
        week: week.data || [],
        month: month.data || [],
        series: series.data || [],
        savedTargets: settings.data?.value || {},
        targets: resolveTargets(DEFAULT_TARGETS, settings.data?.value),
        todayCalls: todayCalls.count || 0,
      })
    } catch (e) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function saveToday(draft) {
    const entries = Object.entries(draft).filter(([, v]) => v !== '' && v != null)
    if (entries.length === 0 || biz === 'all') return
    setSaving(true)
    const rows = entries.map(([metric_key, v]) => ({
      business_id: biz, date: todayKey(), metric_key, value: Number(v),
    }))
    const { error: upErr } = await supabase
      .from('metrics_daily')
      .upsert(rows, { onConflict: 'business_id,date,metric_key' })
    setSaving(false)
    if (upErr) { setError(upErr.message); return }
    await load()
  }
```

For the daily today-rollup, fetch today's rows too — simplest is to derive them from `series` (which already spans the last 7 days incl. today). Update `computeValues`' daily branch to filter `series` to `todayKey()`:

```jsx
  if (tab === 'daily') {
    const today = data.series.filter((r) => r.date === todayKey())
    return rollupMetrics(bizFilter(today))
  }
```

Add `import { useCallback } from 'react'` to the existing React import. Render `<LogToday>` guarded by `data`:

```jsx
      {!loading && !error && !isDemoMode && data && tab === 'daily' && (
        <LogToday
          biz={biz}
          values={computeValues('daily', biz, data)}
          todayCalls={data.todayCalls}
          onSave={saveToday}
          saving={saving}
        />
      )}
```

- [ ] **Step 3: Add the live-call cross-count + 7-day trend strip to Daily**

In `LogToday`, show the live FUB call count beside the manual Calls input as a cross-check (spec: "FUB logged N today"). Under the Calls `<label>`, add:

```jsx
            {m.key === 'calls' && (
              <span className="mt-1 block text-[10.5px] text-dim">
                FUB logged {todayCalls} today
              </span>
            )}
```

Add `todayCalls` to `LogToday`'s props (`function LogToday({ biz, values, todayCalls, onSave, saving })`).

Add a 7-day trend strip for calls above the day's cards (Daily only). Add this component and render it before `<CardGrid>` on the daily tab, guarded by `data`:

```jsx
function TrendStrip({ series }) {
  const max = Math.max(1, ...series)
  const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
  const start = new Date(); start.setDate(start.getDate() - 6)
  return (
    <div className="mt-6 rounded-card border border-line bg-panel p-4">
      <div className="mb-3 text-xs font-semibold text-muted">Calls · last 7 days</div>
      <div className="flex items-end gap-2" style={{ height: 64 }}>
        {series.map((v, i) => {
          const d = new Date(start); d.setDate(start.getDate() + i)
          return (
            <div key={i} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex w-full flex-1 items-end">
                <div className="w-full rounded-sm" style={{ height: `${(v / max) * 100}%`, minHeight: 2, background: 'var(--bay)' }} />
              </div>
              <span className="num text-[10px] text-dim">{DOW[d.getDay()]}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

Render on the daily tab, computing the series with the biz filter:

```jsx
      {!loading && !error && !isDemoMode && data && tab === 'daily' && (
        <TrendStrip
          series={dailySeries(
            biz === 'all' ? data.series : data.series.filter((r) => r.business_id === biz),
            'calls', todayKey(), 7,
          )}
        />
      )}
```

Add `dailySeries` to the `../lib/reports` import at the top of the file.

- [ ] **Step 4: Verify the build compiles**

Run: `npm run build`
Expected: success.

- [ ] **Step 5: Smoke-test the write path + Daily extras**

In the preview (Supabase connected), select Bayway, open `/reports` → Daily, enter `calls = 12`, click **Save today**. Confirm no error, the Calls card updates to `12 / 100`, the "FUB logged N today" line shows under the Calls input, the 7-day strip shows a bar for today, and re-loading persists `12`. Confirm the **All** filter shows the "pick a business" hint in place of the editor. Capture a screenshot.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Reports.jsx
git commit -m "feat(reports): Daily 'Log today' manual entry, live call cross-count, 7-day trend"
```

---

### Task 8: Edit-targets modal — upsert settings.metric_targets

**Files:**
- Modify: `src/pages/Reports.jsx`

Adds an "Edit targets" button that opens a modal listing the current tab's targets and upserts the whole set into `settings.metric_targets`.

- [ ] **Step 1: Add the modal component**

```jsx
function EditTargets({ tab, biz, targets, onClose, onSave, saving }) {
  const metrics = metricsForTab(tab, biz)
  const [draft, setDraft] = useState(() =>
    Object.fromEntries(metrics.map((m) => [m.key, targets[m.key] ?? ''])),
  )
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-card border border-line bg-panel2 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 text-sm font-semibold">Edit targets — {tab}</div>
        <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
          {metrics.map((m) => (
            <label key={m.key} className="flex items-center justify-between gap-3 text-xs text-muted">
              {m.label}
              <input
                type="number" min="0"
                value={draft[m.key]}
                onChange={(e) => setDraft((d) => ({ ...d, [m.key]: e.target.value }))}
                className="w-28 rounded-md border border-line2 bg-panel px-2 py-1 text-sm text-white"
              />
            </label>
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-line2 px-3 py-1.5 text-[13px] text-muted">Cancel</button>
          <button
            disabled={saving}
            onClick={() => onSave(draft)}
            className="rounded-md bg-white px-3 py-1.5 text-[13px] font-semibold text-[#07120b] disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save targets'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire it into Reports()**

Add `const [editing, setEditing] = useState(false)`. Add an "Edit targets" button to the right of the tab bar. Add the save handler (merges the draft over existing saved targets so other tabs' overrides survive):

```jsx
  async function saveTargets(draft) {
    setSaving(true)
    const clean = Object.fromEntries(
      Object.entries(draft).filter(([, v]) => v !== '' && v != null).map(([k, v]) => [k, Number(v)]),
    )
    const merged = { ...(data.savedTargets || {}), ...clean }
    const { error: upErr } = await supabase
      .from('settings')
      .upsert({ key: 'metric_targets', value: merged }, { onConflict: 'key' })
    setSaving(false)
    if (upErr) { setError(upErr.message); return }
    setEditing(false)
    await load()
  }
```

(`data.savedTargets` is already populated by Task 7's `load()`.) Render `{editing && data && <EditTargets tab={tab} biz={biz} targets={data.targets} onClose={() => setEditing(false)} onSave={saveTargets} saving={saving} />}`.

- [ ] **Step 3: Verify the build compiles**

Run: `npm run build`
Expected: success.

- [ ] **Step 4: Smoke-test target editing**

In the preview, open `/reports` → Daily, click **Edit targets**, change Calls target `100 → 80`, Save. Confirm the Calls card's `/ 100` becomes `/ 80` and its bar re-scales, and that re-loading the page keeps `80`. Capture a screenshot.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Reports.jsx
git commit -m "feat(reports): edit-targets modal upserting settings.metric_targets"
```

---

### Task 9: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full unit suite**

Run: `npm run test`
Expected: all suites pass, including the new `reports` suites.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: success, no warnings about unresolved imports.

- [ ] **Step 3: End-to-end manual pass in the preview**

With Supabase connected, verify each acceptance point from the spec's Testing section:
- Log a daily metric (Bayway) → progress bar updates; reload persists it.
- Edit a target → bar re-scales; reload persists it.
- Switch MPG / Bayway / All → every tab re-slices; "All" disables the daily log editor with the pick-a-business hint.
- Monthly tab shows live `Total database`, `Loans closed (MTD)`, `Loan volume (MTD)`; pre-approval/application cards show the `SNAPSHOT` badge; manual cards show `MANUAL`.
- Revenue tab shows `Combined monthly income` = gross commission + monthly residual, against the `$27,500` target.

- [ ] **Step 4: Confirm no stray commits / clean tree**

Run: `git status`
Expected: clean working tree; `git log --oneline -8` shows the eight task commits (Tasks 1–8; Task 9 is verification-only).
