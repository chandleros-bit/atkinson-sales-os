# MPG tracker, slice 1 (touch log, Log visit, Visits export) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Log MPG walk-in visits in the OS (on a phone, at the door) and copy each day's visits, already in column order, into the "Chandler Visits" tab of the manager's tracker.

**Architecture:** Three new app-owned, per-user tables (`mpg_prospect_lists`, `mpg_prospects`, `mpg_touches`), created now so later slices don't need schema churn. Slice 1 writes only prospects and touches.

- **Pure helpers** in `src/lib/mpgTracker.js`: row builder, sheet formatting, validation.
- **Supabase calls** in `src/lib/mpgTouches.js`.
- **UI:** a `LogVisitDialog`, reached from **+ New** and from an MPG person sheet, and a `DailyTracker` panel shown as a new **Daily tracker** tab on Reports (MPG view only).

**Nothing here promotes a visit to Zoho.** That is slice 2. Visits to businesses that are already Zoho leads write a Zoho note (and a follow-up task) through the existing `crm-action` `add_note` / `create_task`.

**Spec:** `docs/superpowers/specs/2026-11-05-mpg-tracker-touch-log-design.md` (sections Data model, Capture → Log visit, Daily tracker export).

**Tech Stack:** React 18 + Vite + Tailwind, Supabase JS, Vitest (jsdom render tests in the repo's existing style, no Testing Library).

**Later slices (separate plans, written after this one ships):**
2. Promotion to Zoho.
3. Follow-ups (Log call outcomes, Log touch, Follow-ups block).
4. Prospect lists + dialer prospect mode + cold-calls line.
5. ISV.
6. Backfill from the current sheet.

---

## Files

- **Create** `supabase/migrations/0060_mpg_touch_log.sql`: the three tables, indexes, own-row RLS and `updated_at` triggers.
- **Create** `src/lib/mpgTracker.js` + `src/lib/mpgTracker.test.js`: pure helpers.
  - formatting: `phoneKey`, `cellText`, `sheetDate`, `yesNo`, `contactLabel`, `reachLabel`,
  - dates: `occurredAtFor`, `dayRange`,
  - building and exporting: `buildVisit`, `visitRow`, `toTsv`, `zohoVisitNote`, `newSinceCopy`,
  - copy state: `readCopied`, `writeCopied`.
- **Create** `src/lib/mpgTouches.js`: Supabase calls (`searchMpgBusinesses`, `saveVisit`, `updateTouch`, `deleteTouch`, `fetchTouchesForDay`) and a change bus.
- **Create** `src/components/LogVisitDialog.jsx` + `src/components/LogVisitDialog.render.test.jsx`.
- **Create** `src/components/DailyTracker.jsx` + `src/components/DailyTracker.render.test.jsx`.
- **Modify** `src/components/QuickAddMenu.jsx`: optional "Log visit…" item.
- **Modify** `src/components/NewMenu.jsx`: show it outside the Bayway view; open the dialog.
- **Modify** `src/components/PersonSheet.jsx`: a "Log visit" button for MPG people.
- **Modify** `src/pages/Reports.jsx`: a `tracker` tab, MPG view only, rendering `DailyTracker`.

Run single test files with `npx vitest run <path>`, and the whole suite with `npx vitest run`.

---

### Task 1: Migration

**Files:**
- Create: `supabase/migrations/0060_mpg_touch_log.sql`

- [ ] **Step 1: Write the migration**

```sql
-- MPG touch log (spec: docs/superpowers/specs/2026-11-05-mpg-tracker-touch-log-design.md).
-- App-owned and per user, like work_items (0041): never synced to Zoho.
--   mpg_prospect_lists  one row per imported call list (used from slice 4)
--   mpg_prospects       businesses the OS knows that are not (yet) Zoho leads
--   mpg_touches         one row per touch; the only table the tracker export reads

create table if not exists mpg_prospect_lists (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid(),
  name        text not null,
  source      text,
  imported_at timestamptz not null default now(),
  row_count   int not null default 0
);

create table if not exists mpg_prospects (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid(),
  kind           text not null default 'merchant' check (kind in ('merchant', 'isv')),
  list_id        uuid references mpg_prospect_lists(id) on delete set null,
  business_name  text not null check (nullif(trim(business_name), '') is not null),
  contact_name   text,
  contact_role   text,
  phone          text,
  phone_key      text,
  email          text,
  address        text,
  category       text,
  platform       text,
  isv_stage      text check (isv_stage in ('new_prospect', 'contacted', 'discovery', 'technical_review',
                                           'proposal', 'agreement', 'live', 'not_a_fit')),
  temperature    text check (temperature in ('hot', 'warm', 'cold')),
  status         text not null default 'new'
                 check (status in ('new', 'working', 'cold', 'bad_number', 'promoted')),
  zoho_lead_id   text,
  promoted_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists mpg_prospects_user_phone on mpg_prospects (user_id, phone_key);
create index if not exists mpg_prospects_user_list on mpg_prospects (user_id, list_id, status);

create table if not exists mpg_touches (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid(),
  occurred_at     timestamptz not null default now(),
  channel         text not null check (channel in
                  ('walk_in', 'cold_call', 'follow_up_call', 'email', 'social', 'isv')),
  prospect_id     uuid references mpg_prospects(id) on delete set null,
  contact_id      uuid references contacts(id) on delete set null,
  business_name   text not null check (nullif(trim(business_name), '') is not null),
  contact_label   text,
  reach_label     text,
  notes           text,
  next_step       text,
  follow_up_on    date,
  temperature     text check (temperature in ('hot', 'warm', 'cold')),
  call_result     text check (call_result in ('no_answer', 'voicemail', 'gatekeeper', 'dm_reached', 'bad_number')),
  dm_conversation boolean not null default false,
  statement       boolean not null default false,
  demo_proposal   boolean not null default false,
  application     boolean not null default false,
  boarded         boolean not null default false,
  isv_stage       text,
  crm_action_id   uuid references crm_actions(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
-- A touch whose prospect or contact was deleted keeps its snapshot text, so the
-- subject check applies on insert only (enforced in the app), not as a constraint.
-- The export reads one user, one channel and an occurred_at range.
create index if not exists mpg_touches_user_channel_occurred on mpg_touches (user_id, channel, occurred_at);
create index if not exists mpg_touches_prospect on mpg_touches (prospect_id) where prospect_id is not null;
create index if not exists mpg_touches_contact on mpg_touches (contact_id) where contact_id is not null;

-- Own-row RLS on all three, same four policies as work_items.
do $$
declare t text;
begin
  foreach t in array array['mpg_prospect_lists', 'mpg_prospects', 'mpg_touches']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "own %1$s select" on %1$I', t);
    execute format('create policy "own %1$s select" on %1$I for select to authenticated using (user_id = auth.uid())', t);
    execute format('drop policy if exists "own %1$s insert" on %1$I', t);
    execute format('create policy "own %1$s insert" on %1$I for insert to authenticated with check (user_id = auth.uid())', t);
    execute format('drop policy if exists "own %1$s update" on %1$I', t);
    execute format('create policy "own %1$s update" on %1$I for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('drop policy if exists "own %1$s delete" on %1$I', t);
    execute format('create policy "own %1$s delete" on %1$I for delete to authenticated using (user_id = auth.uid())', t);
  end loop;
end $$;

-- FK checks bypass RLS, so the generic insert/update policies above would let a
-- user point a touch at another user's prospect, or a prospect at another user's
-- list, or at a contact outside MPG. Recreate those four policies with explicit
-- ownership checks on the parent.
drop policy if exists "own mpg_prospects insert" on mpg_prospects;
create policy "own mpg_prospects insert" on mpg_prospects for insert to authenticated
  with check (
    user_id = auth.uid()
    and (list_id is null or exists (select 1 from mpg_prospect_lists l where l.id = list_id and l.user_id = auth.uid()))
  );
drop policy if exists "own mpg_prospects update" on mpg_prospects;
create policy "own mpg_prospects update" on mpg_prospects for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (list_id is null or exists (select 1 from mpg_prospect_lists l where l.id = list_id and l.user_id = auth.uid()))
  );

drop policy if exists "own mpg_touches insert" on mpg_touches;
create policy "own mpg_touches insert" on mpg_touches for insert to authenticated
  with check (
    user_id = auth.uid()
    and (prospect_id is null or exists (select 1 from mpg_prospects p where p.id = prospect_id and p.user_id = auth.uid()))
    and (contact_id is null or exists (select 1 from contacts c where c.id = contact_id and c.business_id = 'mpg' and public.can_read_book('mpg')))
  );
drop policy if exists "own mpg_touches update" on mpg_touches;
create policy "own mpg_touches update" on mpg_touches for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (prospect_id is null or exists (select 1 from mpg_prospects p where p.id = prospect_id and p.user_id = auth.uid()))
    and (contact_id is null or exists (select 1 from contacts c where c.id = contact_id and c.business_id = 'mpg' and public.can_read_book('mpg')))
  );

create or replace function public.mpg_touch_log_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists mpg_prospects_touch on mpg_prospects;
create trigger mpg_prospects_touch before update on mpg_prospects
  for each row execute function public.mpg_touch_log_touch();
drop trigger if exists mpg_touches_touch on mpg_touches;
create trigger mpg_touches_touch before update on mpg_touches
  for each row execute function public.mpg_touch_log_touch();
```

Note: the spec's `mpg_touches_has_subject` check is dropped in favour of an app-side check. `on delete set null` on both foreign keys would otherwise make deleting a prospect fail. The spec gets this same note in Task 8.

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0060_mpg_touch_log.sql
git commit -m "feat: MPG touch log tables (prospects, lists, touches)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Do **not** run `supabase db push` here. The migration is applied in Task 8, after the user says OK.

---

### Task 2: Formatting helpers (TDD)

**Files:**
- Create: `src/lib/mpgTracker.js`
- Test: `src/lib/mpgTracker.test.js`

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect } from 'vitest'
import { phoneKey, cellText, sheetDate, yesNo, contactLabel, reachLabel, toTsv } from './mpgTracker'

