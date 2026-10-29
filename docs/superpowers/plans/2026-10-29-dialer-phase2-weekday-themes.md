# Dialer phase 2: weekday theme lists — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Calls lane gets the day's theme list (Mon new realtors, Tue loan status, Wed past clients, Thu pre-approved, Fri top partners) with a Mon–Fri strip, in the spec's order around Up Next, dialed with the phase 1 dialer.

**Architecture:** Migration `0050` widens `v_dial_contacts` to the theme people and appends `person_stage` and `pre_approved_at`. Pure `src/lib/dialThemes.js` decides who's on which theme and when they're due; `ThemeList` renders the strip and list; `Priority` learns a `buckets` filter so Up Next's sections can sit before and after the dial lists. The dialer takes any item list.

**Tech Stack:** React 18 + Vite + Tailwind, Supabase views, Vitest + jsdom.

Spec: `docs/superpowers/specs/2026-10-29-dialer-cadence-design.md` (Weekday themes, The daily list). Additions over the spec's phase split, agreed in the build: Tuesday ships now as a borrower-only list (phase 3 adds the agents); the theme cap is a constant (15) for now, not `settings.dial_cadence`.

---

## Files

| File | Responsibility |
|---|---|
| Create `supabase/migrations/0050_dial_themes.sql` | widen `v_dial_contacts` |
| Create `src/lib/dialThemes.js` + `.test.js` | theme membership, due dates, day lists, week counts |
| Modify `src/lib/dialTexts.js` + test | Bayway theme texts |
| Create `src/components/ThemeList.jsx` + `.render.test.jsx` | strip + list |
| Modify `src/components/Dialer.jsx` + test | lead-only prompts |
| Modify `src/pages/Priority.jsx` + test | `buckets` filter |
| Modify `src/pages/Workbench.jsx` | lane order, theme list, one dialer for both lists |

---

### Task 1: Migration — widen `v_dial_contacts`

**Files:** Create `supabase/migrations/0050_dial_themes.sql`

- [ ] **Step 1: Write it** (same columns as 0049 in the same order, two appended; WHERE widened)

```sql
-- Dial list phase 2: the weekday theme people join v_dial_contacts
-- (docs/superpowers/specs/2026-10-29-dialer-cadence-design.md, Weekday themes).
-- Same columns as 0049, plus person_stage and pre_approved_at at the end.
--   Mon new realtors   FUB stage Realtors, created in the last 90 days
--   Tue loan status    Disclosed, or tagged under contract (still on the board)
--   Wed past clients   FUB stage Closed / Past Client
--   Thu pre-approved   tagged Pre-Approved, on the board before Disclosed
--   Fri top partners   tagged Top Partner
create or replace view public.v_dial_contacts
with (security_invoker = on) as
select * from (
  select
    c.id,
    c.business_id,
    c.name,
    c.company,
    c.phone,
    c.email,
    case c.business_id
      when 'bay' then 'https://baywayhtx.followupboss.com/2/people/view/' || c.external_id
      else 'https://crm.zoho.com/crm/tab/Leads/' || c.external_id
    end as crm_profile_url,
    case c.business_id
      when 'bay' then public.derive_stage(c.raw, c.person_stage, c.business_id)
      else c.person_stage
    end as stage,
    c.stage_since,
    public.try_timestamptz(case c.business_id when 'bay' then c.raw->>'created' else c.raw->>'Created_Time' end)
      as crm_created_at,
    case when c.business_id = 'bay' and jsonb_typeof(c.raw->'tags') = 'array'
      then array(select lower(trim(t)) from jsonb_array_elements_text(c.raw->'tags') as t)
      else '{}'::text[]
    end as tags,
    case c.business_id when 'bay' then c.raw->>'source' else c.raw->>'Lead_Source' end as lead_source,
    coalesce(oc.calls, 0) as outbound_calls,
    coalesce(oc.calls_since_stage, 0) as outbound_calls_since_stage,
    oc.first_at as first_outbound_call_at,
    oc.last_at as last_outbound_call_at,
    oc.connected_at,
    c.person_stage,
    pa.at as pre_approved_at
  from contacts c
  left join lateral (
    select count(*)::int as calls,
           (count(*) filter (where c.stage_since is null or a.occurred_at >= c.stage_since))::int as calls_since_stage,
           min(a.occurred_at) as first_at,
           max(a.occurred_at) as last_at,
           max(a.occurred_at) filter (where public.call_connected(a.raw)) as connected_at
    from activities a
    where a.contact_id = c.id
      and a.type = 'call'
      and a.direction = 'outbound'
  ) oc on true
  left join lateral (
    -- When the OS tagged Pre-Approved (Workbench Review complete).
    select max(ca.created_at) as at
    from crm_actions ca
    where ca.contact_id = c.id
      and ca.action = 'set_stage'
      and ca.request->'payload'->>'target' = 'pre_approved'
      and ca.status in ('ok', 'partial')
  ) pa on true
) s
where (business_id = 'bay' and stage in ('New Lead', 'Attempted', 'Nurture / Credit Repair'))
   or (business_id = 'mpg' and stage in ('Not Contacted', 'Open', 'Attempted to Contact'))
   or (business_id = 'bay' and person_stage = 'Realtors' and crm_created_at >= now() - interval '90 days')
   or (business_id = 'bay' and person_stage in ('Closed', 'Past Client'))
   or (business_id = 'bay' and 'top partner' = any (tags))
   or (business_id = 'bay' and stage is not null and stage not in ('Lost', 'Nurture / Credit Repair')
       and (stage = 'Disclosed' or 'under contract' = any (tags) or 'pre-approved' = any (tags)));
```

