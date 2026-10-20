# Tier 1 · Card Health + Speed-to-Lead Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every pipeline card shows whether the lead is moving: a next-step dot (overdue / due today / scheduled / none), a red "stuck in stage" marker against per-stage limits, and a live speed-to-lead timer on new, uncalled leads. Up Next agrees with the board.

**Architecture:**
- Migration `0034` adds five fields to the END of `v_active_pipeline` and `v_mpg_contacts`, using the same expressions as `v_lead_signals`, so each board stays one query.
- Pure helpers in the new `src/lib/cardHealth.js` turn a row into `{ next, stuck, speed }`, a sort rank and a column summary. They reuse the day math and the new `stuckDaysFor()` from `priorityQueue.js`, so the board and Up Next share one rule.
- `Pipeline.jsx` renders the health line and passes a health sort into `buildColumns`.
- Part B adds a shared `useNow` ticker, a 60-second refresh while the tab is visible, and a tab-title alert.

**Tech stack:** React 18, Vite, Vitest (jsdom render tests with `createRoot` + `act`), Tailwind, Supabase Postgres views.

**Spec:** `docs/superpowers/specs/2026-10-19-tier1-pipeline-flow-design.md`, sections "Data", 1 and 2. Approved in chat on 2026-10-19 with all recommendations.

**Two PRs:**
- Part A, Tasks 1–6, is PR 1 on branch `feat/card-health`.
- Part B, Tasks 7–12, is PR 2 on branch `feat/speed-to-lead`, cut from `main` after PR 1 merges.

**Repo rules:**
- Commit as the repo's configured git user. Never pass `-c user.name` / `-c user.email`.
- End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Production is Vercel; ignore Netlify bot comments.
- `supabase db push --linked` writes the production database, so it needs Chandler's go-ahead in chat (Task 3 Step 4).

**Scratchpad:** dry-run SQL files go in `$SCRATCH`, defined below, never in the repo.

```bash
SCRATCH="C:/Users/Chandler/AppData/Local/Temp/claude/C--Users-Chandler--claude-projects-atkinson-sales-os-phase1/ee633ddb-8ac4-4a50-9be9-3d57a5c84413/scratchpad"
```

---

## File map

| File | Part | Responsibility |
|---|---|---|
| `supabase/migrations/0034_card_health.sql` (create) | A | The five health columns on both board views; mirrors `stuck_days_by_stage` into `settings.priority_rules`. |
| `src/lib/priorityQueue.js` (modify) | A, B | `stuck_days_by_stage` / `speed_to_lead_minutes` defaults; `stuckDaysFor()`; exports `calendarDaysSince`, `overdueDays`; per-stage stuck bucket; minute-level new-lead text. |
| `src/lib/priorityQueue.test.js` (modify) | A, B | Tests for the above. |
| `src/lib/cardHealth.js` (create) | A, B | Pure: `nextStep`, `stuckFor`, `speedToLead`, `formatElapsed`, `cardHealth`, `healthRank`, `sortByHealth`, `columnSummary`, `lateLeadCount`, `titleFor`. |
| `src/lib/cardHealth.test.js` (create) | A, B | Unit tests. |
| `src/lib/pipeline.js` (modify) | A | `buildColumns` takes a `sortCards` option. |
| `src/lib/pipeline.test.js` (modify) | A | Test for `sortCards`. |
| `src/pages/Pipeline.jsx` (modify) | A, B | Health columns in `cfg.columns`, `HealthLine` / `StuckLine`, header summary, health sort, ticker, 60s refresh. |
| `src/pages/Pipeline.render.test.jsx` (modify) | A, B | Card-health and timer render tests. |
| `src/lib/useNow.js` (create) | B | Shared `Date.now()` ticker hook. |
| `src/lib/usePriorityQueue.js` (modify) | B | 60s refresh while the tab is visible. |
| `src/components/Layout.jsx` (modify) | B | Tab title "(n) New lead waiting · Atkinson Sales OS". |

---

# Part A: Card health (PR 1)

### Task 0: Branch and commit the spec

- [ ] **Step 1: Create the branch from an up-to-date main**

```bash
cd C:/Users/Chandler/.claude/projects/atkinson-sales-os-phase1
git checkout main && git pull --ff-only
git checkout -b feat/card-health
```

- [ ] **Step 2: Commit the approved spec and this plan**

```bash
git add docs/superpowers/specs/2026-10-19-tier1-pipeline-flow-design.md docs/superpowers/plans/2026-10-19-tier1-card-health-speed-to-lead.md
git commit -m "docs: Tier 1 pipeline flow spec and card health plan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1: Per-stage stuck limits in `priorityQueue.js`

**Files:**
- Modify: `src/lib/priorityQueue.js` (`DEFAULT_RULES` ~line 29, `bucketsFor` ~line 90, exports)
- Test: `src/lib/priorityQueue.test.js`

- [ ] **Step 1: Write the failing tests**

In `src/lib/priorityQueue.test.js`, add `stuckDaysFor` to the import list:

```js
import {
  BUCKETS,
  DEFAULT_RULES,
  resolveRules,
  humanTouchAt,
  bucketsFor,
  buildQueue,
  groupForDisplay,
  reasonText,
  lastCallLabel,
  urgentCount,
  stuckDaysFor,
} from './priorityQueue'
```

Then add, inside the existing `describe('bucket 6: stuck in stage', ...)` block, after its last `it`:

```js
  it('uses the per-stage limit: Attempted is stuck at 5 days', () => {
    const lead = (n) => base({ is_active: true, stage: 'Attempted', stage_since: daysAgo(n), open_task_count: 1, oldest_open_due_at: daysAgo(-1) })
    expect(bucketsFor(lead(5), rules, NOW)).toContain('stuck')
    expect(bucketsFor(lead(4), rules, NOW)).not.toContain('stuck')
  })
