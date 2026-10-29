# Dialer phase 1: lead cadence, dialer and texts — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Workbench Calls lane gets a "Lead cadence" list (both books) of who to call today and a one-at-a-time dialer that logs each outcome in the CRM and offers the right text.

**Architecture:** A new view `v_dial_contacts` gives every cadence lead with its outbound-call history (count, first, last, last connected). Pure `src/lib/dialList.js` turns rows into due items (attempt 1–6, move to Nurture, nurture, cold, credit repair); `src/lib/dialTexts.js` holds the text templates and `sms:` links. `useDialList` fetches; `DialList` renders the section above Up Next; `Dialer` walks it. Every CRM write is an existing crm-action action (`log_call`, `add_note`, `set_stage`).

**Tech Stack:** React 18 + Vite + Tailwind, Supabase (Postgres views, RLS), Vitest + jsdom, crm-action edge function (unchanged).

Spec: `docs/superpowers/specs/2026-10-29-dialer-cadence-design.md` (phase 1 sections).

---

## Files

| File | Responsibility |
|---|---|
| Create `supabase/migrations/0049_dial_contacts.sql` | `call_connected()`, `v_dial_contacts`, `dial_skips` |
| Create `src/lib/dialTexts.js` + `.test.js` | templates, `textFor`, `smsHref` |
| Create `src/lib/dialList.js` + `.test.js` | cadence rules: `attemptDue`, `dialItem`, `buildDialList`, `whenLabel` |
| Create `src/lib/useDialList.js` | fetch view + skips, refresh, `skipToday` |
| Create `src/components/DialList.jsx` + `.render.test.jsx` | the Calls lane section |
| Create `src/components/Dialer.jsx` + `.render.test.jsx` | focus mode |
| Modify `src/pages/Priority.jsx` | `hideIds` prop (no duplicate rows) |
| Modify `src/pages/Workbench.jsx` | mount DialList + Dialer in the Calls lane |
| Modify `docs/superpowers/specs/2026-10-29-dialer-cadence-design.md` | text logging is a confirm tap (below) |

Spec adjustment made by this plan: tapping **Text** only opens Messages; a **Log text** button then records it in the CRM. The OS can't delete a CRM note, so "log on tap, Undo" isn't possible.

---

### Task 1: Migration — `v_dial_contacts`, `call_connected`, `dial_skips`

**Files:** Create `supabase/migrations/0049_dial_contacts.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Dial list phase 1 (docs/superpowers/specs/2026-10-29-dialer-cadence-design.md).
--   * call_connected(raw): a call record was a real conversation: CRM outcome
--     Interested / Not Interested (FUB outcome; Zoho Call_Result or the
--     "Call: <outcome>" subject crm-action writes) or 2+ minutes long.
--   * v_dial_contacts: the lead-cadence leads of both books with their
--     outbound-call history. Phase 2 widens the WHERE (realtors, past clients).
--   * dial_skips: "Not today" in the dialer (app-owned, per user).

create or replace function public.call_connected(raw jsonb)
returns boolean
language sql
immutable
as $$
  select coalesce(raw->>'outcome', '') in ('Interested', 'Not Interested')
      or coalesce(raw->>'Call_Result', '') in ('Interested', 'Not interested')
      or coalesce(raw->>'Subject', '') in ('Call: Interested', 'Call: Not Interested')
      or case when coalesce(raw->>'duration', '') ~ '^\d+$'
              then (raw->>'duration')::int >= 120 else false end
      or case when coalesce(raw->>'Call_Duration', '') ~ '^\d+:\d{2}$'
              then split_part(raw->>'Call_Duration', ':', 1)::int * 60
                 + split_part(raw->>'Call_Duration', ':', 2)::int >= 120
              else false end
$$;

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
    oc.connected_at
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
) s
where (business_id = 'bay' and stage in ('New Lead', 'Attempted', 'Nurture / Credit Repair'))
   or (business_id = 'mpg' and stage in ('Not Contacted', 'Open', 'Attempted to Contact'));

create table if not exists dial_skips (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid(),
  contact_id  uuid not null references contacts(id) on delete cascade,
  until_date  date not null,
  created_at  timestamptz not null default now(),
  unique (user_id, contact_id)
);

alter table dial_skips enable row level security;

drop policy if exists "own dial_skips select" on dial_skips;
create policy "own dial_skips select" on dial_skips
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "own dial_skips insert" on dial_skips;
create policy "own dial_skips insert" on dial_skips
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "own dial_skips update" on dial_skips;
create policy "own dial_skips update" on dial_skips
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own dial_skips delete" on dial_skips;
create policy "own dial_skips delete" on dial_skips
  for delete to authenticated using (user_id = auth.uid());
```

- [ ] **Step 2: Dry run (no apply yet)**

Remote has `0044` from the unmerged `feat/mpg-skip-initial-lead`; copy it in for the push, then remove it.

```bash
git show 8baf28e:supabase/migrations/0044_drop_mpg_initial_leads.sql > supabase/migrations/0044_drop_mpg_initial_leads.sql
supabase db push --linked --dry-run
rm supabase/migrations/0044_drop_mpg_initial_leads.sql
```
Expected: `Would push these migrations: • 0049_dial_contacts.sql`. Apply only after Chandler approves (Task 8).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0049_dial_contacts.sql
git commit -m "feat: v_dial_contacts and dial_skips for the dial list"
```

---

### Task 2: Text templates and `sms:` links

**Files:** Create `src/lib/dialTexts.js`, `src/lib/dialTexts.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest'
import { TEXTS, textFor, smsHref, firstName } from './dialTexts'

describe('firstName', () => {
  it('is the first word, or "there"', () => {
    expect(firstName('Sam Golden')).toBe('Sam')
    expect(firstName('  ')).toBe('there')
    expect(firstName(null)).toBe('there')
  })
})

describe('textFor', () => {
  it('fills the first name into the book template', () => {
    expect(textFor('bay', 'a1', 'Sam Golden')).toBe("Hi Sam, this is Chandler with Bayway. Just tried calling about your home loan. When's a good time to talk?")
    expect(textFor('mpg', 'a3', 'Ana Ruiz')).toBe('Hey Ana, Chandler again. Got a few minutes this week to look at your processing rates?')
  })
  it('has every lead step for both books, and credit repair for Bayway only', () => {
    for (const book of ['bay', 'mpg']) for (const k of ['a1', 'a3', 'a5', 'a6', 'nurture']) expect(TEXTS[book][k]).toBeTruthy()
    expect(textFor('bay', 'credit_repair', 'Sam')).toMatch(/^Hi Sam, checking in on how the credit/)
    expect(textFor('mpg', 'credit_repair', 'Sam')).toBe(null)
    expect(textFor('bay', null, 'Sam')).toBe(null)
  })
  it('reads like a person: no dashes or sign-offs', () => {
    for (const book of Object.values(TEXTS)) for (const t of Object.values(book)) expect(t).not.toMatch(/[—–]|Best,|Thanks!$/)
  })
})