- [ ] **Step 2: Dry run** (temporary 0044 copy, as in phase 1): expect `• 0050_dial_themes.sql`. Apply after Chandler's OK (Task 7).
- [ ] **Step 3: Commit** `feat: theme people in v_dial_contacts`

---

### Task 2: Theme texts

**Files:** Modify `src/lib/dialTexts.js`, `src/lib/dialTexts.test.js`

- [ ] **Step 1: Test** — add to `dialTexts.test.js`:

```js
describe('theme texts', () => {
  it('has a Bayway check-in for every weekday theme', () => {
    for (const k of ['new_realtor', 'loan_status', 'past_client', 'pre_approved', 'top_partner']) expect(TEXTS.bay[k]).toBeTruthy()
    expect(textFor('bay', 'pre_approved', 'Ana Ruiz')).toBe('Hi Ana, checking in on the house hunt. Found anything you like yet?')
  })
})
```

- [ ] **Step 2: Implement** — add to `TEXTS.bay`:

```js
    new_realtor: 'Hey {first}, Chandler with Bayway. Good to connect. Anything I can help your buyers with this week?',
    loan_status: 'Hi {first}, Chandler here with a quick update on your loan. Got a minute to talk today?',
    past_client: 'Hey {first}, Chandler with Bayway. Hope the house is treating you well. Anything I can help with?',
    pre_approved: 'Hi {first}, checking in on the house hunt. Found anything you like yet?',
    top_partner: 'Hey {first}, Chandler here. Just checking in, anything I can help with on your deals?',
```
and extend the header comment with the theme keys.

- [ ] **Step 3: Run** `npx vitest run src/lib/dialTexts.test.js` — PASS. **Commit** `feat: theme check-in texts`

---

### Task 3: Theme rules (`dialThemes.js`)

**Files:** Create `src/lib/dialThemes.js`, `src/lib/dialThemes.test.js`

- [ ] **Step 1: Test**

