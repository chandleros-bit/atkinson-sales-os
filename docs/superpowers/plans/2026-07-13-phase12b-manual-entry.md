# Reports Phase 12b — Manual Entry for All Tabs + Revenue Completion

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every `manual` metric on the Weekly / Monthly / Revenue tabs enterable (today only the Daily tab has an entry surface), wire the already-built-and-tested `pipelineValue` into a Monthly card, and add the Revenue tab's missing derived figures so the $27,500 / $330K North Star actually computes.

**Architecture:** Generalize Phase 12's daily-only `LogToday` into a per-tab `LogMetrics` surface that upserts into the same `metrics_daily` table, keyed to a **period date** for the active tab (daily → today, weekly → that week's Monday, monthly/revenue → the 1st of the month). Because the existing rollups already query `gte(weekStart)` and `gte(monthStart)`, a row written at the period's start date rolls up correctly with no window changes. One new pure helper (`periodDateFor`) owns that mapping; new registry entries and derived math extend the existing registry pattern.

**Tech Stack:** React 18 + Vite, Tailwind (dark theme, `.num`), Supabase (Postgres, RLS), vitest.

**Depends on:** Phase 12 (branch `phase12-reports` / PR). Migration `0012_reports_rls.sql` must already be applied — no new migration is needed (the same `metrics_daily` upsert policy covers these writes).

**Context — why this exists:** Phase 12's final review found manual entry reachable only on the Daily tab, leaving ~19 cards permanently empty and `rev_combined_income` stuck at $0 (it sums `rev_gross_commission` + `rev_monthly_residual`, both manual). Phase 12 shipped anyway by explicit decision, with this as the agreed fast-follow.

**Project constraints (read before committing):**
- Dev server `npm run dev` (port 5199). Tests `npm run test`. Build `npm run build`.
- **Commit as the repo's configured author only.** Never pass `-c user.email=…`/`-c user.name=…`, never add a `Co-Authored-By` trailer — the Netlify free plan only builds single-contributor pushes.
- Do not push unless asked; commit locally per task.
- Pure logic goes in `src/lib/reports.js` with tests in `src/lib/reports.test.js`; JSX is verified by build + preview (repo has no jsdom).

**File structure:**
- Modify `src/lib/reports.js` — add `periodDateFor`, new METRICS entries, new DEFAULT_TARGETS.
- Modify `src/lib/reports.test.js` — tests for the above.
- Modify `src/pages/Reports.jsx` — generalize `LogToday` → `LogMetrics`, render per tab, extend `computeValues`.

---

### Task 1: `periodDateFor` — which date a tab's manual entry writes to

**Files:** Modify `src/lib/reports.js`; Test `src/lib/reports.test.js`

- [ ] **Step 1: Write the failing test (append)**

```js
import { periodDateFor } from './reports'

// Wednesday 2026-07-15T12:00 local
const NOW_P = new Date(2026, 6, 15, 12, 0, 0).getTime()

describe('periodDateFor', () => {
  it('writes daily entries to today', () => {
    expect(periodDateFor('daily', NOW_P)).toBe('2026-07-15')
  })
  it('writes weekly entries to the week Monday', () => {
    expect(periodDateFor('weekly', NOW_P)).toBe('2026-07-13')
  })
  it('writes monthly and revenue entries to the 1st of the month', () => {
    expect(periodDateFor('monthly', NOW_P)).toBe('2026-07-01')
    expect(periodDateFor('revenue', NOW_P)).toBe('2026-07-01')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- reports` → FAIL (`periodDateFor is not a function`).

- [ ] **Step 3: Implement (append to reports.js)**

```js
// The metrics_daily.date a tab's manual entry writes to. Rows land on the
// period's first day so the existing gte(weekStart)/gte(monthStart) rollups
// pick them up unchanged. daily -> today, weekly -> Monday, monthly/revenue
// -> the 1st.
export function periodDateFor(tab, now = Date.now()) {
  if (tab === 'daily') return dayKey(new Date(now).toISOString())
  if (tab === 'weekly') return weekStart(now)
  return monthWindow(now).from
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- reports` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reports.js src/lib/reports.test.js
git commit -m "feat(reports): periodDateFor — per-tab manual-entry date"
```

---

### Task 2: Registry additions — pipeline value, revenue figures, weekly conversation total

**Files:** Modify `src/lib/reports.js`; Test `src/lib/reports.test.js`

The existing registry invariant tests (every metric key has a numeric `DEFAULT_TARGETS` entry; enums valid; unique keys) already cover these additions — they will fail if a target is forgotten.

- [ ] **Step 1: Add the metrics.** In `src/lib/reports.js`, add to the `METRICS` array — in the `monthly` group:

```js
  { key: 'pipeline_value',     label: 'Pipeline value (open)', tab: 'monthly', biz: 'bay', source: 'live',    unit: 'currency' },