describe('phoneKey', () => {
  it('keeps the 10 US digits', () => {
    expect(phoneKey('832-474-7707')).toBe('8324747707')
    expect(phoneKey('+1 (832) 474-7707')).toBe('8324747707')
  })
  it('is null for anything that is not a 10-digit US number', () => {
    expect(phoneKey('281767-898')).toBe(null)
    expect(phoneKey('')).toBe(null)
    expect(phoneKey(null)).toBe(null)
  })
})

describe('cellText', () => {
  it('turns null into an empty cell', () => {
    expect(cellText(null)).toBe('')
    expect(cellText(undefined)).toBe('')
  })
  it('replaces tabs and line breaks so a note stays in one cell', () => {
    expect(cellText('wants\tlower\nrates\r\nnow')).toBe('wants · lower · rates · now')
  })
  it('keeps Excel from reading text as a formula', () => {
    expect(cellText('+1 832 474 7707')).toBe(' +1 832 474 7707')
    expect(cellText('=SUM(A1)')).toBe(' =SUM(A1)')
    expect(cellText('-15% fee')).toBe(' -15% fee')
    expect(cellText('@owner')).toBe(' @owner')
  })
  it('trims ordinary text', () => {
    expect(cellText('  Feges BBQ ')).toBe('Feges BBQ')
  })
})

describe('sheetDate', () => {
  it('formats a day key as M/D/YYYY', () => {
    expect(sheetDate('2026-11-05')).toBe('11/5/2026')
  })
  it('formats a timestamp by its local day', () => {
    const d = new Date(2026, 9, 3, 23, 30) // Oct 3, 11:30 PM local
    expect(sheetDate(d.toISOString())).toBe('10/3/2026')
  })
  it('is empty for no date', () => {
    expect(sheetDate(null)).toBe('')
  })
})

describe('labels', () => {
  it('yesNo', () => {
    expect(yesNo(true)).toBe('Yes')
    expect(yesNo(false)).toBe('No')
    expect(yesNo(null)).toBe('No')
  })
  it('contactLabel joins name and role', () => {
    expect(contactLabel('Jimmy', 'Manager')).toBe('Jimmy / Manager')
    expect(contactLabel('Jimmy', '')).toBe('Jimmy')
    expect(contactLabel('', 'Owner')).toBe('Owner')
    expect(contactLabel(' ', null)).toBe(null)
  })
  it('reachLabel joins phone and email', () => {
    expect(reachLabel('832-474-7707', 'jimmy@njr.com')).toBe('832-474-7707 / jimmy@njr.com')
    expect(reachLabel('', 'jimmy@njr.com')).toBe('jimmy@njr.com')
    expect(reachLabel(null, null)).toBe(null)
  })
})