```

And a new block at the end of the file:

```js
describe('stuckDaysFor', () => {
  it('reads the per-stage limit, null for never, else the flat stuck_days', () => {
    expect(stuckDaysFor('New Lead', rules)).toBe(2)
    expect(stuckDaysFor('Attempted', rules)).toBe(5)
    expect(stuckDaysFor('Application Received', rules)).toBe(14)
    expect(stuckDaysFor('Nurture / Credit Repair', rules)).toBeNull()
    expect(stuckDaysFor('Open', rules)).toBe(14)
    expect(stuckDaysFor('Open', { ...rules, stuck_days_by_stage: undefined })).toBe(14)
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/lib/priorityQueue.test.js`
Expected: FAIL. `stuckDaysFor is not a function`, and the Attempted-at-5-days case fails because the flat limit is 14.

- [ ] **Step 3: Implement**

In `src/lib/priorityQueue.js`, add the per-stage map to `DEFAULT_RULES`, right after `stuck_days: 14,`:

```js
  stuck_days: 14,
  // Days in one Bayway column before a lead is "stuck" (board card turns red,
  // Up Next bucket 6). null = never. Stages not listed (MPG, unknown) use
  // stuck_days. Mirrored into settings by migration 0034.
  stuck_days_by_stage: {
    'New Lead': 2,
    Attempted: 5,
    'Contacted/Working': 7,
    'Application/Estimate Sent': 7,
    'Application Received': 14,
    'Nurture / Credit Repair': null,
  },
```

Add this function directly below `resolveRules`:

```js
// Days in `stage` before a lead counts as stuck, or null for never.
export function stuckDaysFor(stage, rules) {
  const byStage = rules.stuck_days_by_stage || {}
  return Object.prototype.hasOwnProperty.call(byStage, stage) ? byStage[stage] : rules.stuck_days
}
```

In `bucketsFor`, replace these two lines:

```js
  const stageDays = daysSince(row.stage_since, now)
  if (row.is_active && stageDays != null && stageDays >= rules.stuck_days) out.push('stuck')
```

with:

```js
  const stageDays = daysSince(row.stage_since, now)
  const stuckLimit = stuckDaysFor(row.stage, rules)
  if (row.is_active && stuckLimit != null && stageDays != null && stageDays >= stuckLimit) out.push('stuck')
```

At the very end of the file, export the two day helpers for `cardHealth.js`. They keep their local-calendar-day rules, so the board and Up Next count days the same way.

```js
// Shared with the board's card health (cardHealth.js) so both count days alike.
export { daysSince as calendarDaysSince, overdueDays }
```

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `npx vitest run src/lib/priorityQueue.test.js`
Expected: PASS. The existing `resolveRules(null)` → `DEFAULT_RULES` test still passes, and the existing `App Sent` stuck tests still use the flat 14.

- [ ] **Step 5: Commit**

```bash
git add src/lib/priorityQueue.js src/lib/priorityQueue.test.js
git commit -m "feat: per-stage stuck limits for Up Next

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `cardHealth.js`, the pure health rules

**Files:**
- Create: `src/lib/cardHealth.js`
- Test: `src/lib/cardHealth.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/cardHealth.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { nextStep, stuckFor, cardHealth, healthRank, sortByHealth, columnSummary } from './cardHealth'
import { DEFAULT_RULES } from './priorityQueue'

// Local times (no Z), the same convention as priorityQueue.test.js.
// 2026-10-18 is a Sunday.
const NOW = new Date('2026-10-18T09:00:00').getTime()
const daysAgo = (n, hh = '09:00:00') => {
  const d = new Date(NOW)
  d.setDate(d.getDate() - n)
  const p = (x) => String(x).padStart(2, '0')
  return new Date(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${hh}`).toISOString()
}
const rules = DEFAULT_RULES
const row = (o = {}) => ({
  id: o.id || 'x',
  stage: 'Attempted',
  stage_since: null,
  open_task_count: 0,
  oldest_open_due_at: null,
  last_touch_at: null,
  ...o,
})

describe('nextStep', () => {
  it('none when nothing is open', () => {
    expect(nextStep(row(), NOW)).toEqual({ state: 'none', text: 'No next step' })
  })
  it('overdue by whole local days', () => {
    expect(nextStep(row({ open_task_count: 1, oldest_open_due_at: daysAgo(1) }), NOW)).toMatchObject({ state: 'overdue', text: 'Follow-up 1 day overdue' })
    expect(nextStep(row({ open_task_count: 2, oldest_open_due_at: daysAgo(3) }), NOW)).toMatchObject({ state: 'overdue', text: 'Follow-up 3 days overdue' })
  })
  it('due today, including later today', () => {
    expect(nextStep(row({ open_task_count: 1, oldest_open_due_at: daysAgo(0, '17:00:00') }), NOW)).toEqual({ state: 'today', text: 'Due today' })
  })
  it('scheduled shows the weekday and date', () => {
    expect(nextStep(row({ open_task_count: 1, oldest_open_due_at: daysAgo(-5) }), NOW)).toEqual({ state: 'scheduled', text: 'Next: Fri, Oct 23' })
  })
  it('an open task with no due date still counts as a next step', () => {
    expect(nextStep(row({ open_task_count: 1, oldest_open_due_at: null }), NOW)).toEqual({ state: 'scheduled', text: 'Task open · no date' })
  })
  it('parked and lost leads show nothing', () => {
    expect(nextStep(row({ stage: 'Nurture / Credit Repair' }), NOW).state).toBe('parked')
    expect(nextStep(row({ stage: 'Lost' }), NOW).state).toBe('parked')
  })
})

describe('stuckFor', () => {
  it('flags at the per-stage limit', () => {
    expect(stuckFor(row({ stage_since: daysAgo(5) }), rules, NOW)).toEqual({ days: 5, text: '5d in Attempted' })
    expect(stuckFor(row({ stage_since: daysAgo(4) }), rules, NOW)).toBeNull()
  })
  it('falls back to stuck_days for MPG statuses', () => {
    expect(stuckFor(row({ stage: 'Open', stage_since: daysAgo(14) }), rules, NOW)).toEqual({ days: 14, text: '14d in Open' })
    expect(stuckFor(row({ stage: 'Open', stage_since: daysAgo(13) }), rules, NOW)).toBeNull()
  })
  it('never for unknown stage dates or parked leads', () => {
    expect(stuckFor(row({ stage_since: null }), rules, NOW)).toBeNull()
    expect(stuckFor(row({ stage: 'Nurture / Credit Repair', stage_since: daysAgo(90) }), rules, NOW)).toBeNull()
  })
})

describe('ordering and summary', () => {
  const overdue = row({ id: 'overdue', open_task_count: 1, oldest_open_due_at: daysAgo(2) })
  const stuck = row({ id: 'stuck', open_task_count: 1, oldest_open_due_at: daysAgo(-3), stage_since: daysAgo(6) })
  const none = row({ id: 'none' })
  const today = row({ id: 'today', open_task_count: 1, oldest_open_due_at: daysAgo(0, '15:00:00') })
  const scheduled = row({ id: 'scheduled', open_task_count: 1, oldest_open_due_at: daysAgo(-2) })

  it('ranks overdue, stuck, none, today, scheduled', () => {
    const ids = sortByHealth([scheduled, today, none, stuck, overdue], rules, NOW).map((r) => r.id)
    expect(ids).toEqual(['overdue', 'stuck', 'none', 'today', 'scheduled'])
  })
  it('keeps oldest-touch-first inside a rank', () => {
    const a = row({ id: 'a', last_touch_at: daysAgo(1) })
    const b = row({ id: 'b', last_touch_at: daysAgo(9) })
    expect(sortByHealth([a, b], rules, NOW).map((r) => r.id)).toEqual(['b', 'a'])
  })
  it('healthRank puts an overdue stuck card with the overdue ones', () => {
    const both = row({ open_task_count: 1, oldest_open_due_at: daysAgo(1), stage_since: daysAgo(30) })
    expect(healthRank(cardHealth(both, rules, NOW))).toBe(healthRank(cardHealth(overdue, rules, NOW)))
  })
  it('summarises a column', () => {
    expect(columnSummary([overdue, stuck, none], rules, NOW)).toBe('1 overdue · 1 stuck')
    expect(columnSummary([none, scheduled], rules, NOW)).toBe('')
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/lib/cardHealth.test.js`
Expected: FAIL with `Failed to resolve import "./cardHealth"`.

- [ ] **Step 3: Implement**

Create `src/lib/cardHealth.js`:

```js
// Pipeline card health: is this lead moving? Pure, no React, no I/O.
// Spec: docs/superpowers/specs/2026-10-19-tier1-pipeline-flow-design.md (1, 2)
//
// Days are the rep's local calendar days, via the same helpers Up Next uses,
// so a red card on the board and an Up Next row always agree.
import { dueDayKey } from './tasks'
import { calendarDaysSince, overdueDays, stuckDaysFor } from './priorityQueue'
import { isLostStage } from './pipeline'
import { sortByAttention } from './overview'

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

// Parked (Nurture / Credit Repair) and lost leads aren't expected to move.
const isParked = (row) => /nurture/i.test(row.stage || '') || isLostStage(row.stage)

function dayLabel(key) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

// The lead's next step, from its oldest open task.
// { state: 'overdue' | 'today' | 'scheduled' | 'none' | 'parked', text }
export function nextStep(row, now = Date.now()) {
  if (isParked(row)) return { state: 'parked', text: '' }
  if (!(row.open_task_count > 0)) return { state: 'none', text: 'No next step' }
  if (!row.oldest_open_due_at) return { state: 'scheduled', text: 'Task open · no date' }
  const late = overdueDays(row.oldest_open_due_at, now)
  if (late >= 1) return { state: 'overdue', text: `Follow-up ${plural(late, 'day')} overdue` }
  if (late === 0) return { state: 'today', text: 'Due today' }
  return { state: 'scheduled', text: `Next: ${dayLabel(dueDayKey(row.oldest_open_due_at))}` }
}

// { days, text } once the lead has sat in its stage for the stage's limit.
// Unknown stage dates (stage predates tracking, 0029) are never stuck.
export function stuckFor(row, rules, now = Date.now()) {
  if (isParked(row)) return null
  const limit = stuckDaysFor(row.stage, rules)
  const days = calendarDaysSince(row.stage_since, now)
  if (limit == null || days == null || days < limit) return null
  return { days, text: `${days}d in ${row.stage}` }
}

export function cardHealth(row, rules, now = Date.now()) {
  return { next: nextStep(row, now), stuck: stuckFor(row, rules, now) }
}

// Smaller sorts first: overdue, stuck, no next step, due today, scheduled.
const NEXT_RANK = { overdue: 0, none: 2, today: 3, scheduled: 4, parked: 5 }
export function healthRank(h) {
  if (h.next.state === 'overdue') return 0
  if (h.stuck) return 1
  return NEXT_RANK[h.next.state]
}

// Board order inside a column. Ties keep the old oldest-touch-first order
// (Array.prototype.sort is stable).
export function sortByHealth(cards, rules, now = Date.now()) {
  const rank = new Map(cards.map((r) => [r, healthRank(cardHealth(r, rules, now))]))
  return sortByAttention(cards).sort((a, b) => rank.get(a) - rank.get(b))
}

// "4 overdue · 2 stuck" for a column header; '' when nothing needs saying.
export function columnSummary(cards, rules, now = Date.now()) {
  let overdue = 0
  let stuck = 0
  for (const r of cards) {
    const h = cardHealth(r, rules, now)
    if (h.next.state === 'overdue') overdue += 1
    if (h.stuck) stuck += 1
  }
  return [overdue && `${overdue} overdue`, stuck && `${stuck} stuck`].filter(Boolean).join(' · ')
}
```

Note: `sortByAttention` returns a new array (`[...rows].sort`), and the `rank` map is keyed by row object, so this works on the copy.

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `npx vitest run src/lib/cardHealth.test.js`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/cardHealth.js src/lib/cardHealth.test.js
git commit -m "feat: card health rules for the pipeline board

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Migration `0034`, the health columns on the board views

**Files:**
- Create: `supabase/migrations/0034_card_health.sql`

- [ ] **Step 1: Get the baseline counts**

Write `$SCRATCH/baseline.sql`:

```sql
select
  (select count(*) from v_active_pipeline where business_id = 'bay') as bay_rows,
  (select count(*) from v_mpg_contacts) as mpg_rows;
```

Run: `supabase db query --linked -f "$SCRATCH/baseline.sql"`
Expected: one row. Note both numbers; `bay_rows` was 133 on 2026-10-19.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/0034_card_health.sql`:

```sql
-- Tier 1 card health (docs/superpowers/specs/2026-10-19-tier1-pipeline-flow-design.md).
-- The two board views gain the five fields Up Next reads from v_lead_signals,
-- so each card can show its next step, days in stage and speed-to-lead
-- without a second query. v_lead_signals can't be reused: it drops snoozed
-- and reason-less leads. Same expressions as v_lead_signals (0029). New
-- columns go at the END so create or replace view keeps working (as 0022).

create or replace view public.v_active_pipeline
with (security_invoker = on) as
select id, business_id, name, email, phone, last_touch_at, stage, crm_profile_url,
       docs_tracked, docs_outstanding, docs_outstanding_count,
       docs_oldest_requested_at, doc_notes,
       last_note_snippet, last_note_at,
       stage_since, crm_created_at, last_outbound_call_at,
       open_task_count, oldest_open_due_at
from (
  select
    c.id,
    c.business_id,
    c.name,
    c.email,
    c.phone,
    c.last_touch_at,
    public.derive_stage(c.raw, c.person_stage, c.business_id) as stage,
    case c.business_id
      when 'bay' then 'https://baywayhtx.followupboss.com/2/people/view/' || c.external_id
      when 'mpg' then 'https://crm.zoho.com/crm/tab/Leads/' || c.external_id
    end as crm_profile_url,
    (bdt.id is not null) as docs_tracked,
    coalesce(d.names, '{}'::text[]) as docs_outstanding,
    coalesce(d.cnt, 0) as docs_outstanding_count,
    d.oldest as docs_oldest_requested_at,
    bdt.notes as doc_notes,
    n.snippet as last_note_snippet,
    n.occurred_at as last_note_at,
    c.stage_since,
    public.try_timestamptz(case c.business_id when 'bay' then c.raw->>'created' else c.raw->>'Created_Time' end)
      as crm_created_at,
    oc.last_outbound_call_at,
    coalesce(tk.open_task_count, 0) as open_task_count,
    tk.oldest_open_due_at
  from contacts c
  left join borrower_doc_tracking bdt
    on c.business_id = 'bay'
   and bdt.removed_at is null
   and bdt.fub_person_id = c.external_id
  left join lateral (
    select array_agg(bd.doc_type order by bd.first_requested_at asc nulls last, bd.doc_type asc) as names,
           count(*)::int as cnt,
           min(bd.first_requested_at) as oldest
    from borrower_docs bd
    where bd.tracking_id = bdt.id
      and bd.status = 'needed'
      and bd.removed_at is null
  ) d on true
  left join lateral (
    select a.notes as snippet, a.occurred_at
    from activities a
    where a.contact_id = c.id
      and a.type = 'note'
    order by a.occurred_at desc nulls last, a.id desc
    limit 1
  ) n on c.business_id = 'bay'
  left join (
    select contact_id, max(occurred_at) as last_outbound_call_at
    from activities
    where type = 'call' and direction = 'outbound' and contact_id is not null
    group by contact_id
  ) oc on oc.contact_id = c.id
  left join (
    select contact_id, count(*)::int as open_task_count, min(due_at) as oldest_open_due_at
    from tasks
    where is_completed = false and contact_id is not null
    group by contact_id
  ) tk on tk.contact_id = c.id
) s
where stage is not null;

create or replace view public.v_mpg_contacts
with (security_invoker = on) as
select
  c.id,
  c.name,
  c.company,
  c.email,
  c.phone,
  c.last_touch_at,
  coalesce(c.person_stage, '—') as stage,
  'https://crm.zoho.com/crm/tab/Leads/' || c.external_id as crm_profile_url,
  c.stage_since,
  public.try_timestamptz(c.raw->>'Created_Time') as crm_created_at,
  oc.last_outbound_call_at,
  coalesce(tk.open_task_count, 0) as open_task_count,
  tk.oldest_open_due_at
from contacts c
left join (
  select contact_id, max(occurred_at) as last_outbound_call_at
  from activities
  where type = 'call' and direction = 'outbound' and contact_id is not null
  group by contact_id
) oc on oc.contact_id = c.id
left join (
  select contact_id, count(*)::int as open_task_count, min(due_at) as oldest_open_due_at
  from tasks
  where is_completed = false and contact_id is not null
  group by contact_id
) tk on tk.contact_id = c.id
where c.business_id = 'mpg';

-- Keep settings.priority_rules mirroring DEFAULT_RULES (priorityQueue.js).
-- Only adds the key; never overwrites a value Chandler has edited.
update settings
set value = value || jsonb_build_object('stuck_days_by_stage', jsonb_build_object(
  'New Lead', 2,
  'Attempted', 5,
  'Contacted/Working', 7,
  'Application/Estimate Sent', 7,
  'Application Received', 14,
  'Nurture / Credit Repair', null
))
where key = 'priority_rules'
  and not (value ? 'stuck_days_by_stage');
```

- [ ] **Step 3: Dry-run inside a transaction that always rolls back**

Write `$SCRATCH/check-0034.sql`:

```sql
do $$
declare
  t0 timestamptz := clock_timestamp();
  bay int; bay_open int; bay_since int; bay_created int; mpg int; rules jsonb;
begin
  select count(*),
         count(*) filter (where open_task_count > 0),
         count(*) filter (where stage_since is not null),
         count(*) filter (where crm_created_at is not null)
    into bay, bay_open, bay_since, bay_created
    from v_active_pipeline where business_id = 'bay';
  select count(*) into mpg from v_mpg_contacts;
  select value->'stuck_days_by_stage' into rules from settings where key = 'priority_rules';
  raise exception '%', json_build_object(
    'bay_rows', bay, 'bay_with_open_task', bay_open, 'bay_with_stage_since', bay_since,
    'bay_with_created', bay_created, 'mpg_rows', mpg, 'stuck_days_by_stage', rules,
    'ms', round(extract(epoch from clock_timestamp() - t0) * 1000));
end $$;
```

Then:

```bash
{ echo 'begin;'; cat supabase/migrations/0034_card_health.sql; cat "$SCRATCH/check-0034.sql"; } > "$SCRATCH/dry-0034.sql"
supabase db query --linked -f "$SCRATCH/dry-0034.sql"
```

Expected: an error whose message is the JSON. The raised exception aborts the transaction, so nothing is kept. Check:
- `bay_rows` and `mpg_rows` equal the Step 1 baseline.
- `bay_with_created` is close to `bay_rows`.
- `stuck_days_by_stage` has the six keys.
- `ms` is under ~1500.

If `ms` is much higher, stop and report before going on. The spec's fallback is a `(contact_id, type, direction)` index on `activities`.

- [ ] **Step 4: Apply (needs Chandler's go-ahead in chat)**

Ask: "Dry run OK (paste the JSON). Apply migration 0034 to production?" Wait for a yes, then run:

```bash
supabase db push --linked
```

Expected: `Applying migration 0034_card_health.sql...` and `Finished supabase db push.`

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0034_card_health.sql
git commit -m "feat: health columns on the pipeline board views

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `buildColumns` takes a card sort

**Files:**
- Modify: `src/lib/pipeline.js` (`buildColumns`, ~line 47)
- Test: `src/lib/pipeline.test.js`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/pipeline.test.js`:

```js
describe('buildColumns sortCards', () => {
  it('orders cards with the given sort, default oldest touch first', () => {
    const rows = [row('a', 'Attempted', '2026-10-10T12:00:00Z'), row('b', 'Attempted', '2026-10-01T12:00:00Z')]
    expect(buildColumns(rows)[0].cards.map((c) => c.id)).toEqual(['b', 'a'])
    const byId = (cards) => [...cards].sort((x, y) => x.id.localeCompare(y.id))
    expect(buildColumns(rows, undefined, { sortCards: byId })[0].cards.map((c) => c.id)).toEqual(['a', 'b'])
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/lib/pipeline.test.js`
Expected: FAIL. The second expectation gets `['b', 'a']`.

- [ ] **Step 3: Implement**

In `src/lib/pipeline.js`, change the signature and the `cards:` line of `buildColumns`:

```js
// sortCards orders each column's cards (the board passes a health sort;
// default oldest touch first).
export function buildColumns(rows, flowOrder = LOAN_FLOW_ORDER, { showAllFlow = false, sortCards = sortByAttention } = {}) {
```

```js
    cards: sortCards(cards),
```

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `npx vitest run src/lib/pipeline.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pipeline.js src/lib/pipeline.test.js
git commit -m "feat: buildColumns accepts a card sort

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Health on the board (`Pipeline.jsx`)

**Files:**
- Modify: `src/pages/Pipeline.jsx`
- Test: `src/pages/Pipeline.render.test.jsx`

- [ ] **Step 1: Write the failing render test**

In `src/pages/Pipeline.render.test.jsx`, first widen the fake query builder so `usePriorityQueue`'s activities query, which Pipeline now triggers, doesn't throw. Change:

```js
  for (const m of ['select', 'eq', 'order', 'range', 'lte', 'limit']) q[m] = () => q
```

to:

```js
  for (const m of ['select', 'eq', 'order', 'range', 'lte', 'limit', 'gte', 'or']) q[m] = () => q
```

Then append:

```js
// Noon local N days ago, so whole-day maths can't flip at midnight or DST.
const ago = (n) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(12, 0, 0, 0)
  return d.toISOString()
}

describe('Pipeline card health', () => {
  it('shows the next step, stuck days and a column summary, worst first', async () => {
    DATA.rows = [
      { ...card('b', 'Ben Quiet', 'Attempted'), open_task_count: 0, oldest_open_due_at: null, stage_since: ago(9) },
      { ...card('a', 'Ana Late', 'Attempted'), open_task_count: 1, oldest_open_due_at: ago(3), stage_since: ago(1) },
    ]
    await mount()
    expect(cardEl('a').querySelector('[data-health="overdue"]').textContent).toContain('Follow-up 3 days overdue')
    expect(cardEl('b').querySelector('[data-health="none"]').textContent).toContain('No next step')
    expect(cardEl('b').querySelector('[data-health="stuck"]').textContent).toBe('9d in Attempted')
    expect(cardEl('a').querySelector('[data-health="stuck"]')).toBeNull()
    expect(column('Attempted').querySelector('[data-col-count]').textContent).toBe('2 · 1 overdue · 1 stuck')
    expect(cardsIn('Attempted')).toEqual(['a', 'b'])
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/pages/Pipeline.render.test.jsx`
Expected: the new test FAILS (`Cannot read properties of null (reading 'textContent')`). The existing drag tests still pass.

- [ ] **Step 3: Implement**

In `src/pages/Pipeline.jsx`, add the imports below the existing `../lib/pipeline` import:

```js
import { cardHealth, sortByHealth, columnSummary } from '../lib/cardHealth'
import { usePriorityQueue } from '../lib/usePriorityQueue'
```

Add these two components directly above `function Card(`:

```jsx
// Next-step dot + words. The colour is never the only signal.
const DOT = { overdue: 'var(--neg-ink)', today: 'var(--bay-gold)', scheduled: 'var(--pos-ink)', none: 'var(--dim)' }

function HealthLine({ h }) {
  if (!h || h.next.state === 'parked') return null
  const overdue = h.next.state === 'overdue'
  return (
    <div className="mt-1 flex items-center gap-1.5 text-[11px]" data-health={h.next.state}>
      <span aria-hidden="true" className="h-[7px] w-[7px] flex-none rounded-full" style={{ background: DOT[h.next.state] }} />
      <span className={overdue ? 'font-semibold' : 'text-muted'} style={overdue ? { color: 'var(--neg-ink)' } : undefined}>
        {h.next.text}
      </span>
    </div>
  )
}

function StuckLine({ h }) {
  if (!h?.stuck) return null
  return (
    <div className="mt-0.5 text-[11px] font-semibold" style={{ color: 'var(--neg-ink)' }} data-health="stuck">
      {h.stuck.text}
    </div>
  )
}
```

Change `Card` to take `health`, colour its accent bar red when stuck, and render the two lines under the contact line:

```jsx
function Card({ r, lost, biz, onDone, drag, health }) {
```

```jsx
      <span
        className="absolute bottom-2 left-0 top-2 w-[3px] rounded-sm"
        style={{ background: lost ? 'var(--dim)' : health?.stuck ? 'var(--neg-ink)' : accent }}
      />
```

```jsx
      <div className="mt-0.5 truncate text-[11.5px] text-muted">
        {sub || 'no contact info'}
      </div>
      <HealthLine h={health} />
      <StuckLine h={health} />
```

Change `Column` to compute health and the header summary. `rules` / `now` are absent on the demo board, so health is skipped there:

```jsx
function Column({ col, biz, onDone, drag, rules, now }) {
  const isOver = drag?.over === col.stage
  const summary = rules ? columnSummary(col.cards, rules, now) : ''
```

```jsx
        <span className="num text-[11px] text-muted" data-col-count>
          {col.cards.length}
          {summary ? ` · ${summary}` : ''}
        </span>
```

```jsx
        {col.cards.map((r) => (
          <Card
            key={r.id}
            r={r}
            lost={col.isLost}
            biz={biz}
            onDone={onDone}
            drag={drag}
            health={rules ? cardHealth(r, rules, now) : null}
          />
        ))}
```

Change `Board` to pass them through:

```jsx
function Board({ columns, biz, onDone, drag, rules, now }) {
  return (
    <div className="mt-5 flex gap-3.5 overflow-x-auto pb-2">
      {columns.map((col) => (
        <Column key={col.stage} col={col} biz={biz} onDone={onDone} drag={drag} rules={rules} now={now} />
      ))}
    </div>
  )
}
```

Add the five health columns to both `PIPELINE` configs:

```js
const HEALTH_COLUMNS = ', stage_since, crm_created_at, last_outbound_call_at, open_task_count, oldest_open_due_at'
```

(place it directly above `const PIPELINE = {`)

```js
    columns:
      'id, business_id, name, email, phone, last_touch_at, stage, crm_profile_url, ' +
      'docs_tracked, docs_outstanding, docs_outstanding_count, docs_oldest_requested_at, ' +
      'doc_notes, last_note_snippet, last_note_at' + HEALTH_COLUMNS,
```

```js
    columns: 'id, name, company, email, phone, last_touch_at, stage, crm_profile_url' + HEALTH_COLUMNS,
```

In `Pipeline()`, read the shared rules (the same ones Up Next uses) right after `const cfg = ...`:

```js
  // Same rules as Up Next, so a red card and an Up Next "Stuck" row agree.
  const { rules } = usePriorityQueue()
```

Replace the `const columns = ...` line, and pass `rules` / `now` to `Board`:

```js
  // The draggable Bayway board shows every column, so empty stages take drops.
  const now = Date.now()
  const columns = buildColumns(withPendingMoves(rows, pending), cfg.flowOrder, {
    showAllFlow: canDrag,
    sortCards: (cards) => sortByHealth(cards, rules, now),
  })
```

```jsx
        <Board columns={columns} biz={biz} onDone={() => load({ quiet: true })} drag={drag} rules={rules} now={now} />
```

- [ ] **Step 4: Run the page tests and the full suite**

Run: `npx vitest run src/pages/Pipeline.render.test.jsx`
Expected: PASS, including the existing drag tests.

Run: `npm test`
Expected: all test files PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Pipeline.jsx src/pages/Pipeline.render.test.jsx
git commit -m "feat: next-step dot, stuck marker and column summary on pipeline cards

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Verify in the browser and open PR 1

- [ ] **Step 1: Start the dev server and open both boards**

Use `preview_start` with `{ name: "atkinson-sales-os" }` (port 5173), signed in. Open `/bayway/pipeline` and `/mpg/pipeline`.

- [ ] **Step 2: Check the board**

- `read_console_messages` with `onlyErrors: true`: expect none.
- `read_page`: every Bayway card except Nurture / Credit Repair shows one health line.
- Column headers read like "21 · 4 overdue · 2 stuck".
- Spot-check one overdue lead against Up Next, which should list it under "Follow-up overdue".
- Spot-check one stuck lead, which should appear under "Stuck in stage" unless a higher bucket takes it.
- Screenshot the Bayway board.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/card-health
gh pr create --title "Card health on pipeline cards" --body "$(cat <<'EOF'
Tier 1, slice 1 (spec: docs/superpowers/specs/2026-10-19-tier1-pipeline-flow-design.md, section 1).

- Every card shows its next step: overdue (red), due today (amber), scheduled (green, with date), or none (grey). Parked / lost cards show nothing.
- Cards past their stage's limit get a red accent bar and "9d in Attempted". Limits: New Lead 2, Attempted 5, Contacted/Working 7, App/Estimate Sent 7, App Received 14; MPG and unknown stages use 14.
- Column headers sum it up ("21 · 4 overdue · 2 stuck"). Cards sort worst first.
- Up Next's "Stuck in stage" uses the same per-stage limits.
- Migration 0034 adds stage_since, crm_created_at, last_outbound_call_at, open_task_count and oldest_open_due_at to v_active_pipeline and v_mpg_contacts (already applied; dry-run JSON below).

Dry run: <paste JSON from Task 3 Step 3>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Then call `mcp__ccd_pr__get_status` and bind the PR if it isn't reported. Stop here for Chandler to review and merge before Part B.

---

# Part B: Speed-to-lead (PR 2)

### Task 7: Branch from the merged main

- [ ] **Step 1: Create the branch**

```bash
cd C:/Users/Chandler/.claude/projects/atkinson-sales-os-phase1
git checkout main && git pull --ff-only
git checkout -b feat/speed-to-lead
```

Expected: `main` contains PR 1's merge commit (`git log --oneline -1` shows it).

---

### Task 8: Speed-to-lead rule in `cardHealth.js`

**Files:**
- Modify: `src/lib/priorityQueue.js` (`DEFAULT_RULES`)
- Modify: `src/lib/cardHealth.js`
- Test: `src/lib/cardHealth.test.js`

- [ ] **Step 1: Write the failing tests**

In `src/lib/cardHealth.test.js`, extend the import:

```js
import { nextStep, stuckFor, cardHealth, healthRank, sortByHealth, columnSummary, speedToLead, formatElapsed } from './cardHealth'
```

Append:

```js
describe('speedToLead', () => {
  const fresh = (o = {}) => row({ stage: 'New Lead', crm_created_at: daysAgo(0, '08:56:00'), last_outbound_call_at: null, ...o })

  it('runs on a new, uncalled lead and turns late at speed_to_lead_minutes', () => {
    expect(speedToLead(fresh(), rules, NOW)).toEqual({ minutes: 4, late: false, text: '4m · not called' })
    expect(speedToLead(fresh({ crm_created_at: daysAgo(0, '08:55:00') }), rules, NOW)).toEqual({ minutes: 5, late: true, text: '5m · not called' })
  })
  it('also runs on MPG Not Contacted / Open', () => {
    expect(speedToLead(fresh({ stage: 'Not Contacted' }), rules, NOW)).not.toBeNull()
    expect(speedToLead(fresh({ stage: 'Open' }), rules, NOW)).not.toBeNull()
  })
  it('stops once called, outside the first column, or after new_lead_days', () => {
    expect(speedToLead(fresh({ last_outbound_call_at: daysAgo(0, '08:58:00') }), rules, NOW)).toBeNull()
    expect(speedToLead(fresh({ stage: 'Attempted' }), rules, NOW)).toBeNull()
    expect(speedToLead(fresh({ crm_created_at: daysAgo(8) }), rules, NOW)).toBeNull()
    expect(speedToLead(fresh({ crm_created_at: null }), rules, NOW)).toBeNull()
  })
})

describe('formatElapsed', () => {
  it('minutes, hours and minutes, then days', () => {
    expect(formatElapsed(0)).toBe('0m')
    expect(formatElapsed(59)).toBe('59m')
    expect(formatElapsed(60)).toBe('1h')
    expect(formatElapsed(72)).toBe('1h 12m')
    expect(formatElapsed(47 * 60 + 59)).toBe('47h 59m')
    expect(formatElapsed(48 * 60)).toBe('2d')
  })
})

describe('speed in health and ordering', () => {
  it('cardHealth carries speed, and new uncalled leads sort first, late ones before fresh ones', () => {
    const late = row({ id: 'late', stage: 'New Lead', crm_created_at: daysAgo(0, '08:00:00') })
    const freshLead = row({ id: 'fresh', stage: 'New Lead', crm_created_at: daysAgo(0, '08:58:00') })
    const overdue = row({ id: 'overdue', stage: 'New Lead', crm_created_at: daysAgo(30), open_task_count: 1, oldest_open_due_at: daysAgo(2) })
    expect(cardHealth(late, rules, NOW).speed).toMatchObject({ late: true })
    expect(sortByHealth([overdue, freshLead, late], rules, NOW).map((r) => r.id)).toEqual(['late', 'fresh', 'overdue'])
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/lib/cardHealth.test.js`
Expected: FAIL with `speedToLead is not a function`.

- [ ] **Step 3: Implement**

In `src/lib/priorityQueue.js`, add to `DEFAULT_RULES` right after the `stuck_days_by_stage` block:

```js
  // Minutes before a new, uncalled lead's timer turns red (board + tab title).
  speed_to_lead_minutes: 5,
```

In `src/lib/cardHealth.js`, add below `stuckFor`:

```js
// The first column of each book, where a new lead's next step is the first call.
export const SPEED_STAGES = new Set(['New Lead', 'Not Contacted', 'Open'])

export function formatElapsed(minutes) {
  if (minutes < 60) return `${minutes}m`
  if (minutes < 48 * 60) {
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    return m ? `${h}h ${m}m` : `${h}h`
  }
  return `${Math.floor(minutes / 1440)}d`
}

// Speed-to-lead: wall-clock time since the lead arrived, until the first
// outbound call. Same window as Up Next's "New, not yet called" bucket.
// { minutes, late, text } or null.
export function speedToLead(row, rules, now = Date.now()) {
  if (!SPEED_STAGES.has(row.stage) || row.last_outbound_call_at || !row.crm_created_at) return null
  const created = new Date(row.crm_created_at).getTime()
  if (Number.isNaN(created)) return null
  if (calendarDaysSince(row.crm_created_at, now) > rules.new_lead_days) return null
  const minutes = Math.max(0, Math.floor((now - created) / 60000))
  return { minutes, late: minutes >= rules.speed_to_lead_minutes, text: `${formatElapsed(minutes)} · not called` }
}
```

Replace `cardHealth` and `healthRank` with:

```js
export function cardHealth(row, rules, now = Date.now()) {
  return { next: nextStep(row, now), stuck: stuckFor(row, rules, now), speed: speedToLead(row, rules, now) }
}

// Smaller sorts first: uncalled new leads (late, then fresh), then overdue,
// stuck, no next step, due today, scheduled.
const NEXT_RANK = { overdue: 0, none: 2, today: 3, scheduled: 4, parked: 5 }
export function healthRank(h) {
  if (h.speed) return h.speed.late ? -2 : -1
  if (h.next.state === 'overdue') return 0
  if (h.stuck) return 1
  return NEXT_RANK[h.next.state]
}
```

Task 2's tests still pass: their rows have no `crm_created_at`, so `speed` is null.

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `npx vitest run src/lib/cardHealth.test.js src/lib/priorityQueue.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cardHealth.js src/lib/cardHealth.test.js src/lib/priorityQueue.js
git commit -m "feat: speed-to-lead rule for new, uncalled leads

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Up Next new-lead text in minutes

**Files:**
- Modify: `src/lib/priorityQueue.js` (`reasonText`, `new_lead` case)
- Test: `src/lib/priorityQueue.test.js`

- [ ] **Step 1: Write the failing test**

In `src/lib/priorityQueue.test.js`, inside `describe('reasonText / lastCallLabel', ...)`, add a new `it`:

```js
  it('counts a new lead in minutes for its first hour', () => {
    expect(reasonText({ ...base({ crm_created_at: daysAgo(0, '08:48:00') }), bucket: 'new_lead' }, NOW)).toBe('New lead · 12m, not called')
    expect(reasonText({ ...base({ crm_created_at: daysAgo(0, '07:30:00') }), bucket: 'new_lead' }, NOW)).toBe('New lead · 2 hours, not called')
  })
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/lib/priorityQueue.test.js`
Expected: FAIL. It got `New lead · 0 hours, not called`.

- [ ] **Step 3: Implement**

Replace the `new_lead` case in `reasonText`:

```js
    case 'new_lead': {
      const mins = Math.max(0, Math.floor((now - ms(row.crm_created_at)) / 60000))
      if (mins < 60) return `New lead · ${mins}m, not called`
      const hrs = Math.max(0, Math.round((now - ms(row.crm_created_at)) / 3600000))
      return hrs < 48 ? `New lead · ${plural(hrs, 'hour')}, not called` : `New lead · ${plural(daysSince(row.crm_created_at, now), 'day')}, not called`
    }
```

(08:48 → 09:00 is 12m; 07:30 → 09:00 is 90 minutes, which rounds to 2 hours, as before.)

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `npx vitest run src/lib/priorityQueue.test.js`
Expected: PASS, including the existing `26 hours` and `4 days` cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/priorityQueue.js src/lib/priorityQueue.test.js
git commit -m "feat: Up Next shows new-lead age in minutes for the first hour

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Live timer on the board (`useNow` + card)

**Files:**
- Create: `src/lib/useNow.js`
- Modify: `src/pages/Pipeline.jsx`
- Test: `src/pages/Pipeline.render.test.jsx`

- [ ] **Step 1: Write the failing render test**

Append to `src/pages/Pipeline.render.test.jsx`:

```js
describe('Pipeline speed-to-lead', () => {
  it('times a new, uncalled lead and marks it late after 5 minutes', async () => {
    DATA.rows = [
      { ...card('n', 'Nia New', 'New Lead'), crm_created_at: new Date(Date.now() - 10 * 60_000).toISOString(), last_outbound_call_at: null },
      { ...card('c', 'Cal Called', 'New Lead'), crm_created_at: new Date(Date.now() - 10 * 60_000).toISOString(), last_outbound_call_at: new Date().toISOString() },
    ]
    await mount()
    const timer = cardEl('n').querySelector('[data-health="speed"]')
    expect(timer.textContent).toContain('10m · not called')
    expect(timer.getAttribute('data-late')).toBe('true')
    expect(cardEl('c').querySelector('[data-health="speed"]')).toBeNull()
    expect(cardEl('c').querySelector('[data-health="none"]')).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/pages/Pipeline.render.test.jsx`
Expected: the new test FAILS. `timer` is null, because `HealthLine` doesn't render speed yet.

- [ ] **Step 3: Implement**

Create `src/lib/useNow.js`:

```js
// One clock per page for live labels (speed-to-lead timers). Re-renders the
// caller every `ms`; pauses while the tab is hidden and catches up on return.
import { useEffect, useState } from 'react'

export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const tick = () => document.visibilityState === 'visible' && setNow(Date.now())
    const id = setInterval(tick, ms)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [ms])
  return now
}
```

In `src/pages/Pipeline.jsx`:

Add the import:

```js
import { useNow } from '../lib/useNow'
```

Replace `HealthLine` so a running timer takes the dot's place:

```jsx
function HealthLine({ h }) {
  if (!h) return null
  if (h.speed) {
    return (
      <div
        className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold"
        style={{ color: h.speed.late ? 'var(--neg-ink)' : 'var(--muted)' }}
        data-health="speed"
        data-late={h.speed.late ? 'true' : 'false'}
      >
        <span aria-hidden="true">⏱</span>
        {h.speed.text}
      </div>
    )
  }
  if (h.next.state === 'parked') return null
  const overdue = h.next.state === 'overdue'
  return (
    <div className="mt-1 flex items-center gap-1.5 text-[11px]" data-health={h.next.state}>
      <span aria-hidden="true" className="h-[7px] w-[7px] flex-none rounded-full" style={{ background: DOT[h.next.state] }} />
      <span className={overdue ? 'font-semibold' : 'text-muted'} style={overdue ? { color: 'var(--neg-ink)' } : undefined}>
        {h.next.text}
      </span>
    </div>
  )
}
```

In `Pipeline()`, take `now` from the ticker instead of `Date.now()`. Declare it at the top with the other hooks, after `usePriorityQueue`, never below an early return:

```js
  const now = useNow(30_000)
```

Delete the `const now = Date.now()` line from Task 5, so the `columns` computation uses the hook's `now`.

- [ ] **Step 4: Run the page tests and the full suite**

Run: `npx vitest run src/pages/Pipeline.render.test.jsx`
Expected: PASS.

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/useNow.js src/pages/Pipeline.jsx src/pages/Pipeline.render.test.jsx
git commit -m "feat: live speed-to-lead timer on new pipeline cards

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: 60-second refresh and the tab-title alert

**Files:**
- Modify: `src/lib/cardHealth.js` (`lateLeadCount`, `titleFor`)
- Test: `src/lib/cardHealth.test.js`
- Modify: `src/lib/usePriorityQueue.js` (visible-tab refresh)
- Modify: `src/pages/Pipeline.jsx` (visible-tab board reload)
- Modify: `src/components/Layout.jsx` (title)

- [ ] **Step 1: Write the failing tests**

In `src/lib/cardHealth.test.js`, extend the import with `lateLeadCount, titleFor`:

```js
import { nextStep, stuckFor, cardHealth, healthRank, sortByHealth, columnSummary, speedToLead, formatElapsed, lateLeadCount, titleFor } from './cardHealth'
```

Then append:

```js
describe('tab title', () => {
  it('counts late new leads across both books', () => {
    const rows = [
      row({ stage: 'New Lead', crm_created_at: daysAgo(0, '08:00:00') }),
      row({ stage: 'Open', crm_created_at: daysAgo(0, '08:30:00') }),
      row({ stage: 'New Lead', crm_created_at: daysAgo(0, '08:58:00') }),
      row({ stage: 'New Lead', crm_created_at: daysAgo(0, '08:00:00'), last_outbound_call_at: daysAgo(0, '08:10:00') }),
    ]
    expect(lateLeadCount(rows, rules, NOW)).toBe(2)
  })
  it('prefixes the title only when someone is waiting', () => {
    expect(titleFor(0)).toBe('Atkinson Sales OS')
    expect(titleFor(1)).toBe('(1) New lead waiting · Atkinson Sales OS')
    expect(titleFor(3)).toBe('(3) New leads waiting · Atkinson Sales OS')
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/lib/cardHealth.test.js`
Expected: FAIL with `lateLeadCount is not a function`.

- [ ] **Step 3: Implement the helpers**

Append to `src/lib/cardHealth.js`:

```js
// How many new, uncalled leads are past speed_to_lead_minutes (any book).
export function lateLeadCount(rows, rules, now = Date.now()) {
  return (rows || []).filter((r) => speedToLead(r, rules, now)?.late).length
}

export const APP_TITLE = 'Atkinson Sales OS'
export function titleFor(late) {
  if (!late) return APP_TITLE
  return `(${late}) New lead${late === 1 ? '' : 's'} waiting · ${APP_TITLE}`
}
```

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `npx vitest run src/lib/cardHealth.test.js`
Expected: PASS.

- [ ] **Step 5: Wire the refreshes and the title**

In `src/lib/usePriorityQueue.js`, refresh every 60s while any component is subscribed and the tab is visible. Replace the hook's `useEffect`:

```js
  useEffect(() => {
    listeners.add(setSnap)
    if (!store.at && !inflight) refreshPriorityQueue()
    else setSnap(store)
    // Keep new leads and callbacks current while the app is on screen.
    const id = setInterval(() => {
      if (document.visibilityState === 'visible' && Date.now() - store.at >= STALE_MS) refreshPriorityQueue()
    }, STALE_MS)
    return () => {
      clearInterval(id)
      listeners.delete(setSnap)
    }
  }, [])
```

(Several subscribers each start an interval, but the `store.at` staleness check and the shared `inflight` promise mean at most one fetch a minute.)

In `src/pages/Pipeline.jsx`, after the existing `useEffect(() => { load() }, [load])`, add:

```js
  // New leads and finished calls show up without a reload while the board is open.
  useEffect(() => {
    const id = setInterval(() => document.visibilityState === 'visible' && load({ quiet: true }), 60_000)
    return () => clearInterval(id)
  }, [load])
```

In `src/components/Layout.jsx`, add the imports:

```js
import { useEffect, useState } from 'react'
import { usePriorityQueue } from '../lib/usePriorityQueue'
import { useNow } from '../lib/useNow'
import { lateLeadCount, titleFor } from '../lib/cardHealth'
```

(The first line replaces the existing `import { useState } from 'react'`.)

Inside `Layout()`, after `const [menuOpen, setMenuOpen] = useState(false)`, add:

```js
  // "(1) New lead waiting · Atkinson Sales OS" while a new lead's timer is red.
  // queue rows are v_lead_signals rows: they carry stage, crm_created_at and
  // last_outbound_call_at for both books.
  const { queue, rules } = usePriorityQueue('all')
  const now = useNow(30_000)
  const late = lateLeadCount(queue, rules, now)
  useEffect(() => {
    document.title = titleFor(late)
  }, [late])
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: all PASS. If a render test that mounts `Layout` hangs on intervals, it needs `vi.useFakeTimers()`; no current test mounts `Layout`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/cardHealth.js src/lib/cardHealth.test.js src/lib/usePriorityQueue.js src/pages/Pipeline.jsx src/components/Layout.jsx
git commit -m "feat: 60s refresh while visible and a tab-title alert for waiting leads

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Verify in the browser and open PR 2

- [ ] **Step 1: Check the timer and title**

With `preview_start` `{ name: "atkinson-sales-os" }`, open `/bayway/pipeline`.
- Any New Lead card with no call logged shows "⏱ 12m · not called" (red at 5m or more). Cards with a call show the dot instead.
- Wait about 30s with `computer` `wait`, then `read_page`: the minute count has moved on.
- Check `document.title` with `javascript_tool` (`document.title`). It has the "(n) New lead waiting" prefix exactly when a red timer exists.
- `read_console_messages` with `onlyErrors: true`: expect none.
- Screenshot the New Lead column.

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin feat/speed-to-lead
gh pr create --title "Speed-to-lead timer" --body "$(cat <<'EOF'
Tier 1, slice 2 (spec: docs/superpowers/specs/2026-10-19-tier1-pipeline-flow-design.md, section 2).

- New, uncalled leads (Bayway New Lead, MPG Not Contacted / Open, created in the last 7 days) show a live "⏱ 12m · not called" in place of the next-step dot; red at 5 minutes. They sort to the top of their column.
- Up Next says "New lead · 12m, not called" for a lead's first hour.
- The tab title reads "(1) New lead waiting · Atkinson Sales OS" while any timer is red.
- Pipeline and Up Next refresh every 60s while the tab is visible.

Known limit: FUB/Zoho data still arrives on the 15-minute sync, so a lead can appear already a few minutes old, and a call made in the FUB app can take up to 15 minutes to stop its timer. Slice 9 (FUB webhooks) fixes the Bayway side.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Then call `mcp__ccd_pr__get_status` and bind the PR if it isn't reported.

---

## Not in this plan (later plans, one per slice)

Slices 3–9 from the spec each get their own plan when they're next:
3. Required next step.
4. Drop zones for Nurture.
5. Drop zones for Lost.
6. Search palette.
7. Quick add.
8. New lead create.
9. Webhook freshness.