```

in the `weekly` group:

```js
  { key: 'weekly_conversations', label: 'Meaningful conversations', tab: 'weekly', biz: 'both', source: 'derived', unit: 'count' },
```

and in the `revenue` group:

```js
  { key: 'rev_processing_volume', label: 'Processing volume',      tab: 'revenue', biz: 'mpg', source: 'manual',  unit: 'currency' },
  { key: 'rev_avg_per_closing',   label: 'Avg income / closing',   tab: 'revenue', biz: 'bay', source: 'derived', unit: 'currency' },
  { key: 'rev_avg_residual',      label: 'Avg residual / account', tab: 'revenue', biz: 'mpg', source: 'derived', unit: 'currency' },
  { key: 'rev_annualized',        label: 'Annualized income',      tab: 'revenue', biz: 'both',source: 'derived', unit: 'currency' },
```

- [ ] **Step 2: Add their defaults.** In `DEFAULT_TARGETS` add:

```js
  pipeline_value: 2_000_000,
  weekly_conversations: 100,
  rev_processing_volume: 1_000_000,
  rev_avg_per_closing: 3_500,
  rev_avg_residual: 100,
  rev_annualized: 330_000,
```

- [ ] **Step 3: Run the tests**

Run: `npm run test -- reports`
Expected: PASS (the registry invariant tests confirm every new key has a numeric target and valid enums).

- [ ] **Step 4: Commit**

```bash
git add src/lib/reports.js
git commit -m "feat(reports): registry — pipeline value, weekly conversation total, revenue derived figures"
```

---

### Task 3: Compute the new live/derived values

**Files:** Modify `src/pages/Reports.jsx`

- [ ] **Step 1: Add a safe-divide helper.** Add at module scope in `Reports.jsx`:

```jsx
// Returns null (renders as "—", pace "none") rather than NaN/Infinity when the
// denominator is missing — an unknown average must not read as $0.
function safeDiv(numerator, denominator) {
  const n = Number(numerator || 0)
  const d = Number(denominator || 0)
  if (!d) return null
  return n / d
}
```

- [ ] **Step 2: Wire `pipelineValue` into the Monthly branch.** Add `pipelineValue` to the `../lib/reports` import. In `computeValues`' monthly branch, add to the returned object:

```jsx
      pipeline_value: pipelineValue(bayDeals),
```

- [ ] **Step 3: Add the weekly conversations total.** Replace the weekly branch of `computeValues` with:

```jsx
  if (tab === 'weekly') {
    const manual = rollupMetrics(bizFilter(data.week))
    return {
      ...manual,
      weekly_conversations:
        Number(manual.realtor_convos || 0) + Number(manual.bizowner_convos || 0),
    }
  }
```

- [ ] **Step 4: Extend the revenue branch.** Replace the revenue branch's returned object with:

```jsx
  const closings = countWon(bayDeals, win)
  return {
    ...manual,
    rev_closings: closings,
    rev_loan_volume: sumWon(bayDeals, win),
    rev_combined_income: combined,
    rev_avg_per_closing: safeDiv(manual.rev_gross_commission, closings),
    rev_avg_residual: safeDiv(manual.rev_monthly_residual, manual.rev_active_merchants),
    rev_annualized: combined * 12,
  }
```

- [ ] **Step 5: Verify the build**

Run: `npm run build` → success.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Reports.jsx
git commit -m "feat(reports): pipeline value card, weekly conversation total, revenue derived figures"
```

---

### Task 4: Generalize `LogToday` into a per-tab `LogMetrics`

**Files:** Modify `src/pages/Reports.jsx`

- [ ] **Step 1: Replace the `LogToday` component with `LogMetrics`.** It takes `tab`, lists that tab's `manual` metrics, and labels itself by period. Replace the whole `LogToday` function with:

```jsx
const PERIOD_LABEL = {
  daily: 'today', weekly: 'this week', monthly: 'this month', revenue: 'this month',
}

function LogMetrics({ tab, biz, values, todayCalls, onSave, saving }) {
  const metrics = metricsForTab(tab, biz).filter((m) => m.source === 'manual')
  const [draft, setDraft] = useState({})
  if (metrics.length === 0) return null
  if (biz === 'all') {
    return (
      <div className="mt-6 rounded-card border border-line bg-panel p-4 text-sm text-muted">
        Pick <b className="text-white">MPG</b> or <b className="text-white">Bayway</b> in the sidebar to log {PERIOD_LABEL[tab]}’s numbers.
      </div>
    )
  }
  return (
    <div className="mt-6 rounded-card border border-line bg-panel p-4">
      <div className="mb-3 text-sm font-semibold">Log {PERIOD_LABEL[tab]}</div>
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
            {m.key === 'calls' && biz === 'bay' && (
              <span className="mt-1 block text-[10.5px] text-dim">
                FUB logged {todayCalls} today
              </span>
            )}
          </label>
        ))}
      </div>
      <button
        disabled={saving}
        onClick={() => onSave(draft)}
        className="mt-3 rounded-md bg-white px-3 py-1.5 text-[13px] font-semibold text-[#07120b] disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Make `saveToday` period-aware.** Rename it `saveMetrics` and use `periodDateFor(tab, ...)`. Replace the existing `saveToday` function with:

```jsx
  async function saveMetrics(draft) {
    const entries = Object.entries(draft).filter(([, v]) => v !== '' && v != null)
    if (entries.length === 0 || biz === 'all') return
    setSaving(true)
    const date = periodDateFor(tab)
    const rows = entries.map(([metric_key, v]) => ({
      business_id: biz, date, metric_key, value: Number(v),
    }))
    const { error: upErr } = await supabase
      .from('metrics_daily')
      .upsert(rows, { onConflict: 'business_id,date,metric_key' })
    setSaving(false)
    if (upErr) { setError(upErr.message); return }
    await load()
  }
```

Add `periodDateFor` to the `../lib/reports` import.

- [ ] **Step 3: Render `LogMetrics` on every tab.** Replace the existing daily-only `<LogToday .../>` render block with (note `key={`${tab}-${biz}`}` — remounting per tab AND business is what prevents a draft from one period/business being saved onto another):

```jsx
      {!loading && !error && !isDemoMode && data && (
        <LogMetrics
          key={`${tab}-${biz}`}
          tab={tab}
          biz={biz}
          values={computeValues(tab, biz, data)}
          todayCalls={data.todayCalls}
          onSave={saveMetrics}
          saving={saving}
        />
      )}
```

Leave the `TrendStrip` render daily-only, unchanged.

- [ ] **Step 4: Verify the build**

Run: `npm run build` → success. Confirm no lingering references to `LogToday` or `saveToday` (grep both).

- [ ] **Step 5: Commit**

```bash
git add src/pages/Reports.jsx
git commit -m "feat(reports): per-tab manual entry (LogMetrics) writing to the period's date"
```

---

### Task 5: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full suite** — Run `npm run test`. Expected: all pass (Phase 12's 115 plus the new `periodDateFor` tests).
- [ ] **Step 2: Build** — Run `npm run build`. Expected: success.
- [ ] **Step 3: End-to-end manual pass** (needs `0012` applied + Supabase login):
  - Weekly tab, Bayway: enter Realtor conversations = 12, Save → card shows `12 / 50`; reload persists; "Meaningful conversations" reflects realtor + business-owner totals.
  - Revenue tab, Bayway: enter Gross commission = 17500; MPG: enter Monthly residual = 10000 → **Combined monthly income shows $27,500** against its target, and Annualized income shows $330,000.
  - Revenue tab: Avg income / closing shows `—` when there are no closings this month (not `$0`).
  - Monthly tab: "Pipeline value (open)" renders a live figure.
  - Switch business mid-edit without saving → the form resets (no cross-business write).
- [ ] **Step 4: Clean tree** — Run `git status`. Expected: clean; `git log --oneline -4` shows the four task commits.