describe('smsHref', () => {
  it('is an sms: link with the digits and the encoded body', () => {
    expect(smsHref('(913) 713-5946', 'Hi Sam, ok?')).toBe('sms:9137135946?&body=Hi%20Sam%2C%20ok%3F')
    expect(smsHref('+1 913 713 5946', 'x')).toBe('sms:+19137135946?&body=x')
    expect(smsHref('', 'x')).toBe(null)
  })
})
```

- [ ] **Step 2: Run it — expect FAIL** (`npx vitest run src/lib/dialTexts.test.js`: module not found)

- [ ] **Step 3: Implement**

```js
// The texts the dialer offers after a call (spec: Texts). Short and plain, the
// way Chandler texts. {first} is the lead's first name. Keys: a1 / a3 / a5 /
// a6 = after attempts 1, 3, 5 and 6; nurture (nurture and cold calls);
// credit_repair (Bayway parked in Credit Repair).
export const TEXTS = {
  bay: {
    a1: "Hi {first}, this is Chandler with Bayway. Just tried calling about your home loan. When's a good time to talk?",
    a3: 'Hey {first}, Chandler again. Still happy to help with your loan. Do you have 10 min today or tomorrow?',
    a5: '{first}, quick check in. Are you still looking at a loan, or should I check back later?',
    a6: "Hi {first}, I'll stop reaching out for now. If anything changes just text me here.",
    nurture: 'Hey {first}, Chandler here. Just checking in, anything I can help with on the home search?',
    credit_repair: 'Hi {first}, checking in on how the credit is coming along. Happy to take another look anytime.',
  },
  mpg: {
    a1: "Hi {first}, this is Chandler with Media Payments Group. Just tried calling about your card processing. When's a good time?",
    a3: 'Hey {first}, Chandler again. Got a few minutes this week to look at your processing rates?',
    a5: '{first}, quick check in. Still want to look at lowering your fees, or should I check back later?',
    a6: "Hi {first}, I'll stop reaching out for now. Text me here if you want to pick it back up.",
    nurture: 'Hey {first}, Chandler with MPG checking in. Anything I can help with on the processing side?',
  },
}

export const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'there'

export function textFor(book, key, name) {
  const t = key ? TEXTS[book]?.[key] : null
  return t ? t.replaceAll('{first}', firstName(name)) : null
}

// Opens Messages on an iPhone / Mac (iMessage when the other person has it,
// SMS otherwise) with the number and text filled in. "?&body=" works on iOS
// and Android alike.
export function smsHref(phone, body) {
  const num = String(phone || '').replace(/[^\d+]/g, '')
  return num ? `sms:${num}?&body=${encodeURIComponent(body || '')}` : null
}
```

- [ ] **Step 4: Run — expect PASS.** `npx vitest run src/lib/dialTexts.test.js`
- [ ] **Step 5: Commit** `git add src/lib/dialTexts.js src/lib/dialTexts.test.js && git commit -m "feat: dialer text templates and sms links"`

---

### Task 3: Cadence rules (`dialList.js`)

**Files:** Create `src/lib/dialList.js`, `src/lib/dialList.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest'
import { attemptDue, businessDay, dialItem, buildDialList, whenLabel, ATTEMPTS } from './dialList'

// Local wall-clock instants. 2026-10-26 is a Monday.
const at = (d, h = 9, m = 0) => new Date(2026, 9, d, h, m).getTime()
const iso = (t) => new Date(t).toISOString()
const DAY = 86_400_000
const lead = (o = {}) => ({
  id: 'l1', business_id: 'bay', name: 'Sam Golden', phone: '9137135946', stage: 'New Lead', stage_since: null,
  crm_created_at: iso(at(26, 9)), tags: [], outbound_calls: 0, outbound_calls_since_stage: 0,
  first_outbound_call_at: null, last_outbound_call_at: null, connected_at: null, ...o,
})
const called = (n, first, last = first) => ({ outbound_calls: n, first_outbound_call_at: iso(first), last_outbound_call_at: iso(last), stage: 'Attempted' })

describe('businessDay', () => {
  it('moves Saturday and Sunday to Monday, same time', () => {
    expect(businessDay(at(31, 10))).toBe(new Date(2026, 10, 2, 10).getTime()) // Sat -> Mon
    expect(businessDay(new Date(2026, 10, 1, 10).getTime())).toBe(new Date(2026, 10, 2, 10).getTime()) // Sun -> Mon
    expect(businessDay(at(28, 10))).toBe(at(28, 10))
  })
})

describe('attemptDue', () => {
  it('spaces attempts from attempt 1: +3h, next business day opposite half, day 3, 5, 8', () => {
    const first = at(26, 10) // Mon 10 AM
    expect(attemptDue(2, first)).toBe(at(26, 13))
    expect(attemptDue(3, first)).toBe(at(27, 14)) // morning first, so afternoon
    expect(attemptDue(3, at(26, 15))).toBe(at(27, 9)) // afternoon first, so morning
    expect(attemptDue(4, first)).toBe(at(29, 9))
    expect(attemptDue(5, first)).toBe(new Date(2026, 10, 2, 9).getTime()) // Sat 10/31 -> Mon 11/2
    expect(attemptDue(6, first)).toBe(new Date(2026, 10, 3, 9).getTime())
  })
  it('pushes a late-evening attempt 2 to the next business day morning', () => {
    expect(attemptDue(2, at(30, 18))).toBe(new Date(2026, 10, 2, 9).getTime()) // Fri 6 PM -> Mon 9 AM
  })
})

describe('dialItem: lead attempts', () => {
  it('a new, never-called lead is attempt 1, due from when it arrived', () => {
    expect(dialItem(lead(), at(26, 9, 3))).toMatchObject({ kind: 'attempt', step: 1, dueAt: at(26, 9), label: 'Attempt 1', textKey: 'a1', book: 'bay' })
  })
  it('counts attempts from the call history and schedules the next', () => {
    const it2 = dialItem(lead(called(1, at(26, 10))), at(26, 11))
    expect(it2).toMatchObject({ step: 2, dueAt: at(26, 13), textKey: null })
    const it3 = dialItem(lead(called(2, at(26, 10), at(26, 13))), at(27, 8))
    expect(it3).toMatchObject({ step: 3, dueAt: at(27, 14), hint: 'try afternoon', textKey: 'a3' })
  })
  it('never makes the next attempt due within 2 hours of the last call', () => {
    const it4 = dialItem(lead(called(3, at(26, 10), at(29, 8))), at(29, 8, 30))
    expect(it4.dueAt).toBe(at(29, 10))
  })
  it('ends the cadence on a connected call or a stage past Attempted', () => {
    expect(dialItem(lead({ ...called(2, at(26, 10)), connected_at: iso(at(26, 13)) }), at(27))).toBe(null)
    expect(dialItem(lead({ stage: 'Contacted/Working' }), at(27))).toBe(null)
  })
  it('after six Bayway attempts asks to move the lead to Nurture', () => {
    const sixth = new Date(2026, 10, 3, 9).getTime()
    expect(dialItem(lead(called(ATTEMPTS, at(26, 10), sixth)), sixth + 3 * 3_600_000)).toMatchObject({ kind: 'move_nurture', step: 6, dueAt: sixth, label: '6 attempts, move to Nurture' })
  })
})

