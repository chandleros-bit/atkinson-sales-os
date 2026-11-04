# Assistant Login and Bayway Briefing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Shelby (Bayway assistant) her own Bayway-only OS login, and email her a 7:30 AM Bayway files briefing.

**Architecture:** Part A adds a pure `buildAssistantBriefing` builder and renderer next to Chandler's, bundles them into the existing `daily-briefing` edge function, and sends both briefings per run with separate claims and `sync_log` sources. Part B adds `user_roles`, three SECURITY DEFINER helpers (`app_role`, `is_owner`, `can_read_book`), rewrites RLS so the assistant reads only Bayway rows and no money tables, adds role checks to `crm-action`, and gates the client (routes, nav, Quick Actions, drag, dialer) on the signed-in user's role.

**Tech Stack:** React 18 + Vite, Vitest (jsdom render tests), Supabase Postgres RLS, Deno edge functions, esbuild bundle (`npm run build:briefing`), denomailer Gmail SMTP.

**Spec:** `docs/superpowers/specs/2026-11-03-temperature-forecast-briefings-design.md`, section 3 ("Assistant's briefing", "The assistant's login") and Build order step 3.

**Branch:** `feat/assistant-login` (off `main`). Worktree: `C:\Users\Chandler\.claude\projects\atkinson-sales-os-phase1\.claude\worktrees\sync-health-poll`.

**Rules for every task:**
- Commit as the repo's configured git user. No `-c user.name` / `-c user.email` overrides.
- Never read `.env` files.
- Nothing touches production (migrations, function deploys, secrets, settings rows) until the Rollout section, and only after Chandler says yes.
- Run `npx vitest run <file>` for the task's tests; run the full `npm test` before each commit. Two pre-existing unhandled errors from `useSyncHealth` mocks and one Pipeline DST test failure are known; anything else new is yours.

---

## Decisions this plan makes (deviations from the spec, on purpose)