```js
import { describe, it, expect } from 'vitest'
import { THEMES, themeOf, themeItem, buildThemeList, themeForDay } from './dialThemes'

// 2026-10-26 is a Monday.
const at = (d, h = 9) => new Date(2026, 9, d, h).getTime()
const iso = (t) => new Date(t).toISOString()
const DAY = 86_400_000
const person = (o = {}) => ({ id: 'p', business_id: 'bay', name: 'Ana Ruiz', phone: '1', stage: null, person_stage: 'Lead', tags: [], crm_created_at: iso(at(1)), stage_since: null, outbound_calls: 0, last_outbound_call_at: null, pre_approved_at: null, ...o })

describe('themeOf', () => {
  it('puts each person on one theme, top partner first', () => {
    expect(themeOf(person({ person_stage: 'Realtors', crm_created_at: iso(at(20)) }), at(28))).toBe('new_realtor')
    expect(themeOf(person({ person_stage: 'Realtors', crm_created_at: iso(at(20) - 120 * DAY) }), at(28))).toBe(null)
    expect(themeOf(person({ person_stage: 'Realtors', tags: ['top partner'] }), at(28))).toBe('top_partner')
    expect(themeOf(person({ stage: 'Disclosed', tags: ['disclosed', 'under contract'] }), at(28))).toBe('loan_status')
    expect(themeOf(person({ stage: 'Application Received', tags: ['under contract'] }), at(28))).toBe('loan_status')
    expect(themeOf(person({ stage: 'Application Received', tags: ['pre-approved'] }), at(28))).toBe('pre_approved')
    expect(themeOf(person({ person_stage: 'Closed' }), at(28))).toBe('past_client')
    expect(themeOf(person({ stage: 'Attempted' }), at(28))).toBe(null)
    expect(themeOf(person({ business_id: 'mpg', tags: ['top partner'] }), at(28))).toBe(null)
  })
})

describe('themeItem rhythm', () => {
  const now = at(28, 12)
  it('new realtor: intro call, then 7, 14, then 30 days apart', () => {
    const r = person({ person_stage: 'Realtors', crm_created_at: iso(at(20)) })
    expect(themeItem(r, now)).toMatchObject({ kind: 'new_realtor', dueAt: at(20), label: 'New realtor · intro call', hint: 'never called', textKey: 'new_realtor' })
    expect(themeItem({ ...r, outbound_calls: 1, last_outbound_call_at: iso(at(21)) }, now)).toMatchObject({ dueAt: at(21) + 7 * DAY, label: 'New realtor · call 2' })
    expect(themeItem({ ...r, outbound_calls: 2, last_outbound_call_at: iso(at(21)) }, now).dueAt).toBe(at(21) + 14 * DAY)
    expect(themeItem({ ...r, outbound_calls: 5, last_outbound_call_at: iso(at(21)) }, now).dueAt).toBe(at(21) + 30 * DAY)
  })
  it('loan status weekly, past client every 90 days, pre-approved weekly, top partner every 14 days', () => {
    const last = { outbound_calls: 1, last_outbound_call_at: iso(at(20)) }
    expect(themeItem(person({ stage: 'Disclosed', ...last }), now)).toMatchObject({ kind: 'loan_status', dueAt: at(20) + 6 * DAY, label: 'Loan status update', hint: 'last call 8 days ago' })
    expect(themeItem(person({ person_stage: 'Closed', ...last }), now).dueAt).toBe(at(20) + 90 * DAY)
    expect(themeItem(person({ stage: 'Application Received', tags: ['pre-approved'], ...last }), now).dueAt).toBe(at(20) + 7 * DAY)
    expect(themeItem(person({ tags: ['top partner'], person_stage: 'Realtors', ...last }), now).dueAt).toBe(at(20) + 14 * DAY)
  })
  it('flags a pre-approval 60+ days old for a fresh letter', () => {
    const pa = person({ stage: 'Application Received', tags: ['pre-approved'], pre_approved_at: iso(at(28) - 64 * DAY) })
    expect(themeItem(pa, at(28, 12)).hint).toBe('never called · pre-approved 64 days, refresh letter')
    expect(themeItem({ ...pa, pre_approved_at: null, stage_since: iso(at(28) - 10 * DAY) }, at(28, 12)).hint).toBe('never called')
  })
})

describe('buildThemeList', () => {
  const rows = [
    person({ id: 'r1', person_stage: 'Realtors', crm_created_at: iso(at(20)) }),
    person({ id: 'r2', person_stage: 'Realtors', crm_created_at: iso(at(22)) }),
    person({ id: 'r3', person_stage: 'Realtors', crm_created_at: iso(at(22)), outbound_calls: 1, last_outbound_call_at: iso(at(26, 10)) }),
    person({ id: 'tp', person_stage: 'Realtors', tags: ['top partner'] }),
    person({ id: 'pc', person_stage: 'Closed' }),
  ]
  it("is today's theme, due people only, most overdue first", () => {
    const list = buildThemeList(rows, { now: at(26, 12) }) // Monday
    expect(list.theme.key).toBe('new_realtor')
    expect(list.items.map((i) => i.id)).toEqual(['r1', 'r2'])
  })
  it('caps the list and reports the total', () => {
    const many = Array.from({ length: 20 }, (_, i) => person({ id: `p${i}`, person_stage: 'Closed' }))
    const list = buildThemeList(many, { now: at(28, 12) }) // Wednesday
    expect(list.items).toHaveLength(15)
    expect(list.total).toBe(20)
  })
  it('previews another weekday as of that day, and counts every weekday', () => {
    const list = buildThemeList(rows, { now: at(26, 12), day: 5 })
    expect(list.theme.key).toBe('top_partner')
    expect(list.items.map((i) => i.id)).toEqual(['tp'])
    const counts = Object.fromEntries(list.week.map((w) => [w.key, w.count]))
    expect(counts).toEqual({ new_realtor: 2, loan_status: 0, past_client: 1, pre_approved: 0, top_partner: 1 })
    expect(list.week.find((w) => w.isToday).day).toBe(1)
  })
  it('has no theme on weekends and honors skips and the book filter', () => {
    expect(buildThemeList(rows, { now: new Date(2026, 9, 31, 12).getTime() }).theme).toBe(null)
    expect(buildThemeList(rows, { now: at(26, 12), skips: new Set(['r1']) }).items.map((i) => i.id)).toEqual(['r2'])
    expect(buildThemeList(rows, { now: at(26, 12), inBook: (b) => b === 'mpg' }).items).toEqual([])
  })
})

describe('themeForDay', () => {
  it('maps Monday..Friday', () => {
    expect(THEMES.map((t) => t.day)).toEqual([1, 2, 3, 4, 5])
    expect(themeForDay(3).key).toBe('past_client')
    expect(themeForDay(0)).toBe(null)
  })
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement**

```js
// The weekday theme lists (spec: Weekday themes). Pure: v_dial_contacts rows
// in, the day's due people out. Bayway only. Each person sits on one theme
// (top partner, loan status, pre-approved, new realtor, past client, first
// match wins) and is due once their rhythm has passed since their last
// outbound call; never called is due now. Someone not reached stays due and
// shows again on the same weekday next week.
const DAY = 86_400_000
export const THEME_CAP = 15
export const THEMES = [
  { day: 1, key: 'new_realtor', label: 'New realtors' },
  { day: 2, key: 'loan_status', label: 'Loan status' },
  { day: 3, key: 'past_client', label: 'Past clients' },
  { day: 4, key: 'pre_approved', label: 'Pre-approved' },
  { day: 5, key: 'top_partner', label: 'Top partners' },
]
const BY_KEY = Object.fromEntries(THEMES.map((t) => [t.key, t]))
// New realtors: call 2 a week after the intro, call 3 two weeks later, then monthly.
const REALTOR_GAPS = [7, 14, 30]
const GAP_DAYS = { loan_status: 6, past_client: 90, pre_approved: 7, top_partner: 14 }
const LABEL = { loan_status: 'Loan status update', past_client: 'Past client check-in', pre_approved: 'Pre-approval check-in', top_partner: 'Partner check-in' }
const NEW_REALTOR_DAYS = 90
const OFF_BOARD = new Set(['Lost', 'Nurture / Credit Repair'])