describe('dialItem: MPG runs on calls alone', () => {
  const mpg = (o) => lead({ business_id: 'mpg', stage: 'Open', ...o })
  it('uses Open / Not Contacted / Attempted to Contact as the cadence and stops on any other status', () => {
    expect(dialItem(mpg(), at(26, 9, 1))).toMatchObject({ kind: 'attempt', step: 1 })
    expect(dialItem(mpg({ ...called(2, at(26, 10)), stage: 'Attempted to Contact' }), at(27))).toMatchObject({ step: 3 })
    expect(dialItem(mpg({ stage: 'Contacted' }), at(27))).toBe(null)
  })
  it('after six calls: two weekly nurture calls, then cold every 30 days', () => {
    const last = at(28, 10)
    expect(dialItem(mpg({ ...called(6, at(20, 10), last), stage: 'Open' }), at(28, 11))).toMatchObject({ kind: 'nurture', label: 'Nurture call 1 of 2', dueAt: last + 7 * DAY, textKey: 'nurture' })
    expect(dialItem(mpg({ ...called(7, at(13, 10), last), stage: 'Open' }), at(28, 11))).toMatchObject({ label: 'Nurture call 2 of 2' })
    expect(dialItem(mpg({ ...called(8, at(6, 10), last), stage: 'Open' }), at(28, 11))).toMatchObject({ kind: 'cold', label: 'Cold check-in', dueAt: businessDay(last + 30 * DAY) })
  })
})

describe('dialItem: Bayway parked leads', () => {
  const parked = (o) => lead({ stage: 'Nurture / Credit Repair', stage_since: iso(at(20, 9)), ...o })
  it('Nurture: calls 7 days apart, twice, then cold', () => {
    expect(dialItem(parked({ tags: ['nurture'] }), at(27))).toMatchObject({ kind: 'nurture', label: 'Nurture call 1 of 2', dueAt: at(27, 9) })
    expect(dialItem(parked({ tags: ['nurture'], outbound_calls_since_stage: 1, last_outbound_call_at: iso(at(27, 11)) }), at(28))).toMatchObject({ label: 'Nurture call 2 of 2', dueAt: businessDay(at(27, 11) + 7 * DAY) })
    expect(dialItem(parked({ tags: ['nurture'], outbound_calls_since_stage: 2, last_outbound_call_at: iso(at(27, 11)) }), at(28))).toMatchObject({ kind: 'cold', dueAt: businessDay(at(27, 11) + 30 * DAY) })
  })
  it('Credit Repair: a check-in 30 days after the later of parking and the last call', () => {
    expect(dialItem(parked({ tags: ['credit repair'] }), at(27))).toMatchObject({ kind: 'credit_repair', label: 'Credit repair check-in', dueAt: businessDay(at(20, 9) + 30 * DAY), textKey: 'credit_repair' })
  })
})

describe('buildDialList', () => {
  const now = at(28, 12)
  const rows = [
    lead({ id: 'later', ...called(1, at(28, 10)) }), // attempt 2 due 1 PM today
    lead({ id: 'new', crm_created_at: iso(at(28, 11, 55)) }), // attempt 1, speed to lead
    lead({ id: 'over', ...called(3, at(23, 10), at(26, 10)) }), // attempt 4 due 10/26... overdue
    lead({ id: 'tomorrow', ...called(2, at(28, 9), at(28, 11)) }), // attempt 3 due tomorrow
    lead({ id: 'mpg', business_id: 'mpg', stage: 'Open' }),
  ]
  it('keeps what is due by the end of today: due now first (new leads on top), then later today', () => {
    const list = buildDialList(rows, { now })
    expect(list.dueNow.map((i) => i.id)).toEqual(['new', 'mpg', 'over'])
    expect(list.laterToday.map((i) => i.id)).toEqual(['later'])
  })
  it('drops skipped leads and other books', () => {
    const list = buildDialList(rows, { now, skips: new Set(['new']), inBook: (b) => b === 'bay' })
    expect(list.dueNow.map((i) => i.id)).toEqual(['over'])
  })
})

describe('whenLabel', () => {
  it('says due now, overdue days, or the time later today', () => {
    expect(whenLabel({ dueAt: at(28, 11) }, at(28, 12))).toBe('due now')
    expect(whenLabel({ dueAt: at(25, 9) }, at(28, 12))).toBe('3 days late')
    expect(whenLabel({ dueAt: at(28, 14, 30) }, at(28, 12))).toBe('2:30 PM')
  })
})
```

Clocks change on Sunday 2026-11-01. Expectations built from calendar dates
(`new Date(2026, 10, 2, 9)`) stay correct across it; ones built by adding
`n * DAY` mirror the code's own millisecond math (nurture / cold gaps), so both
sides shift the same way.

- [ ] **Step 2: Run — expect FAIL** (`npx vitest run src/lib/dialList.test.js`: module not found)

- [ ] **Step 3: Implement**

```js
// Who to call today for the lead cadence (spec: Lead cadence, Nurture and
// Cold). Pure: v_dial_contacts rows in, due items out. Attempts are counted
// from the real outbound-call history, so calls made in FUB or Zoho count too.
// Times are browser-local.
//
//   attempt 1        as soon as the lead arrives
//   attempt 2        3 hours after attempt 1 (next business morning if late)
//   attempt 3        next business day, the other half of the day
//   attempts 4, 5, 6 days 3, 5 and 8 after attempt 1, 9 AM
//   Bayway after 6   "move to Nurture" (Chandler confirms; the OS never re-tags)
//   MPG after 6      two weekly nurture calls, then cold every 30 days
//   Bayway parked    Nurture: 2 weekly calls then cold; Credit Repair: every 30 days
const HOUR = 3_600_000
const DAY = 24 * HOUR
export const ATTEMPTS = 6
const NURTURE_CALLS = 2
const BAY_CADENCE = new Set(['New Lead', 'Attempted'])
const MPG_CADENCE = new Set(['Not Contacted', 'Open', 'Attempted to Contact'])
const PARKED = 'Nurture / Credit Repair'
// The text offered after each attempt (dialTexts.js keys).
const TEXT_AFTER = { 1: 'a1', 3: 'a3', 5: 'a5', 6: 'a6' }