1. **No `v_loans_assistant` view.** Nothing in the app the assistant can open reads `loans` (Person sheet, Pipeline and Workbench don't), and her briefing reads loans with the service role. A SECURITY DEFINER view with no consumer is only attack surface. `loans` simply becomes owner-only. Add the view when a page needs it.
2. **`metrics_daily` and `calendar_events` are owner-only**, even though `metrics_daily` has `business_id`: it holds gross commission and residuals, and the calendar is Chandler's.
3. **`user_roles.user_id` has no foreign key to `auth.users`**, so the RLS test can insert a throwaway assistant inside a rolled-back transaction without creating an auth user.
4. **The assistant's briefing has its own switch**, `briefings.assistant_enabled` (default `false`), so Chandler test-sends it before Shelby gets one.
5. **Assistant lists show the top 15** plus "+N more" (Chandler's show 5): they are her working lists.
6. **Settings the assistant can read:** `priority_rules`, `writeback_enabled`, `create_lead_enabled` (needed by Up Next and Quick Actions). Everything else is owner-only.

## File map

| File | Change | Responsibility |
|---|---|---|
| `src/lib/briefingTime.js` | modify | add `addBusinessDays(dateKey, n)` |
| `src/lib/assistantBriefing.js` | create | pure `buildAssistantBriefing(data, now)` |
| `src/lib/assistantBriefing.test.js` | create | builder tests |
| `src/lib/briefingEmail.js` | modify | add `renderAssistantBriefing(m, { appUrl })` |
| `src/lib/briefingEmail.test.js` | modify | renderer tests |
| `src/lib/briefingEntry.js` | modify | export the two new functions |
| `supabase/functions/daily-briefing/briefing.bundle.js` | regenerate | `npm run build:briefing` |
| `supabase/functions/daily-briefing/index.ts` | rewrite | send owner + assistant, per-recipient claim and log |
| `src/pages/SyncStatus.jsx` | modify | labels for `briefing-assistant` sources |
| `supabase/migrations/0056_assistant_role.sql` | create | `user_roles`, helpers, RLS rewrite, `v_assistant_writes`, `assistant_enabled` |
| `supabase/tests/assistant_rls.sql` | create | RLS checks as an assistant and as the owner, rolled back |
| `supabase/functions/crm-action/plan.ts` | modify | `ASSISTANT_ACTIONS`, `ASSISTANT_READS` |
| `supabase/functions/crm-action/run.ts` | modify | role gate |
| `supabase/functions/crm-action/index.ts` | modify | look up the caller's role |
| `supabase/functions/crm-action/run.test.js` | modify | assistant tests |
| `src/lib/roles.js` + `roles.test.js` | create | pure role rules: paths, quick actions |
| `src/context/AuthContext.jsx` | modify | load `role`, `books`, `name` |
| `src/context/BusinessContext.jsx` | modify | assistant is pinned to `bay` |
| `src/App.jsx` | modify | role-aware guard and "No access" screen |
| `src/components/Sidebar.jsx` | modify | links by role, name and role label |
| `src/components/Layout.jsx` | modify | hide book switch for assistant, bottom nav by role |
| `src/components/NewMenu.jsx`, `QuickAddMenu.jsx` | modify | no Log call / New lead for assistant |
| `src/components/QuickActions.jsx` | modify | assistant: note, follow-up, complete only |
| `src/components/WorkLane.jsx` | modify | no stage-move outcomes for assistant |
| `src/components/PageHeader.jsx` | modify | no sync check for assistant |
| `src/pages/Pipeline.jsx` | modify | no drag, no "Pays first" for assistant |
| `src/pages/Workbench.jsx` | modify | Work lane only for assistant |
| `src/components/PersonSheet.jsx` | modify | read-only temperature, "by assistant" labels |
| `src/lib/contactNotes.js` | modify | mark notes the assistant wrote |
| `src/components/Roles.render.test.jsx` | create | render tests for the gating |
| `docs/assistant-login-setup.md` | create | invite Shelby, add her role row |

---

# Part A: Shelby's briefing

### Task 1: `addBusinessDays`

**Files:**
- Modify: `src/lib/briefingTime.js` (append after `previousBusinessDayRangeUtc`)
- Test: `src/lib/briefingTime.test.js`

- [ ] **Step 1: Write the failing test** (append to `src/lib/briefingTime.test.js`; add `addBusinessDays` to its import from `./briefingTime`)

```js
describe('addBusinessDays', () => {
  it('skips weekends (TRID: Loan Estimate within 3 business days)', () => {
    expect(addBusinessDays('2026-11-02', 3)).toBe('2026-11-05') // Mon -> Thu
    expect(addBusinessDays('2026-11-06', 3)).toBe('2026-11-11') // Fri -> Wed
    expect(addBusinessDays('2026-11-07', 3)).toBe('2026-11-11') // Sat -> Wed
    expect(addBusinessDays('2026-11-08', 1)).toBe('2026-11-09') // Sun -> Mon
  })
  it('returns the same day for 0 and null for a bad key', () => {
    expect(addBusinessDays('2026-11-04', 0)).toBe('2026-11-04')
    expect(addBusinessDays(null, 3)).toBe(null)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/lib/briefingTime.test.js`
Expected: FAIL, `addBusinessDays is not a function` (or not exported).

- [ ] **Step 3: Implement** (append to `src/lib/briefingTime.js`)

```js
// 'YYYY-MM-DD' plus n business days (Mon-Fri; federal holidays not counted).
// Used for the TRID Loan Estimate deadline: 3 business days from application.
export function addBusinessDays(dateKey, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''))
  if (!m) return null
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  let left = n
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1)
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) left--
  }
  return d.toISOString().slice(0, 10)
}
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `npx vitest run src/lib/briefingTime.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/briefingTime.js src/lib/briefingTime.test.js
git commit -m "feat: addBusinessDays for the TRID disclosure deadline"
```

---

### Task 2: `buildAssistantBriefing`

**Files:**
- Create: `src/lib/assistantBriefing.js`
- Test: `src/lib/assistantBriefing.test.js`

**Data contract** (loaded by the edge function with the service role, Task 5):
- `loans`: Bayway loans: `{ id, contact_id, borrower_name, stage_group, firm_closing_on, title_company, buyer_agent_name, buyer_agent_phone, seller_agent_name, seller_agent_phone, scenario_auto, scenario_override }`
- `pipeline`: `v_active_pipeline` Bayway rows: `{ id, name, stage, stage_since, docs_tracked, docs_outstanding, docs_outstanding_count, docs_oldest_requested_at }`
- `workItems`: the assistant's own open `work_items`: `{ id, kind, title, status, check_back_on, due_on, contact_id, contact_name }`

**Model** (what the renderer reads):
```
{
  dateLabel,
  closing:     { count, top: [{ name, date, title, docs: [..], buyerAgent: {name, phone}|null, sellerAgent: {name, phone}|null }] },
  disclosures: { count, top: [{ name, dueBy, due }] },          // due: today >= dueBy
  missingDocs: { count, top: [{ name, docs: [..], days, chase }] }, // oldest request first; chase: days >= 7
  newApps:     { count, top: [{ name }] },
  waiting:     { count, top: [{ name, detail }] },
  chaseCount, closingCount, quiet,
}
```

- [ ] **Step 1: Write the failing tests** (`src/lib/assistantBriefing.test.js`)

```js
import { describe, it, expect } from 'vitest'
import { buildAssistantBriefing, CHASE_DAYS } from './assistantBriefing'

// Wed Nov 4 2026, 7:30 AM Chicago (CST, UTC-6).
const NOW = Date.parse('2026-11-04T13:30:00Z')
const iso = (s) => new Date(s).toISOString()

const pipe = (o) => ({ id: o.id, name: o.name, stage: 'Contacted/Working', stage_since: null, docs_tracked: false, docs_outstanding: [], docs_outstanding_count: 0, docs_oldest_requested_at: null, ...o })

describe('buildAssistantBriefing', () => {
  it('lists open loans closing in the next 7 days with docs, title and agents', () => {
    const m = buildAssistantBriefing({
      loans: [
        { id: 'l1', contact_id: 'c1', borrower_name: 'Pat Lee', stage_group: 'closing', firm_closing_on: '2026-11-06', title_company: 'Lone Star Title', buyer_agent_name: 'Jo Ray', buyer_agent_phone: '7135550100', seller_agent_name: null, seller_agent_phone: null },
        { id: 'l2', contact_id: 'c2', borrower_name: 'Funded Fay', stage_group: 'funded', firm_closing_on: '2026-11-05' },
        { id: 'l3', contact_id: 'c3', borrower_name: 'Late Lou', stage_group: 'closing', firm_closing_on: '2026-11-12' },
        { id: 'l4', contact_id: 'c4', borrower_name: 'Scenario Sam', stage_group: 'closing', firm_closing_on: '2026-11-05', scenario_override: true },
      ],
      pipeline: [pipe({ id: 'c1', name: 'Pat Lee', docs_tracked: true, docs_outstanding: ['W2'], docs_outstanding_count: 1, docs_oldest_requested_at: iso('2026-11-01T15:00:00Z') })],
      workItems: [],
    }, NOW)
    expect(m.closing.count).toBe(1)
    expect(m.closing.top[0]).toEqual({ name: 'Pat Lee', date: '2026-11-06', title: 'Lone Star Title', docs: ['W2'], buyerAgent: { name: 'Jo Ray', phone: '7135550100' }, sellerAgent: null })
    expect(m.closingCount).toBe(1)
  })

  it('puts Application Received leads under Disclosures due with a 3-business-day deadline', () => {
    const m = buildAssistantBriefing({
      loans: [],
      pipeline: [
        pipe({ id: 'a', name: 'Due Dan', stage: 'Application Received', stage_since: iso('2026-10-30T16:00:00Z') }), // Fri -> Wed Nov 4: due today
        pipe({ id: 'b', name: 'Fresh Fran', stage: 'Application Received', stage_since: iso('2026-11-03T16:00:00Z') }), // Tue -> Fri Nov 6
        pipe({ id: 'c', name: 'Disclosed Di', stage: 'Disclosed', stage_since: iso('2026-10-20T16:00:00Z') }),
      ],
      workItems: [],
    }, NOW)
    expect(m.disclosures.top).toEqual([
      { name: 'Due Dan', dueBy: '2026-11-04', due: true },
      { name: 'Fresh Fran', dueBy: '2026-11-06', due: false },
    ])
  })

  it('orders missing docs oldest first and marks 7+ days as chase today', () => {
    const m = buildAssistantBriefing({
      loans: [],
      pipeline: [
        pipe({ id: 'a', name: 'New Ned', docs_tracked: true, docs_outstanding: ['Paystub'], docs_outstanding_count: 1, docs_oldest_requested_at: iso('2026-11-02T13:00:00Z') }),
        pipe({ id: 'b', name: 'Old Olga', docs_tracked: true, docs_outstanding: ['W2', 'Bank'], docs_outstanding_count: 2, docs_oldest_requested_at: iso('2026-10-25T13:00:00Z') }),
        pipe({ id: 'c', name: 'Clear Cy', docs_tracked: true, docs_outstanding: [], docs_outstanding_count: 0 }),
      ],
      workItems: [],
    }, NOW)
    expect(m.missingDocs.count).toBe(2)
    expect(m.missingDocs.top[0]).toEqual({ name: 'Old Olga', docs: ['W2', 'Bank'], days: 10, chase: true })
    expect(m.missingDocs.top[1].chase).toBe(false)
    expect(m.chaseCount).toBe(1)
    expect(CHASE_DAYS).toBe(7)
  })

  it('lists applications received on the previous business day', () => {
    const m = buildAssistantBriefing({
      loans: [],
      pipeline: [
        pipe({ id: 'a', name: 'Yesterday Yu', stage: 'Application Received', stage_since: iso('2026-11-03T20:00:00Z') }),
        pipe({ id: 'b', name: 'Today Tia', stage: 'Application Received', stage_since: iso('2026-11-04T13:00:00Z') }),
      ],
      workItems: [],
    }, NOW)
    expect(m.newApps.top).toEqual([{ name: 'Yesterday Yu' }])
  })

  it('waits on borrowers: Application/Estimate Sent 3+ days, and due check-backs', () => {
    const m = buildAssistantBriefing({
      loans: [],
      pipeline: [
        pipe({ id: 'a', name: 'Slow Sue', stage: 'Application/Estimate Sent', stage_since: iso('2026-10-30T13:00:00Z') }),
        pipe({ id: 'b', name: 'Quick Quin', stage: 'Application/Estimate Sent', stage_since: iso('2026-11-03T13:00:00Z') }),
      ],
      workItems: [
        { id: 'w1', kind: 'custom', title: 'Call title about payoff', status: 'waiting', check_back_on: '2026-11-04', due_on: null, contact_name: 'Pat Lee' },
        { id: 'w2', kind: 'custom', title: 'Later', status: 'open', check_back_on: '2026-11-09', due_on: null, contact_name: null },
      ],
    }, NOW)
    expect(m.waiting.top).toEqual([
      { name: 'Slow Sue', detail: 'Application/Estimate Sent 5 days ago, no movement' },
      { name: 'Pat Lee', detail: 'Check back: Call title about payoff' },
    ])
  })

  it('is quiet when every list is empty', () => {
    const m = buildAssistantBriefing({ loans: [], pipeline: [], workItems: [] }, NOW)
    expect(m.quiet).toBe(true)
    expect(m.dateLabel).toBe('Wed Nov 4')
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/lib/assistantBriefing.test.js`
Expected: FAIL, cannot resolve `./assistantBriefing`.

- [ ] **Step 3: Implement** (`src/lib/assistantBriefing.js`)

```js
// Shelby's Bayway files briefing (spec 2026-11-03, section 3, "Assistant's
// briefing"). Pure, no I/O; the daily-briefing edge function loads `data` with
// the service role and renders the result. No money: no comp, no forecast, no
// MPG, nothing sensitive from the loan file (income, SSN, credit).
import { isOpen, isScenario } from './loans'
import { daysSince } from './overview'
import { chicagoDateKey, previousBusinessDateKey, longDateLabel, addBusinessDays } from './briefingTime'

const TOP = 15
export const CHASE_DAYS = 7
const WAIT_DAYS = 3
const APP_RECEIVED = 'Application Received'
const APP_SENT = 'Application/Estimate Sent'

const list = (rows, toItem) => ({ count: rows.length, top: rows.slice(0, TOP).map(toItem) })
const agent = (name, phone) => (name ? { name, phone: phone || null } : null)
const dayOf = (ts) => (ts ? chicagoDateKey(new Date(ts).getTime()) : null)

export function buildAssistantBriefing(data, now = Date.now()) {
  const pipeline = data.pipeline || []
  const byId = new Map(pipeline.map((r) => [r.id, r]))
  const today = chicagoDateKey(now)
  const weekOut = chicagoDateKey(now, 6)

  // 1. Closing in the next 7 days (today through +6), open loans only.
  const closingRows = (data.loans || [])
    .filter((l) => !isScenario(l) && isOpen(l) && l.firm_closing_on && l.firm_closing_on >= today && l.firm_closing_on <= weekOut)
    .sort((a, b) => a.firm_closing_on.localeCompare(b.firm_closing_on))
  const closing = list(closingRows, (l) => ({
    name: l.borrower_name || '(no name)',
    date: l.firm_closing_on,
    title: l.title_company || null,
    docs: byId.get(l.contact_id)?.docs_outstanding || [],
    buyerAgent: agent(l.buyer_agent_name, l.buyer_agent_phone),
    sellerAgent: agent(l.seller_agent_name, l.seller_agent_phone),
  }))

  // 2. Disclosures due: Application Received, not yet Disclosed. TRID: the
  // Loan Estimate goes out within 3 business days of the application.
  const disclosureRows = pipeline
    .filter((r) => r.stage === APP_RECEIVED && r.stage_since)
    .map((r) => ({ name: r.name || '(no name)', dueBy: addBusinessDays(dayOf(r.stage_since), 3) }))
    .sort((a, b) => a.dueBy.localeCompare(b.dueBy))
    .map((r) => ({ ...r, due: today >= r.dueBy }))
  const disclosures = list(disclosureRows, (r) => r)

  // 3. Missing docs, oldest request first; 7+ days old means chase today.
  const docRows = pipeline
    .filter((r) => r.docs_tracked && (r.docs_outstanding_count || 0) > 0)
    .sort((a, b) => String(a.docs_oldest_requested_at || '').localeCompare(String(b.docs_oldest_requested_at || '')))
    .map((r) => {
      const days = daysSince(r.docs_oldest_requested_at, now)
      return { name: r.name || '(no name)', docs: r.docs_outstanding || [], days, chase: days !== null && days >= CHASE_DAYS }
    })
  const missingDocs = list(docRows, (r) => r)

  // 4. New applications: entered Application Received on the last business day.
  const prevDay = previousBusinessDateKey(now)
  const newApps = list(
    pipeline.filter((r) => r.stage === APP_RECEIVED && dayOf(r.stage_since) === prevDay),
    (r) => ({ name: r.name || '(no name)' }),
  )

  // 5. Waiting on borrower: sent 3+ days ago with no stage move, then her due check-backs.
  const stuck = pipeline
    .filter((r) => r.stage === APP_SENT && r.stage_since && daysSince(r.stage_since, now) >= WAIT_DAYS)
    .sort((a, b) => String(a.stage_since).localeCompare(String(b.stage_since)))
    .map((r) => ({ name: r.name || '(no name)', detail: `${APP_SENT} ${daysSince(r.stage_since, now)} days ago, no movement` }))
  const checkBacks = (data.workItems || [])
    .filter((w) => w.status !== 'done' && ((w.check_back_on && w.check_back_on <= today) || (w.due_on && w.due_on <= today)))
    .map((w) => ({ name: w.contact_name || w.title || 'Work item', detail: `Check back: ${w.title || w.kind}` }))
  const waiting = list(stuck.concat(checkBacks), (r) => r)

  const chaseCount = docRows.filter((r) => r.chase).length
  return {
    dateLabel: longDateLabel(now),
    closing,
    disclosures,
    missingDocs,
    newApps,
    waiting,
    closingCount: closing.count,
    chaseCount,
    quiet: !closing.count && !disclosures.count && !missingDocs.count && !newApps.count && !waiting.count,
  }
}
```

- [ ] **Step 4: Run them to make sure they pass**

Run: `npx vitest run src/lib/assistantBriefing.test.js`
Expected: PASS (6 tests). If `dateLabel` differs, check `longDateLabel`'s output format in `briefingTime.js` and fix the test's expected string to match it (the owner tests use `'Tue Nov 3'` style).

- [ ] **Step 5: Commit**

```bash
git add src/lib/assistantBriefing.js src/lib/assistantBriefing.test.js
git commit -m "feat: assistant briefing builder (closings, disclosures, docs, new apps, waiting)"
```

---

### Task 3: `renderAssistantBriefing`

**Files:**
- Modify: `src/lib/briefingEmail.js` (add after `renderOwnerBriefing`, before `plainSeparators`)
- Test: `src/lib/briefingEmail.test.js`

- [ ] **Step 1: Write the failing tests** (append to `src/lib/briefingEmail.test.js`; change the import to `import { renderOwnerBriefing, renderAssistantBriefing } from './briefingEmail'`)

```js
const amodel = (o = {}) => ({
  dateLabel: 'Wed Nov 4',
  closing: { count: 1, top: [{ name: 'Pat Lee', date: '2026-11-06', title: 'Lone Star Title', docs: ['W2'], buyerAgent: { name: 'Jo Ray', phone: '7135550100' }, sellerAgent: null }] },
  disclosures: { count: 2, top: [{ name: 'Due Dan', dueBy: '2026-11-04', due: true }, { name: 'Fresh Fran', dueBy: '2026-11-06', due: false }] },
  missingDocs: { count: 1, top: [{ name: 'Old Olga', docs: ['W2', 'Bank'], days: 10, chase: true }] },
  newApps: { count: 0, top: [] },
  waiting: { count: 0, top: [] },
  closingCount: 1,
  chaseCount: 1,
  quiet: false,
  ...o,
})

describe('renderAssistantBriefing', () => {
  it('subject carries the date, closings and docs to chase, ASCII only', () => {
    const { subject } = renderAssistantBriefing(amodel(), { appUrl: 'https://x.app' })
    expect(subject).toBe('Bayway files | Wed Nov 4 | 1 closing this week | 1 doc to chase')
    expect(/^[ -~]*$/.test(subject)).toBe(true)
  })
  it('pluralizes the subject counts', () => {
    const { subject } = renderAssistantBriefing(amodel({ closingCount: 2, chaseCount: 5 }), { appUrl: 'https://x.app' })
    expect(subject).toBe('Bayway files | Wed Nov 4 | 2 closing this week | 5 docs to chase')
  })
  it('shows closings with title, agents and docs; disclosures before missing docs', () => {
    const { text } = renderAssistantBriefing(amodel(), { appUrl: 'https://x.app' })
    expect(text).toContain('Pat Lee - closes Nov 6 | Title: Lone Star Title | Buyer agent: Jo Ray 7135550100 | Docs: W2')
    expect(text).toContain('Due Dan - disclose by Nov 4 (DUE)')
    expect(text).toContain('Fresh Fran - disclose by Nov 6')
    expect(text).toContain('Old Olga - W2, Bank - 10 days - CHASE TODAY')
    expect(text.indexOf('Disclosures due')).toBeLessThan(text.indexOf('Missing docs'))
    expect(text).not.toContain('New applications')
  })
  it('marks due rows red in HTML and keeps HTML ASCII', () => {
    const { html } = renderAssistantBriefing(amodel(), { appUrl: 'https://x.app' })
    expect(html).toMatch(/<li style="color:#b42318">Due Dan - disclose by Nov 4 \(DUE\)<\/li>/)
    expect(html).toContain('href="https://x.app/pipeline"')
    expect(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(html)).toBe(true)
  })
  it('says the files are quiet when nothing is listed', () => {
    const empty = { count: 0, top: [] }
    const m = amodel({ closing: empty, disclosures: empty, missingDocs: empty, closingCount: 0, chaseCount: 0, quiet: true })
    const { text } = renderAssistantBriefing(m, { appUrl: 'https://x.app' })
    expect(text).toContain('Nothing on the files today.')
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/lib/briefingEmail.test.js`
Expected: FAIL, `renderAssistantBriefing is not a function`.

- [ ] **Step 3: Implement** (add to `src/lib/briefingEmail.js`, after `renderOwnerBriefing`)

```js
// Shelby's Bayway files briefing. Rows are { text, alert }: alert rows (a
// disclosure due, a doc to chase) are red in HTML and upper-case in text.
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

export function renderAssistantBriefing(m, { appUrl }) {
  const url = (p) => `${String(appUrl).replace(/\/$/, '')}${p}`
  const subject = `Bayway files | ${m.dateLabel} | ${m.closingCount} closing this week | ${plural(m.chaseCount, 'doc', 'docs')} to chase`

  const agentText = (label, a) => (a ? `${label}: ${a.name}${a.phone ? ` ${a.phone}` : ''}` : null)
  const block = (title, b, href, toRow) => {
    if (!b.count) return null
    const rows = b.top.map(toRow)
    if (b.count > b.top.length) rows.push({ text: `+${b.count - b.top.length} more`, alert: false })
    return { title: `${title} (${b.count})`, rows, href }
  }
  const blocks = [
    block('Closing in 7 days', m.closing, '/pipeline', (c) => ({
      text: [
        `${c.name} - closes ${dayLabel(c.date)}`,
        c.title ? `Title: ${c.title}` : 'Title: not set',
        agentText('Buyer agent', c.buyerAgent),
        agentText('Seller agent', c.sellerAgent),
        c.docs.length ? `Docs: ${c.docs.join(', ')}` : 'Docs: none outstanding',
      ].filter(Boolean).join(' | '),
      alert: false,
    })),
    block('Disclosures due', m.disclosures, '/pipeline', (d) => ({ text: `${d.name} - disclose by ${dayLabel(d.dueBy)}${d.due ? ' (DUE)' : ''}`, alert: d.due })),
    block('Missing docs', m.missingDocs, '/pipeline', (d) => ({
      text: `${d.name} - ${d.docs.join(', ')}${d.days != null ? ` - ${d.days} days` : ''}${d.chase ? ' - CHASE TODAY' : ''}`,
      alert: d.chase,
    })),
    block('New applications', m.newApps, '/pipeline', (a) => ({ text: `${a.name} - set up the file and send the doc list`, alert: false })),
    block('Waiting on borrower', m.waiting, '/workbench', (w) => ({ text: `${w.name} - ${w.detail}`, alert: false })),
  ].filter(Boolean)

  const textBody = blocks.length
    ? blocks.map((b) => [b.title, ...b.rows.map((r) => `  - ${r.text}`), `  ${url(b.href)}`].join('\n')).join('\n\n')
    : 'Nothing on the files today.'
  const text = plainSeparators(`${subject}\n\n${textBody}\n\nOpen the OS: ${url('/workbench')}\n`)

  const li = (r) => `<li${r.alert ? ' style="color:#b42318"' : ''}>${esc(r.text)}</li>`
  const blockHtml = (b) =>
    `<p style="font:600 14px Arial,sans-serif;margin:14px 0 4px"><a href="${esc(url(b.href))}" style="color:#1d4ed8">${esc(b.title)}</a></p>` +
    `<ul style="font:14px Arial,sans-serif;margin:0;padding-left:18px">${b.rows.map(li).join('')}</ul>`
  const html = [
    `<div style="max-width:600px">`,
    `<p style="font:13px Arial,sans-serif;color:#667085;margin:0">${esc(m.dateLabel)} - Bayway files</p>`,
    blocks.length ? blocks.map(blockHtml).join('') : `<p style="font:14px Arial,sans-serif">Nothing on the files today.</p>`,
    `<p style="font:13px Arial,sans-serif;margin-top:24px"><a href="${esc(url('/workbench'))}">Open the OS</a></p>`,
    `</div>`,
  ].join('')

  return { subject, text, html: asciiHtml(html) }
}
```

- [ ] **Step 4: Run them to make sure they pass**

Run: `npx vitest run src/lib/briefingEmail.test.js`
Expected: PASS (owner tests unchanged, 5 new).

- [ ] **Step 5: Commit**

```bash
git add src/lib/briefingEmail.js src/lib/briefingEmail.test.js
git commit -m "feat: render the assistant's Bayway files briefing"
```

---

### Task 4: Bundle the new functions

**Files:**
- Modify: `src/lib/briefingEntry.js`
- Regenerate: `supabase/functions/daily-briefing/briefing.bundle.js`

- [ ] **Step 1: Export them** (`src/lib/briefingEntry.js` becomes)

```js
// Everything the daily-briefing edge function needs from src/lib, bundled by
// scripts/build-briefing.mjs into supabase/functions/daily-briefing/briefing.bundle.js
// (Deno can't load src/lib's extensionless imports directly).
export { buildOwnerBriefing } from './briefing'
export { buildAssistantBriefing } from './assistantBriefing'
export { renderOwnerBriefing, renderAssistantBriefing } from './briefingEmail'
export { shouldSend, chicagoParts, chicagoDayRangeUtc, chicagoDateKey, previousBusinessDayRangeUtc } from './briefingTime'
export { CORE_SOURCES } from './syncHealth'
```

- [ ] **Step 2: Run the staleness test to see it fail**

Run: `npx vitest run src/lib/briefingBundle.test.js`
Expected: FAIL (bundle out of date).

- [ ] **Step 3: Rebuild**

Run: `npm run build:briefing`
Then: `grep -c "renderAssistantBriefing" supabase/functions/daily-briefing/briefing.bundle.js`
Expected: a count of at least 1.

- [ ] **Step 4: Run the staleness test**

Run: `npx vitest run src/lib/briefingBundle.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/briefingEntry.js supabase/functions/daily-briefing/briefing.bundle.js
git commit -m "build: bundle the assistant briefing for daily-briefing"
```

---

### Task 5: `daily-briefing` sends both briefings

Each recipient gets its own claim (`briefing_sends (day, recipient)`), its own send and its own `sync_log` row, so one failing never blocks or repeats the other. Chandler's work items are now filtered to his user id (the service role reads everyone's). Test mode: header `x-briefing-test: <BRIEFING_TEST_KEY>`, plus `x-briefing-who: assistant` for Shelby's version; test sends always go to `owner_email`.

**Files:**
- Rewrite: `supabase/functions/daily-briefing/index.ts`
- Modify: `src/pages/SyncStatus.jsx` (source labels)

`user_roles` arrives in Task 6's migration. Rollout applies the migration before deploying this function.

- [ ] **Step 1: Replace `supabase/functions/daily-briefing/index.ts` with**

```ts
// Daily briefings (spec 2026-11-03, section 3; plans 2026-11-04-daily-briefing.md
// and 2026-11-04-assistant-login-briefing.md). pg_cron calls this at 12:30,
// 13:30 and 14:30 UTC on weekdays (migration 0055); it sends only at 7:xx or
// 8:xx Chicago (shouldSend), once per recipient per day: a briefing_sends row
// (day, recipient) is claimed before each send and released if that send fails.
//
//   owner      Chandler's briefing to briefings.owner_email   (sync_log 'briefing-owner')
//   assistant  Shelby's Bayway files to briefings.assistant_email, only while
//              briefings.assistant_enabled is true          (sync_log 'briefing-assistant')
//
// Test mode: header x-briefing-test equal to the BRIEFING_TEST_KEY secret skips
// the window, the switch and the claim, sends to owner_email with a [TEST]
// subject and logs to '<source>-test'. Header x-briefing-who: assistant picks
// Shelby's briefing; otherwise Chandler's. Callers get only { ok }.
// Deployed --no-verify-jwt like the syncs. The service role bypasses RLS, so
// per-user tables are filtered by user id here.
import { serviceClient, logSync, fetchAll } from '../_shared/db.ts'
import { sendGmail } from '../_shared/gmail-smtp.ts'
import {
  buildOwnerBriefing, renderOwnerBriefing, buildAssistantBriefing, renderAssistantBriefing,
  shouldSend, chicagoDayRangeUtc, previousBusinessDayRangeUtc, chicagoDateKey, CORE_SOURCES,
} from './briefing.bundle.js'

const SOURCE = { owner: 'briefing-owner', assistant: 'briefing-assistant' }
const SEND_TIMEOUT_MS = 30_000
const APP_URL = 'https://atkinson-sales-os.vercel.app'
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const setting = async (db, key) => {
  const { data, error } = await db.from('settings').select('value').eq('key', key).maybeSingle()
  if (error) throw new Error(`setting ${key}: ${error.message}`)
  return data?.value ?? null
}
const rows = ({ data, error }) => {
  if (error) throw new Error(error.message)
  return data || []
}
// A hung SMTP connection becomes a logged error instead of a stuck function.
const withTimeout = (promise, ms) => {
  let timer
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`send timed out after ${ms / 1000}s`)), ms) })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
const flatWorkItems = (items) => items.map(({ contact, ...w }) => ({ ...w, contact_name: contact?.name || null }))

async function ownerMail(db, cfg, now, ownerId) {
  const today = chicagoDayRangeUtc(now)
  const yesterday = previousBusinessDayRangeUtc(now)
  const [cy, cm] = chicagoDateKey(now).split('-').map(Number)
  const since = new Date(Date.UTC(cy, cm - 2, 1)).toISOString().slice(0, 10)
  const tomorrowKey = chicagoDateKey(now, 1)

  const [rules, targets, rates, forecastSettings] = await Promise.all(
    ['priority_rules', 'metric_targets', 'arive', 'forecast'].map((k) => setting(db, k)),
  )
  const [metrics, mpgMetricRows, deals, activities, yesterdayActivities, pipeline, loans, ratings, signals, dialRows, dialSkips, mpgTasks, workItems, events] = await Promise.all([
    fetchAll(() => db.from('metrics_daily').select('date, business_id, metric_key, value').gte('date', since).order('id')),
    db.from('metrics_daily').select('date, business_id, metric_key, value').eq('business_id', 'mpg').in('metric_key', ['rev_monthly_residual', 'rev_active_merchants']).order('date', { ascending: false }).order('id').limit(120).then(rows),
    fetchAll(() => db.from('deals').select('status, value, expected_close, business_id').eq('business_id', 'bay').order('id')),
    fetchAll(() => db.from('activities').select('occurred_at, type, business_id').eq('direction', 'outbound').in('type', ['call', 'text', 'email']).gte('occurred_at', `${since}T00:00:00Z`).order('id')),
    fetchAll(() => db.from('activities').select('type, direction, raw').gte('occurred_at', yesterday.from).lt('occurred_at', yesterday.to).order('id')),
    fetchAll(() => db.from('v_active_pipeline').select('id, business_id, name, stage, stage_since, last_touch_at, crm_created_at, last_outbound_call_at, open_task_count, oldest_open_due_at, docs_outstanding_count, docs_oldest_requested_at').eq('business_id', 'bay').order('id')),
    fetchAll(() => db.from('loans').select('id, borrower_name, role, amount, stage_group, funded_on, firm_closing_on, application_on, contact_id, comp_override, scenario_auto, scenario_override, updated_at, last_seen_at').order('id')),
    fetchAll(() => db.from('lead_ratings').select('contact_id, business_id, temperature, est_amount, close_month, rated_at, contact:contacts(name)').order('contact_id')),
    fetchAll(() => db.from('v_lead_signals').select('*').order('id')),
    fetchAll(() => db.from('v_dial_contacts').select('*').order('id')),
    fetchAll(() => db.from('dial_skips').select('contact_id').eq('user_id', ownerId).gte('until_date', tomorrowKey).order('id')),
    fetchAll(() => db.from('v_tasks').select('id, title, due_at, contact_id, contact_name, company, business_id').eq('business_id', 'mpg').order('id')),
    fetchAll(() => db.from('work_items').select('id, business_id, kind, contact_id, title, status, waiting_on, check_back_on, due_on, created_at, done_at, contact:contacts(name)').eq('user_id', ownerId).neq('status', 'done').order('id')),
    fetchAll(() => db.from('calendar_events').select('id, source_account, title, starts_at, is_all_day').gte('starts_at', today.from).lt('starts_at', today.to).order('starts_at')),
  ])
  const syncLatest = {}
  await Promise.all(
    CORE_SOURCES.map(async ({ source }) => {
      const { data } = await db.from('sync_log').select('ran_at, status').eq('source', source).order('ran_at', { ascending: false }).limit(1).maybeSingle()
      if (data) syncLatest[source] = data
    }),
  )
  const model = buildOwnerBriefing({
    rules, targets, rates, forecastSettings, metrics, mpgMetricRows, deals, activities, yesterdayActivities, pipeline, loans, ratings, signals, dialRows,
    dialSkips: dialSkips.map((r) => r.contact_id), mpgTasks, workItems: flatWorkItems(workItems), events, syncLatest,
  }, now)
  return renderOwnerBriefing(model, { appUrl: cfg.app_url || APP_URL })
}

async function assistantMail(db, cfg, now, assistantId) {
  const [loans, pipeline, workItems] = await Promise.all([
    fetchAll(() => db.from('loans').select('id, contact_id, borrower_name, stage_group, firm_closing_on, title_company, buyer_agent_name, buyer_agent_phone, seller_agent_name, seller_agent_phone, scenario_auto, scenario_override').eq('business_id', 'bay').order('id')),
    fetchAll(() => db.from('v_active_pipeline').select('id, name, stage, stage_since, docs_tracked, docs_outstanding, docs_outstanding_count, docs_oldest_requested_at').eq('business_id', 'bay').order('id')),
    assistantId
      ? fetchAll(() => db.from('work_items').select('id, kind, title, status, check_back_on, due_on, contact_id, contact:contacts(name)').eq('user_id', assistantId).eq('business_id', 'bay').neq('status', 'done').order('id'))
      : Promise.resolve([]),
  ])
  const model = buildAssistantBriefing({ loans, pipeline, workItems: flatWorkItems(workItems) }, now)
  return renderAssistantBriefing(model, { appUrl: cfg.app_url || APP_URL })
}

// One recipient: claim (unless testing), build, send, log. Returns true on success.
async function sendOne(db, { who, to, isTest, now, build }) {
  const source = isTest ? `${SOURCE[who]}-test` : SOURCE[who]
  const day = chicagoDateKey(now)
  let claimed = false
  try {
    if (!isTest) {
      const { error } = await db.from('briefing_sends').insert({ day, recipient: to })
      if (error?.code === '23505') return true // already sent today
      if (error) throw new Error(`claim: ${error.message}`)
      claimed = true
    }
    const mail = await build()
    await withTimeout(sendGmail({ to, subject: isTest ? `[TEST] ${mail.subject}` : mail.subject, text: mail.text, html: mail.html }), SEND_TIMEOUT_MS)
    claimed = false // sent: keep the claim even if logging fails
    await logSync(db, source, 'ok', 1, `${isTest ? 'test ' : ''}sent to ${to}: ${mail.subject}`)
    return true
  } catch (err) {
    const message = String(err?.message || err).slice(0, 500)
    // Release the claim so the next hour's run can retry.
    if (claimed) await db.from('briefing_sends').delete().eq('day', day).eq('recipient', to).then(() => {}, () => {})
    await logSync(db, source, 'error', 0, message).catch(() => {})
    return false
  }
}

Deno.serve(async (req) => {
  const now = Date.now()
  const testKey = Deno.env.get('BRIEFING_TEST_KEY')
  const isTest = !!testKey && req.headers.get('x-briefing-test') === testKey
  const testWho = req.headers.get('x-briefing-who') === 'assistant' ? 'assistant' : 'owner'
  let db
  try {
    db = serviceClient()
    const cfg = (await setting(db, 'briefings')) || {}
    if (!cfg.enabled && !isTest) return json(200, { ok: true, skipped: true })
    if (!isTest && !shouldSend(now)) return json(200, { ok: true, skipped: true })

    const roles = rows(await db.from('user_roles').select('user_id, role'))
    const ownerId = roles.find((r) => r.role === 'owner')?.user_id
    const assistantId = roles.find((r) => r.role === 'assistant')?.user_id || null
    if (!ownerId) throw new Error('no owner in user_roles')

    const ownerTo = cfg.owner_email || 'chandler@baywayhtx.com'
    const jobs = isTest
      ? [testWho]
      : ['owner', ...(cfg.assistant_enabled === true && cfg.assistant_email ? ['assistant'] : [])]
    let ok = true
    for (const who of jobs) {
      const to = isTest || who === 'owner' ? ownerTo : cfg.assistant_email
      const build = who === 'owner' ? () => ownerMail(db, cfg, now, ownerId) : () => assistantMail(db, cfg, now, assistantId)
      ok = (await sendOne(db, { who, to, isTest, now, build })) && ok
    }
    return json(ok ? 200 : 500, { ok })
  } catch (err) {
    const message = String(err?.message || err).slice(0, 500)
    if (db) await logSync(db, isTest ? `${SOURCE[testWho]}-test` : SOURCE.owner, 'error', 0, message).catch(() => {})
    return json(500, { ok: false })
  }
})
```

- [ ] **Step 2: Type-check the function**

Run: `npx supabase functions deploy daily-briefing --dry-run 2>&1 | tail -5` if the CLI supports `--dry-run`; otherwise run `deno check supabase/functions/daily-briefing/index.ts` if Deno is installed. If neither is available, skip and say so in the task report: the Rollout's test send is the real check.
Expected: no type errors.

- [ ] **Step 3: SyncStatus labels.** In `src/pages/SyncStatus.jsx`, find the source-label map that holds `'briefing-owner': 'Daily briefing (you)'` and `'briefing-owner-test': 'Daily briefing (test)'`, and add the two new entries right after them:

```js
  'briefing-assistant': "Daily briefing (Shelby)",
  'briefing-assistant-test': "Daily briefing (Shelby, test)",
```

Run: `npx vitest run src/pages/SyncStatus.render.test.jsx`
Expected: PASS.

- [ ] **Step 4: Full suite**

Run: `npm test`
Expected: PASS apart from the known pre-existing failures listed at the top.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/daily-briefing/index.ts src/pages/SyncStatus.jsx
git commit -m "feat: daily-briefing sends Shelby's Bayway files briefing too"
```

---

# Part B: The assistant's login

### Task 6: Migration `0056_assistant_role.sql` and the RLS test

**Files:**
- Create: `supabase/migrations/0056_assistant_role.sql`
- Create: `supabase/tests/assistant_rls.sql`

The live policies this replaces (from `pg_policies` on 2026-11-04) are named exactly as dropped below. Do not apply the migration in this task; Rollout does.

- [ ] **Step 1: Write the migration**

```sql
-- Assistant login (spec 2026-11-03, section 3, "The assistant's login").
--   * user_roles: who is the owner (both books) and who is the assistant
--     (Bayway only). Rows are added by hand (docs/assistant-login-setup.md);
--     no app write policy. No FK to auth.users, so the RLS test can use a
--     throwaway id inside a rolled-back transaction.
--   * app_role / is_owner / can_read_book: SECURITY DEFINER so policies can
--     read user_roles without recursing into its own RLS.
--   * Read policies: book tables by can_read_book(business_id); Bayway-only
--     tables by can_read_book('bay'); money and Chandler-only tables
--     (loans, metrics_daily, calendar_events, sync_log) owner-only.
--   * Write policies on settings, loans, metrics_daily, sync_log and
--     lead_ratings become owner-only.
--   * v_assistant_writes: the notes and tasks the assistant created through
--     crm-action, so the OS can show "by assistant".
--   * briefings.assistant_enabled = false until Chandler turns it on.

create table if not exists public.user_roles (
  user_id    uuid primary key,
  role       text not null check (role in ('owner', 'assistant')),
  books      text[] not null,
  name       text,
  created_at timestamptz not null default now()
);
alter table public.user_roles enable row level security;

create or replace function public.app_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.user_roles where user_id = auth.uid()
$$;
create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'owner')
$$;
create or replace function public.can_read_book(book text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and book = any (books))
$$;
revoke all on function public.app_role() from public, anon;
revoke all on function public.is_owner() from public, anon;
revoke all on function public.can_read_book(text) from public, anon;
grant execute on function public.app_role() to authenticated, service_role;
grant execute on function public.is_owner() to authenticated, service_role;
grant execute on function public.can_read_book(text) to authenticated, service_role;

drop policy if exists "read own or owner user_roles" on public.user_roles;
create policy "read own or owner user_roles" on public.user_roles
  for select to authenticated using (user_id = auth.uid() or public.is_owner());

-- Chandler is the owner. Fail the migration rather than lock him out.
insert into public.user_roles (user_id, role, books, name)
select id, 'owner', array['bay', 'mpg'], 'Chandler Atkinson'
from auth.users where email = 'chandler.dashboard@gmail.com'
on conflict (user_id) do nothing;
do $$
begin
  if not exists (select 1 from public.user_roles where role = 'owner') then
    raise exception 'no owner: chandler.dashboard@gmail.com is not in auth.users';
  end if;
end $$;

-- ---- Read: by book ---------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['stages', 'contacts', 'deals', 'activities', 'tasks'] loop
    execute format('drop policy if exists "authenticated read %1$s" on public.%1$I', t);
    execute format('create policy "authenticated read %1$s" on public.%1$I for select to authenticated using (public.can_read_book(business_id))', t);
  end loop;
  foreach t in array array['borrower_doc_tracking', 'borrower_docs', 'contact_relationships', 'contact_relationship_syncs'] loop
    execute format('drop policy if exists "authenticated read %1$s" on public.%1$I', t);
    execute format('create policy "authenticated read %1$s" on public.%1$I for select to authenticated using (public.can_read_book(''bay''))', t);
  end loop;
  foreach t in array array['calendar_events', 'metrics_daily', 'sync_log'] loop
    execute format('drop policy if exists "authenticated read %1$s" on public.%1$I', t);
    execute format('create policy "authenticated read %1$s" on public.%1$I for select to authenticated using (public.is_owner())', t);
  end loop;
end $$;

drop policy if exists "authenticated select loans" on public.loans;
create policy "authenticated select loans" on public.loans
  for select to authenticated using (public.is_owner());

drop policy if exists "authenticated read crm_actions" on public.crm_actions;
create policy "authenticated read crm_actions" on public.crm_actions
  for select to authenticated using (user_id = auth.uid() or public.is_owner());

drop policy if exists "authenticated read settings" on public.settings;
create policy "authenticated read settings" on public.settings
  for select to authenticated
  using (public.is_owner() or (public.app_role() = 'assistant' and key in ('priority_rules', 'writeback_enabled', 'create_lead_enabled')));

drop policy if exists "authenticated read lead_ratings" on public.lead_ratings;
create policy "authenticated read lead_ratings" on public.lead_ratings
  for select to authenticated using (public.can_read_book(business_id));

-- ---- Write: owner only -----------------------------------------------------
drop policy if exists "authenticated insert lead_ratings" on public.lead_ratings;
create policy "authenticated insert lead_ratings" on public.lead_ratings
  for insert to authenticated with check (rated_by = auth.uid() and public.is_owner());
drop policy if exists "authenticated update lead_ratings" on public.lead_ratings;
create policy "authenticated update lead_ratings" on public.lead_ratings
  for update to authenticated using (public.is_owner()) with check (rated_by = auth.uid() and public.is_owner());
drop policy if exists "authenticated delete lead_ratings" on public.lead_ratings;
create policy "authenticated delete lead_ratings" on public.lead_ratings
  for delete to authenticated using (public.is_owner());

drop policy if exists "authenticated insert loans" on public.loans;
create policy "authenticated insert loans" on public.loans
  for insert to authenticated with check (public.is_owner());
drop policy if exists "authenticated update loans" on public.loans;
create policy "authenticated update loans" on public.loans
  for update to authenticated using (public.is_owner()) with check (public.is_owner());

drop policy if exists "authenticated insert metrics_daily" on public.metrics_daily;
create policy "authenticated insert metrics_daily" on public.metrics_daily
  for insert to authenticated with check (public.is_owner());
drop policy if exists "authenticated update metrics_daily" on public.metrics_daily;
create policy "authenticated update metrics_daily" on public.metrics_daily
  for update to authenticated using (public.is_owner()) with check (public.is_owner());

do $$
declare k text;
begin
  foreach k in array array['arive', 'forecast', 'metric_targets'] loop
    execute format('drop policy if exists "authenticated insert %1$s settings" on public.settings', k);
    execute format('drop policy if exists "authenticated update %1$s settings" on public.settings', k);
  end loop;
end $$;
drop policy if exists "authenticated insert metric_targets" on public.settings;
drop policy if exists "authenticated update metric_targets" on public.settings;
drop policy if exists "owner insert settings" on public.settings;
drop policy if exists "owner update settings" on public.settings;
create policy "owner insert settings" on public.settings
  for insert to authenticated with check (public.is_owner() and key in ('arive', 'forecast', 'metric_targets'));
create policy "owner update settings" on public.settings
  for update to authenticated
  using (public.is_owner() and key in ('arive', 'forecast', 'metric_targets'))
  with check (public.is_owner() and key in ('arive', 'forecast', 'metric_targets'));

drop policy if exists "authenticated insert arive sync_log" on public.sync_log;
create policy "authenticated insert arive sync_log" on public.sync_log
  for insert to authenticated with check (source = 'arive' and public.is_owner());

-- Per-user tables keep their own-row rules and gain the book check.
drop policy if exists "own work_items insert" on public.work_items;
create policy "own work_items insert" on public.work_items
  for insert to authenticated with check (user_id = auth.uid() and public.can_read_book(business_id));
drop policy if exists "own work_items update" on public.work_items;
create policy "own work_items update" on public.work_items
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and public.can_read_book(business_id));
drop policy if exists "own contact_events insert" on public.contact_events;
create policy "own contact_events insert" on public.contact_events
  for insert to authenticated with check (user_id = auth.uid() and public.can_read_book(business_id));
drop policy if exists "own contact_events update" on public.contact_events;
create policy "own contact_events update" on public.contact_events
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and public.can_read_book(business_id));

-- ---- "by assistant" ----------------------------------------------------------
-- Each successful add_note / create_task step the assistant ran, joined to
-- the mirrored row (FUB notes are activities 'note-<id>', tasks are tasks
-- '<id>'). security_invoker: the owner sees all, the assistant her own.
create or replace view public.v_assistant_writes
with (security_invoker = on) as
select ca.contact_id, ca.created_at, a.id as activity_id, t.id as task_id
from public.crm_actions ca
join public.user_roles ur on ur.user_id = ca.user_id and ur.role = 'assistant'
cross join lateral jsonb_array_elements(coalesce(ca.results, '[]'::jsonb)) s
left join public.activities a
  on s->>'step' = 'add_note' and a.source_crm = 'fub' and a.external_id = 'note-' || (s->>'crm_id')
left join public.tasks t
  on s->>'step' = 'create_task' and t.source_crm = 'fub' and t.external_id = s->>'crm_id'
where (s->>'ok')::boolean is true
  and (a.id is not null or t.id is not null);
revoke all on public.v_assistant_writes from anon;
grant select on public.v_assistant_writes to authenticated;

-- Shelby's briefing stays off until Chandler test-sends it.
update public.settings
set value = value || '{"assistant_enabled": false}'::jsonb
where key = 'briefings' and not (value ? 'assistant_enabled');
```

- [ ] **Step 2: Check the settings policy names before relying on the loop.** The live names are `authenticated insert arive settings`, `authenticated update arive settings`, `authenticated insert forecast settings`, `authenticated update forecast settings`, `authenticated insert metric_targets`, `authenticated update metric_targets`. The loop drops `authenticated insert metric_targets settings` (doesn't exist, harmless) and the two lines after it drop the real metric_targets ones. Confirm with:

Run: `grep -n "create policy" supabase/migrations/0012_reports_rls.sql supabase/migrations/0052_loans.sql supabase/migrations/0054_lead_ratings.sql`
Expected: the six names above. If any differs, add a matching `drop policy if exists` line.

- [ ] **Step 3: Write the RLS test** (`supabase/tests/assistant_rls.sql`)

```sql
-- RLS checks for the assistant role (spec 2026-11-03, Testing: RLS tests).
-- Runs as postgres, switches to the authenticated role with a fake assistant
-- and then the real owner, and ROLLS BACK: nothing persists.
-- Run: npx supabase db query --linked -f supabase/tests/assistant_rls.sql
-- Passing prints the two "passed" notices; a failure raises 'FAIL: ...'.
begin;

insert into public.user_roles (user_id, role, books, name)
values ('00000000-0000-4000-8000-0000000000a1', 'assistant', array['bay'], 'RLS test');

set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
do $$
declare n int;
begin
  select count(*) into n from public.contacts where business_id = 'mpg';
  if n <> 0 then raise exception 'FAIL: assistant reads % MPG contacts', n; end if;
  select count(*) into n from public.contacts where business_id = 'bay';
  if n = 0 then raise exception 'FAIL: assistant reads no Bayway contacts'; end if;
  select count(*) into n from public.v_active_pipeline where business_id = 'mpg';
  if n <> 0 then raise exception 'FAIL: assistant reads % MPG pipeline rows', n; end if;
  select count(*) into n from public.activities where business_id = 'mpg';
  if n <> 0 then raise exception 'FAIL: assistant reads % MPG activities', n; end if;
  select count(*) into n from public.tasks where business_id = 'mpg';
  if n <> 0 then raise exception 'FAIL: assistant reads % MPG tasks', n; end if;
  select count(*) into n from public.loans;
  if n <> 0 then raise exception 'FAIL: assistant reads % loans', n; end if;
  select count(*) into n from public.sync_log;
  if n <> 0 then raise exception 'FAIL: assistant reads % sync_log rows', n; end if;
  select count(*) into n from public.metrics_daily;
  if n <> 0 then raise exception 'FAIL: assistant reads % metrics_daily rows', n; end if;
  select count(*) into n from public.calendar_events;
  if n <> 0 then raise exception 'FAIL: assistant reads % calendar events', n; end if;
  select count(*) into n from public.crm_actions;
  if n <> 0 then raise exception 'FAIL: assistant reads % crm_actions rows', n; end if;
  select count(*) into n from public.settings where key not in ('priority_rules', 'writeback_enabled', 'create_lead_enabled');
  if n <> 0 then raise exception 'FAIL: assistant reads % private settings', n; end if;
  select count(*) into n from public.user_roles;
  if n <> 1 then raise exception 'FAIL: assistant reads % user_roles rows (want only her own)', n; end if;
  begin
    insert into public.lead_ratings (contact_id, business_id, temperature)
    select id, 'bay', 'hot' from public.contacts where business_id = 'bay' limit 1;
    raise exception 'FAIL: assistant wrote a lead rating';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.settings set value = value where key = 'priority_rules';
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAIL: assistant updated settings'; end if;
  end;
  raise notice 'assistant RLS: all checks passed';
end $$;

select set_config('request.jwt.claims', '{"sub":"2cbf8825-be9d-429a-a4ed-3c3915d09c1d","role":"authenticated"}', true);
do $$
declare n int;
begin
  select count(*) into n from public.contacts where business_id = 'mpg';
  if n = 0 then raise exception 'FAIL: owner reads no MPG contacts'; end if;
  select count(*) into n from public.sync_log;
  if n = 0 then raise exception 'FAIL: owner reads no sync_log'; end if;
  select count(*) into n from public.settings where key = 'arive';
  if n = 0 then raise exception 'FAIL: owner cannot read arive settings'; end if;
  select count(*) into n from public.user_roles;
  if n < 2 then raise exception 'FAIL: owner reads % user_roles rows (want all)', n; end if;
  raise notice 'owner RLS: all checks passed';
end $$;

rollback;
```

- [ ] **Step 4: Static check.** No local database is available, so check the SQL by reading it once more against the policy list in this task's header, then commit. Rollout step R2 runs the migration in dry-run and R4 runs this test against production in a rolled-back transaction.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0056_assistant_role.sql supabase/tests/assistant_rls.sql
git commit -m "feat: user_roles and Bayway-only RLS for the assistant"
```

---

### Task 7: `crm-action` role checks

**Files:**
- Modify: `supabase/functions/crm-action/plan.ts`
- Modify: `supabase/functions/crm-action/run.ts`
- Modify: `supabase/functions/crm-action/index.ts`
- Test: `supabase/functions/crm-action/run.test.js`

Rules: the owner is still `ALLOWED_USER_ID`. A caller whose `user_roles.role` is `assistant` may run `add_note`, `create_task`, `complete_task` on Bayway, plus the read-only `contact_notes` and `contact_relationships`. Any other action from her is refused **and recorded** (a `crm_actions` row with status `refused`), except `whoami` and `smart_lists`, which 403 like any stranger. Anyone else: 403.

- [ ] **Step 1: Write the failing tests.** In `supabase/functions/crm-action/run.test.js`, find the `go` helper (line ~147):

```js
const go = (req, extra = {}) => run(req, { db, adapters: { bay, mpg }, allowedUserId: USER, userId: USER, now, ...extra })
```

Add this `describe` block at the end of the file. It uses the file's fixtures: `seed()` has Bayway contact `c-bay`, MPG contact `c-mpg` and open task `t-open`; the fake db keeps rows in `db.tables`; `uuid(n)` makes ids.

```js
describe('crm-action run: assistant role', () => {
  const ASSISTANT = '00000000-0000-4000-8000-0000000000a1'
  const asAssistant = (req, extra = {}) => go(req, { userId: ASSISTANT, role: 'assistant', ...extra })
  const noteReq = (contactId = 'c-bay', n = 81) => ({ client_action_id: uuid(n), action: 'add_note', contact_id: contactId, payload: { body: 'Sent the doc list' } })

  it('lets the assistant add a note on a Bayway contact, recorded under her id', async () => {
    const res = await asAssistant(noteReq())
    expect(res.http).toBe(200)
    expect(res.body.status).toBe('ok')
    expect(db.tables.crm_actions.at(-1)).toMatchObject({ action: 'add_note', status: 'ok', user_id: ASSISTANT })
  })
  it('lets the assistant complete a Bayway task and create a follow-up', async () => {
    expect((await asAssistant({ client_action_id: uuid(82), action: 'complete_task', task_id: 't-open' })).body.status).toBe('ok')
    expect((await asAssistant({ client_action_id: uuid(83), action: 'create_task', contact_id: 'c-bay', payload: { due_date: '2026-10-20', title: 'Follow up: Jo' } })).body.status).toBe('ok')
  })
  it('refuses Log call from the assistant and records the refusal', async () => {
    const res = await asAssistant(logCallReq())
    expect(res.http).toBe(200)
    expect(res.body).toMatchObject({ status: 'refused', error: 'The assistant login cannot do that' })
    expect(db.tables.crm_actions.at(-1)).toMatchObject({ action: 'log_call', status: 'refused', user_id: ASSISTANT })
    expect(bay.send.logCall).not.toHaveBeenCalled()
  })
  it('refuses set_stage, set_temperature and push_task from the assistant', async () => {
    expect((await asAssistant({ client_action_id: uuid(84), action: 'set_stage', contact_id: 'c-bay', payload: { target: 'working' } })).body.status).toBe('refused')
    expect((await asAssistant({ client_action_id: uuid(85), action: 'set_temperature', contact_id: 'c-bay', payload: { temperature: 'hot' } })).body.status).toBe('refused')
    expect((await asAssistant({ client_action_id: uuid(86), action: 'push_task', task_id: 't-open', payload: { due_date: '2026-10-21' } })).body.status).toBe('refused')
  })
  it('refuses an MPG contact for the assistant', async () => {
    const res = await asAssistant(noteReq('c-mpg', 87))
    expect(res.body).toMatchObject({ status: 'refused', error: 'The assistant login is Bayway only' })
  })
  it('refuses an MPG contact_notes read for the assistant', async () => {
    const res = await asAssistant({ client_action_id: uuid(88), action: 'contact_notes', contact_id: 'c-mpg' })
    expect(res.body).toMatchObject({ status: 'refused', error: 'The assistant login is Bayway only' })
  })
  it('403s whoami and smart_lists for the assistant', async () => {
    expect((await asAssistant({ client_action_id: uuid(89), action: 'whoami' })).http).toBe(403)
    expect((await asAssistant({ client_action_id: uuid(90), action: 'smart_lists' })).http).toBe(403)
  })
  it('403s a signed-in user with no role and writes nothing', async () => {
    const res = await go(noteReq(), { userId: ASSISTANT, role: null })
    expect(res.http).toBe(403)
    expect(db.calls).toEqual([])
  })
})
```

If the fake FUB adapter's send function for logging a call isn't `bay.send.logCall`, use the name the existing guard test uses (`expect(bay.send.logCall).not.toHaveBeenCalled()` at line ~159). If `create_task` on `c-bay` fails because the adapter's fake has no task read-back, copy the shape the existing create-task test (line ~311) relies on.

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run supabase/functions/crm-action/run.test.js`
Expected: the new tests FAIL (the assistant gets 403 today); existing tests PASS.

- [ ] **Step 3: Add the action sets** (append to `supabase/functions/crm-action/plan.ts`, after `TASK_ACTIONS`)

```ts
// The assistant login (spec 2026-11-03, section 3): notes, follow-ups and
// completing tasks on Bayway, plus the two read-only refreshes the contact
// card runs. Everything else is refused (and recorded) for her.
export const ASSISTANT_ACTIONS = new Set(['add_note', 'create_task', 'complete_task'])
export const ASSISTANT_READS = new Set(['contact_notes', 'contact_relationships'])
export const ASSISTANT_REFUSED = 'The assistant login cannot do that'
export const ASSISTANT_BAYWAY_ONLY = 'The assistant login is Bayway only'
```

- [ ] **Step 4: Gate `run`.** In `supabase/functions/crm-action/run.ts`:

Change the import from `./plan.ts` to also bring in `ASSISTANT_ACTIONS, ASSISTANT_READS, ASSISTANT_REFUSED, ASSISTANT_BAYWAY_ONLY`.

Update the header comment's injected list with one line: `//   role:          the caller's user_roles.role ('owner' | 'assistant' | null)`.

Replace the first line of `run`:

```ts
export async function run(req, { db, adapters, allowedUserId, userId, now = new Date() }) {
  if (!allowedUserId || !userId || userId !== allowedUserId) return reply(403, { error: 'Forbidden' })
```

with:

```ts
export async function run(req, { db, adapters, allowedUserId, userId, role = null, now = new Date() }) {
  const isOwner = !!allowedUserId && !!userId && userId === allowedUserId
  const isAssistant = !isOwner && !!userId && role === 'assistant'
  if (!isOwner && !isAssistant) return reply(403, { error: 'Forbidden' })
  // Setup and Smart List reads are Chandler's alone.
  if (isAssistant && (req?.action === 'whoami' || req?.action === 'smart_lists')) return reply(403, { error: 'Forbidden' })
```

In the `contact_notes` branch, right after `if (!contact) return reply(200, { status: 'refused', error: 'Contact not found' })`, add:

```ts
    if (isAssistant && contact.business_id !== 'bay') return reply(200, { status: 'refused', error: ASSISTANT_BAYWAY_ONLY })
```

(`contact_relationships` already skips non-Bayway contacts.)

After the `refuse` helper is defined and before the `writeback_enabled` check, add:

```ts
  if (isAssistant && !ASSISTANT_ACTIONS.has(req.action)) return refuse(ASSISTANT_REFUSED)
  if (isAssistant && businessId !== 'bay') return refuse(ASSISTANT_BAYWAY_ONLY)
```

`ASSISTANT_READS` documents the two read actions; `run` reaches them before the claim, so they need no extra check beyond the Bayway one above.

- [ ] **Step 5: Look up the role in `index.ts`.** In `supabase/functions/crm-action/index.ts`, replace the header comment's sentence starting "Unlike the sync functions" through "keeps writes to Chandler alone." with:

```ts
// Unlike the sync functions (deployed --no-verify-jwt for pg_cron), this one is
// deployed WITH JWT verification. run.ts lets ALLOWED_USER_ID (Chandler) do
// everything and a user_roles 'assistant' do notes, follow-ups and completing
// tasks on Bayway only; anyone else gets 403.
```

and after `if (error || !userId) return json(401, { error: 'Not signed in' })` add:

```ts
  // The caller's role (assistant login). A failed lookup means no role: only
  // ALLOWED_USER_ID gets through then.
  const { data: roleRow } = await db.from('user_roles').select('role').eq('user_id', userId).maybeSingle()
```

and pass `role: roleRow?.role ?? null,` in the `run(body, { ... })` options next to `userId`.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run supabase/functions/crm-action`
Expected: PASS, old and new.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/crm-action/plan.ts supabase/functions/crm-action/run.ts supabase/functions/crm-action/index.ts supabase/functions/crm-action/run.test.js
git commit -m "feat: crm-action lets the assistant add notes, follow-ups and complete tasks on Bayway"
```

---

### Task 8: Pure role rules

**Files:**
- Create: `src/lib/roles.js`
- Test: `src/lib/roles.test.js`

- [ ] **Step 1: Write the failing tests** (`src/lib/roles.test.js`)

```js
import { describe, it, expect } from 'vitest'
import { canVisit, homeFor, quickActionsFor, ASSISTANT_QUICK_ACTIONS, roleLabel } from './roles'

describe('roles', () => {
  it('lets the owner go anywhere', () => {
    expect(canVisit('owner', '/')).toBe(true)
    expect(canVisit('owner', '/reports')).toBe(true)
  })
  it('keeps the assistant to Workbench, Tasks and Pipeline', () => {
    for (const p of ['/workbench', '/priority', '/tasks', '/pipeline', '/bayway/pipeline']) expect(canVisit('assistant', p)).toBe(true)
    for (const p of ['/', '/reports', '/analytics', '/bayway/loans', '/settings', '/sync', '/rate', '/calendar', '/contacts', '/activity', '/mpg/pipeline', '/pipelines']) expect(canVisit('assistant', p)).toBe(false)
  })
  it('lets nobody in without a role', () => {
    expect(canVisit(null, '/workbench')).toBe(false)
  })
  it('sends each role home', () => {
    expect(homeFor('owner')).toBe('/')
    expect(homeFor('assistant')).toBe('/workbench')
  })
  it('narrows Quick Actions for the assistant only', () => {
    expect(ASSISTANT_QUICK_ACTIONS).toEqual(['note', 'followup', 'done'])
    expect(quickActionsFor('owner', undefined)).toBe(undefined)
    expect(quickActionsFor('owner', ['call'])).toEqual(['call'])
    expect(quickActionsFor('assistant', undefined)).toEqual(['note', 'followup', 'done'])
    expect(quickActionsFor('assistant', ['call', 'note'])).toEqual(['note'])
  })
  it('labels the role', () => {
    expect(roleLabel('owner')).toBe('Super Admin')
    expect(roleLabel('assistant')).toBe('Assistant')
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/lib/roles.test.js`
Expected: FAIL, cannot resolve `./roles`.

- [ ] **Step 3: Implement** (`src/lib/roles.js`)

```js
// Who sees what (spec 2026-11-03, section 3, "The assistant's login"). The
// database enforces it (RLS, crm-action); this only keeps the app from
// offering what the server would refuse.
const ASSISTANT_PATHS = /^\/(workbench|priority|tasks|pipeline|bayway\/pipeline)(\/|$)/

export const ASSISTANT_QUICK_ACTIONS = ['note', 'followup', 'done']

export function canVisit(role, path) {
  if (role === 'owner') return true
  if (role === 'assistant') return ASSISTANT_PATHS.test(path)
  return false
}

export const homeFor = (role) => (role === 'assistant' ? '/workbench' : '/')

// QuickActions' `only` list for this role (undefined = every action).
export function quickActionsFor(role, only) {
  if (role !== 'assistant') return only
  return (only || ASSISTANT_QUICK_ACTIONS).filter((a) => ASSISTANT_QUICK_ACTIONS.includes(a))
}

export const roleLabel = (role) => (role === 'assistant' ? 'Assistant' : 'Super Admin')
```

- [ ] **Step 4: Run them to make sure they pass**

Run: `npx vitest run src/lib/roles.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/roles.js src/lib/roles.test.js
git commit -m "feat: pure role rules for the assistant login"
```

---

### Task 9: Load the role, pin the book, guard routes, nav

**Files:**
- Modify: `src/context/AuthContext.jsx`
- Modify: `src/context/BusinessContext.jsx`
- Modify: `src/App.jsx`
- Modify: `src/components/Sidebar.jsx`
- Modify: `src/components/Layout.jsx`
- Test: `src/components/Sidebar.render.test.jsx` (extend) and the new `src/components/Roles.render.test.jsx` (Task 10 adds more to it)

- [ ] **Step 1: AuthContext loads the role.** Replace `src/context/AuthContext.jsx` with:

```jsx
import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, isDemoMode } from '../lib/supabase'

const AuthContext = createContext(null)
const NO_ROLE = { role: null, books: [], name: null, error: null }

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(!isDemoMode)
  // user_roles row for the signed-in user (assistant login). Demo mode is the owner.
  const [access, setAccess] = useState(isDemoMode ? { role: 'owner', books: ['bay', 'mpg'], name: null, error: null } : NO_ROLE)
  const [roleLoading, setRoleLoading] = useState(!isDemoMode)

  useEffect(() => {
    if (isDemoMode) return
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const uid = session?.user?.id || null
  useEffect(() => {
    if (isDemoMode) return undefined
    if (!uid) {
      setAccess(NO_ROLE)
      setRoleLoading(false)
      return undefined
    }
    let live = true
    setRoleLoading(true)
    Promise.resolve(supabase.from('user_roles').select('role, books, name').eq('user_id', uid).maybeSingle()).then(
      ({ data, error }) => {
        if (!live) return
        setAccess({ role: data?.role ?? null, books: data?.books ?? [], name: data?.name ?? null, error: error?.message ?? null })
        setRoleLoading(false)
      },
      (e) => {
        if (!live) return
        setAccess({ ...NO_ROLE, error: String(e?.message || e) })
        setRoleLoading(false)
      },
    )
    return () => {
      live = false
    }
  }, [uid])

  const signIn = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return error
  }

  const signOut = async () => {
    if (!isDemoMode) await supabase.auth.signOut()
  }

  const value = {
    session,
    loading: loading || (Boolean(session) && roleLoading),
    isDemoMode,
    isAuthed: isDemoMode || Boolean(session),
    role: access.role,
    books: access.books,
    userName: access.name,
    roleError: access.error,
    signIn,
    signOut,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
```

- [ ] **Step 2: BusinessContext pins the assistant to Bayway.** In `src/context/BusinessContext.jsx`, add `import { useAuth } from './AuthContext'` and replace the body of `BusinessProvider` up to the `matches` line with:

```jsx
export function BusinessProvider({ children }) {
  const { role } = useAuth() || {}
  const [picked, setPicked] = useState(() => localStorage.getItem('biz-filter') || 'all')
  // The assistant login is Bayway only: the switch is hidden and fixed.
  const biz = role === 'assistant' ? 'bay' : picked
  const setBiz = role === 'assistant' ? () => {} : setPicked

  useEffect(() => {
    if (role !== 'assistant') localStorage.setItem('biz-filter', biz)
    // Drives the --accent CSS variable swap for single-business theming.
    if (biz === 'all') {
      document.documentElement.removeAttribute('data-biz')
    } else {
      document.documentElement.setAttribute('data-biz', biz)
    }
  }, [biz, role])
```

(`useAuth() || {}` keeps existing tests that render `BusinessProvider` without an `AuthProvider` working.)

- [ ] **Step 3: Route guard and No-access screen.** In `src/App.jsx`: change the router import to `import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'`, add `import { canVisit, homeFor } from './lib/roles'`, and replace `Protected` with:

```jsx
function Protected({ children }) {
  const { isAuthed, loading, role, roleError, signOut } = useAuth()
  const { pathname } = useLocation()
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted">
        Loading…
      </div>
    )
  }
  if (!isAuthed) return <Navigate to="/login" replace />
  // Signed in but not in user_roles (or the lookup failed): no data anyway (RLS).
  if (!role) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted">
        <p className="text-[15px] font-semibold text-[color:var(--text)]">This login has no access to the OS yet.</p>
        {roleError && <p>Couldn't check access: {roleError}</p>}
        <button type="button" onClick={signOut} className="rounded-[10px] border border-line2 px-3 py-1.5 font-semibold">
          Sign out
        </button>
      </div>
    )
  }
  if (!canVisit(role, pathname)) return <Navigate to={homeFor(role)} replace />
  return children
}
```

- [ ] **Step 4: Sidebar by role.** In `src/components/Sidebar.jsx`:
  - add `import { canVisit, roleLabel } from '../lib/roles'`;
  - in `Sidebar`, change `const { signOut, isDemoMode } = useAuth()` to `const { signOut, isDemoMode, role, userName, session } = useAuth()`;
  - before `return`, add:

```jsx
  // The assistant sees Workbench, Tasks and Pipeline only.
  const groups = LINKS.map((g) => ({ ...g, items: g.items.filter((it) => canVisit(role, it.to)) })).filter((g) => g.items.length)
  const shownName = userName || (role === 'owner' || isDemoMode ? 'Chandler Atkinson' : session?.user?.email || 'Signed in')
  const initials = shownName.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
```

  - change `{LINKS.map(({ group, items }) => (` to `{groups.map(({ group, items }) => (`;
  - replace the hard-coded `CA` with `{initials}`, `Chandler Atkinson` with `{shownName}`, and `Super Admin` with `{roleLabel(role)}`.

- [ ] **Step 5: Layout by role.** In `src/components/Layout.jsx`:
  - add `import { canVisit } from '../lib/roles'`;
  - in `MobileBar` and `TopBar`, add `const { role } = useAuth()` and render the `BusinessFilter` wrapper only when `role !== 'assistant'` (wrap each `<div className="w-[164px] flex-none">…</div>` and `<div className="w-[248px]">…</div>` in `{role !== 'assistant' && (...)}`);
  - in `BottomNav`, add `const { role } = useAuth()`, and after building `items` add `const shown = items.filter((it) => canVisit(role, it.to))`; render `shown.map(...)` instead of `items.map(...)` and change the grid class `grid-cols-5` to use an inline style `style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }}` (remove `grid-cols-5` from the className).

- [ ] **Step 6: Tests.** Read `src/components/Sidebar.render.test.jsx` to see how it mounts the sidebar and mocks `AuthContext`/`supabase`. Add a test that mounts it with an auth value of `{ role: 'assistant', userName: 'Shelby Atkinson', signOut() {}, isDemoMode: false, session: null }` and asserts the nav link texts are exactly `['Workbench', 'Tasks', 'Pipeline']`, the footer shows `Shelby Atkinson` and `Assistant`, and there is no `Overview`, `Reports`, `Loans` or `Settings` link. Add a second test with `role: 'owner'` asserting `Overview`, `Reports` and `Settings` are present. If the existing test renders the real `AuthProvider`, mock `../context/AuthContext` with `vi.mock` returning `{ useAuth: () => authValue }` instead.

Run: `npx vitest run src/components/Sidebar.render.test.jsx`
Expected: PASS.

- [ ] **Step 7: Full suite, then commit**

Run: `npm test`
Expected: PASS apart from the known pre-existing failures. Tests that render `App`, `Layout` or pages with a mocked supabase now also hit `user_roles`: if one fails because its mock has no `user_roles` answer, make that mock return `{ data: { role: 'owner', books: ['bay', 'mpg'], name: null }, error: null }` for `user_roles`.

```bash
git add src/context/AuthContext.jsx src/context/BusinessContext.jsx src/App.jsx src/components/Sidebar.jsx src/components/Layout.jsx src/components/Sidebar.render.test.jsx
git commit -m "feat: role-aware routes and nav; assistant is pinned to Bayway"
```

---

### Task 10: Hide actions the assistant can't take

**Files:**
- Modify: `src/components/QuickActions.jsx` (line ~741)
- Modify: `src/components/QuickAddMenu.jsx`, `src/components/NewMenu.jsx`
- Modify: `src/components/WorkLane.jsx`
- Modify: `src/components/PageHeader.jsx`
- Modify: `src/pages/Pipeline.jsx`
- Modify: `src/pages/Workbench.jsx`
- Modify: `src/components/PersonSheet.jsx` (line ~279)
- Create: `src/components/Roles.render.test.jsx`

- [ ] **Step 1: Write the failing render test** (`src/components/Roles.render.test.jsx`). Mirror the mocking in `src/components/QuickActions.render.test.jsx` (its `query(table)` fake and `vi.mock('../lib/supabase', ...)`), and add an auth mock whose role a test can flip:

```jsx
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

let authValue = { role: 'assistant', isDemoMode: false }
vi.mock('../context/AuthContext', () => ({ useAuth: () => authValue }))

const flags = { bay: true, mpg: true }
function query(table) {
  const q = {}
  for (const m of ['select', 'eq', 'neq', 'in', 'gte', 'lt', 'order', 'limit', 'range']) q[m] = () => q
  q.maybeSingle = async () => ({ data: table === 'settings' ? { value: { ...flags } } : null, error: null })
  q.then = (resolve) => resolve({ data: [], error: null })
  return q
}
vi.mock('../lib/supabase', () => ({
  isDemoMode: false,
  supabase: { from: (t) => query(t), functions: { invoke: async () => ({ data: { status: 'ok' }, error: null }) } },
}))

const { default: QuickActions } = await import('./QuickActions')
const { resetWritebackFlags } = await import('../lib/writeback')
const { default: QuickAddMenu } = await import('./QuickAddMenu')

async function mount(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => createRoot(host).render(el))
  return host
}
const labels = (host) => [...host.querySelectorAll('[aria-label]')].map((b) => b.getAttribute('aria-label'))

describe('assistant gating', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    resetWritebackFlags()
  })
  it('QuickActions offers the assistant note, follow-up and complete only', async () => {
    authValue = { role: 'assistant', isDemoMode: false }
    const host = await mount(<QuickActions businessId="bay" contactId="c1" contactName="Pat" stage="Contacted/Working" task={{ id: 't1' }} />)
    const l = labels(host)
    expect(l).toContain('Add note')
    expect(l).toContain('Schedule follow-up')
    expect(l).toContain('Complete task')
    expect(l).not.toContain('Move stage')
    expect(l).not.toContain('Push task')
    expect(l.some((x) => /log call/i.test(x))).toBe(false)
  })
  it('QuickActions still offers the owner everything', async () => {
    authValue = { role: 'owner', isDemoMode: false }
    const host = await mount(<QuickActions businessId="bay" contactId="c1" contactName="Pat" stage="Contacted/Working" task={{ id: 't1' }} />)
    expect(labels(host)).toContain('Move stage')
  })
  it('QuickAddMenu hides kinds it is told to', async () => {
    const host = await mount(<QuickAddMenu onPick={() => {}} hide={['call']} />)
    await act(async () => host.querySelector('button[aria-haspopup="menu"]').click())
    expect(host.textContent).not.toContain('Log call')
    expect(host.textContent).toContain('Note')
  })
})
```

Check the Log call button's real `aria-label` in `QuickActions.jsx` (around line 804) and use it in the first test's last assertion if it isn't matched by `/log call/i`.

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/components/Roles.render.test.jsx`
Expected: FAIL (assistant sees Move stage; QuickAddMenu ignores `hide`).

- [ ] **Step 3: QuickActions.** In `src/components/QuickActions.jsx` add `import { useAuth } from '../context/AuthContext'` and `import { quickActionsFor } from '../lib/roles'`. In `QuickActions`, rename the prop `only` to `onlyProp` in the destructuring (`... onFailed, only: onlyProp, autoOpen = null, ...`) and add as the first lines of the body:

```jsx
  const { role } = useAuth() || {}
  const only = quickActionsFor(role, onlyProp)
```

The existing `const show = (name) => !only || only.includes(name)` then does the rest. `autoOpen` for a kind the assistant can't use (e.g. `'call'` from + New) is blocked in Step 4; also guard it here by changing `useState(autoOpen)` to `useState(autoOpen && (!only || only.includes(autoOpen)) ? autoOpen : null)` — move that `useState` line below the two new lines.

- [ ] **Step 4: + New.** In `src/components/QuickAddMenu.jsx`, add a `hide = []` prop and change `const items = showLead ? [NEW_LEAD, ...QUICK_ADD] : QUICK_ADD` to:

```jsx
  const items = (showLead ? [NEW_LEAD, ...QUICK_ADD] : QUICK_ADD).filter((i) => !hide.includes(i.kind))
```

In `src/components/NewMenu.jsx`, add `import { useAuth } from '../context/AuthContext'`, read `const { role } = useAuth() || {}`, change `leadBooks` to `const leadBooks = role === 'assistant' ? [] : ['bay', 'mpg'].filter(...)` (keep the existing filter), and pass `hide={role === 'assistant' ? ['call'] : []}` to `QuickAddMenu`.

- [ ] **Step 5: Work lane stage moves.** In `src/components/WorkLane.jsx` two paths reach `set_stage`: finishing an `estimate` item (opens the Estimate/Application Sent picker, `sent()` at line ~324) and Review complete in `UpdateSheet` (`onReview` at line ~404). Add `import { useAuth } from '../context/AuthContext'`, then:
  - in `WorkLane`, add `const { role } = useAuth() || {}` and `const assistant = role === 'assistant'`;
  - line ~335: `canDone={it.kind === 'custom' || it.kind === 'disclosed' || ((it.kind === 'estimate' || it.kind === 'mpg_task') && flags[it.book] === true && !assistant)}`;
  - line ~403: `canReview={flags.bay === true && !assistant}`;
  - in `UpdateSheet`, add `const { role } = useAuth() || {}` and change the line ~192 message to `{!canReview && <div className="mt-2 text-[12px] text-[color:var(--neg-ink)]">{role === 'assistant' ? 'Chandler sends review outcomes to FollowUpBoss.' : "Write-back to FollowUpBoss is off, so the outcome can't be sent."}</div>}`.

  Leave status, waiting-on, check-back and notes alone: those write `work_items`, which she may.

- [ ] **Step 6: Sync check.** In `src/components/PageHeader.jsx`, add `import { useAuth } from '../context/AuthContext'`, and at the top of `SyncDot` add `const { role } = useAuth() || {}`; change `if (isDemoMode || !latest) return null` to `if (isDemoMode || !latest || role === 'assistant') return null`. (Keep the hooks above the early return.)

- [ ] **Step 7: Pipeline.** In `src/pages/Pipeline.jsx`:
  - add `import { useAuth } from '../context/AuthContext'`;
  - in the page component that defines `canDrag` (line ~797), add `const { role } = useAuth() || {}` and change it to `const canDrag = biz === 'bay' && !isDemoMode && flags.bay === true && role !== 'assistant'`;
  - in the component that renders the Sort `<select>` (`SORTS.map` at line ~132), add `const { role } = useAuth() || {}` and replace `SORTS.map(` with `SORTS.filter((o) => o.id !== 'pays_first' || role !== 'assistant').map(`.

- [ ] **Step 8: Workbench.** In `src/pages/Workbench.jsx`, add `import { useAuth } from '../context/AuthContext'`; in `Workbench`, add `const { role } = useAuth() || {}` and change:

```jsx
  const showCalls = !mobile || lane === 'calls'
  const showWork = !mobile || lane === 'work'
```

to:

```jsx
  // The assistant doesn't make calls from the OS: Work lane only.
  const assistant = role === 'assistant'
  const showCalls = !assistant && (!mobile || lane === 'calls')
  const showWork = assistant || !mobile || lane === 'work'
```

and wrap the mobile lane switch (the `{mobile && (` block at line ~108 holding the Calls / Work buttons) as `{mobile && !assistant && (`.

- [ ] **Step 9: Person sheet temperature.** In `src/components/PersonSheet.jsx`, add `import { useAuth } from '../context/AuthContext'` and `import { TEMP_LABEL } from '../lib/leadRatings'`, read `const { role } = useAuth() || {}` in the component that renders line ~279, and replace the `<TemperaturePicker ... />` line with:

```jsx
          {role === 'assistant' ? (
            rating?.temperature ? (
              <div data-temp-readonly className="text-[12.5px] text-muted">
                Temperature: <span className="font-semibold text-[color:var(--text)]">{TEMP_LABEL[rating.temperature]}</span>
              </div>
            ) : null
          ) : (
            <TemperaturePicker key={`${rating?.temperature || 'none'}|${rating?.est_amount ?? ''}|${rating?.close_month ?? ''}`} contactId={person.id} businessId={biz} rating={rating} />
          )}
```

- [ ] **Step 10: Run the tests**

Run: `npx vitest run src/components/Roles.render.test.jsx src/components/QuickActions.render.test.jsx src/components/QuickAddMenu.render.test.jsx src/pages/Pipeline.render.test.jsx src/pages/Workbench.render.test.jsx src/components/PersonSheet.render.test.jsx`
Expected: PASS. Existing tests don't mock `AuthContext`; `useAuth() || {}` makes role `undefined` there, which behaves as the owner. If one of them renders inside a real `AuthProvider` and now waits on `user_roles`, give its supabase mock a `user_roles` answer of `{ role: 'owner', books: ['bay','mpg'], name: null }`.

- [ ] **Step 11: Full suite, then commit**

Run: `npm test`

```bash
git add src/components/QuickActions.jsx src/components/QuickAddMenu.jsx src/components/NewMenu.jsx src/components/WorkLane.jsx src/components/PageHeader.jsx src/pages/Pipeline.jsx src/pages/Workbench.jsx src/components/PersonSheet.jsx src/components/Roles.render.test.jsx
git commit -m "feat: assistant sees notes, follow-ups and complete only; no drag, dialer, money or sync"
```

---

### Task 11: "by assistant" on notes and tasks

**Files:**
- Modify: `src/lib/contactNotes.js`
- Modify: `src/components/PersonSheet.jsx` (notes list and the open-tasks list)
- Test: `src/lib/contactNotes.test.js`

- [ ] **Step 1: Write the failing test** (append to `src/lib/contactNotes.test.js`, importing `noteRows`)

```js
describe('noteRows by assistant', () => {
  it('marks notes whose activity id the assistant wrote', () => {
    const acts = [
      { id: 'a1', occurred_at: '2026-11-04T15:00:00Z', raw: { body: 'Sent doc list' } },
      { id: 'a2', occurred_at: '2026-11-04T14:00:00Z', raw: { body: 'Called' } },
    ]
    const rows = noteRows(acts, null, new Set(['a1']))
    expect(rows.find((r) => r.id === 'a1').byAssistant).toBe(true)
    expect(rows.find((r) => r.id === 'a2').byAssistant).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/lib/contactNotes.test.js`
Expected: FAIL (`byAssistant` undefined).

- [ ] **Step 3: Implement.** In `src/lib/contactNotes.js`, change `noteRows`:

```js
// firstNote: the lead form's note, pinned above the list, so left out of it.
// assistantIds: activity ids the assistant wrote (v_assistant_writes).
export function noteRows(activities, firstNote = null, assistantIds = new Set()) {
  return (activities || [])
    .map((a) => {
      const raw = a.raw || {}
      const text = plainText(raw.body ?? raw.Note_Content ?? a.notes)
      const author = (typeof raw.createdBy === 'string' ? raw.createdBy : raw.Created_By?.name) || null
      return { id: a.id, at: a.occurred_at, title: raw.Note_Title || raw.subject || null, text, author, byAssistant: assistantIds.has(a.id) }
    })
    .filter((n) => n.text && !(firstNote && same(n.text, firstNote)))
    .sort((a, b) => new Date(b.at) - new Date(a.at))
}
```

In `useContactNotes`'s `load`, add a third query to the `Promise.all`:

```js
      supabase.from('v_assistant_writes').select('activity_id, task_id').eq('contact_id', contactId),
```

name it `writes` in the destructuring, build `const assistantIds = new Set((writes.data || []).map((w) => w.activity_id).filter(Boolean))` and `const assistantTaskIds = new Set((writes.data || []).map((w) => w.task_id).filter(Boolean))`, pass `assistantIds` as the third argument wherever `noteRows(` is called in that hook, and add `assistantTaskIds` to the state the hook returns (initial state `assistantTaskIds: new Set()`). A failed `v_assistant_writes` read (`writes.error`) leaves both sets empty: labels are a nicety, never a reason to hide notes.

- [ ] **Step 4: Show it.** In `src/components/PersonSheet.jsx`, where each note renders its `author`, append ` · by assistant` when `n.byAssistant` (find the JSX that prints `author`; render `{n.byAssistant && <span data-by-assistant> · by assistant</span>}` right after it). Where the sheet lists open tasks from `useContactCard` (`v_tasks` rows with `id`), render the same span after a task's title when the notes hook's `assistantTaskIds.has(task.id)`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/contactNotes.test.js src/components/PersonSheet.render.test.jsx`
Expected: PASS. If the PersonSheet test's supabase fake has no answer for `v_assistant_writes`, its default empty `data: []` is enough.

- [ ] **Step 6: Commit**

```bash
git add src/lib/contactNotes.js src/lib/contactNotes.test.js src/components/PersonSheet.jsx
git commit -m "feat: mark notes and tasks the assistant wrote"
```

---

### Task 12: Setup doc and spec status

**Files:**
- Create: `docs/assistant-login-setup.md`
- Modify: `docs/superpowers/specs/2026-11-03-temperature-forecast-briefings-design.md` (Status line)

- [ ] **Step 1: Write `docs/assistant-login-setup.md`**

````markdown
# Assistant login setup (Shelby)

Spec: docs/superpowers/specs/2026-11-03-temperature-forecast-briefings-design.md, section 3.
Plan: docs/superpowers/plans/2026-11-04-assistant-login-briefing.md.

## 1. Invite her (Chandler, Supabase dashboard)

Authentication > Users > Invite user > `shelby@baywayhtx.com`. Public sign-up stays off.
She sets her password from the invite email, then signs in at https://atkinson-sales-os.vercel.app.
Until step 2 she sees "This login has no access to the OS yet." and RLS returns nothing.

## 2. Give her the assistant role

```sql
insert into public.user_roles (user_id, role, books, name)
select id, 'assistant', array['bay'], 'Shelby Atkinson'
from auth.users where email = 'shelby@baywayhtx.com'
on conflict (user_id) do update set role = excluded.role, books = excluded.books, name = excluded.name;
```

## 3. What she can do

- Sees Workbench (Work lane), Tasks and Pipeline, Bayway only, and the Person sheet.
- Adds notes, schedules follow-ups and completes tasks. They reach FUB through Chandler's API key, so FUB shows them as his; the OS shows "by assistant".
- Cannot log calls, move stages, rate temperature, create leads or push tasks (crm-action refuses and records it).
- Never sees MPG, loans, commission, forecast, Reports, Settings or Sync Status.

## 4. Her briefing

`briefings.assistant_enabled` turns it on:

```sql
update public.settings set value = value || '{"assistant_enabled": true}'::jsonb where key = 'briefings';
```

Test send (to Chandler) with the BRIEFING_TEST_KEY secret and header `x-briefing-who: assistant`.

## Removing her

```sql
delete from public.user_roles where user_id = (select id from auth.users where email = 'shelby@baywayhtx.com');
```
Then delete the user in the dashboard if she should not sign in at all.
````

- [ ] **Step 2: Update the spec status line.** Replace the `**Status:**` line in the spec with:

```markdown
**Status:** Sections 1-2 live (PR #83). Chandler's briefing live (PR #85). Section 3 assistant login and briefing built on feat/assistant-login (plan 2026-11-04-assistant-login-briefing.md).
```

- [ ] **Step 3: Commit**

```bash
git add docs/assistant-login-setup.md docs/superpowers/specs/2026-11-03-temperature-forecast-briefings-design.md docs/superpowers/plans/2026-11-04-assistant-login-briefing.md
git commit -m "docs: assistant login setup and step 3 plan"
```

---

## Rollout (each step needs Chandler's OK first)

Order matters: the migration before the client (the new client reads `user_roles` and shows "no access" without it), and before `daily-briefing` (it reads `user_roles`).

- **R1. Push and open the PR** (`feat/assistant-login` into `main`). Don't merge yet.
- **R2. Migration dry run:** `npx supabase db push --dry-run` lists only `0056_assistant_role.sql`.
- **R3. Apply:** `npx supabase db push`. Then check Chandler still reads everything: `npx supabase db query --linked "select role, books from public.user_roles"` shows one owner row.
- **R4. RLS test:** `npx supabase db query --linked -f supabase/tests/assistant_rls.sql` prints both "passed" notices (it rolls back).
- **R5. Deploy functions:** `npx supabase functions deploy crm-action` (with JWT verification, as today) and `npx supabase functions deploy daily-briefing --no-verify-jwt`.
- **R6. Test-send Shelby's briefing to Chandler:** POST the function with headers `x-briefing-test: <key>` and `x-briefing-who: assistant` (Chandler runs it with his key, as with step 2). Then the same without `x-briefing-who` to confirm his own still works.
- **R7. Merge the PR**; Vercel deploys. Chandler signs in and checks the OS looks as before.
- **R8. Invite Shelby** (docs/assistant-login-setup.md steps 1-2). She signs in and sees Workbench, Tasks and Pipeline, Bayway only.
- **R9. Turn on her briefing** (setup doc step 4) when Chandler says so.