const ms = (iso) => (iso ? new Date(iso).getTime() : null)
const days = (from, now) => Math.floor((now - from) / DAY)

export const themeForDay = (weekday) => THEMES.find((t) => t.day === weekday) || null

// Which theme a person is on, or null.
export function themeOf(row, now = Date.now()) {
  if (row.business_id !== 'bay') return null
  const tags = row.tags || []
  if (tags.includes('top partner')) return 'top_partner'
  const onBoard = row.stage && !OFF_BOARD.has(row.stage)
  if (onBoard && (row.stage === 'Disclosed' || tags.includes('under contract'))) return 'loan_status'
  if (onBoard && tags.includes('pre-approved')) return 'pre_approved'
  const created = ms(row.crm_created_at)
  if (row.person_stage === 'Realtors' && created != null && now - created <= NEW_REALTOR_DAYS * DAY) return 'new_realtor'
  if (row.person_stage === 'Closed' || row.person_stage === 'Past Client') return 'past_client'
  return null
}

// A person -> their theme item (due date, label, hint), or null.
export function themeItem(row, now = Date.now()) {
  const kind = themeOf(row, now)
  if (!kind) return null
  const calls = row.outbound_calls || 0
  const last = ms(row.last_outbound_call_at)
  const base = { id: row.id, book: 'bay', row, calls, kind, theme: kind, step: null, textKey: kind }
  const lastHint = last == null ? 'never called' : `last call ${days(last, now)} days ago`
  if (kind === 'new_realtor') {
    const dueAt = calls === 0 || last == null ? ms(row.crm_created_at) : last + REALTOR_GAPS[Math.min(calls, REALTOR_GAPS.length) - 1] * DAY
    return { ...base, dueAt, label: calls === 0 ? 'New realtor · intro call' : `New realtor · call ${calls + 1}`, hint: lastHint }
  }
  let hint = lastHint
  if (kind === 'pre_approved') {
    const since = ms(row.pre_approved_at)
    const age = since == null ? null : days(since, now)
    if (age != null && age >= 60) hint = `${lastHint} · pre-approved ${age} days, refresh letter`
  }
  return { ...base, dueAt: last == null ? 0 : last + GAP_DAYS[kind] * DAY, label: LABEL[kind], hint }
}