const ms = (iso) => (iso ? new Date(iso).getTime() : null)

// Saturday or Sunday -> Monday, same time of day.
export function businessDay(t) {
  const d = new Date(t)
  if (d.getDay() === 6) d.setDate(d.getDate() + 2)
  else if (d.getDay() === 0) d.setDate(d.getDate() + 1)
  return d.getTime()
}

function dayAt(from, days, hour) {
  const d = new Date(from)
  d.setDate(d.getDate() + days)
  d.setHours(hour, 0, 0, 0)
  return businessDay(d.getTime())
}

// When attempt n (2..6) is due, from attempt 1's time.
export function attemptDue(n, firstAt) {
  const first = new Date(firstAt)
  if (n === 2) {
    const t = new Date(firstAt + 3 * HOUR)
    return t.toDateString() !== first.toDateString() || t.getHours() >= 20 ? dayAt(firstAt, 1, 9) : t.getTime()
  }
  if (n === 3) return dayAt(firstAt, 1, first.getHours() < 12 ? 14 : 9)
  if (n === 4) return dayAt(firstAt, 3, 9)
  if (n === 5) return dayAt(firstAt, 5, 9)
  if (n === 6) return dayAt(firstAt, 8, 9)
  return firstAt
}

const nurtureOrCold = (base, k, last) =>
  k < NURTURE_CALLS
    ? { ...base, kind: 'nurture', step: k + 1, dueAt: businessDay(last + 7 * DAY), label: `Nurture call ${k + 1} of ${NURTURE_CALLS}`, textKey: 'nurture' }
    : { ...base, kind: 'cold', step: null, dueAt: businessDay(last + 30 * DAY), label: 'Cold check-in', textKey: 'nurture' }

function parkedItem(row, base) {
  const since = ms(row.stage_since) ?? ms(row.crm_created_at) ?? 0
  const last = ms(row.last_outbound_call_at)
  const anchor = Math.max(since, last ?? 0)
  const tags = row.tags || []
  if (tags.includes('credit repair')) {
    return { ...base, kind: 'credit_repair', step: null, dueAt: businessDay(anchor + 30 * DAY), label: 'Credit repair check-in', textKey: 'credit_repair' }
  }
  if (tags.includes('nurture')) return nurtureOrCold(base, row.outbound_calls_since_stage || 0, anchor)
  return null
}

// One v_dial_contacts row -> its next cadence item, or null (not on a cadence).
export function dialItem(row, now = Date.now()) {
  const book = row.business_id
  const calls = row.outbound_calls || 0
  const first = ms(row.first_outbound_call_at)
  const last = ms(row.last_outbound_call_at)
  const base = { id: row.id, book, row, calls, hint: null }
  if (book === 'bay' && row.stage === PARKED) return parkedItem(row, base)
  const inCadence = book === 'bay' ? BAY_CADENCE.has(row.stage) : MPG_CADENCE.has(row.stage)
  if (!inCadence) return null
  const created = ms(row.crm_created_at) ?? first ?? now
  const connected = ms(row.connected_at)
  if (connected != null && connected >= created) return null
  if (calls === 0) return { ...base, kind: 'attempt', step: 1, dueAt: created, label: 'Attempt 1', hint: 'speed to lead', textKey: TEXT_AFTER[1] }
  if (calls < ATTEMPTS) {
    const step = calls + 1
    return {
      ...base,
      kind: 'attempt',
      step,
      dueAt: Math.max(attemptDue(step, first), last + 2 * HOUR),
      label: `Attempt ${step}`,
      hint: step === 3 ? (new Date(first).getHours() < 12 ? 'try afternoon' : 'try morning') : null,
      textKey: TEXT_AFTER[step] || null,
    }
  }
  if (book === 'bay') return { ...base, kind: 'move_nurture', step: ATTEMPTS, dueAt: last, label: `${ATTEMPTS} attempts, move to Nurture`, textKey: null }
  return nurtureOrCold(base, calls - ATTEMPTS, last)
}

const endOfDay = (now) => {
  const d = new Date(now)
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}

// rows -> { dueNow, laterToday }. Due now: new leads (attempt 1) first, then
// oldest due first. Later today: by time. skips: contact ids off the list today.
export function buildDialList(rows, { now = Date.now(), skips = new Set(), inBook = () => true } = {}) {
  const items = (rows || [])
    .map((r) => dialItem(r, now))
    .filter((i) => i && inBook(i.book) && !skips.has(i.id) && i.dueAt <= endOfDay(now))
  const dueNow = items
    .filter((i) => i.dueAt <= now)
    .sort((a, b) => (a.kind === 'attempt' && a.step === 1 ? 0 : 1) - (b.kind === 'attempt' && b.step === 1 ? 0 : 1) || b.dueAt - a.dueAt)
  const laterToday = items.filter((i) => i.dueAt > now).sort((a, b) => a.dueAt - b.dueAt)
  return { dueNow, laterToday }
}