describe('toTsv', () => {
  it('joins cells with tabs and rows with line breaks, no header', () => {
    expect(toTsv([['a', 'b'], ['c', '']])).toBe('a\tb\nc\t')
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/lib/mpgTracker.test.js`
Expected: FAIL, because `./mpgTracker` can't be resolved.

- [ ] **Step 3: Implement**

```js
// MPG daily tracker: pure helpers for the touch log and the copy-paste export
// into the manager's workbook (MPG_Chandler_Private_Tracker.xlsx).
// Spec: docs/superpowers/specs/2026-11-05-mpg-tracker-touch-log-design.md
import { localDateKey } from './crmActions'

const trimmed = (v) => (typeof v === 'string' ? v.trim() : '')

// The last 10 digits of a US number, for dedupe. null when it isn't one.
export function phoneKey(raw) {
  let d = String(raw ?? '').replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1)
  return d.length === 10 ? d : null
}

// One pasted cell. Tabs/line breaks would split the paste into extra cells, and
// Excel evaluates text starting with = + - @ as a formula ("+1 832…" too).
export function cellText(v) {
  if (v == null) return ''
  let s = String(v).replace(/[\t\r\n]+/g, ' · ').trim()
  if (/^[=+\-@]/.test(s)) s = ` ${s}`
  return s
}

// 'YYYY-MM-DD' or an ISO timestamp -> 'M/D/YYYY' (the sheet's date validation
// accepts it). A timestamp counts on its local calendar day.
export function sheetDate(v) {
  if (!v) return ''
  const key = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : localDateKey(new Date(v))
  const [y, m, d] = key.split('-').map(Number)
  return `${m}/${d}/${y}`
}

export const yesNo = (b) => (b ? 'Yes' : 'No')

export function contactLabel(name, role) {
  const n = trimmed(name)
  const r = trimmed(role)
  if (n && r) return `${n} / ${r}`
  return n || r || null
}

export function reachLabel(phone, email) {
  const parts = [trimmed(phone), trimmed(email)].filter(Boolean)
  return parts.length ? parts.join(' / ') : null
}

export const toTsv = (rows) => rows.map((r) => r.join('\t')).join('\n')
```

`localDateKey` already exists in `src/lib/crmActions.js` (`export function localDateKey(d)`).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/mpgTracker.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mpgTracker.js src/lib/mpgTracker.test.js
git commit -m "feat: MPG tracker sheet formatting helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Visit builder, Visits row, Zoho note, copy state (TDD)

**Files:**
- Modify: `src/lib/mpgTracker.js`
- Test: `src/lib/mpgTracker.test.js`

- [ ] **Step 1: Append the failing tests**

```js
import { buildVisit, visitRow, zohoVisitNote, occurredAtFor, dayRange, newSinceCopy, readCopied, writeCopied, OUTCOMES } from './mpgTracker'

const NOW = new Date(2026, 10, 5, 15, 0) // Nov 5 2026, 3:00 PM local

const baseForm = {
  dayKey: '2026-11-05',
  business: { type: 'new', name: 'Feges BBQ' },
  contactName: 'Patrick',
  role: 'Owner',
  phone: '713-555-0101',
  email: '',
  notes: 'Pays 3.9% on Square',
  nextStep: 'Bring a quote',
  followUpOn: '2026-11-10',
  temperature: 'warm',
  outcomes: { dm_conversation: true, statement: false, demo_proposal: false, application: false, boarded: false },
}

describe('occurredAtFor', () => {
  it('uses now for today', () => {
    expect(occurredAtFor('2026-11-05', NOW)).toBe(NOW.toISOString())
  })
  it('uses local noon for an earlier day', () => {
    expect(occurredAtFor('2026-11-03', NOW)).toBe(new Date(2026, 10, 3, 12, 0).toISOString())
  })
})

describe('dayRange', () => {
  it('spans local midnight to the next local midnight', () => {
    expect(dayRange('2026-11-05')).toEqual({
      from: new Date(2026, 10, 5).toISOString(),
      to: new Date(2026, 10, 6).toISOString(),
    })
  })
})

describe('buildVisit', () => {
  it('builds a new prospect and its walk-in touch', () => {
    const { prospect, touch } = buildVisit(baseForm, NOW)
    expect(prospect).toEqual({
      kind: 'merchant', business_name: 'Feges BBQ', contact_name: 'Patrick', contact_role: 'Owner',
      phone: '713-555-0101', phone_key: '7135550101', email: null, temperature: 'warm', status: 'working',
    })
    expect(touch).toEqual({
      channel: 'walk_in', occurred_at: NOW.toISOString(), contact_id: null, prospect_id: null,
      business_name: 'Feges BBQ', contact_label: 'Patrick / Owner', reach_label: '713-555-0101',
      notes: 'Pays 3.9% on Square', next_step: 'Bring a quote', follow_up_on: '2026-11-10', temperature: 'warm',
      dm_conversation: true, statement: false, demo_proposal: false, application: false, boarded: false,
    })
  })
  it('points at an existing prospect without creating one', () => {
    const { prospect, touch } = buildVisit({ ...baseForm, business: { type: 'prospect', id: 'p1', name: 'Feges BBQ' } }, NOW)
    expect(prospect).toBe(null)
    expect(touch.prospect_id).toBe('p1')
    expect(touch.contact_id).toBe(null)
  })
  it('points at a Zoho contact', () => {
    const { prospect, touch } = buildVisit({ ...baseForm, business: { type: 'contact', id: 'c1', name: 'NJR Salons' } }, NOW)
    expect(prospect).toBe(null)
    expect(touch.contact_id).toBe('c1')
    expect(touch.business_name).toBe('NJR Salons')
  })
  it('edit mode returns only the touch fields', () => {
    const { prospect, touch } = buildVisit({ ...baseForm, business: { type: 'edit', name: 'Feges BBQ' } }, NOW)
    expect(prospect).toBe(null)
    expect(touch).not.toHaveProperty('contact_id')
    expect(touch).not.toHaveProperty('prospect_id')
    expect(touch).not.toHaveProperty('channel')
  })
  it('allows no rating and no follow-up', () => {
    const { touch } = buildVisit({ ...baseForm, temperature: null, followUpOn: '' }, NOW)
    expect(touch.temperature).toBe(null)
    expect(touch.follow_up_on).toBe(null)
  })
  it('rejects bad input', () => {
    expect(() => buildVisit({ ...baseForm, business: { type: 'new', name: '  ' } }, NOW)).toThrow('Pick or type the business')
    expect(() => buildVisit({ ...baseForm, business: null }, NOW)).toThrow('Pick or type the business')
    expect(() => buildVisit({ ...baseForm, dayKey: '' }, NOW)).toThrow('Pick the visit date')
    expect(() => buildVisit({ ...baseForm, dayKey: '2026-11-06' }, NOW)).toThrow('The visit date is in the future')
    expect(() => buildVisit({ ...baseForm, followUpOn: '11/10' }, NOW)).toThrow('Follow-up date is not a date')
    expect(() => buildVisit({ ...baseForm, temperature: 'lukewarm' }, NOW)).toThrow('Pick Hot, Warm or Cold')
  })
})

describe('visitRow', () => {
  it('lays a touch out in Chandler Visits columns A–M', () => {
    const { touch } = buildVisit(baseForm, NOW)
    expect(visitRow(touch)).toEqual([
      '11/5/2026', 'Feges BBQ', 'Patrick / Owner', '713-555-0101', 'Pays 3.9% on Square',
      'Bring a quote', '11/10/2026', 'Warm', 'Yes', 'No', 'No', 'No', 'No',
    ])
  })
  it('leaves quality and follow-up empty when not set', () => {
    const row = visitRow({ occurred_at: NOW.toISOString(), business_name: 'X', temperature: null, follow_up_on: null })
    expect(row[6]).toBe('')
    expect(row[7]).toBe('')
    expect(row.slice(8)).toEqual(['No', 'No', 'No', 'No', 'No'])
  })
})

describe('zohoVisitNote', () => {
  it('names the visit, rating and outcomes, then the notes', () => {
    const { touch } = buildVisit({ ...baseForm, outcomes: { ...baseForm.outcomes, statement: true } }, NOW)
    expect(zohoVisitNote(touch)).toBe('Walk-in · Warm · Decision-maker conversation, Statement received — Pays 3.9% on Square')
  })
  it('is just "Walk-in" with nothing else', () => {
    expect(zohoVisitNote({ temperature: null, notes: null })).toBe('Walk-in')
  })
})

describe('newSinceCopy', () => {
  const rows = [
    { id: 'a', created_at: '2026-11-05T20:00:00.000Z' },
    { id: 'b', created_at: '2026-11-05T23:30:00.000Z' },
  ]
  it('returns every row when the day was never copied', () => {
    expect(newSinceCopy(rows, null)).toEqual(rows)
  })
  it('returns rows created after the copy', () => {
    expect(newSinceCopy(rows, '2026-11-05T22:00:00.000Z').map((r) => r.id)).toEqual(['b'])
  })
})

describe('copy state', () => {
  it('round-trips through a storage object', () => {
    const store = new Map()
    const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }
    expect(readCopied('2026-11-05', 'visits', storage)).toBe(null)
    writeCopied('2026-11-05', 'visits', '2026-11-05T23:00:00.000Z', storage)
    expect(readCopied('2026-11-05', 'visits', storage)).toBe('2026-11-05T23:00:00.000Z')
  })
  it('never throws when storage is blocked', () => {
    const storage = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
    expect(readCopied('2026-11-05', 'visits', storage)).toBe(null)
    expect(() => writeCopied('2026-11-05', 'visits', 'x', storage)).not.toThrow()
  })
})

describe('OUTCOMES', () => {
  it('lists the five sheet outcomes in column order', () => {
    expect(OUTCOMES.map((o) => o.key)).toEqual(['dm_conversation', 'statement', 'demo_proposal', 'application', 'boarded'])
  })
})
```

Merge the new names into the file's existing `import { … } from './mpgTracker'` line rather than adding a second import.

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/lib/mpgTracker.test.js`
Expected: FAIL, with `buildVisit` (and the others) reported as not a function.

- [ ] **Step 3: Implement (append to `src/lib/mpgTracker.js`)**

```js
// The sheet's five outcome columns (Visits I–M, Follow-ups H–L), in order.
export const OUTCOMES = [
  { key: 'dm_conversation', label: 'Decision-maker conversation' },
  { key: 'statement', label: 'Statement received' },
  { key: 'demo_proposal', label: 'Demo / proposal' },
  { key: 'application', label: 'Application submitted' },
  { key: 'boarded', label: 'Merchant boarded' },
]
export const TEMPERATURES = [
  { key: 'hot', label: 'Hot' },
  { key: 'warm', label: 'Warm' },
  { key: 'cold', label: 'Cold' },
]
const TEMP_LABEL = Object.fromEntries(TEMPERATURES.map((t) => [t.key, t.label]))
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/

function parseDayKey(key) {
  const [y, m, d] = key.split('-').map(Number)
  return { y, m, d }
}

// When a touch logged for dayKey happened: now for today, local noon for an
// earlier day (so it lands on that day in every view).
export function occurredAtFor(dayKey, now = new Date()) {
  if (dayKey === localDateKey(now)) return now.toISOString()
  const { y, m, d } = parseDayKey(dayKey)
  return new Date(y, m - 1, d, 12, 0, 0).toISOString()
}

// [from, to) covering one local calendar day.
export function dayRange(dayKey) {
  const { y, m, d } = parseDayKey(dayKey)
  return { from: new Date(y, m - 1, d).toISOString(), to: new Date(y, m - 1, d + 1).toISOString() }
}

// form -> { prospect: mpg_prospects insert row | null, touch: mpg_touches row }.
// form.business: { type: 'new', name } | { type: 'prospect', id, name } |
//   { type: 'contact', id, name } | { type: 'edit', name } (edit: touch fields only).
// For 'new', the caller inserts the prospect first and sets touch.prospect_id.
export function buildVisit(form, now = new Date()) {
  const b = form?.business
  const name = trimmed(b?.name)
  if (!b || !name) throw new Error('Pick or type the business')
  if (!DAY_KEY.test(form.dayKey || '')) throw new Error('Pick the visit date')
  if (form.dayKey > localDateKey(now)) throw new Error('The visit date is in the future')
  const follow = trimmed(form.followUpOn)
  if (follow && !DAY_KEY.test(follow)) throw new Error('Follow-up date is not a date')
  const temperature = form.temperature || null
  if (temperature && !TEMP_LABEL[temperature]) throw new Error('Pick Hot, Warm or Cold')

  const outcomes = Object.fromEntries(OUTCOMES.map((o) => [o.key, !!form.outcomes?.[o.key]]))
  const fields = {
    occurred_at: occurredAtFor(form.dayKey, now),
    business_name: name,
    contact_label: contactLabel(form.contactName, form.role),
    reach_label: reachLabel(form.phone, form.email),
    notes: trimmed(form.notes) || null,
    next_step: trimmed(form.nextStep) || null,
    follow_up_on: follow || null,
    temperature,
    ...outcomes,
  }
  if (b.type === 'edit') return { prospect: null, touch: fields }

  const touch = {
    channel: 'walk_in',
    ...fields,
    contact_id: b.type === 'contact' ? b.id : null,
    prospect_id: b.type === 'prospect' ? b.id : null,
  }
  const prospect = b.type === 'new'
    ? {
        kind: 'merchant',
        business_name: name,
        contact_name: trimmed(form.contactName) || null,
        contact_role: trimmed(form.role) || null,
        phone: trimmed(form.phone) || null,
        phone_key: phoneKey(form.phone),
        email: trimmed(form.email) || null,
        temperature,
        status: 'working',
      }
    : null
  return { prospect, touch }
}

// One mpg_touches walk-in row -> Chandler Visits columns A–M.
export function visitRow(t) {
  return [
    sheetDate(t.occurred_at),
    t.business_name,
    t.contact_label,
    t.reach_label,
    t.notes,
    t.next_step,
    sheetDate(t.follow_up_on),
    TEMP_LABEL[t.temperature] || '',
    ...OUTCOMES.map((o) => yesNo(t[o.key])),
  ].map(cellText)
}

// The note dropped on a Zoho lead when a visit is logged against it.
export function zohoVisitNote(t) {
  const head = ['Walk-in']
  if (TEMP_LABEL[t.temperature]) head.push(TEMP_LABEL[t.temperature])
  const hit = OUTCOMES.filter((o) => t[o.key]).map((o) => o.label)
  if (hit.length) head.push(hit.join(', '))
  const base = head.join(' · ')
  return t.notes ? `${base} — ${t.notes}` : base
}

// Rows logged after the block was last copied (a backdated or late entry).
export function newSinceCopy(rows, copiedAtIso) {
  if (!copiedAtIso) return rows
  const t = new Date(copiedAtIso).getTime()
  return rows.filter((r) => new Date(r.created_at).getTime() > t)
}

// When a block was copied, per day, in this browser only (a convenience: losing
// it just means no "copied" hint). storage defaults to localStorage.
const copyKey = (dayKey, block) => `mpg-tracker-copied:${dayKey}:${block}`
export function readCopied(dayKey, block, storage = globalThis.localStorage) {
  try {
    return storage?.getItem(copyKey(dayKey, block)) ?? null
  } catch {
    return null
  }
}
export function writeCopied(dayKey, block, iso, storage = globalThis.localStorage) {
  try {
    storage?.setItem(copyKey(dayKey, block), iso)
  } catch {
    // private window or blocked storage: the hint is optional
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/mpgTracker.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mpgTracker.js src/lib/mpgTracker.test.js
git commit -m "feat: MPG visit builder, Visits row and Zoho note text

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Supabase calls

**Files:**
- Create: `src/lib/mpgTouches.js`

This file is thin I/O. It is exercised by the render tests in Tasks 5–7, which mock `../lib/supabase`.

- [ ] **Step 1: Write the module**

```js
// Supabase calls for the MPG touch log (migration 0060). App-owned, per user:
// RLS limits every query to your own rows. Pure logic lives in mpgTracker.js.
import { supabase, isDemoMode } from './supabase'
import { cleanQuery } from './search'
import { dayRange } from './mpgTracker'

// MPG businesses matching q: Zoho contacts (by person or company) and OS
// prospects not yet promoted. -> [{ type, id, name, sub, phone, email, role }]
export async function searchMpgBusinesses(q) {
  const s = cleanQuery(q)
  if (s.length < 2 || isDemoMode) return []
  const [contacts, prospects] = await Promise.all([
    supabase
      .from('contacts')
      .select('id, name, company, phone, email')
      .eq('business_id', 'mpg')
      .or(`name.ilike.%${s}%,company.ilike.%${s}%`)
      .order('company')
      .limit(8),
    supabase
      .from('mpg_prospects')
      .select('id, business_name, contact_name, contact_role, phone, email')
      .neq('status', 'promoted')
      .ilike('business_name', `%${s}%`)
      .order('business_name')
      .limit(8),
  ])
  return [
    ...(contacts.data || []).map((c) => ({
      type: 'contact', id: c.id, name: c.company || c.name, sub: c.company ? c.name : 'Zoho lead',
      phone: c.phone, email: c.email, role: null, contactName: c.company ? c.name : null,
    })),
    ...(prospects.data || []).map((p) => ({
      type: 'prospect', id: p.id, name: p.business_name, sub: p.contact_name || 'Not in Zoho',
      phone: p.phone, email: p.email, role: p.contact_role, contactName: p.contact_name,
    })),
  ]
}

// { prospect, touch } from buildVisit -> the saved touch. A new business's
// prospect is inserted first so the touch can point at it.
export async function saveVisit({ prospect, touch }) {
  let row = touch
  if (prospect) {
    const { data, error } = await supabase.from('mpg_prospects').insert(prospect).select('id').single()
    if (error) return { data: null, error }
    row = { ...touch, prospect_id: data.id }
  }
  if (!row.prospect_id && !row.contact_id) return { data: null, error: { message: 'A visit needs a business' } }
  return supabase.from('mpg_touches').insert(row).select('*').single()
}

export async function updateTouch(id, patch) {
  return supabase.from('mpg_touches').update(patch).eq('id', id).select('*').single()
}

export async function deleteTouch(id) {
  return supabase.from('mpg_touches').delete().eq('id', id)
}

// One local day's touches of a channel, oldest first.
export async function fetchTouchesForDay(dayKey, channel = 'walk_in') {
  if (isDemoMode) return { data: [], error: null }
  const { from, to } = dayRange(dayKey)
  return supabase
    .from('mpg_touches')
    .select('*')
    .eq('channel', channel)
    .gte('occurred_at', from)
    .lt('occurred_at', to)
    .order('occurred_at', { ascending: true })
}

// Lets the Daily tracker reload after a visit is saved, edited or deleted.
const CHANGED = 'mpg-touches:changed'
export function notifyTouchesChanged() {
  window.dispatchEvent(new CustomEvent(CHANGED))
}
export function onTouchesChanged(fn) {
  window.addEventListener(CHANGED, fn)
  return () => window.removeEventListener(CHANGED, fn)
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/mpgTouches.js
git commit -m "feat: Supabase calls for the MPG touch log

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Log visit dialog (TDD)

**Files:**
- Create: `src/components/LogVisitDialog.jsx`
- Test: `src/components/LogVisitDialog.render.test.jsx`

**Behaviour:**
- **Props:** `onClose`, optional `preset` (a business from search, `{ type: 'contact' | 'prospect', id, name, phone, email, role, contactName }`), optional `touch` (edit an existing row).
- **Choosing the business** (when there's no preset and no touch): a search box. Results come from `searchMpgBusinesses`. The last option is "Add new business: <typed text>".
- **Fields:** date (default today), contact name, role, phone, email, notes, next step, follow-up date, Hot/Warm/Cold, and the five outcome checkboxes. Picking a result pre-fills contact name, role, phone and email.
- **Saving:**
  - `buildVisit`, then `saveVisit` (or `updateTouch` in edit mode), then `notifyTouchesChanged()`, a toast "Visit logged", and `onClose()`.
  - If the business is a Zoho contact and `useWritebackFlags().mpg === true`: also `invokeCrmAction(buildActionRequest({ action: 'add_note', contactId, subject: 'Walk-in', body: zohoVisitNote(touch) }))`. When a follow-up date is set, add `invokeCrmAction(buildActionRequest({ action: 'create_task', contactId, dueDate: followUpOn, title: nextStep || 'Follow up', type: 'Follow Up' }))`.
  - **A failed Zoho write** shows an error toast with Retry. The visit stays saved.
  - **A `buildVisit` error** shows inline, and nothing is saved.
- **Edit mode:** the business is shown read-only, the save calls `updateTouch(touch.id, built.touch)`, and there is a Delete button (`deleteTouch`, with a confirm).

- [ ] **Step 1: Write the failing render test**

```jsx
// @vitest-environment jsdom
// Log visit: a new business saves a prospect then a walk-in touch; a Zoho
// contact's visit also writes a Zoho note (and a task when a follow-up date is
// set); a bad form saves nothing.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import React from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const invoke = vi.fn()
const inserted = []
const DATA = { contacts: [], prospects: [], writeback: { bay: true, mpg: true } }

function query(table) {
  const q = {}
  for (const m of ['select', 'eq', 'neq', 'or', 'ilike', 'gte', 'lt', 'order', 'limit']) q[m] = () => q
  q.insert = (row) => {
    inserted.push({ table, row })
    const id = table === 'mpg_prospects' ? 'p-new' : 't-new'
    return { select: () => ({ single: async () => ({ data: { id, ...row }, error: null }) }) }
  }
  q.maybeSingle = async () => (table === 'settings' ? { data: { value: DATA.writeback }, error: null } : { data: null, error: null })
  q.then = (resolve) => resolve({
    data: table === 'contacts' ? DATA.contacts : table === 'mpg_prospects' ? DATA.prospects : [],
    error: null,
  })
  return q
}

vi.mock('../lib/supabase', () => ({
  isDemoMode: false,
  supabase: { from: (t) => query(t), functions: { invoke: (...a) => invoke(...a) } },
}))

const { default: LogVisitDialog } = await import('./LogVisitDialog')
const { default: Toaster } = await import('./Toaster')
const { resetWritebackFlags } = await import('../lib/writeback')

beforeEach(() => {
  document.body.innerHTML = ''
  inserted.length = 0
  DATA.contacts = []
  DATA.prospects = []
  DATA.writeback = { bay: true, mpg: true }
  resetWritebackFlags()
  invoke.mockReset()
  invoke.mockResolvedValue({ data: { status: 'ok', results: [{ step: 'add_note', ok: true }] }, error: null })
})

async function render(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    createRoot(host).render(React.createElement(React.Fragment, null, el, React.createElement(Toaster)))
  })
  return host
}

const byLabel = (text) => [...document.querySelectorAll('label')].find((l) => l.textContent.includes(text))?.control
const button = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(text))

async function type(el, value) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function click(el) {
  await act(async () => { el.click() })
}
async function wait(ms = 300) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)) })
}

describe('LogVisitDialog', () => {
  it('saves a new business as a prospect, then the walk-in touch', async () => {
    const onClose = vi.fn()
    await render(React.createElement(LogVisitDialog, { onClose }))
    await type(byLabel('Business'), 'Feges BBQ')
    await wait()
    await click(button('Add new business'))
    await type(byLabel('Contact name'), 'Patrick')
    await click(button('Warm'))
    await click(byLabel('Decision-maker conversation'))
    await click(button('Save visit'))
    await wait(50)

    expect(inserted.map((i) => i.table)).toEqual(['mpg_prospects', 'mpg_touches'])
    expect(inserted[0].row.business_name).toBe('Feges BBQ')
    expect(inserted[1].row).toMatchObject({
      channel: 'walk_in', prospect_id: 'p-new', business_name: 'Feges BBQ',
      contact_label: 'Patrick', temperature: 'warm', dm_conversation: true,
    })
    expect(invoke).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('a Zoho contact visit writes a Zoho note and a follow-up task', async () => {
    await render(React.createElement(LogVisitDialog, {
      onClose: () => {},
      preset: { type: 'contact', id: 'c1', name: 'NJR Salons', phone: '832-474-7707', contactName: 'Jimmy' },
    }))
    await type(byLabel('Notes'), 'Wants a rate review')
    await type(byLabel('Follow-up date'), '2026-12-01')
    await click(button('Save visit'))
    await wait(50)

    expect(inserted.map((i) => i.table)).toEqual(['mpg_touches'])
    expect(inserted[0].row.contact_id).toBe('c1')
    const actions = invoke.mock.calls.map((c) => c[1].body.action)
    expect(actions).toEqual(['add_note', 'create_task'])
    expect(invoke.mock.calls[0][1].body.payload.body).toBe('Walk-in — Wants a rate review')
  })

  it('skips the Zoho note when MPG write-back is off', async () => {
    DATA.writeback = { bay: true, mpg: false }
    await render(React.createElement(LogVisitDialog, {
      onClose: () => {},
      preset: { type: 'contact', id: 'c1', name: 'NJR Salons' },
    }))
    await click(button('Save visit'))
    await wait(50)
    expect(inserted).toHaveLength(1)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('shows the problem and saves nothing without a business', async () => {
    await render(React.createElement(LogVisitDialog, { onClose: () => {} }))
    await click(button('Save visit'))
    await wait(50)
    expect(inserted).toHaveLength(0)
    expect(document.body.textContent).toContain('Pick or type the business')
  })
})
```

The `crm-action` request body shape (`body.action`, `body.payload.body`) comes from `buildActionRequest` in `src/lib/crmActions.js`. `invokeCrmAction` in `src/lib/writeback.js` sends it as `supabase.functions.invoke('crm-action', { body: request })`, so `invoke.mock.calls[i][1].body` is the request.

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/components/LogVisitDialog.render.test.jsx`
Expected: FAIL, because `./LogVisitDialog` can't be resolved.

- [ ] **Step 3: Implement**

```jsx
// Log a walk-in visit (MPG). Saves to the OS touch log only; a visit to a
// business that is already a Zoho lead also drops a Zoho note (and a follow-up
// task). Promotion of new businesses to Zoho comes in slice 2.
// Spec: docs/superpowers/specs/2026-11-05-mpg-tracker-touch-log-design.md
import { useEffect, useState } from 'react'
import { buildVisit, zohoVisitNote, OUTCOMES, TEMPERATURES } from '../lib/mpgTracker'
import { searchMpgBusinesses, saveVisit, updateTouch, deleteTouch, notifyTouchesChanged } from '../lib/mpgTouches'
import { localDateKey, buildActionRequest } from '../lib/crmActions'
import { useWritebackFlags, invokeCrmAction } from '../lib/writeback'
import { showToast } from './Toaster'

const INPUT = 'w-full rounded-[10px] border border-line2 bg-panel px-3 py-2 text-[13px] text-[color:var(--text)]'
const LABEL = 'mb-1 block text-[12px] font-semibold text-muted'

function splitLabel(label) {
  const [name, role] = String(label || '').split(' / ')
  return { name: name || '', role: role || '' }
}

function emptyForm(now) {
  return {
    dayKey: localDateKey(now), contactName: '', role: '', phone: '', email: '', notes: '', nextStep: '',
    followUpOn: '', temperature: null, outcomes: {},
  }
}

function formFromTouch(t) {
  const { name, role } = splitLabel(t.contact_label)
  return {
    dayKey: localDateKey(new Date(t.occurred_at)), contactName: name, role, phone: t.reach_label || '', email: '',
    notes: t.notes || '', nextStep: t.next_step || '', followUpOn: t.follow_up_on || '',
    temperature: t.temperature, outcomes: Object.fromEntries(OUTCOMES.map((o) => [o.key, !!t[o.key]])),
  }
}

async function writeZoho(contactId, touch, followUpOn, nextStep) {
  const requests = [buildActionRequest({ action: 'add_note', contactId, subject: 'Walk-in', body: zohoVisitNote(touch) })]
  if (followUpOn) {
    requests.push(buildActionRequest({ action: 'create_task', contactId, dueDate: followUpOn, title: nextStep || 'Follow up', type: 'Follow Up' }))
  }
  for (const req of requests) {
    const res = await invokeCrmAction(req)
    if (res?.status !== 'ok') {
      showToast({
        tone: 'error',
        text: `Visit saved, but the Zoho ${req.action === 'add_note' ? 'note' : 'task'} failed: ${res?.error || 'unknown error'}`,
        retry: () => writeZoho(contactId, touch, followUpOn, nextStep),
      })
      return
    }
  }
}

export default function LogVisitDialog({ onClose, preset = null, touch = null }) {
  const writeback = useWritebackFlags()
  const [business, setBusiness] = useState(() => (touch ? { type: 'edit', name: touch.business_name } : preset))
  const [form, setForm] = useState(() => {
    if (touch) return formFromTouch(touch)
    const f = emptyForm(new Date())
    return preset ? { ...f, contactName: preset.contactName || '', role: preset.role || '', phone: preset.phone || '', email: preset.email || '' } : f
  })
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [problem, setProblem] = useState(null)
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (business) return undefined
    let alive = true
    const id = setTimeout(async () => {
      const rows = await searchMpgBusinesses(query)
      if (alive) setResults(rows)
    }, 250)
    return () => {
      alive = false
      clearTimeout(id)
    }
  }, [query, business])

  function pick(b) {
    setBusiness(b)
    setForm((f) => ({ ...f, contactName: b.contactName || f.contactName, role: b.role || f.role, phone: b.phone || f.phone, email: b.email || f.email }))
  }

  async function save() {
    setProblem(null)
    let built
    try {
      built = buildVisit({ ...form, business })
    } catch (e) {
      setProblem(e.message)
      return
    }
    setSaving(true)
    const { error } = touch ? await updateTouch(touch.id, built.touch) : await saveVisit(built)
    setSaving(false)
    if (error) {
      setProblem(error.message)
      return
    }
    notifyTouchesChanged()
    showToast({ tone: 'ok', text: touch ? 'Visit updated' : 'Visit logged' })
    onClose()
    if (!touch && business.type === 'contact' && writeback.mpg === true) {
      await writeZoho(business.id, built.touch, built.touch.follow_up_on, built.touch.next_step)
    }
  }

  async function remove() {
    if (!window.confirm('Delete this visit?')) return
    const { error } = await deleteTouch(touch.id)
    if (error) return setProblem(error.message)
    notifyTouchesChanged()
    showToast({ tone: 'ok', text: 'Visit deleted' })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={touch ? 'Edit visit' : 'Log visit'}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl border border-line bg-panel p-5 sm:max-w-md sm:rounded-card"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="text-[15px] font-bold">{touch ? 'Edit visit' : 'Log visit'}</div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-10 w-10 place-items-center rounded-[10px] text-muted hover:bg-hoverbg">✕</button>
        </div>

        {!business ? (
          <div>
            <label className={LABEL}>
              Business
              <input className={INPUT} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search or type a new business" autoFocus />
            </label>
            <div className="mt-2 flex flex-col">
              {results.map((r) => (
                <button key={`${r.type}:${r.id}`} type="button" onClick={() => pick(r)} className="flex min-h-[40px] items-center gap-2 rounded-[10px] px-2 text-left text-[13px] hover:bg-hoverbg">
                  <span className="truncate font-semibold">{r.name}</span>
                  <span className="truncate text-muted">· {r.sub}</span>
                </button>
              ))}
              {query.trim().length >= 2 && (
                <button type="button" onClick={() => pick({ type: 'new', name: query.trim() })} className="flex min-h-[40px] items-center rounded-[10px] px-2 text-left text-[13px] font-semibold hover:bg-hoverbg">
                  Add new business: {query.trim()}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="mb-3 flex items-center justify-between rounded-[10px] border border-line2 px-3 py-2 text-[13px]">
            <span className="truncate font-semibold">{business.name}</span>
            {!touch && !preset && (
              <button type="button" onClick={() => setBusiness(null)} className="text-[12px] text-muted hover:text-[color:var(--text)]">Change</button>
            )}
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className={LABEL}>Visit date<input type="date" className={INPUT} value={form.dayKey} onChange={set('dayKey')} /></label>
          <label className={LABEL}>Follow-up date<input type="date" className={INPUT} value={form.followUpOn} onChange={set('followUpOn')} /></label>
          <label className={LABEL}>Contact name<input className={INPUT} value={form.contactName} onChange={set('contactName')} /></label>
          <label className={LABEL}>Role<input className={INPUT} value={form.role} onChange={set('role')} /></label>
          <label className={LABEL}>Phone<input type="tel" className={INPUT} value={form.phone} onChange={set('phone')} /></label>
          <label className={LABEL}>Email<input type="email" className={INPUT} value={form.email} onChange={set('email')} /></label>
        </div>
        <label className={`${LABEL} mt-3`}>Notes<textarea rows={3} className={INPUT} value={form.notes} onChange={set('notes')} /></label>
        <label className={`${LABEL} mt-3`}>Next step<input className={INPUT} value={form.nextStep} onChange={set('nextStep')} /></label>

        <div className="mt-3">
          <div className={LABEL}>Prospect quality</div>
          <div className="flex gap-2">
            {TEMPERATURES.map((t) => (
              <button
                key={t.key}
                type="button"
                aria-pressed={form.temperature === t.key}
                onClick={() => setForm((f) => ({ ...f, temperature: f.temperature === t.key ? null : t.key }))}
                className={`min-h-[40px] flex-1 rounded-[10px] border text-[13px] font-semibold ${form.temperature === t.key ? 'border-[color:var(--text)]' : 'border-line2 text-muted'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-1">
          {OUTCOMES.map((o) => (
            <label key={o.key} className="flex min-h-[36px] items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={!!form.outcomes[o.key]}
                onChange={(e) => setForm((f) => ({ ...f, outcomes: { ...f.outcomes, [o.key]: e.target.checked } }))}
              />
              {o.label}
            </label>
          ))}
        </div>

        {problem && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{problem}</div>}

        <div className="mt-4 flex gap-2">
          {touch && (
            <button type="button" onClick={remove} className="min-h-[44px] rounded-[10px] border border-line2 px-4 text-[13px] text-muted">Delete</button>
          )}
          <button type="button" disabled={saving} onClick={save} className="btn-primary min-h-[44px] flex-1 rounded-[10px] text-[14px] font-semibold">
            {saving ? 'Saving…' : 'Save visit'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

**Two checks before running:**
- Confirm `buildActionRequest`'s `add_note` reads `form.body` / `form.subject` and `create_task` reads `form.dueDate` / `form.title` / `form.type` (`src/lib/crmActions.js:162-176`). Adjust the keys if they differ.
- Confirm that `useWritebackFlags()` returns `{}` before it loads. `writeback.mpg === true` keeps the write off until the flag is known.

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/components/LogVisitDialog.render.test.jsx`
Expected: PASS. If `byLabel(...)` returns undefined, the `<label>` must wrap its control (as above) so `label.control` resolves.

- [ ] **Step 5: Commit**

```bash
git add src/components/LogVisitDialog.jsx src/components/LogVisitDialog.render.test.jsx
git commit -m "feat: Log visit dialog for MPG walk-ins

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Entry points (+ New, person sheet)

**Files:**
- Modify: `src/components/QuickAddMenu.jsx`
- Modify: `src/components/NewMenu.jsx`
- Modify: `src/components/PersonSheet.jsx` (the row holding `ScheduleButton`, around line 310)

- [ ] **Step 1: QuickAddMenu: optional "Log visit…"**

In `src/components/QuickAddMenu.jsx`, add the item and a prop:

```jsx
const NEW_LEAD = { kind: 'lead', label: 'New lead…' }
const LOG_VISIT = { kind: 'visit', label: 'Log visit…' }

// showLead: offer "New lead…" (settings.create_lead_enabled plus write-back).
// showVisit: offer "Log visit…" (MPG walk-ins; hidden on the Bayway view).
export default function QuickAddMenu({ onPick, showLead = false, showVisit = false, hide = [], className = 'btn-primary', style }) {
  const [open, setOpen] = useState(false)
  const items = [...(showLead ? [NEW_LEAD] : []), ...(showVisit ? [LOG_VISIT] : []), ...QUICK_ADD].filter((i) => !hide.includes(i.kind))
```

(The rest of the component is unchanged.)

- [ ] **Step 2: NewMenu: open the dialog**

In `src/components/NewMenu.jsx`:

```jsx
import LogVisitDialog from './LogVisitDialog'
// …
  const [visitOpen, setVisitOpen] = useState(false)
// …
      <QuickAddMenu
        showLead={leadBooks.length > 0}
        hide={assistant ? ['call'] : []}
        showVisit={!assistant && biz !== 'bay'}
        onPick={(kind) => {
          if (kind === 'task') return setNewTaskOpen(true)
          if (kind === 'lead') return setNewLeadOpen(true)
          if (kind === 'visit') {
            onBeforePick?.()
            return setVisitOpen(true)
          }
          onBeforePick?.()
          openSearch({ pick: kind })
        }}
      />
      {visitOpen && <LogVisitDialog onClose={() => setVisitOpen(false)} />}
```

- [ ] **Step 3: PersonSheet: "Log visit" for MPG people**

In `src/components/PersonSheet.jsx`, import `LogVisitDialog`, add `const [visitOpen, setVisitOpen] = useState(false)` with the component's other state, and put the button in the row that holds `ScheduleButton` (around line 310). The assistant login is Bayway-only, so `biz === 'mpg'` already keeps it away from them:

```jsx
<div className="flex flex-wrap items-center gap-3">
  <ScheduleButton businessId={biz} contactId={person.id} contactName={person.name} />
  {biz === 'mpg' && (
    <button type="button" onClick={() => setVisitOpen(true)} className="text-[12.5px] font-semibold" style={{ color: t.ink }}>
      Log visit
    </button>
  )}
  {/* existing "Open in Zoho" link unchanged */}
</div>
{visitOpen && (
  <LogVisitDialog
    onClose={() => setVisitOpen(false)}
    preset={{
      type: 'contact', id: person.id, name: person.company || person.name,
      phone: person.phone, email: person.email, contactName: person.company ? person.name : null,
    }}
  />
)}
```

- [ ] **Step 4: Run the related tests**

Run: `npx vitest run src/components/PersonSheet.render.test.jsx src/components/Sidebar.render.test.jsx src/components/LogVisitDialog.render.test.jsx`
Expected: PASS. If a Sidebar/QuickAdd test asserts the exact menu items, update it to expect "Log visit…" on the MPG and All views, and not on Bayway.

- [ ] **Step 5: Commit**

```bash
git add src/components/QuickAddMenu.jsx src/components/NewMenu.jsx src/components/PersonSheet.jsx src/components/*.render.test.jsx
git commit -m "feat: Log visit from + New and MPG person sheets

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Daily tracker panel + Reports tab (TDD)

**Files:**
- Create: `src/components/DailyTracker.jsx`
- Test: `src/components/DailyTracker.render.test.jsx`
- Modify: `src/pages/Reports.jsx` (`TABS`, `cards` memo, tab body)

**Behaviour:**
- **Date picker:** a date input defaulting to today. It loads `fetchTouchesForDay(day, 'walk_in')` and reloads on `onTouchesChanged`.
- **Visits block:**
  - title "Chandler Visits", with a row count,
  - a compact list (business, contact, quality, outcomes); clicking a row opens `LogVisitDialog` with `touch`,
  - a **Copy rows (n)** button: `navigator.clipboard.writeText(toTsv(rows.map(visitRow)))`, then `writeCopied(day, 'visits', nowIso)`,
  - once copied, the line "Copied 6:12 PM", plus "· k rows logged since" with a **Copy new rows only (k)** button (`newSinceCopy`) when there are newer rows,
  - the hint "Click the first empty yellow cell in column A of Chandler Visits, then paste."
- **Copy failure:** if `navigator.clipboard` is missing or rejects, show an error toast "Couldn't copy — select the rows below and copy them by hand", and show the TSV in a read-only `<textarea>`.
- **Empty day:** "No visits logged for this day."

- [ ] **Step 1: Write the failing render test**

```jsx
// @vitest-environment jsdom
// Daily tracker: copies the day's visits as tab-separated Visits rows, notes
// the copy, and offers just the rows logged since.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import React from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const DATA = { touches: [] }
function query() {
  const q = {}
  for (const m of ['select', 'eq', 'gte', 'lt', 'order']) q[m] = () => q
  q.then = (resolve) => resolve({ data: DATA.touches, error: null })
  return q
}
vi.mock('../lib/supabase', () => ({ isDemoMode: false, supabase: { from: () => query() } }))

const { default: DailyTracker } = await import('./DailyTracker')
const { default: Toaster } = await import('./Toaster')

const touch = (id, business, createdAt) => ({
  id, channel: 'walk_in', occurred_at: '2026-11-05T18:00:00.000Z', created_at: createdAt,
  business_name: business, contact_label: 'Jimmy / Manager', reach_label: '+1 832 474 7707',
  notes: 'line one\nline two', next_step: null, follow_up_on: null, temperature: 'hot',
  dm_conversation: true, statement: false, demo_proposal: false, application: false, boarded: false,
})

let writeText
beforeEach(() => {
  document.body.innerHTML = ''
  localStorage.clear()
  DATA.touches = [touch('a', 'NJR Salons', '2026-11-05T18:01:00.000Z')]
  writeText = vi.fn().mockResolvedValue()
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})

async function render() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    createRoot(host).render(React.createElement(React.Fragment, null,
      React.createElement(DailyTracker, { initialDay: '2026-11-05' }), React.createElement(Toaster)))
  })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}
const button = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(text))

describe('DailyTracker', () => {
  it('copies the day as Visits rows A–M', async () => {
    await render()
    await act(async () => { button('Copy rows').click() })
    const occurredDay = new Date('2026-11-05T18:00:00.000Z')
    const sheetDay = `${occurredDay.getMonth() + 1}/${occurredDay.getDate()}/${occurredDay.getFullYear()}`
    expect(writeText).toHaveBeenCalledWith(
      [sheetDay, 'NJR Salons', 'Jimmy / Manager', ' +1 832 474 7707', 'line one · line two', '', '', 'Hot', 'Yes', 'No', 'No', 'No', 'No'].join('\t'),
    )
    expect(document.body.textContent).toContain('Copied')
  })

  it('offers only the rows logged after the copy', async () => {
    localStorage.setItem('mpg-tracker-copied:2026-11-05:visits', '2026-11-05T19:00:00.000Z')
    DATA.touches = [touch('a', 'NJR Salons', '2026-11-05T18:01:00.000Z'), touch('b', 'Feges BBQ', '2026-11-05T20:00:00.000Z')]
    await render()
    expect(document.body.textContent).toContain('1 row logged since')
    await act(async () => { button('Copy new rows only').click() })
    expect(writeText.mock.calls[0][0].split('\n')).toHaveLength(1)
    expect(writeText.mock.calls[0][0]).toContain('Feges BBQ')
  })

  it('says so when the day is empty', async () => {
    DATA.touches = []
    await render()
    expect(document.body.textContent).toContain('No visits logged for this day.')
    expect(button('Copy rows')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/components/DailyTracker.render.test.jsx`
Expected: FAIL, because `./DailyTracker` can't be resolved.

- [ ] **Step 3: Implement `DailyTracker.jsx`**

```jsx
// Reports → Daily tracker (MPG): the day's visits as rows for the manager's
// workbook, copied to the clipboard and pasted into "Chandler Visits" (A–M).
// Later slices add the Follow-ups and ISV blocks and the cold-calls line.
import { useCallback, useEffect, useState } from 'react'
import { visitRow, toTsv, newSinceCopy, readCopied, writeCopied, OUTCOMES } from '../lib/mpgTracker'
import { fetchTouchesForDay, onTouchesChanged } from '../lib/mpgTouches'
import { localDateKey } from '../lib/crmActions'
import LogVisitDialog from './LogVisitDialog'
import { showToast } from './Toaster'

const clock = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

export default function DailyTracker({ initialDay }) {
  const [day, setDay] = useState(initialDay || localDateKey(new Date()))
  const [rows, setRows] = useState([])
  const [error, setError] = useState(null)
  const [copiedAt, setCopiedAt] = useState(null)
  const [fallback, setFallback] = useState(null)
  const [editing, setEditing] = useState(null)

  const load = useCallback(async () => {
    const { data, error: err } = await fetchTouchesForDay(day, 'walk_in')
    setError(err ? err.message : null)
    setRows(data || [])
    setCopiedAt(readCopied(day, 'visits'))
  }, [day])

  useEffect(() => {
    load()
    return onTouchesChanged(load)
  }, [load])

  const fresh = copiedAt ? newSinceCopy(rows, copiedAt) : []

  async function copy(list) {
    const text = toTsv(list.map(visitRow))
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard')
      await navigator.clipboard.writeText(text)
      const now = new Date().toISOString()
      writeCopied(day, 'visits', now)
      setCopiedAt(now)
      setFallback(null)
      showToast({ tone: 'ok', text: `Copied ${plural(list.length, 'row')}` })
    } catch {
      setFallback(text)
      showToast({ tone: 'error', text: "Couldn't copy — select the rows below and copy them by hand" })
    }
  }

  return (
    <section className="mt-5">
      <label className="mb-4 flex items-center gap-2 text-[13px] font-semibold">
        Day
        <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="rounded-[10px] border border-line2 bg-panel px-3 py-1.5 text-[13px]" />
      </label>
      {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <div className="rounded-card border border-line bg-panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[14px] font-bold">Chandler Visits <span className="font-normal text-muted">· {plural(rows.length, 'row')}</span></div>
          {rows.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {fresh.length > 0 && (
                <button type="button" onClick={() => copy(fresh)} className="min-h-[40px] rounded-[10px] border border-line2 px-3 text-[13px] font-semibold">
                  Copy new rows only ({fresh.length})
                </button>
              )}
              <button type="button" onClick={() => copy(rows)} className="btn-primary min-h-[40px] rounded-[10px] px-3 text-[13px] font-semibold">
                Copy rows ({rows.length})
              </button>
            </div>
          )}
        </div>
        {copiedAt && (
          <div className="mt-1 text-[12px] text-muted">
            Copied {clock(copiedAt)}{fresh.length > 0 ? ` · ${plural(fresh.length, 'row')} logged since` : ''}
          </div>
        )}
        {rows.length === 0 ? (
          <div className="mt-3 text-[13px] text-muted">No visits logged for this day.</div>
        ) : (
          <>
            <div className="mt-1 text-[12px] text-dim">Click the first empty yellow cell in column A of Chandler Visits, then paste.</div>
            <ul className="mt-3 divide-y divide-line">
              {rows.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => setEditing(r)} className="flex min-h-[44px] w-full items-center gap-2 px-1 text-left text-[13px] hover:bg-hoverbg">
                    <span className="truncate font-semibold">{r.business_name}</span>
                    {r.contact_label && <span className="truncate text-muted">· {r.contact_label}</span>}
                    {r.temperature && <span className="text-muted">· {r.temperature[0].toUpperCase() + r.temperature.slice(1)}</span>}
                    <span className="ml-auto truncate text-[12px] text-dim">{OUTCOMES.filter((o) => r[o.key]).map((o) => o.label).join(', ')}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {fallback && <textarea readOnly rows={4} value={fallback} className="mt-3 w-full rounded-[10px] border border-line2 bg-panel p-2 font-mono text-[11px]" onFocus={(e) => e.target.select()} />}
      </div>
      {editing && <LogVisitDialog touch={editing} onClose={() => setEditing(null)} />}
    </section>
  )
}
```

- [ ] **Step 4: Wire the Reports tab**

In `src/pages/Reports.jsx`:

```jsx
import DailyTracker from '../components/DailyTracker'
// …
const TABS = [
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'revenue', label: 'Revenue' },
  { key: 'sprint', label: 'Sprint' },
  { key: 'tracker', label: 'Daily tracker', biz: 'mpg' },
]
```

Inside `Reports()`:

```jsx
  const tabs = TABS.filter((t) => !t.biz || t.biz === biz)
  // Leaving the MPG view while on its tracker falls back to Daily.
  useEffect(() => {
    if (!tabs.some((t) => t.key === tab)) setTab('daily')
  }, [biz]) // eslint-disable-line react-hooks/exhaustive-deps
```

Then:
- Render `tabs.map(...)` instead of `TABS.map(...)` in the tab bar.
- In the `cards` memo, start with `if (!data || tab === 'tracker') return []`.
- Hide **Edit targets** when `tab === 'tracker'`.
- Below the tab bar:

```jsx
      {tab === 'tracker' ? (
        <DailyTracker />
      ) : (
        <>
          {/* the existing error / demo / loading / CardGrid / per-tab blocks, unchanged */}
        </>
      )}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/components/DailyTracker.render.test.jsx src/lib/reports.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/DailyTracker.jsx src/components/DailyTracker.render.test.jsx src/pages/Reports.jsx
git commit -m "feat: Daily tracker tab on Reports copies MPG visits for the sheet

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Verify and ship

- [ ] **Step 1: Run the full suite**

Run: `npx vitest run`
Expected: all pass except the one failure already on `main`: `src/lib/briefingBundle.test.js > is up to date with src/lib`. Nothing in this plan touches the briefing bundle's inputs.

- [ ] **Step 2: Build**

Run: `npx vite build`
Expected: the build succeeds.

- [ ] **Step 3: Spec note**

In `docs/superpowers/specs/2026-11-05-mpg-tracker-touch-log-design.md`, under `mpg_touches`, replace the `constraint mpg_touches_has_subject …` line with a comment, and add the `updated_at` column the migration has: "checked in the app on insert (`saveVisit`). A DB check would block deleting a prospect, since both foreign keys `set null`." Commit it with the next step's push.

- [ ] **Step 4: Apply the migration (only after the user says OK)**

Ask the user first. Then:

```bash
supabase db push --linked
```

Expected: `0060_mpg_touch_log.sql` applied.

- [ ] **Step 5: Browser check**

1. Start the dev server: `preview_start` with `{ name: "atkinson-sales-os" }` (port 5173).
2. Switch to the MPG view.
3. Log two visits: one new business and one existing Zoho lead (check that the Zoho note appears).
4. On Reports → Daily tracker, copy, and paste into a **copy** of `MPG_Chandler_Private_Tracker.xlsx` at Chandler Visits A8. Every pasted row should show Entry status "Counted", and the points should calculate.
5. Check the dialog at 375 px wide (`resize_window` with preset `mobile`), then reset to desktop.

- [ ] **Step 6: Push and open the PR to `main`**

```bash
git push -u origin HEAD
gh pr create --base main --title "MPG tracker slice 1: Log visit + Daily tracker export" --body "Slice 1 of docs/superpowers/specs/2026-11-05-mpg-tracker-touch-log-design.md: MPG touch log tables, Log visit (OS only; Zoho note for existing leads), and a Reports → Daily tracker tab that copies the day's visits as Chandler Visits rows A–M.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Then bind it with the ccd_pr tools (`get_status`, `bind_pr` if needed).