const endOfDay = (t) => {
  const d = new Date(t)
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}

// The date of `weekday` (1-5) in now's Monday-Friday week.
function dateOfWeekday(now, weekday) {
  const d = new Date(now)
  const today = d.getDay() === 0 ? 7 : d.getDay()
  d.setDate(d.getDate() + (weekday - today))
  return d.getTime()
}

// rows -> { theme, items (capped), total, week }. day: preview another weekday
// (1-5), evaluated as of that day this week; default today. week: each
// weekday's theme with how many people are due by then.
export function buildThemeList(rows, { now = Date.now(), day = null, skips = new Set(), inBook = () => true, cap = THEME_CAP } = {}) {
  const items = inBook('bay') ? (rows || []).map((r) => themeItem(r, now)).filter((i) => i && !skips.has(i.id)) : []
  const dueBy = (key, t) => items.filter((i) => i.kind === key && i.dueAt <= endOfDay(t))
  const todayDay = new Date(now).getDay()
  const week = THEMES.map((t) => ({ ...t, count: dueBy(t.key, dateOfWeekday(now, t.day)).length, isToday: t.day === todayDay }))
  const theme = themeForDay(day ?? todayDay)
  if (!theme) return { theme: null, items: [], total: 0, week }
  const due = dueBy(theme.key, day == null ? now : dateOfWeekday(now, day)).sort((a, b) => a.dueAt - b.dueAt)
  return { theme, items: due.slice(0, cap), total: due.length, week }
}