export function whenLabel(item, now = Date.now()) {
  if (item.dueAt > now) {
    const d = new Date(item.dueAt)
    const h = d.getHours() % 12 || 12
    return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() >= 12 ? 'PM' : 'AM'}`
  }
  const late = Math.floor((now - item.dueAt) / DAY)
  return late >= 1 ? `${late} day${late === 1 ? '' : 's'} late` : 'due now'
}
```

Note on ordering: within "due now", new leads first, then **most recently due first** (`b.dueAt - a.dueAt`) so a fresh attempt 2 isn't buried under a week-old one; the test expects `['new', 'mpg', 'over']` (both `new` and `mpg` are attempt 1; `new` arrived later so sorts first). Adjust the test, not the code, if the tie order differs.

- [ ] **Step 4: Run — expect PASS.** Fix only real rule mistakes; the spec's schedule is the source of truth.
- [ ] **Step 5: Commit** `git add src/lib/dialList.js src/lib/dialList.test.js && git commit -m "feat: lead cadence rules for the dial list"`

---

### Task 4: `useDialList` hook

**Files:** Create `src/lib/useDialList.js`

- [ ] **Step 1: Implement** (thin I/O, covered by the DialList render test)

```js
// Data for the dial list: v_dial_contacts (paged) and today's "Not today"
// skips. Reloads after any CRM write (crm-action:done), on window focus, and
// every minute so "later today" items come due on time.
import { useCallback, useEffect, useState } from 'react'
import { supabase, isDemoMode } from './supabase'
import { fetchAllSettled } from './fetchAll'
import { localDateKey } from './crmActions'

export function useDialList() {
  const [state, setState] = useState({ rows: [], skips: new Set(), loading: !isDemoMode, error: null, now: Date.now() })

  const load = useCallback(async () => {
    if (isDemoMode) return
    const today = localDateKey(new Date())
    const [v, s] = await Promise.all([
      fetchAllSettled(() => supabase.from('v_dial_contacts').select('*').order('id')),
      supabase.from('dial_skips').select('contact_id').gt('until_date', today),
    ])
    const error = v.error || s.error
    setState((st) => ({
      rows: error ? st.rows : v.data || [],
      skips: error ? st.skips : new Set((s.data || []).map((r) => r.contact_id)),
      loading: false,
      error: error ? error.message : null,
      now: Date.now(),
    }))
  }, [])

  useEffect(() => {
    load()
    const tick = setInterval(() => setState((st) => ({ ...st, now: Date.now() })), 60_000)
    window.addEventListener('crm-action:done', load)
    window.addEventListener('focus', load)
    return () => {
      clearInterval(tick)
      window.removeEventListener('crm-action:done', load)
      window.removeEventListener('focus', load)
    }
  }, [load])

  // "Not today": off the list until tomorrow.
  const skipToday = useCallback(async (contactId) => {
    const tomorrow = localDateKey(new Date(Date.now() + 86_400_000))
    setState((st) => ({ ...st, skips: new Set([...st.skips, contactId]) }))
    await supabase.from('dial_skips').upsert({ contact_id: contactId, until_date: tomorrow }, { onConflict: 'user_id,contact_id' })
  }, [])

  return { ...state, reload: load, skipToday }
}
```

- [ ] **Step 2: Commit** `git add src/lib/useDialList.js && git commit -m "feat: useDialList data hook"`

---

### Task 5: `DialList` section in the Calls lane

**Files:** Create `src/components/DialList.jsx`, `src/components/DialList.render.test.jsx`

- [ ] **Step 1: Write the failing render test**

```jsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import React from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
vi.mock('./PersonSheet', () => ({ openPerson: () => {} }))
const { default: DialList } = await import('./DialList')

const NOW = new Date(2026, 9, 28, 12).getTime()
const item = (o) => ({ id: 'a', book: 'bay', kind: 'attempt', step: 3, calls: 2, dueAt: NOW - 1000, label: 'Attempt 3', hint: 'try afternoon', textKey: 'a3', row: { id: 'a', name: 'Sam Golden', phone: '9137135946', lead_source: 'Lendingflow', business_id: 'bay' }, ...o })

async function render(props) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => createRoot(host).render(React.createElement(DialList, { now: NOW, onDial: () => {}, ...props })))
  return host
}

describe('DialList', () => {
  it('lists due-now and later-today leads with attempt pips, label, time and a call link', async () => {
    const onDial = vi.fn()
    const host = await render({ dueNow: [item()], laterToday: [item({ id: 'b', step: 2, calls: 1, dueAt: NOW + 2.5 * 3600000, label: 'Attempt 2', hint: null, row: { id: 'b', name: 'Dawn Gast', phone: '1', business_id: 'bay' } })], onDial })
    const rows = host.querySelectorAll('[data-dial-row]')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('Sam Golden')
    expect(rows[0].textContent).toContain('Attempt 3 · due now · try afternoon')
    expect(rows[0].querySelectorAll('[data-pip="on"]')).toHaveLength(2)
    expect(rows[0].querySelector('a[href="tel:9137135946"]')).not.toBe(null)
    expect(rows[1].textContent).toContain('2:30 PM')
    await act(async () => host.querySelector('[data-start-dialing]').click())
    expect(onDial).toHaveBeenCalledWith(0)
  })
  it('says when nobody is due', async () => {
    const host = await render({ dueNow: [], laterToday: [] })
    expect(host.textContent).toContain('No lead calls due right now')
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (`npx vitest run src/components/DialList.render.test.jsx`)

- [ ] **Step 3: Implement**

```jsx
// The Calls lane's "Lead cadence" section (spec: The daily list): leads due
// now, then later today, each with its attempt pips and a call link. Start
// dialing / a row opens the Dialer at that lead.
import PersonLink from './PersonLink'
import BizBadge from './BizBadge'
import { telHref } from '../lib/phone'
import { ATTEMPTS, whenLabel } from '../lib/dialList'

export function Pips({ item }) {
  if (item.kind !== 'attempt' && item.kind !== 'move_nurture') return null
  return (
    <span className="inline-flex gap-[3px] align-middle" aria-label={`${item.calls} of ${ATTEMPTS} attempts`}>
      {Array.from({ length: ATTEMPTS }, (_, i) => (
        <span key={i} data-pip={i < item.calls ? 'on' : 'off'} className={`h-[7px] w-[7px] rounded-full border ${i < item.calls ? 'border-[color:var(--chrome)] bg-[color:var(--chrome)]' : 'border-line2'}`} />
      ))}
    </span>
  )
}

function Row({ item, index, now, onDial }) {
  const r = item.row
  const tel = telHref(r.phone)
  return (
    // The row opens the dialer; the name (PersonLink, its own button that stops
    // propagation) opens the contact card. A div, so no button nests in a button.
    <div data-dial-row className="flex items-center gap-3 border-b border-line px-4 py-2.5">
      <div role="button" tabIndex={0} onClick={() => onDial(index)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onDial(index)} className="min-w-0 flex-1 cursor-pointer text-left" aria-label={`Dial ${r.name || 'lead'}`}>
        <div className="flex min-w-0 items-center gap-2">
          <BizBadge biz={item.book} />
          <PersonLink id={r.id} url={r.crm_profile_url} className="min-w-0 truncate text-[14px] font-semibold">{r.name || '(no name)'}</PersonLink>
          {r.lead_source && <span className="max-w-[120px] flex-none truncate rounded-full border border-line2 px-2 text-[11px] font-semibold text-muted">{r.lead_source}</span>}
        </div>
        <div className="mt-1 flex items-center gap-2 text-[12.5px] text-muted">
          <Pips item={item} />
          <span>{[item.label, whenLabel(item, now), item.hint].filter(Boolean).join(' · ')}</span>
        </div>
      </div>
      {tel && (
        <a href={tel} aria-label={`Call ${r.name || 'lead'}`} className="grid h-10 w-10 flex-none place-items-center rounded-[10px] text-muted hover:bg-hoverbg">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" /></svg>
        </a>
      )}
    </div>
  )
}

// dueNow / laterToday: buildDialList output. onDial(index): open the dialer at
// that position in [...dueNow, ...laterToday].
export default function DialList({ dueNow, laterToday, now = Date.now(), onDial }) {
  const all = [...dueNow, ...laterToday]
  return (
    <section aria-label="Lead cadence">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 pb-1.5 pt-3">
        <div className="text-[12px] font-bold uppercase tracking-wide text-muted">
          Lead cadence <span className="num font-semibold text-dim">{dueNow.length}</span>
          {laterToday.length > 0 && <span className="font-semibold normal-case text-dim"> · {laterToday.length} later today</span>}
        </div>
        {all.length > 0 && (
          <button type="button" data-start-dialing onClick={() => onDial(0)} className="min-h-[34px] rounded-[10px] px-3 text-[13px] font-bold text-white" style={{ background: 'var(--chrome)' }}>
            Start dialing
          </button>
        )}
      </div>
      {all.length === 0 && <div className="border-b border-line px-4 py-3 text-[13px] text-muted">No lead calls due right now.</div>}
      {all.map((it, i) => <Row key={`${it.id}:${it.kind}:${it.step}`} item={it} index={i} now={now} onDial={onDial} />)}
    </section>
  )
}
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `git add src/components/DialList.jsx src/components/DialList.render.test.jsx && git commit -m "feat: Lead cadence section for the Calls lane"`

---

### Task 6: `Dialer` focus mode

**Files:** Create `src/components/Dialer.jsx`, `src/components/Dialer.render.test.jsx`

Behavior (spec: The dialer):
- Card: book badge, name, stage, source, pips + label + hint, number (large), **Call on phone** (`tel:`), **Open CRM** (`crm_profile_url`).
- Outcomes: **No answer** → `log_call` `No Answer`; **Left voicemail** → `Left Message`; both 1 min, `nextStep: 'scheduled'` (the cadence is the next step), `setStage: callStageAdvance(book, stage)`. **Connected** → existing Log call form (`QuickActions` with `only={[]}` and `autoOpen="call"`), next lead when it closes. **Bad number** → `Bad Number`, then (Bayway) Move to Nurture / Mark Lost (`set_stage` `lost`, reason `Unreachable`).
- After a no answer / voicemail: the template for that step (`textFor`) as a **Text** link (`smsHref`), then **Log text** (`add_note` body `Texted: <text>`), and **Next**. Bayway attempt 6 (and `move_nurture` items) show **Move to Nurture** (`set_stage` `nurture`) first.
- **Skip** (to the end of this run), **Not today** (`skipToday`), **Next**; a summary at the end (calls, connected, texts).
- Errors from crm-action show inline with Retry; nothing advances on an error.

- [ ] **Step 1: Write the failing render test**

```jsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import React from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const invoke = vi.fn()
vi.mock('../lib/supabase', () => ({
  isDemoMode: false,
  supabase: {
    from: () => { const q = {}; for (const m of ['select', 'eq', 'in', 'gte', 'order', 'limit']) q[m] = () => q; q.maybeSingle = async () => ({ data: { value: { bay: true, mpg: true } }, error: null }); q.then = (r) => r({ data: [], error: null }); return q },
    functions: { invoke: (...a) => invoke(...a) },
  },
}))
vi.mock('./PersonSheet', () => ({ openPerson: () => {} }))
const { default: Dialer } = await import('./Dialer')

const item = (o = {}) => ({ id: 'a', book: 'bay', kind: 'attempt', step: 1, calls: 0, dueAt: 0, label: 'Attempt 1', hint: 'speed to lead', textKey: 'a1', row: { id: 'a', name: 'Sam Golden', phone: '9137135946', stage: 'New Lead', business_id: 'bay', crm_profile_url: '#' }, ...o })
const ok = (steps) => ({ data: { status: 'ok', results: steps.map((step) => ({ step, ok: true })) }, error: null })
const button = (t) => [...document.querySelectorAll('button, a')].find((b) => b.textContent.trim().startsWith(t))
const click = (el) => act(async () => el.click())

async function open(items, extra = {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const onClose = vi.fn()
  const skipToday = vi.fn(async () => {})
  await act(async () => createRoot(host).render(React.createElement(Dialer, { items, start: 0, onClose, skipToday, ...extra })))
  return { onClose, skipToday }
}

beforeEach(() => {
  document.body.innerHTML = ''
  invoke.mockReset()
  invoke.mockResolvedValue(ok(['log_call', 'set_stage']))
})

describe('Dialer', () => {
  it('logs a no answer, moves a New Lead to Attempted, then offers the attempt-1 text', async () => {
    await open([item()])
    expect(document.body.textContent).toContain('(913) 713-5946')
    expect(button('Call on phone').getAttribute('href')).toBe('tel:9137135946')
    await click(button('No answer'))
    expect(invoke.mock.calls[0][1].body).toMatchObject({ action: 'log_call', contact_id: 'a', payload: { outcome: 'No Answer', duration_min: 1, next_step: 'scheduled', set_stage: 'attempted' } })
    const text = button('Text')
    expect(text.getAttribute('href')).toMatch(/^sms:9137135946\?&body=Hi%20Sam%2C%20this%20is%20Chandler/)
    invoke.mockResolvedValue(ok(['add_note']))
    await click(button('Log text'))
    expect(invoke.mock.calls[1][1].body).toMatchObject({ action: 'add_note', contact_id: 'a', payload: { body: expect.stringMatching(/^Texted: Hi Sam/) } })
  })

  it('offers Move to Nurture after the sixth Bayway attempt', async () => {
    await open([item({ step: 6, calls: 5, label: 'Attempt 6', textKey: 'a6', row: { ...item().row, stage: 'Attempted' } })])
    await click(button('Left voicemail'))
    expect(invoke.mock.calls[0][1].body.payload).toMatchObject({ outcome: 'Left Message' })
    invoke.mockResolvedValue(ok(['set_stage']))
    await click(button('Move to Nurture'))
    expect(invoke.mock.calls[1][1].body).toMatchObject({ action: 'set_stage', contact_id: 'a', payload: { target: 'nurture' } })
  })

  it('skips, takes a lead off for today, and ends with a summary', async () => {
    const { skipToday, onClose } = await open([item(), item({ id: 'b', row: { ...item().row, id: 'b', name: 'Dawn Gast' } })])
    await click(button('Not today'))
    expect(skipToday).toHaveBeenCalledWith('a')
    expect(document.body.textContent).toContain('Dawn Gast')
    await click(button('Next'))
    expect(document.body.textContent).toContain('Done for now')
    await click(button('Close'))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows a CRM error with Retry and stays on the lead', async () => {
    invoke.mockResolvedValue({ data: { status: 'error', results: [{ step: 'log_call', ok: false, error: 'FUB down' }] }, error: null })
    await open([item()])
    await click(button('No answer'))
    expect(document.querySelector('[role="alert"]').textContent).toContain('FUB down')
    expect(document.body.textContent).toContain('Sam Golden')
  })
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement**

```jsx
// One lead at a time (spec: The dialer). Calls go out on Chandler's phone or
// in the CRM; this logs the outcome through crm-action and offers the text
// for the step. items: [...dueNow, ...laterToday] at the moment dialing began.
import { useState } from 'react'
import QuickActions, { Sheet, quickActionTone } from './QuickActions'
import BizBadge from './BizBadge'
import { Pips } from './DialList'
import { invokeCrmAction } from '../lib/writeback'
import { buildActionRequest, summarizeResult, callStageAdvance, CRM_LABEL } from '../lib/crmActions'
import { formatPhone, telHref } from '../lib/phone'
import { textFor, smsHref } from '../lib/dialTexts'

const quiet = 'min-h-[40px] rounded-[10px] border border-line2 px-3 text-[13px] font-semibold text-[#344054]'

export default function Dialer({ items, start = 0, onClose, skipToday }) {
  const [queue, setQueue] = useState(() => items.slice(start).concat(items.slice(0, start)))
  const [pos, setPos] = useState(0)
  const [phase, setPhase] = useState('call') // call | after | bad | log
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [stats, setStats] = useState({ calls: 0, connected: 0, texts: 0 })
  const it = queue[pos]
  const t = quickActionTone(it?.book || 'bay')

  const next = () => {
    setPhase('call')
    setError(null)
    setPos((p) => p + 1)
  }

  const send = async (request, after) => {
    setBusy(true)
    setError(null)
    const res = await invokeCrmAction(request)
    const summary = summarizeResult(res, it.book)
    setBusy(false)
    if (summary.tone === 'error') {
      setError({ text: summary.text, retry: () => send(request, after) })
      return
    }
    after()
  }

  const logOutcome = (outcome) =>
    send(
      buildActionRequest({ action: 'log_call', contactId: it.id, outcome, durationMin: 1, nextStep: 'scheduled', setStage: callStageAdvance(it.book, it.row.stage) }),
      () => {
        setStats((s) => ({ ...s, calls: s.calls + 1 }))
        setPhase(outcome === 'Bad Number' ? 'bad' : 'after')
      },
    )

  const move = (target, reason) => send(buildActionRequest({ action: 'set_stage', contactId: it.id, target, reason }), next)

  if (!it) {
    return (
      <Sheet title="Done for now" subtitle="Lead cadence" t={t} onClose={onClose}>
        <div className="text-[14px]">{stats.calls} calls · {stats.connected} connected · {stats.texts} texts</div>
        <button type="button" onClick={onClose} className={`${quiet} mt-4 w-full`}>Close</button>
      </Sheet>
    )
  }

  const r = it.row
  const text = textFor(it.book, it.textKey, r.name)
  const parkPrompt = it.book === 'bay' && (it.kind === 'move_nurture' || (it.kind === 'attempt' && it.step === 6))

  return (
    <Sheet title={r.name || '(no name)'} subtitle={`${pos + 1} of ${queue.length} · ${it.label}`} t={t} onClose={onClose}>
      <div className="flex items-center gap-2 text-[13px] text-muted">
        <BizBadge biz={it.book} /> <span>{r.stage}</span> {r.lead_source && <span>· {r.lead_source}</span>}
      </div>
      <div className="mt-2 flex items-center gap-2 text-[12.5px] text-muted">
        <Pips item={it} /> <span>{[it.label, it.hint].filter(Boolean).join(' · ')}</span>
      </div>
      <div className="num mt-3 text-[24px] font-bold">{formatPhone(r.phone) || 'No phone'}</div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {telHref(r.phone) && <a href={telHref(r.phone)} className={`${quiet} grid place-items-center`}>Call on phone</a>}
        {r.crm_profile_url && <a href={r.crm_profile_url} target="_blank" rel="noreferrer" className={`${quiet} grid place-items-center`}>Open {CRM_LABEL[it.book]}</a>}
      </div>

      {error && (
        <div role="alert" className="mt-3 rounded-[10px] border px-3 py-2 text-[12.5px]" style={{ borderColor: '#f2b8b4', background: 'var(--neg-bg)', color: 'var(--neg-ink)' }}>
          {error.text}
          <button type="button" onClick={error.retry} className="ml-2 font-semibold underline">Retry</button>
        </div>
      )}

      {phase === 'call' && (
        <>
          {it.kind === 'move_nurture' && (
            <button type="button" disabled={busy} onClick={() => move('nurture')} className="mt-4 min-h-[42px] w-full rounded-[10px] text-[13.5px] font-bold text-white" style={{ background: t.accent }}>Move to Nurture</button>
          )}
          <div className="mt-4 text-[12px] font-semibold text-dim">How did it go?</div>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            <button type="button" disabled={busy} className={quiet} onClick={() => logOutcome('No Answer')}>No answer</button>
            <button type="button" disabled={busy} className={quiet} onClick={() => logOutcome('Left Message')}>Left voicemail</button>
            <button type="button" disabled={busy} className={quiet} onClick={() => setPhase('log')} style={{ color: 'var(--pos-ink)' }}>Connected</button>
            <button type="button" disabled={busy} className={quiet} onClick={() => logOutcome('Bad Number')}>Bad number</button>
          </div>
        </>
      )}

      {phase === 'log' && (
        <QuickActions
          businessId={it.book}
          contactId={it.id}
          contactName={r.name}
          hasPhone={!!r.phone}
          stage={it.book === 'bay' ? r.stage : null}
          only={[]}
          autoOpen="call"
          onDone={() => setStats((s) => ({ ...s, calls: s.calls + 1, connected: s.connected + 1 }))}
          onSheetClose={next}
        />
      )}

      {phase === 'after' && (
        <div className="mt-4 flex flex-col gap-2">
          {parkPrompt && <button type="button" disabled={busy} onClick={() => move('nurture')} className="min-h-[42px] rounded-[10px] text-[13.5px] font-bold text-white" style={{ background: t.accent }}>Move to Nurture</button>}
          {text && smsHref(r.phone, text) && (
            <>
              <div className="rounded-[10px] bg-panel2 px-3 py-2 text-[12.5px]">{text}</div>
              <div className="grid grid-cols-2 gap-2">
                <a href={smsHref(r.phone, text)} className={`${quiet} grid place-items-center`}>Text</a>
                <button type="button" disabled={busy} className={quiet} onClick={() => send(buildActionRequest({ action: 'add_note', contactId: it.id, body: `Texted: ${text}` }), () => setStats((s) => ({ ...s, texts: s.texts + 1 })))}>Log text</button>
              </div>
            </>
          )}
        </div>
      )}

      {phase === 'bad' && it.book === 'bay' && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" disabled={busy} className={quiet} onClick={() => move('nurture')}>Move to Nurture</button>
          <button type="button" disabled={busy} className={quiet} onClick={() => move('lost', 'Unreachable')}>Mark Lost</button>
        </div>
      )}

      {phase !== 'log' && (
        <div className="mt-4 flex gap-2 border-t border-line pt-3">
          <button type="button" className={quiet} onClick={() => { setQueue((q) => [...q.slice(0, pos), ...q.slice(pos + 1), it]); setPhase('call'); setError(null) }}>Skip</button>
          <button type="button" className={quiet} onClick={async () => { await skipToday(it.id); next() }}>Not today</button>
          <button type="button" className={`${quiet} ml-auto`} onClick={next}>Next</button>
        </div>
      )}
    </Sheet>
  )
}
```

Check before running: `LOST_REASONS` includes `'Unreachable'` (`src/lib/crmActions.js`) — it does; `buildActionRequest` passes `reason` for `set_stage`.

- [ ] **Step 4: Run — expect PASS.** `npx vitest run src/components/Dialer.render.test.jsx`
- [ ] **Step 5: Commit** `git add src/components/Dialer.jsx src/components/Dialer.render.test.jsx && git commit -m "feat: one-at-a-time dialer with outcomes and texts"`

---

### Task 7: Workbench wiring and no duplicates in Up Next

**Files:** Modify `src/pages/Priority.jsx`, `src/pages/Workbench.jsx`; test in `src/pages/Priority.render.test.jsx`

- [ ] **Step 1: Failing test** — append to `src/pages/Priority.render.test.jsx` (reuse its mount/mocks):

```jsx
it('leaves out leads the dial list already shows (hideIds)', async () => {
  mobile = false
  DATA.signals = [
    lead({ id: 'a', name: 'Ana Inbound', last_inbound_at: iso(0, 1) }),
    lead({ id: 'b', name: 'Ben Overdue', open_task_count: 1, oldest_open_due_at: iso(3) }),
  ]
  await refreshPriorityQueue()
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    createRoot(host).render(React.createElement(MemoryRouter, null, React.createElement(Priority, { embedded: true, hideIds: new Set(['a']) })))
  })
  await act(async () => {})
  expect(host.textContent).not.toContain('Ana Inbound')
  expect(host.textContent).toContain('Ben Overdue')
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: `Priority.jsx`**

```jsx
// hideIds: Workbench passes the dial list's leads so no one shows twice.
export default function Priority({ embedded = false, hideIds = null }) {
  const { biz } = useBusiness()
  const { queue: all, rules, touchedToday, loading, error } = usePriorityQueue(biz)
  const queue = hideIds ? all.filter((r) => !hideIds.has(r.id)) : all
```
(Leave the rest of the component as is; it reads `queue`.)

- [ ] **Step 4: `Workbench.jsx`** — in the Calls lane, above `<Priority embedded />`:

```jsx
import { useDialList } from '../lib/useDialList'
import { buildDialList } from '../lib/dialList'
import DialList from '../components/DialList'
import Dialer from '../components/Dialer'
// inside Workbench():
const dial = useDialList()
const dialDue = buildDialList(dial.rows, { now: dial.now, skips: dial.skips, inBook })
const dialItems = [...dialDue.dueNow, ...dialDue.laterToday]
const dialIds = new Set(dialItems.map((i) => i.id))
const [dialAt, setDialAt] = useState(null)
// Calls lane body:
<DialList dueNow={dialDue.dueNow} laterToday={dialDue.laterToday} now={dial.now} onDial={setDialAt} />
<Priority embedded hideIds={dialIds} />
// after the lanes:
{dialAt != null && <Dialer items={dialItems} start={dialAt} skipToday={dial.skipToday} onClose={() => { setDialAt(null); dial.reload() }} />}
```
Move `const inBook = ...` above its first use if needed. Phone tab label: `` `Calls · ${toGo + dialDue.dueNow.length}` ``; desktop lane count: `` `${toGo + dialDue.dueNow.length} to go` ``.