export const themeLabel = (key) => BY_KEY[key]?.label || null
```

- [ ] **Step 4: Run — expect PASS.** **Commit** `feat: weekday theme rules for the dial list`

---

### Task 4: `Priority` `buckets` filter

**Files:** Modify `src/pages/Priority.jsx`, `src/pages/Priority.render.test.jsx`

- [ ] **Step 1: Test** — add:

```jsx
it('shows only the given buckets, and nothing at all when they are empty', async () => {
  mobile = false
  DATA.signals = [
    lead({ id: 'a', name: 'Ana Inbound', last_inbound_at: iso(0, 1) }),
    lead({ id: 'b', name: 'Ben Overdue', open_task_count: 1, oldest_open_due_at: iso(3) }),
  ]
  await refreshPriorityQueue()
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    createRoot(host).render(React.createElement(MemoryRouter, null,
      React.createElement(Priority, { embedded: true, buckets: ['overdue'] }),
      React.createElement('div', { id: 'none' }, React.createElement(Priority, { embedded: true, buckets: ['stuck'] })),
    ))
  })
  await act(async () => {})
  expect(host.textContent).toContain('Ben Overdue')
  expect(host.textContent).not.toContain('Ana Inbound')
  expect(host.querySelector('#none').textContent).toBe('')
})
```

- [ ] **Step 2: Implement** in `Priority.jsx`:

```jsx
// buckets: only these Up Next buckets; renders nothing when they're empty
// (the Workbench places Up Next's sections around the dial lists).
export default function Priority({ embedded = false, hideIds = null, buckets = null }) {
  const { biz } = useBusiness()
  const { queue: all, rules, touchedToday, loading, error } = usePriorityQueue(biz)
  const queue = all.filter((r) => (!hideIds || !hideIds.has(r.id)) && (!buckets || buckets.includes(r.bucket)))
  ...
  if (buckets && (loading || error || isDemoMode || queue.length === 0)) return null
```
(Place the early return after the hooks and derived values; the rest unchanged.)

- [ ] **Step 3: Run** `npx vitest run src/pages/Priority.render.test.jsx` — PASS. **Commit** `feat: Up Next buckets filter`

---

### Task 5: `ThemeList` component

**Files:** Create `src/components/ThemeList.jsx`, `src/components/ThemeList.render.test.jsx`

- [ ] **Step 1: Test**

```jsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import React from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
vi.mock('./PersonSheet', () => ({ openPerson: () => {} }))
const { default: ThemeList } = await import('./ThemeList')

const week = [
  { day: 1, key: 'new_realtor', label: 'New realtors', count: 2, isToday: true },
  { day: 2, key: 'loan_status', label: 'Loan status', count: 1, isToday: false },
  { day: 3, key: 'past_client', label: 'Past clients', count: 0, isToday: false },
  { day: 4, key: 'pre_approved', label: 'Pre-approved', count: 0, isToday: false },
  { day: 5, key: 'top_partner', label: 'Top partners', count: 1, isToday: false },
]
const item = { id: 'r1', book: 'bay', kind: 'new_realtor', dueAt: 0, label: 'New realtor · intro call', hint: 'never called', row: { id: 'r1', name: 'Rita Realtor', phone: '7135550142' } }

async function render(props) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => createRoot(host).render(React.createElement(ThemeList, { onDial: () => {}, onPickDay: () => {}, ...props })))
  return host
}

describe('ThemeList', () => {
  it("shows the week strip and today's list with call links; Start dialing opens the dialer", async () => {
    const onDial = vi.fn()
    const onPickDay = vi.fn()
    const host = await render({ list: { theme: week[0], items: [item], total: 2, week }, onDial, onPickDay })
    const days = [...host.querySelectorAll('[data-theme-day]')]
    expect(days.map((d) => d.textContent)).toEqual(['MonNew realtors · 2', 'TueLoan status · 1', 'WedPast clients · 0', 'ThuPre-approved · 0', 'FriTop partners · 1'])
    expect(days[0].getAttribute('aria-current')).toBe('date')
    const row = host.querySelector('[data-theme-row]')
    expect(row.textContent).toContain('Rita Realtor')
    expect(row.textContent).toContain('New realtor · intro call · never called')
    expect(row.querySelector('a[href="tel:7135550142"]')).not.toBe(null)
    expect(host.textContent).toContain('1 more due')
    await act(async () => host.querySelector('[data-theme-start]').click())
    expect(onDial).toHaveBeenCalledWith(0)
    await act(async () => days[4].click())
    expect(onPickDay).toHaveBeenCalledWith(5)
  })
  it('says so on a weekend and when nobody is due', async () => {
    expect((await render({ list: { theme: null, items: [], total: 0, week } })).textContent).toContain('No theme list on weekends')
    expect((await render({ list: { theme: week[2], items: [], total: 0, week } })).textContent).toContain('Nobody due on Past clients')
  })
})
```

- [ ] **Step 2: Implement**

```jsx
// The day's theme list (spec: Weekday themes): a Mon-Fri strip with each
// day's theme and how many are due, then the picked day's people with a call
// link. Start dialing / a row opens the Dialer on this list.
import PersonLink from './PersonLink'
import { telHref } from '../lib/phone'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const CallIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" /></svg>
)