- [ ] **Step 5: Run the full suite** `npx vitest run` — expect all passing except the known flaky time-of-day `Pipeline.render.test.jsx` "9d/8d" case and the known SearchPalette/Workbench unhandled mock errors. If `Workbench.render.test.jsx` breaks because its supabase mock lacks `v_dial_contacts` / `dial_skips` / `.gt`, add `gt` to its chain and return `[]` for those tables.
- [ ] **Step 6: Commit** `git add src/pages/Priority.jsx src/pages/Workbench.jsx src/pages/Priority.render.test.jsx src/pages/Workbench.render.test.jsx && git commit -m "feat: dial list and dialer in the Workbench Calls lane"`

---

### Task 8: Spec note, deploy, verify, PR

- [ ] **Step 1: Spec** — in `docs/superpowers/specs/2026-10-29-dialer-cadence-design.md` replace the "Tapping Text logs a FUB note … with Undo" bullet with: "Text opens Messages with the template; **Log text** then records `Texted: <text>` as a CRM note (crm-action `add_note`). The OS can't delete a CRM note, so logging waits for that tap." Commit.
- [ ] **Step 2: Build** `npx vite build` — expect success.
- [ ] **Step 3: Ask Chandler** to approve applying `0049` (`supabase db push --linked`, with the temporary 0044 copy as in Task 1). No edge-function deploy is needed.
- [ ] **Step 4: Browser (dev server, live data, phone size 375×812 and desktop)**: Calls lane shows Lead cadence with pips and times; Up Next has no duplicates; Start dialing walks leads; on a lead Chandler is actually calling, No answer logs in FUB/Zoho and the Text link opens Messages. Don't log outcomes on real leads that weren't called. Check the console for errors.
- [ ] **Step 5: PR** to `main` with the migration note, test results and screenshots; merge only when Chandler says so.

---

## Self-review

- Spec coverage (phase 1): both books' attempts 1–6 (Task 3), MPG nurture/cold by calls (Task 3), Bayway move-to-Nurture prompt and parked Nurture / Credit Repair cadences (Tasks 3, 6), connected ends cadence (Task 1 `call_connected`, Task 3), weekend roll (Task 3), dialer outcomes / skip / not today / summary (Task 6), texts and `sms:` (Tasks 2, 6), Calls lane placement with no duplicates (Task 7), `dial_skips` (Tasks 1, 4). Weekday themes, agents and `settings.dial_cadence` are phases 2–3.
- Deviation, recorded in Task 8: text logging is a confirm tap, not log-on-tap with Undo. Dialer is a modal sheet on desktop too (spec suggested beside the list); fine for v1.
- Names used across tasks: `dialItem`, `buildDialList`, `whenLabel`, `attemptDue`, `businessDay`, `ATTEMPTS`, `textFor`, `smsHref`, `firstName`, `TEXTS`, `useDialList` (`rows`, `skips`, `now`, `reload`, `skipToday`), `DialList` (`dueNow`, `laterToday`, `now`, `onDial`), `Pips`, `Dialer` (`items`, `start`, `onClose`, `skipToday`), `Priority` `hideIds`.