// list: buildThemeList output. pickedDay: the previewed weekday or null (today).
export default function ThemeList({ list, pickedDay = null, onPickDay, onDial }) {
  const { theme, items, total, week } = list
  return (
    <section aria-label="Theme of the day">
      <div className="grid grid-cols-5 gap-1 border-b border-line px-3 py-2.5">
        {week.map((w) => {
          const active = pickedDay != null ? w.day === pickedDay : w.isToday
          return (
            <button
              key={w.key}
              type="button"
              data-theme-day
              aria-current={w.isToday ? 'date' : undefined}
              aria-pressed={active}
              onClick={() => onPickDay(w.isToday ? null : w.day)}
              className={`min-w-0 rounded-[10px] border px-1 py-1.5 text-center text-[11.5px] leading-tight ${active ? 'border-[color:var(--chrome)] bg-panel2 font-semibold' : 'border-line text-muted'}`}
            >
              <span className="block font-bold">{DAY_NAMES[w.day]}</span>
              <span className="block truncate">{w.label} · {w.count}</span>
            </button>
          )
        })}
      </div>
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 pb-1.5 pt-3">
        <div className="text-[12px] font-bold uppercase tracking-wide text-muted">
          {theme ? theme.label : 'Theme of the day'} <span className="num font-semibold text-dim">{total}</span>
        </div>
        {items.length > 0 && (
          <button type="button" data-theme-start onClick={() => onDial(0)} className="min-h-[34px] rounded-[10px] px-3 text-[13px] font-bold text-white" style={{ background: 'var(--chrome)' }}>
            Start dialing
          </button>
        )}
      </div>
      {!theme && <div className="border-b border-line px-4 py-3 text-[13px] text-muted">No theme list on weekends.</div>}
      {theme && items.length === 0 && <div className="border-b border-line px-4 py-3 text-[13px] text-muted">Nobody due on {theme.label} right now.</div>}
      {items.map((it, i) => {
        const r = it.row
        const tel = telHref(r.phone)
        return (
          <div key={it.id} data-theme-row className="flex items-center gap-3 border-b border-line px-4 py-2.5">
            <div role="button" tabIndex={0} onClick={() => onDial(i)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onDial(i)} className="min-w-0 flex-1 cursor-pointer text-left" aria-label={`Dial ${r.name || 'contact'}`}>
              <PersonLink id={r.id} url={r.crm_profile_url} className="block truncate text-[14px] font-semibold">{r.name || '(no name)'}</PersonLink>
              <div className="mt-0.5 text-[12.5px] text-muted">{[it.label, it.hint].filter(Boolean).join(' · ')}</div>
            </div>
            {tel && (
              <a href={tel} aria-label={`Call ${r.name || 'contact'}`} className="grid h-10 w-10 flex-none place-items-center rounded-[10px] text-muted hover:bg-hoverbg">
                <CallIcon />
              </a>
            )}
          </div>
        )
      })}
      {total > items.length && <div className="border-b border-line px-4 py-2 text-[12px] text-dim">{total - items.length} more due, they'll come up next week.</div>}
    </section>
  )
}
```

- [ ] **Step 3: Run** — PASS. **Commit** `feat: weekday theme list with the Mon-Fri strip`

---

### Task 6: Dialer for theme calls; Workbench wiring

**Files:** Modify `src/components/Dialer.jsx` (+ test), `src/pages/Workbench.jsx`

- [ ] **Step 1: Dialer test** — add:

```jsx
it('keeps Nurture and Lost to leads: a realtor with a bad number just moves on', async () => {
  invoke.mockResolvedValue(ok(['log_call']))
  await open([item({ kind: 'new_realtor', step: null, calls: 0, label: 'New realtor · intro call', textKey: 'new_realtor', row: { ...item().row, stage: null } })])
  await click(button('Bad number'))
  expect(invoke.mock.calls[0][1].body.payload).toMatchObject({ outcome: 'Bad Number' })
  expect(button('Move to Nurture')).toBe(undefined)
  expect(button('Mark Lost')).toBe(undefined)
})
```

- [ ] **Step 2: Dialer** — lead-only prompts:

```jsx
const LEAD_KINDS = new Set(['attempt', 'move_nurture', 'nurture', 'cold', 'credit_repair'])
// ...
const isLead = LEAD_KINDS.has(it.kind)
const parkPrompt = isLead && it.book === 'bay' && (it.kind === 'move_nurture' || (it.kind === 'attempt' && it.step === 6))
// bad-number panel: {phase === 'bad' && isLead && it.book === 'bay' && (...)}
```
Summary sheet subtitle: "Dial list" instead of "Lead cadence".

- [ ] **Step 3: Workbench** — one dialer for either list, the spec's lane order, theme ids out of Up Next:

```jsx
import { buildThemeList } from '../lib/dialThemes'
import ThemeList from '../components/ThemeList'
// state
const [dialRun, setDialRun] = useState(null) // { items, start } | null
const [themeDay, setThemeDay] = useState(null)
// derived (after dialDue)
const themeList = buildThemeList(dial.rows, { now: dial.now, day: themeDay, skips: dial.skips, inBook })
const dialIds = new Set([...dialItems, ...themeList.items].map((i) => i.id))
// Calls lane body, in order:
<Priority embedded hideIds={dialIds} buckets={['reached_out']} />
<DialList dueNow={dialDue.dueNow} laterToday={dialDue.laterToday} now={dial.now} onDial={(i) => setDialRun({ items: dialItems, start: i })} />
<Priority embedded hideIds={dialIds} buckets={['overdue']} />
<ThemeList list={themeList} pickedDay={themeDay} onPickDay={setThemeDay} onDial={(i) => setDialRun({ items: themeList.items, start: i })} />
<details className="group">
  <summary className="cursor-pointer border-b border-line px-4 py-2.5 text-[12px] font-bold uppercase tracking-wide text-muted">More from Up Next</summary>
  <Priority embedded hideIds={dialIds} buckets={['new_lead', 'hot_cold', 'no_next_step', 'stuck', 'quiet']} />
</details>
// dialer
{dialRun && <Dialer items={dialRun.items} start={dialRun.start} skipToday={dial.skipToday} onClose={() => { setDialRun(null); dial.reload() }} />}
```
Remove the old `dialAt` state. Lane counts: add `themeList.items.length` when today has a theme (`themeDay == null`).

- [ ] **Step 4: Run** the full suite — expect all passing (known mock unhandled errors aside). **Commit** `feat: theme list and Up Next sections in the Calls lane`

---

### Task 7: Verify and ship

- [ ] `npx vite build`.
- [ ] Ask Chandler to approve applying `0050`.
- [ ] Browser (live data, phone + desktop): Mon–Fri strip with counts, today's list (Thursday = Pre-approved, likely empty today: no one is tagged yet), preview Monday (new realtors), Friday (top partner), Wednesday (Closed); Up Next sections around the lists; More collapsed; dialer opens on a theme person (no outcomes logged on real people). Console clean.
- [ ] Update the spec's Phases section (Tuesday borrower list shipped in phase 2), PR to `main`.

## Self-review

- Spec coverage: Mon / Wed / Thu / Fri themes, membership and rhythms (Task 3), cap 15 + "comes back next week" (Task 3/5), week strip with counts and preview (Tasks 3, 5), lane order reached out → lead cadence → follow-ups → theme → More (Tasks 4, 6), pre-approval 60-day flag (Tasks 1, 3), texts (Task 2). Tuesday borrower list added early; agents remain phase 3. `settings.dial_cadence` deferred (constant cap).
- Names: `themeOf`, `themeItem`, `buildThemeList` (`theme`, `items`, `total`, `week[{day,key,label,count,isToday}]`), `themeForDay`, `THEMES`, `THEME_CAP`, `ThemeList` (`list`, `pickedDay`, `onPickDay`, `onDial`), `Priority` (`buckets`), Workbench `dialRun`.
