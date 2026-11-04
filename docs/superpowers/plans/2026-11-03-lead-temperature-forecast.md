# Lead Temperature + Production Forecast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Chandler rate leads Hot / Warm / Cold, rank work by that rating, and show an expected-payout forecast for this month and next, plus a "pays first" sort.

**Architecture:** Ratings live in a new OS-owned table `lead_ratings`. The client merges them into existing rows by contact id, so none of the big SQL views change (`v_lead_signals`, `v_active_pipeline`, `v_dial_contacts`).

- Bayway ratings also set one FUB tag (`Hot`, `Warm` or `Cold`) through a new `crm-action` action, `set_temperature`.
- The forecast is a pure module, `src/lib/forecast.js`. It is fed by the ratings, the Arive `loans` table and commission rates, a new `forecast` settings key, and the MPG residual metrics.
- The nightly scorer stops treating the `hot` tag as a score input.

**Tech Stack:** React 18, Vite, Tailwind, supabase-js v2 (RLS), Supabase Edge Functions (Deno), Vitest with jsdom render tests.

**Spec:** `docs/superpowers/specs/2026-11-03-temperature-forecast-briefings-design.md`, sections 1 and 2.

**Deviations from the spec, on purpose:**
- **Up Next rows show temperature through ranking only.** The Hot / Warm / Cold and "Cold, but active" pills show on Pipeline cards and the Person sheet, which every Up Next row opens. This keeps `UpNextRow.jsx` untouched.
- **The launch rating screen's candidates are active leads with at least one outbound call.** `v_lead_signals` has no connected-call column, and adding one means rewriting the view.
- **The Overview forecast card does not open a list of its own.** The lead-by-lead view is Pipeline sorted by "Pays first". The card links to Settings for the odds.

**Production:** nothing in this plan touches production until Task 19. Task 19 needs Chandler's explicit OK; it applies the migration (`supabase db push`) and deploys `crm-action` and `score-fub-leads`.

---

## Setup

Work in the worktree `C:\Users\Chandler\.claude\projects\atkinson-sales-os-phase1\.claude\worktrees\sync-health-poll`. It has `node_modules` linked. Never work in the main checkout, which belongs to another session.

```bash
git fetch -q origin main && git switch -c feat/lead-temperature origin/main
```

The baseline must be green:

```bash
npx vitest run
```

Expected: all test files pass (87 files at the time of writing).

## File map

| File | Status | Responsibility |
|---|---|---|
| `supabase/migrations/0054_lead_ratings.sql` | create | `lead_ratings` table, RLS, score snapshot trigger, `forecast` settings default |
| `src/lib/leadRatings.js` (+ test) | create | Pure temperature helpers: labels, default close month, merge into rows, effective hot, rank, "Cold, but active" |
| `supabase/functions/_shared/temperature-tags.ts` (+ test) | create | Pure FUB tag swap for a temperature |
| `supabase/functions/crm-action/plan.ts`, `run.ts`, `crm.ts` (+ tests) | modify | New `set_temperature` action |
| `src/lib/crmActions.js` (+ test) | modify | Client request builder and labels for `set_temperature`; `isConversation` |
| `src/lib/useLeadRatings.js` (+ test) | create | Shared ratings store and `saveRating` |
| `supabase/functions/score-fub-leads/index.ts` | modify | Stop using the `hot` tag |
| `src/lib/contactCard.js`, `src/lib/priorityLeads.js` (+ tests) | modify | Tier labels read as Engagement, not Hot/Warm |
| `src/lib/priorityQueue.js`, `src/lib/usePriorityQueue.js` (+ test) | modify | Effective hot; temperature rank inside buckets |
| `src/lib/dialList.js`, `src/pages/Workbench.jsx` (+ test) | modify | Temperature rank in the call list |
| `src/lib/cardHealth.js` (+ test) | modify | Temperature and "Cold, but active" pills |
| `src/lib/forecast.js` (+ test) | create | Settings, lines, month totals, pays-first sort |
| `src/lib/useForecastInputs.js` | create | Loads loans, rates, forecast settings, MPG residual metrics |
| `src/components/ForecastCard.jsx`, `src/pages/Overview.jsx` (+ render test) | create/modify | Overview forecast card |
| `src/lib/pipelineView.js`, `src/pages/Pipeline.jsx` (+ tests) | modify | Temperature filter, "Pays first" sort, ratings merge |
| `src/components/QuickActions.jsx` (+ render test) | modify | Temperature row on Log call |
| `src/components/TemperaturePicker.jsx`, `src/components/PersonSheet.jsx` | create/modify | Rate or edit from the Person sheet |
| `src/pages/RateLeads.jsx`, `src/App.jsx` (+ render test) | create/modify | One-time rating screen at `/rate` |
| `src/pages/Settings.jsx`, `src/App.jsx` (+ render test) | create/modify | Forecast odds settings at `/settings` |

---

### Task 1: Migration for `lead_ratings` and the `forecast` setting

**Files:**
- Create: `supabase/migrations/0054_lead_ratings.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Lead temperature (spec 2026-11-03, section 1). Chandler's own read of a
-- lead after a conversation: Hot / Warm / Cold, plus an optional estimated
-- amount (Bayway) and expected close month. OS-owned; Bayway ratings are also
-- mirrored to FUB as a tag by crm-action set_temperature.
-- score_at_rating snapshots contacts.score whenever the temperature changes,
-- so the UI can flag "Cold, but active" (score rose since the rating).
-- RLS: any signed-in user, as the rest of the schema today. The assistant
-- login (spec section 3) tightens this.

create table if not exists public.lead_ratings (
  contact_id      uuid primary key references public.contacts(id) on delete cascade,
  business_id     text not null references public.businesses(id),
  temperature     text not null check (temperature in ('hot', 'warm', 'cold')),
  est_amount      numeric check (est_amount is null or est_amount > 0),
  close_month     date check (close_month is null or extract(day from close_month) = 1),
  rated_at        timestamptz not null default now(),
  rated_by        uuid not null default auth.uid(),
  score_at_rating int
);

create index if not exists lead_ratings_business_idx on public.lead_ratings (business_id);

alter table public.lead_ratings enable row level security;

drop policy if exists "authenticated read lead_ratings" on public.lead_ratings;
create policy "authenticated read lead_ratings" on public.lead_ratings
  for select to authenticated using (true);

drop policy if exists "authenticated insert lead_ratings" on public.lead_ratings;
create policy "authenticated insert lead_ratings" on public.lead_ratings
  for insert to authenticated with check (rated_by = auth.uid());

drop policy if exists "authenticated update lead_ratings" on public.lead_ratings;
create policy "authenticated update lead_ratings" on public.lead_ratings
  for update to authenticated using (true) with check (rated_by = auth.uid());

drop policy if exists "authenticated delete lead_ratings" on public.lead_ratings;
create policy "authenticated delete lead_ratings" on public.lead_ratings
  for delete to authenticated using (true);

create or replace function public.lead_ratings_snapshot()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' or new.temperature is distinct from old.temperature then
    new.score_at_rating := (select c.score from public.contacts c where c.id = new.contact_id);
  end if;
  return new;
end;
$$;

drop trigger if exists lead_ratings_snapshot on public.lead_ratings;
create trigger lead_ratings_snapshot
  before insert or update on public.lead_ratings
  for each row execute function public.lead_ratings_snapshot();

insert into public.settings (key, value)
values (
  'forecast',
  '{
    "temp_odds": { "hot": 60, "warm": 30, "cold": 10 },
    "arive_odds": { "prospect": 30, "processing": 75, "closing": 95 },
    "close_offset_months": { "hot": 1, "warm": 2, "cold": 3 },
    "mpg_est_residual_per_account": null
  }'::jsonb
)
on conflict (key) do nothing;
```

- [ ] **Step 2: Check it**

This repo's workflow has no local database. Read the migration once against `0041_work_items.sql` for policy syntax. **Do not run `supabase db push`.** That happens in Task 19.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0054_lead_ratings.sql
git commit -m "feat: lead_ratings table and forecast settings (not applied)"
```

---

### Task 2: Pure temperature helpers

**Files:**
- Create: `src/lib/leadRatings.js`
- Test: `src/lib/leadRatings.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest'
import {
  TEMPERATURES, TEMP_LABEL, defaultCloseMonth, closeMonthOf, withRatings, effectiveHot, temperatureRank, coldButActive,
} from './leadRatings'

const NOW = new Date('2026-11-03T09:00:00').getTime()

describe('temperature basics', () => {
  it('has three temperatures with labels', () => {
    expect(TEMPERATURES).toEqual(['hot', 'warm', 'cold'])
    expect(TEMP_LABEL).toEqual({ hot: 'Hot', warm: 'Warm', cold: 'Cold' })
  })
})

describe('close month', () => {
  it('defaults by temperature: Hot next month, Warm +2, Cold +3', () => {
    expect(defaultCloseMonth('hot', NOW)).toBe('2026-12-01')
    expect(defaultCloseMonth('warm', NOW)).toBe('2027-01-01')
    expect(defaultCloseMonth('cold', NOW)).toBe('2027-02-01')
  })
  it('takes custom offsets', () => {
    expect(defaultCloseMonth('hot', NOW, { hot: 0 })).toBe('2026-11-01')
  })
  it('keeps a saved close month', () => {
    expect(closeMonthOf({ temperature: 'cold', close_month: '2026-11-01' }, NOW)).toBe('2026-11-01')
    expect(closeMonthOf({ temperature: 'hot', close_month: null }, NOW)).toBe('2026-12-01')
  })
})

describe('withRatings', () => {
  it('adds temperature, amount, close month and the rating to matching rows only', () => {
    const ratings = new Map([['a', { contact_id: 'a', temperature: 'hot', est_amount: 300000, close_month: null }]])
    const [a, b] = withRatings([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], ratings)
    expect(a).toMatchObject({ id: 'a', temperature: 'hot', est_amount: 300000, close_month: null })
    expect(a.rating.contact_id).toBe('a')
    expect(b).toEqual({ id: 'b', name: 'B' })
  })
  it('returns the same rows when there are no ratings', () => {
    const rows = [{ id: 'a' }]
    expect(withRatings(rows, new Map())).toBe(rows)
    expect(withRatings(rows, null)).toBe(rows)
  })
})

describe('effectiveHot and rank', () => {
  it('a rating wins over the view flag', () => {
    expect(effectiveHot({ is_hot: true, temperature: 'warm' })).toBe(false)
    expect(effectiveHot({ is_hot: false, temperature: 'hot' })).toBe(true)
    expect(effectiveHot({ is_hot: true })).toBe(true)
  })
  it('ranks Hot, Warm, unrated, Cold', () => {
    expect([{ temperature: 'cold' }, {}, { temperature: 'warm' }, { temperature: 'hot' }].map(temperatureRank)).toEqual([3, 2, 1, 0])
  })
})

describe('coldButActive', () => {
  it('fires for a Cold lead whose score rose 20+ since the rating, or whose tier is hot', () => {
    expect(coldButActive({ temperature: 'cold', score_at_rating: 10, current_score: 30 })).toBe(true)
    expect(coldButActive({ temperature: 'cold', score_at_rating: 10, current_score: 29 })).toBe(false)
    expect(coldButActive({ temperature: 'cold', score_at_rating: null, current_score: 90, current_tier: 'hot' })).toBe(true)
  })
  it('never for other temperatures or no rating', () => {
    expect(coldButActive({ temperature: 'warm', score_at_rating: 0, current_score: 90 })).toBe(false)
    expect(coldButActive(null)).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/leadRatings.test.js`
Expected: FAIL, "Failed to resolve import ./leadRatings".

- [ ] **Step 3: Implement**

```js
// Lead temperature (spec 2026-11-03, section 1): Chandler's Hot / Warm / Cold
// read of a lead after a conversation. Pure, no React, no I/O. Ratings come
// from lead_ratings (useLeadRatings) and are merged onto view rows by id.
export const TEMPERATURES = ['hot', 'warm', 'cold']
export const TEMP_LABEL = { hot: 'Hot', warm: 'Warm', cold: 'Cold' }
// Months from now a rated lead is expected to close (settings.forecast can override).
export const DEFAULT_CLOSE_OFFSET = { hot: 1, warm: 2, cold: 3 }
// Score points gained since a Cold rating that make it worth a second look.
export const COLD_ACTIVE_RISE = 20

const pad = (n) => String(n).padStart(2, '0')
const firstOfMonth = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`

// 'YYYY-MM-01', local calendar.
export function defaultCloseMonth(temperature, now = Date.now(), offsets = DEFAULT_CLOSE_OFFSET) {
  const d = new Date(now)
  d.setDate(1)
  d.setMonth(d.getMonth() + (offsets?.[temperature] ?? DEFAULT_CLOSE_OFFSET[temperature] ?? 1))
  return firstOfMonth(d)
}

export function closeMonthOf(rating, now = Date.now(), offsets = DEFAULT_CLOSE_OFFSET) {
  return rating?.close_month ? String(rating.close_month).slice(0, 10) : defaultCloseMonth(rating?.temperature, now, offsets)
}

// ratings: Map contact_id -> rating. Unrated rows come back unchanged.
export function withRatings(rows, ratings) {
  if (!ratings || !ratings.size) return rows
  return rows.map((r) => {
    const x = ratings.get(r.id)
    return x ? { ...r, temperature: x.temperature, est_amount: x.est_amount ?? null, close_month: x.close_month ?? null, rating: x } : r
  })
}

// A rating decides; unrated leads keep the view's is_hot (Engagement tier or tag).
export function effectiveHot(row) {
  return row?.temperature ? row.temperature === 'hot' : !!row?.is_hot
}

const RANK = { hot: 0, warm: 1, cold: 3 }
export function temperatureRank(row) {
  return row?.temperature ? RANK[row.temperature] : 2
}

// rating carries current_score / current_tier from contacts (useLeadRatings).
export function coldButActive(rating) {
  if (!rating || rating.temperature !== 'cold') return false
  if (rating.current_tier === 'hot') return true
  const now = rating.current_score
  const then = rating.score_at_rating
  return now != null && then != null && now - then >= COLD_ACTIVE_RISE
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run src/lib/leadRatings.test.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/leadRatings.js src/lib/leadRatings.test.js
git commit -m "feat: pure lead temperature helpers"
```

---

### Task 3: FUB tag swap for a temperature

**Files:**
- Create: `supabase/functions/_shared/temperature-tags.ts`
- Test: `supabase/functions/_shared/temperature-tags.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// Vitest picks this up like scoring.test.ts: the module is pure.
import { describe, it, expect } from 'vitest'
import { retagTemperature, TEMPERATURE_TAGS } from './temperature-tags.ts'

describe('retagTemperature', () => {
  it('adds the one temperature tag and keeps every other tag', () => {
    expect(retagTemperature(['Attempted', 'Zillow'], 'hot')).toEqual(['Attempted', 'Zillow', 'Hot'])
  })
  it('replaces any earlier temperature tag, any case', () => {
    expect(retagTemperature(['hot', 'Attempted', ' Cold '], 'warm')).toEqual(['Attempted', 'Warm'])
  })
  it('handles no tags', () => {
    expect(retagTemperature(null, 'cold')).toEqual(['Cold'])
  })
  it('refuses an unknown temperature', () => {
    expect(() => retagTemperature([], 'lukewarm')).toThrow('Unknown temperature: lukewarm')
  })
  it('names the tags', () => {
    expect(TEMPERATURE_TAGS).toEqual({ hot: 'Hot', warm: 'Warm', cold: 'Cold' })
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run supabase/functions/_shared/temperature-tags.test.ts`
Expected: FAIL, the module can't be resolved.

- [ ] **Step 3: Implement**

```ts
// Lead temperature as one FUB tag (spec 2026-11-03, section 1). PUT /people
// replaces the whole tag list, so callers read the person first and send the
// list this returns. Pure (no Deno imports) so Vitest can run it.
export const TEMPERATURE_TAGS = { hot: 'Hot', warm: 'Warm', cold: 'Cold' }
const TEMP_NAMES = new Set(Object.keys(TEMPERATURE_TAGS))

export function retagTemperature(tags, temperature) {
  if (!TEMPERATURE_TAGS[temperature]) throw new Error(`Unknown temperature: ${temperature}`)
  const kept = (Array.isArray(tags) ? tags : []).filter((t) => !TEMP_NAMES.has(String(t).trim().toLowerCase()))
  return [...kept, TEMPERATURE_TAGS[temperature]]
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run supabase/functions/_shared/temperature-tags.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/temperature-tags.ts supabase/functions/_shared/temperature-tags.test.ts
git commit -m "feat: FUB tag swap for lead temperature"
```

---

### Task 4: `crm-action` `set_temperature`

**Files:**
- Modify: `supabase/functions/crm-action/plan.ts`:
  - line 6 `ACTIONS`
  - line 9 `CONTACT_ACTIONS`
  - the `planSteps` switch
- Modify: `supabase/functions/crm-action/run.ts`:
  - `preflight`
  - `send`
  - the `mirror` branch for `set_stage`
- Modify: `supabase/functions/crm-action/crm.ts`:
  - imports
  - `fubAdapter(...).send`
- Test: `supabase/functions/crm-action/plan.test.js`
- Test: `supabase/functions/crm-action/run.test.js`

- [ ] **Step 1: Write the failing plan test**

Append to `supabase/functions/crm-action/plan.test.js`, inside `describe('planSteps', ...)`:

```js
  it('sets a temperature as one step', () => {
    expect(planSteps({ action: 'set_temperature', payload: { temperature: 'hot' } })).toEqual([
      { step: 'set_temperature', temperature: 'hot' },
    ])
  })
```

- [ ] **Step 2: Write the failing run tests**

Append to `supabase/functions/crm-action/run.test.js`, after the `set_stage` describe block:

```js
describe('crm-action run: set_temperature (Bayway FUB tag)', () => {
  const mapContact = (p) => ({ business_id: 'bay', source_crm: 'fub', external_id: String(p.id), name: p.name, phone: null, person_stage: p.stage, raw: p })
  const tempReq = (contactId, temperature, n = 60) => ({ client_action_id: uuid(n), action: 'set_temperature', contact_id: contactId, payload: { temperature } })

  beforeEach(() => {
    db.tables.contacts.push(
      { id: 'c-t', business_id: 'bay', source_crm: 'fub', external_id: '6001', name: 'Temp Lead', phone: '1', person_stage: 'Lead' },
    )
    bay.send.setTemperature = vi.fn(async ({ externalId }) => ({ id: externalId, tags: ['Attempted', 'Hot'] }))
    bay.read.person = async (id) => ({ id, name: 'Temp Lead', stage: 'Lead', tags: ['Attempted', 'Hot'] })
    bay.map.contact = mapContact
  })

  it('writes the tag, then mirrors the person back', async () => {
    const res = await go(tempReq('c-t', 'hot'))
    expect(res.body.status).toBe('ok')
    expect(bay.send.setTemperature).toHaveBeenCalledWith({ externalId: '6001', temperature: 'hot' })
    expect(db.tables.contacts.find((c) => c.external_id === '6001').raw.tags).toEqual(['Attempted', 'Hot'])
    expect(db.tables.crm_actions.at(-1)).toMatchObject({ action: 'set_temperature', status: 'ok' })
  })

  it('refuses an unknown temperature', async () => {
    expect((await go(tempReq('c-t', 'lukewarm', 61))).body).toEqual({ status: 'refused', error: 'Unknown temperature: lukewarm' })
    expect(bay.send.setTemperature).not.toHaveBeenCalled()
  })
})
```

Add this test to the same block. `c-mpg` is the MPG contact in the file's `seed()`:

```js
  it('refuses MPG: temperature stays in the dashboard there', async () => {
    const res = await go(tempReq('c-mpg', 'hot', 62))
    expect(res.body.status).toBe('refused')
    expect(res.body.error).toMatch(/Bayway only/)
  })
```

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run supabase/functions/crm-action`
Expected: the new tests FAIL with "Unknown action: set_temperature" or a 400 reply.

- [ ] **Step 4: Implement in `plan.ts`**

Change lines 6 and 9:

```ts
export const ACTIONS = ['log_call', 'add_note', 'create_task', 'complete_task', 'push_task', 'set_stage', 'set_temperature', 'create_contact', 'whoami', 'smart_lists', 'contact_notes', 'contact_relationships']

// Actions that act on one of our contacts / tasks (the request carries its uuid).
export const CONTACT_ACTIONS = new Set(['log_call', 'add_note', 'create_task', 'set_stage', 'set_temperature'])
```

In `planSteps`, add before `case 'create_contact': {`:

```ts
    case 'set_temperature':
      return [{ step: 'set_temperature', temperature: p.temperature }]
```

- [ ] **Step 5: Implement in `run.ts`**

In `preflight`, add right after the line `if (req.action === 'set_stage') return stageRefusal(...)`:

```ts
  if (req.action === 'set_temperature') {
    if (businessId !== 'bay') return 'Temperature tags are Bayway only; MPG temperature stays in the dashboard'
    if (!['hot', 'warm', 'cold'].includes(req.payload?.temperature)) return `Unknown temperature: ${req.payload?.temperature}`
  }
```

In `send`, add before `case 'push_task':`:

```ts
    case 'set_temperature':
      return adapter.send.setTemperature({ externalId: contact.external_id, temperature: step.temperature })
```

In `mirror`, change the condition `if (step.step === 'set_stage') {` to:

```ts
  if (step.step === 'set_stage' || step.step === 'set_temperature') {
```

- [ ] **Step 6: Implement in `crm.ts`**

Add this import under the `bay-stages.ts` import:

```ts
import { retagTemperature } from '../_shared/temperature-tags.ts'
```

In `fubAdapter`'s `send` object, add after `setStage`:

```ts
      // Temperature = one Hot/Warm/Cold tag (temperature-tags.ts). Same
      // read-then-PUT as setStage: PUT /people replaces the whole tag list.
      setTemperature: async ({ externalId, temperature }) => {
        const person = await fubGet(`/people/${externalId}`)
        const tags = retagTemperature(person.tags || [], temperature)
        await fubSend('PUT', `/people/${externalId}`, { tags })
        return { id: externalId, tags }
      },
```

- [ ] **Step 7: Run them to see them pass**

Run: `npx vitest run supabase/functions/crm-action`
Expected: PASS, and no other test broken.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/crm-action
git commit -m "feat: crm-action set_temperature writes the FUB temperature tag"
```

---

### Task 5: Client request builder for `set_temperature`

**Files:**
- Modify: `src/lib/crmActions.js`:
  - line 19 `ACTIONS`
  - the `CONNECTED` constant
  - `buildActionRequest`
  - the `DONE` / `LABEL` maps, around lines 225–242
- Test: `src/lib/crmActions.test.js`

- [ ] **Step 1: Write the failing test**

Append this to `src/lib/crmActions.test.js`, and add `isConversation` to its import from `./crmActions`:

```js
describe('set_temperature', () => {
  it('builds a request for one contact', () => {
    const r = buildActionRequest({ action: 'set_temperature', contactId: 'c1', temperature: 'warm' })
    expect(r).toMatchObject({ action: 'set_temperature', contact_id: 'c1', payload: { temperature: 'warm' } })
  })
  it('refuses anything but Hot, Warm or Cold', () => {
    expect(() => buildActionRequest({ action: 'set_temperature', contactId: 'c1', temperature: 'lukewarm' })).toThrow('Pick Hot, Warm or Cold')
  })
  it('isConversation is true for Interested and Not Interested only', () => {
    expect(['Interested', 'Not Interested', 'Left Message', 'No Answer'].map(isConversation)).toEqual([true, true, false, false])
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/crmActions.test.js`
Expected: FAIL with "Unknown action: set_temperature" and "isConversation is not a function".

- [ ] **Step 3: Implement**

Line 19:

```js
const ACTIONS = new Set(['log_call', 'add_note', 'create_task', 'complete_task', 'push_task', 'set_stage', 'set_temperature', 'create_contact'])
```

Under `const CONNECTED = new Set(['Interested', 'Not Interested'])`:

```js
// A real conversation: the Log call form then offers Hot / Warm / Cold.
export const isConversation = (outcome) => CONNECTED.has(outcome)
```

In `buildActionRequest`, before `if (action === 'set_stage') {`:

```js
  if (action === 'set_temperature') {
    if (!['hot', 'warm', 'cold'].includes(form.temperature)) throw new Error('Pick Hot, Warm or Cold')
    return { ...base, contact_id: form.contactId, payload: { temperature: form.temperature } }
  }
```

In `DONE`, add `set_temperature: 'temperature saved',`. In `LABEL`, add `set_temperature: 'Temperature tag',`.

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run src/lib/crmActions.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/crmActions.js src/lib/crmActions.test.js
git commit -m "feat: client set_temperature request and isConversation"
```

---

### Task 6: Shared ratings store and `saveRating`

**Files:**
- Create: `src/lib/useLeadRatings.js`
- Test: `src/lib/useLeadRatings.test.js`

- [ ] **Step 1: Check `fetchAllSettled`'s query shape**

Run: `sed -n 1,40p src/lib/fetchAll.js`

Note the method it pages with, probably `.range(from, to)`. The mock below assumes `range`. If the real method is different, use that name in the mock.

- [ ] **Step 2: Write the failing test**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = { upserts: [], invokes: [], rows: [] }
vi.mock('./supabase', () => ({
  isDemoMode: false,
  supabase: {
    from: () => {
      const q = {
        select: () => q,
        order: () => q,
        range: async () => ({ data: state.rows, error: null }),
        upsert: async (row) => {
          state.upserts.push(row)
          return { error: null }
        },
      }
      return q
    },
  },
}))
vi.mock('./writeback', () => ({
  invokeCrmAction: async (req) => {
    state.invokes.push(req)
    return { status: 'ok', results: [{ step: 'set_temperature', ok: true }] }
  },
}))

const { toRatingMap, saveRating } = await import('./useLeadRatings')

beforeEach(() => {
  state.upserts = []
  state.invokes = []
})

describe('toRatingMap', () => {
  it('keys by contact and lifts the contact score, tier and name', () => {
    const m = toRatingMap([{ contact_id: 'a', temperature: 'cold', contact: { name: 'Ann', score: 40, tier: 'warm' } }])
    expect(m.get('a')).toMatchObject({ temperature: 'cold', name: 'Ann', current_score: 40, current_tier: 'warm' })
  })
})

describe('saveRating', () => {
  it('upserts the rating and writes the FUB tag for Bayway', async () => {
    const res = await saveRating({ contactId: 'c1', businessId: 'bay', temperature: 'hot', estAmount: 350000 })
    expect(res).toEqual({ ok: true })
    expect(state.upserts[0]).toMatchObject({ contact_id: 'c1', business_id: 'bay', temperature: 'hot', est_amount: 350000, close_month: null })
    expect(state.invokes[0]).toMatchObject({ action: 'set_temperature', contact_id: 'c1', payload: { temperature: 'hot' } })
  })
  it('keeps MPG in the dashboard only', async () => {
    expect(await saveRating({ contactId: 'm1', businessId: 'mpg', temperature: 'warm' })).toEqual({ ok: true })
    expect(state.invokes).toEqual([])
  })
})
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run src/lib/useLeadRatings.test.js`
Expected: FAIL, the module isn't found.

- [ ] **Step 4: Implement**

```js
// One shared copy of lead_ratings (spec 2026-11-03, section 1) for every page
// that ranks or shows temperature: Up Next, the call list, Pipeline, the
// Person sheet and the forecast. saveRating writes the OS row first (the
// truth), then, for Bayway, the FUB Hot/Warm/Cold tag through crm-action.
import { useEffect, useState } from 'react'
import { supabase, isDemoMode } from './supabase'
import { fetchAllSettled } from './fetchAll'
import { invokeCrmAction } from './writeback'
import { buildActionRequest } from './crmActions'

const STALE_MS = 60_000
let store = { ratings: new Map(), at: 0, error: null }
let inflight = null
const listeners = new Set()
const emit = () => listeners.forEach((fn) => fn(store))

// Tests share module state across renders; reset between them.
export function __resetRatingsForTest() {
  store = { ratings: new Map(), at: 0, error: null }
  inflight = null
}

// rows: lead_ratings with contact:contacts(name, score, tier) embedded.
export function toRatingMap(rows) {
  return new Map(
    (rows || []).map((r) => [
      r.contact_id,
      { ...r, name: r.contact?.name ?? null, current_score: r.contact?.score ?? null, current_tier: r.contact?.tier ?? null },
    ]),
  )
}

export function refreshRatings() {
  if (isDemoMode) return Promise.resolve(store)
  inflight ??= (async () => {
    try {
      const { data, error } = await fetchAllSettled(() =>
        supabase
          .from('lead_ratings')
          .select('contact_id, business_id, temperature, est_amount, close_month, rated_at, score_at_rating, contact:contacts(name, score, tier)')
          .order('contact_id'),
      )
      store = error ? { ...store, error: error.message, at: Date.now() } : { ratings: toRatingMap(data), error: null, at: Date.now() }
    } finally {
      inflight = null
      emit()
    }
    return store
  })()
  return inflight
}

if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => {
    if (Date.now() - store.at > STALE_MS) refreshRatings()
  })
}

// Map contact_id -> rating; re-renders when any rating is saved.
export function useLeadRatings() {
  const [snap, setSnap] = useState(store)
  useEffect(() => {
    listeners.add(setSnap)
    if (!store.at && !inflight) refreshRatings()
    else setSnap(store)
    return () => listeners.delete(setSnap)
  }, [])
  return snap.ratings
}

// -> { ok: true } | { ok: true, tagError } (rating saved, FUB tag not) | { ok: false, error }
export async function saveRating({ contactId, businessId, temperature, estAmount = null, closeMonth = null }) {
  const row = {
    contact_id: contactId,
    business_id: businessId,
    temperature,
    est_amount: estAmount ?? null,
    close_month: closeMonth ?? null,
    rated_at: new Date().toISOString(),
  }
  const { error } = await supabase.from('lead_ratings').upsert(row, { onConflict: 'contact_id' })
  if (error) return { ok: false, error: error.message }
  const ratings = new Map(store.ratings)
  ratings.set(contactId, { ...(store.ratings.get(contactId) || {}), ...row })
  store = { ...store, ratings }
  emit()
  if (businessId !== 'bay') return { ok: true }
  const res = await invokeCrmAction(buildActionRequest({ action: 'set_temperature', contactId, temperature }))
  if (res?.status === 'ok') return { ok: true }
  return { ok: true, tagError: res?.error || res?.results?.find((r) => !r.ok)?.error || 'FUB tag not updated' }
}
```

- [ ] **Step 5: Run it to see it pass**

Run: `npx vitest run src/lib/useLeadRatings.test.js`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/useLeadRatings.js src/lib/useLeadRatings.test.js
git commit -m "feat: shared lead ratings store and saveRating"
```

---

### Task 7: The scorer stops reading the `hot` tag

**Files:**
- Modify: `supabase/functions/score-fub-leads/index.ts` (line 9 import; loop at lines 56–64)
- Modify: `supabase/functions/_shared/scoring.ts` (the comment above `assignTier`)

- [ ] **Step 1: Edit the loop**

In `index.ts`, change line 9 to:

```ts
import { scoreContact, assignTier } from '../_shared/scoring.ts'
```

Replace:

```ts
      const hasHotTag = isHotTag(c.raw?.tags)
      const { score, lastActivityAt, activityCount } = scoreContact(acts, { hasHotTag })
      const tier = assignTier({
        score,
        lastActivityAt,
        activityCount,
        inOpenPipeline: inOpenPipeline.has(c.id),
        hasHotTag,
      })
```

with:

```ts
      // The Hot tag is Chandler's temperature now (lead_ratings, spec
      // 2026-11-03), so Engagement is built from activity and stage only.
      const { score, lastActivityAt, activityCount } = scoreContact(acts)
      const tier = assignTier({
        score,
        lastActivityAt,
        activityCount,
        inOpenPipeline: inOpenPipeline.has(c.id),
      })
```

- [ ] **Step 2: Update the comment in `scoring.ts`**

Replace the comment line ` //  - hot: carries the HOT tag, OR high score AND recent activity.` with:

```ts
//  - hot: high score AND recent activity. (score-fub-leads no longer passes
//    hasHotTag: the Hot tag is the temperature rating since 2026-11-03.)
```

Keep `isHotTag` and the `hasHotTag` parameters. They are tested and harmless.

- [ ] **Step 3: Run the scoring tests**

Run: `npx vitest run supabase/functions/_shared/scoring.test.ts`
Expected: PASS, unchanged.

- [ ] **Step 4: Rename the tier labels to Engagement (spec: the words must not collide)**

The score tier still shows as "Hot" / "Warm" in two places: the Person sheet's priority line (`src/lib/contactCard.js` `TIER`) and the Priority Leads page tabs (`src/lib/priorityLeads.js` `TIERS`). The keys stay as they are. Only the labels change.

Update the tests first.
- In `src/lib/contactCard.test.js` (line ~56), change the expected `tier: 'Hot'` to `tier: 'Engagement: high'`.
- Run `grep -n "label" src/lib/priorityLeads.test.js`. Change any expected tier labels to the new ones below.

In `src/lib/contactCard.js`:

```js
// The nightly score's tier, labelled as Engagement so it never reads as the
// Hot / Warm / Cold temperature Chandler sets (spec 2026-11-03).
const TIER = { hot: 'Engagement: high', warm: 'Engagement: medium', active: 'Engagement: active', never_contacted: 'Engagement: none' }
```

In `src/lib/priorityLeads.js`, change only the `label` values in `TIERS`:

```js
  { key: 'hot', label: 'High engagement', color: '#ff5c5c', soft: 'rgba(255,92,92,0.14)' },
  { key: 'warm', label: 'Medium engagement', color: 'var(--bay-gold)', soft: 'rgba(124,173,68,0.16)' },
  { key: 'active', label: 'Active', color: 'var(--bay)', soft: 'var(--bay-soft)' },
  { key: 'never_contacted', label: 'Never Contacted', color: 'var(--dim)', soft: 'rgba(148,148,158,0.14)' },
```

Run: `npx vitest run src/lib/contactCard.test.js src/lib/priorityLeads.test.js src/pages/PriorityLeads.render.test.jsx`

Expected: PASS after the expectation updates. If `PriorityLeads.render.test.jsx` asserts a "Hot" tab label, update it to "High engagement".

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/score-fub-leads/index.ts supabase/functions/_shared/scoring.ts src/lib/contactCard.js src/lib/contactCard.test.js src/lib/priorityLeads.js src/lib/priorityLeads.test.js src/pages/PriorityLeads.render.test.jsx
git commit -m "feat: Engagement score ignores the Hot tag; tier labels read as Engagement"
```

---

### Task 8: Up Next: effective hot and temperature rank

**Files:**
- Modify: `src/lib/priorityQueue.js` (imports; the hot_cold line in `bucketsFor`; the `buildQueue` sort)
- Modify: `src/lib/usePriorityQueue.js` (merge ratings)
- Test: `src/lib/priorityQueue.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/priorityQueue.test.js`:

```js
describe('temperature in Up Next', () => {
  it('a Warm rating turns off hot-going-cold even when the view says hot', () => {
    const row = base({ is_hot: true, is_active: true, stage: 'Contacted/Working', temperature: 'warm', last_outbound_at: daysAgo(9), last_outbound_call_at: daysAgo(9), open_task_count: 1, oldest_open_due_at: daysAgo(-2) })
    expect(bucketsFor(row, rules, NOW)).not.toContain('hot_cold')
  })
  it('a Hot rating turns it on', () => {
    const row = base({ is_hot: false, is_active: true, stage: 'Contacted/Working', temperature: 'hot', last_outbound_at: daysAgo(9), last_outbound_call_at: daysAgo(9), open_task_count: 1, oldest_open_due_at: daysAgo(-2) })
    expect(bucketsFor(row, rules, NOW)).toContain('hot_cold')
  })
  it('inside a bucket: Hot, Warm, unrated, Cold', () => {
    const od = { open_task_count: 1, oldest_open_due_at: daysAgo(2) }
    const q = buildQueue([
      base({ id: 'cold', temperature: 'cold', ...od }),
      base({ id: 'none', ...od }),
      base({ id: 'warm', temperature: 'warm', ...od }),
      base({ id: 'hot', temperature: 'hot', ...od }),
    ], rules, NOW)
    expect(q.map((r) => r.id)).toEqual(['hot', 'warm', 'none', 'cold'])
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/priorityQueue.test.js`
Expected: FAIL. The Warm row still lands in `hot_cold`, and the order is wrong.

- [ ] **Step 3: Implement in `priorityQueue.js`**

Add this import under `import { isCadenceStage } from './dialList'`:

```js
import { effectiveHot, temperatureRank } from './leadRatings'
```

In `bucketsFor`, change:

```js
  if (row.is_hot && untouchedFor(rules.hot_cold_days)) out.push('hot_cold')
```

to:

```js
  if (effectiveHot(row) && untouchedFor(rules.hot_cold_days)) out.push('hot_cold')
```

In the `buildQueue` sort, insert the temperature step right after the bucket comparison:

```js
  return out.sort((a, b) => {
    if (a.bucket !== b.bucket) return RANK[a.bucket] - RANK[b.bucket]
    const tr = temperatureRank(a) - temperatureRank(b)
    if (tr) return tr
    const n = neglect(b, now) - neglect(a, now)
    if (n) return n
    const s = (b.score ?? -1) - (a.score ?? -1)
    if (s) return s
    return String(a.name || '').localeCompare(String(b.name || ''))
  })
```

- [ ] **Step 4: Implement in `usePriorityQueue.js`**

Add imports:

```js
import { useLeadRatings } from './useLeadRatings'
import { withRatings } from './leadRatings'
```

In `usePriorityQueue`, add `const ratings = useLeadRatings()` right after `const [snap, setSnap] = useState(store)`. Then change the memo:

```js
  return useMemo(() => {
    const inView = (r) => biz === 'all' || r.business_id === biz
    const rows = withRatings(snap.rows.filter(inView), ratings)
    const ids = new Set(rows.map((r) => r.id))
```

Change the memo's dependency list from `[snap, biz]` to `[snap, biz, ratings]`.

- [ ] **Step 5: Run the queue and page tests**

Run: `npx vitest run src/lib/priorityQueue.test.js src/pages/Priority.render.test.jsx src/pages/Workbench.render.test.jsx src/pages/Overview.render.test.jsx`

Expected: PASS. If a render test fails because its fake Supabase throws on the unknown `lead_ratings` table, add `lead_ratings: []`, or the file's equivalent, to that test's table fixture.

- [ ] **Step 6: Commit**

```bash
git add src/lib/priorityQueue.js src/lib/usePriorityQueue.js src/lib/priorityQueue.test.js
git commit -m "feat: Up Next ranks Hot, Warm, unrated, Cold inside each bucket"
```

---

### Task 9: Call list temperature rank

**Files:**
- Modify: `src/lib/dialList.js` (`buildDialList` sort)
- Modify: `src/pages/Workbench.jsx` (line 84: merge ratings)
- Test: `src/lib/dialList.test.js`

- [ ] **Step 1: Look at the existing row fixtures**

Run: `grep -n "const row\|function row\|business_id: 'bay'" src/lib/dialList.test.js | head`

Use the shape the file already uses for a Bayway Attempted lead with one call.

- [ ] **Step 2: Write the failing test**

Append to `src/lib/dialList.test.js`. If the file's helper isn't called `row`, build the three rows inline with the fields shown:

```js
describe('buildDialList temperature', () => {
  it('puts Hot first among items due now, after speed to lead', () => {
    const now = new Date('2026-11-03T15:00:00').getTime()
    const due = (id, temperature) => ({
      id,
      business_id: 'bay',
      stage: 'Attempted',
      crm_created_at: '2026-10-20T08:00:00',
      outbound_calls: 1,
      first_outbound_call_at: '2026-10-20T09:00:00',
      last_outbound_call_at: '2026-10-20T09:00:00',
      connected_at: null,
      temperature,
    })
    const { dueNow } = buildDialList([due('a', 'cold'), due('b'), due('c', 'hot')], { now })
    expect(dueNow.map((i) => i.id)).toEqual(['c', 'b', 'a'])
  })
})
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run src/lib/dialList.test.js`
Expected: FAIL (wrong order).

- [ ] **Step 4: Implement**

At the top of `dialList.js` (the file has no imports yet):

```js
import { temperatureRank } from './leadRatings'
```

`leadRatings.js` must not import `dialList.js`. It doesn't, so the import graph stays acyclic.

In `buildDialList`, change the `dueNow` sort to:

```js
  const dueNow = items
    .filter((i) => i.dueAt <= now)
    .sort(
      (a, b) =>
        (a.hint === 'speed to lead' ? 0 : 1) - (b.hint === 'speed to lead' ? 0 : 1) ||
        temperatureRank(a.row) - temperatureRank(b.row) ||
        b.dueAt - a.dueAt,
    )
```

In `src/pages/Workbench.jsx`, add imports:

```js
import { useLeadRatings } from '../lib/useLeadRatings'
import { withRatings } from '../lib/leadRatings'
```

Inside `Workbench()`, change line 84 to:

```js
  const ratings = useLeadRatings()
  const dialDue = buildDialList(withRatings(dial.rows, ratings), { now: dial.now, skips: dial.skips, inBook })
```

- [ ] **Step 5: Run it to see it pass**

Run: `npx vitest run src/lib/dialList.test.js src/pages/Workbench.render.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/dialList.js src/lib/dialList.test.js src/pages/Workbench.jsx
git commit -m "feat: call list puts Hot leads first"
```

---

### Task 10: Card pills: temperature and "Cold, but active"

**Files:**
- Modify: `src/lib/cardHealth.js` (`cardHealth`, `healthPills`)
- Test: `src/lib/cardHealth.test.js`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/cardHealth.test.js`:

```js
describe('temperature pills', () => {
  it('leads with the temperature pill, tinted by heat', () => {
    expect(healthPills(cardHealth(row({ temperature: 'hot' }), rules, NOW))[0]).toEqual({ key: 'temp', tone: 'neg', text: 'Hot' })
    expect(healthPills(cardHealth(row({ temperature: 'warm' }), rules, NOW))[0]).toEqual({ key: 'temp', tone: 'warn', text: 'Warm' })
    expect(healthPills(cardHealth(row({ temperature: 'cold' }), rules, NOW))[0]).toEqual({ key: 'temp', tone: 'neutral', text: 'Cold' })
  })
  it('adds Cold, but active when the score rose since the rating', () => {
    const r = row({ temperature: 'cold', rating: { temperature: 'cold', score_at_rating: 5, current_score: 40 } })
    expect(healthPills(cardHealth(r, rules, NOW)).map((p) => p.key)).toContain('cold_active')
  })
  it('unrated cards are unchanged', () => {
    expect(healthPills(cardHealth(row(), rules, NOW)).map((p) => p.key)).toEqual(['none'])
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/cardHealth.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add the import:

```js
import { TEMP_LABEL, coldButActive } from './leadRatings'
```

Replace `cardHealth`:

```js
export function cardHealth(row, rules, now = Date.now()) {
  return {
    next: nextStep(row, now),
    stuck: stuckFor(row, rules, now),
    speed: speedToLead(row, rules, now),
    temp: row.temperature || null,
    coldActive: coldButActive(row.rating),
  }
}
```

Add next to `NEXT_TONE`:

```js
const TEMP_TONE = { hot: 'neg', warm: 'warn', cold: 'neutral' }
```

In `healthPills`, add right after `const pills = []`:

```js
  if (h.temp) pills.push({ key: 'temp', tone: TEMP_TONE[h.temp], text: TEMP_LABEL[h.temp] })
```

Then add right before `return pills`:

```js
  if (h.coldActive) pills.push({ key: 'cold_active', tone: 'warn', text: 'Cold, but active' })
```

`healthRank` is unchanged. Temperature ranks Up Next and the call list, not the board.

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run src/lib/cardHealth.test.js src/pages/Pipeline.render.test.jsx`

Expected: PASS. Existing `h` fixtures have no `temp`, so their pills are unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cardHealth.js src/lib/cardHealth.test.js
git commit -m "feat: temperature and Cold-but-active pills on cards"
```

---

### Task 11: Forecast module

**Files:**
- Create: `src/lib/forecast.js`
- Test: `src/lib/forecast.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_FORECAST, resolveForecast, monthKeyOf, avgFundedLoan, mpgPerAccount, forecastLines, forecastByMonth, sortPaysFirst,
} from './forecast'

const NOW = new Date('2026-11-03T09:00:00').getTime()
const rates = { primary_pct: 1.25, assisted_pct: 0.75 }
const settings = resolveForecast(null)
const loan = (o) => ({ id: o.id, role: 'primary', amount: 400000, stage_group: 'processing', funded_on: null, firm_closing_on: null, contact_id: null, borrower_name: 'B', comp_override: null, scenario_auto: false, scenario_override: null, ...o })
const rating = (o) => ({ contact_id: o.contact_id, business_id: 'bay', temperature: 'hot', est_amount: null, close_month: null, name: 'R', ...o })
const map = (...rs) => new Map(rs.map((r) => [r.contact_id, r]))

describe('settings', () => {
  it('fills defaults and drops junk', () => {
    expect(resolveForecast(null)).toEqual(DEFAULT_FORECAST)
    expect(resolveForecast({ temp_odds: { hot: '70', warm: 'x' } }).temp_odds).toEqual({ hot: 70, warm: 30, cold: 10 })
  })
})

describe('helpers', () => {
  it('monthKeyOf with an offset', () => {
    expect(monthKeyOf(NOW)).toBe('2026-11')
    expect(monthKeyOf(NOW, 1)).toBe('2026-12')
  })
  it('average funded primary loan over the last 12 months, else all funded', () => {
    const loans = [
      loan({ id: 1, stage_group: 'funded', funded_on: '2026-06-01', amount: 300000 }),
      loan({ id: 2, stage_group: 'funded', funded_on: '2026-09-01', amount: 500000 }),
      loan({ id: 3, stage_group: 'funded', funded_on: '2026-09-01', amount: 900000, role: 'assisted' }),
      loan({ id: 4, stage_group: 'funded', funded_on: '2024-01-01', amount: 100000 }),
    ]
    expect(avgFundedLoan(loans, NOW)).toBe(400000)
    expect(avgFundedLoan([loan({ id: 5, stage_group: 'funded', funded_on: '2023-01-01', amount: 200000 })], NOW)).toBe(200000)
    expect(avgFundedLoan([], NOW)).toBe(null)
  })
  it('MPG per account: actual average, else the estimate, else null', () => {
    expect(mpgPerAccount({ residual: 900, merchants: 3 }, settings)).toEqual({ amount: 300, est: false })
    expect(mpgPerAccount({ residual: 0, merchants: 0 }, { ...settings, mpg_est_residual_per_account: 120 })).toEqual({ amount: 120, est: true })
    expect(mpgPerAccount({}, settings)).toBe(null)
  })
})

describe('forecastLines', () => {
  it('an Arive loan beats the rating on the same contact', () => {
    const lines = forecastLines({
      ratings: map(rating({ contact_id: 'c1' })),
      loans: [loan({ id: 9, contact_id: 'c1', firm_closing_on: '2026-11-20' })],
      rates, settings, avgLoan: 300000, mpgAccount: null, now: NOW,
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ source: 'arive', payout: 5000, odds: 75, month: '2026-11', payDate: '2026-11-20' })
  })
  it('funded loans count at 100% in their funded month; adverse loans and scenarios are out', () => {
    const lines = forecastLines({
      ratings: new Map(),
      loans: [
        loan({ id: 1, stage_group: 'funded', funded_on: '2026-11-02' }),
        loan({ id: 2, stage_group: 'adverse' }),
        loan({ id: 3, scenario_auto: true, firm_closing_on: '2026-11-10' }),
      ],
      rates, settings, avgLoan: null, mpgAccount: null, now: NOW,
    })
    expect(lines.map((l) => [l.key, l.odds, l.funded])).toEqual([['loan:1', 100, true]])
  })
  it('a rated Bayway lead uses its amount, else the average loan, marked est.', () => {
    const lines = forecastLines({
      ratings: map(rating({ contact_id: 'a', est_amount: 200000 }), rating({ contact_id: 'b', temperature: 'warm' })),
      loans: [], rates, settings, avgLoan: 400000, mpgAccount: null, now: NOW,
    })
    expect(lines.find((l) => l.contactId === 'a')).toMatchObject({ payout: 2500, odds: 60, month: '2026-12', est: false })
    expect(lines.find((l) => l.contactId === 'b')).toMatchObject({ payout: 5000, odds: 30, month: '2027-01', est: true })
  })
  it('a rated MPG lead counts as an account, with dollars only when a per-account amount exists', () => {
    const base = { ratings: map(rating({ contact_id: 'm', business_id: 'mpg', close_month: '2026-11-01' })), loans: [], rates, settings, avgLoan: null, now: NOW }
    expect(forecastLines({ ...base, mpgAccount: null })[0]).toMatchObject({ book: 'mpg', payout: null, odds: 60, month: '2026-11' })
    expect(forecastLines({ ...base, mpgAccount: { amount: 150, est: true } })[0]).toMatchObject({ payout: 150, est: true })
  })
})

describe('forecastByMonth', () => {
  it('splits funded and weighted for Bayway, accounts or dollars for MPG', () => {
    const lines = [
      { book: 'bay', month: '2026-11', payout: 5000, odds: 100, funded: true, est: false },
      { book: 'bay', month: '2026-11', payout: 4000, odds: 75, funded: false, est: false },
      { book: 'bay', month: '2026-11', payout: 5000, odds: 60, funded: false, est: true },
      { book: 'bay', month: '2026-12', payout: 9999, odds: 60, funded: false, est: false },
      { book: 'mpg', month: '2026-11', payout: null, odds: 60, est: false },
      { book: 'mpg', month: '2026-11', payout: null, odds: 30, est: false },
    ]
    expect(forecastByMonth(lines, '2026-11')).toEqual({
      month: '2026-11',
      bay: { expected: 11000, funded: 5000, weighted: 6000, est: 1 },
      mpg: { expected: null, accounts: 0.9, est: 0 },
      total: 11000,
    })
  })
})

describe('sortPaysFirst', () => {
  it('earliest pay date first, then bigger expected payout; rows without a line last', () => {
    const lines = [
      { contactId: 'late', payDate: '2026-12-01', payout: 9000, odds: 60 },
      { contactId: 'soon-small', payDate: '2026-11-10', payout: 1000, odds: 60 },
      { contactId: 'soon-big', payDate: '2026-11-10', payout: 5000, odds: 60 },
    ]
    const rows = ['none', 'late', 'soon-small', 'soon-big'].map((id) => ({ id }))
    expect(sortPaysFirst(rows, lines).map((r) => r.id)).toEqual(['soon-big', 'soon-small', 'late', 'none'])
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/forecast.test.js`
Expected: FAIL, the module isn't found.

- [ ] **Step 3: Implement**

```js
// Production forecast (spec 2026-11-03, section 2): expected payout per month
// from open Arive loans (stage odds) and rated leads with no loan yet
// (temperature odds). Pure, no React, no I/O; useForecastInputs loads the inputs.
import { estComp, isScenario } from './loans'
import { closeMonthOf } from './leadRatings'

export const DEFAULT_FORECAST = {
  temp_odds: { hot: 60, warm: 30, cold: 10 },
  arive_odds: { prospect: 30, processing: 75, closing: 95 },
  close_offset_months: { hot: 1, warm: 2, cold: 3 },
  mpg_est_residual_per_account: null,
}

const numOr = (v, d) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? d : Number(v))

export function resolveForecast(saved) {
  const s = saved && typeof saved === 'object' ? saved : {}
  const pick = (key) => Object.fromEntries(Object.entries(DEFAULT_FORECAST[key]).map(([k, d]) => [k, numOr(s[key]?.[k], d)]))
  return {
    temp_odds: pick('temp_odds'),
    arive_odds: pick('arive_odds'),
    close_offset_months: pick('close_offset_months'),
    mpg_est_residual_per_account: numOr(s.mpg_est_residual_per_account, null),
  }
}

const pad = (n) => String(n).padStart(2, '0')
// 'YYYY-MM', local calendar, `offset` months after now's month.
export function monthKeyOf(now = Date.now(), offset = 0) {
  const d = new Date(now)
  d.setDate(1)
  d.setMonth(d.getMonth() + offset)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}
const monthOf = (iso) => (iso ? String(iso).slice(0, 7) : null)

// Mean amount of funded primary loans in the last 12 months, else of all
// funded primary loans; null with none. Stands in for a rated lead's amount.
export function avgFundedLoan(loans, now = Date.now()) {
  const funded = (loans || []).filter((l) => l.stage_group === 'funded' && l.role === 'primary' && Number(l.amount) > 0)
  const yearAgo = new Date(now - 365 * 86_400_000).toISOString().slice(0, 10)
  const recent = funded.filter((l) => l.funded_on && l.funded_on >= yearAgo)
  const pool = recent.length ? recent : funded
  if (!pool.length) return null
  return Math.round(pool.reduce((s, l) => s + Number(l.amount), 0) / pool.length)
}

// metrics: { residual, merchants } (latest MPG monthly residual and active merchants).
export function mpgPerAccount(metrics, settings) {
  const residual = Number(metrics?.residual || 0)
  const merchants = Number(metrics?.merchants || 0)
  if (residual > 0 && merchants > 0) return { amount: Math.round(residual / merchants), est: false }
  const est = settings?.mpg_est_residual_per_account
  if (est != null && est > 0) return { amount: est, est: true }
  return null
}

const ARIVE_OPEN = new Set(['prospect', 'processing', 'closing'])

// One line per counted Arive loan and per rated lead with no loan:
// { key, book, source, contactId, name, payout|null, odds (0-100), month 'YYYY-MM'|null,
//   payDate 'YYYY-MM-DD'|null, est, funded, temperature? }
export function forecastLines({ ratings, loans, rates, settings, avgLoan, mpgAccount, now = Date.now() }) {
  const lines = []
  const loanContacts = new Set()
  const offsets = settings.close_offset_months
  for (const l of loans || []) {
    if (isScenario(l)) continue
    if (l.contact_id) loanContacts.add(l.contact_id)
    const funded = l.stage_group === 'funded'
    if (!funded && !ARIVE_OPEN.has(l.stage_group)) continue
    const r = l.contact_id ? ratings.get(l.contact_id) : null
    const ratedMonth = r ? closeMonthOf(r, now, offsets) : null
    const payDate = funded ? l.funded_on : l.firm_closing_on || ratedMonth
    lines.push({
      key: `loan:${l.id}`,
      book: 'bay',
      source: 'arive',
      contactId: l.contact_id || null,
      name: l.borrower_name || null,
      payout: estComp(l, rates),
      odds: funded ? 100 : settings.arive_odds[l.stage_group],
      month: monthOf(payDate),
      payDate: payDate || null,
      est: false,
      funded,
    })
  }
  for (const r of ratings.values()) {
    if (loanContacts.has(r.contact_id)) continue
    const payDate = closeMonthOf(r, now, offsets)
    const common = {
      key: `rating:${r.contact_id}`,
      source: 'rating',
      contactId: r.contact_id,
      name: r.name || null,
      odds: settings.temp_odds[r.temperature],
      month: monthOf(payDate),
      payDate,
      funded: false,
      temperature: r.temperature,
    }
    if (r.business_id === 'bay') {
      const amount = r.est_amount != null ? Number(r.est_amount) : avgLoan
      lines.push({ ...common, book: 'bay', payout: amount == null ? null : Math.round(amount * rates.primary_pct) / 100, est: r.est_amount == null })
    } else {
      lines.push({ ...common, book: 'mpg', payout: mpgAccount ? mpgAccount.amount : null, est: mpgAccount ? mpgAccount.est : false })
    }
  }
  return lines
}

const weighted = (l) => ((l.payout ?? 0) * l.odds) / 100

// Totals for one 'YYYY-MM'. MPG dollars are null until every MPG line has a payout.
export function forecastByMonth(lines, month) {
  const inMonth = lines.filter((l) => l.month === month)
  const bay = inMonth.filter((l) => l.book === 'bay')
  const mpg = inMonth.filter((l) => l.book === 'mpg')
  const funded = Math.round(bay.filter((l) => l.funded).reduce((s, l) => s + (l.payout ?? 0), 0))
  const open = Math.round(bay.filter((l) => !l.funded).reduce((s, l) => s + weighted(l), 0))
  const mpgDollars = mpg.length && mpg.every((l) => l.payout != null) ? Math.round(mpg.reduce((s, l) => s + weighted(l), 0)) : null
  return {
    month,
    bay: { expected: funded + open, funded, weighted: open, est: bay.filter((l) => l.est).length },
    mpg: { expected: mpgDollars, accounts: Math.round(mpg.reduce((s, l) => s + l.odds / 100, 0) * 10) / 10, est: mpg.filter((l) => l.est).length },
    total: funded + open + (mpgDollars ?? 0),
  }
}

// Pipeline "Pays first": earliest expected pay date, then bigger expected
// payout; rows with no forecast line keep their order at the end.
export function sortPaysFirst(rows, lines) {
  const best = new Map()
  for (const l of lines) {
    if (!l.contactId || !l.payDate) continue
    const cur = best.get(l.contactId)
    if (!cur || l.payDate < cur.payDate) best.set(l.contactId, l)
  }
  return [...rows].sort((a, b) => {
    const la = best.get(a.id)
    const lb = best.get(b.id)
    if (!la || !lb) return (la ? 0 : 1) - (lb ? 0 : 1)
    if (la.payDate !== lb.payDate) return la.payDate < lb.payDate ? -1 : 1
    return weighted(lb) - weighted(la)
  })
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run src/lib/forecast.test.js`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/forecast.js src/lib/forecast.test.js
git commit -m "feat: production forecast module"
```

---

### Task 12: Forecast inputs hook

**Files:**
- Create: `src/lib/useForecastInputs.js`

This task is I/O glue with no unit test of its own. The Overview render test in Task 13 covers it.

- [ ] **Step 1: Implement**

```js
// Inputs for the forecast (forecast.js): Arive loans and commission rates,
// the forecast settings, and the latest MPG residual / active merchants
// entered in Reports. One shared fetch for Overview and Pipeline.
import { useEffect, useMemo, useState } from 'react'
import { supabase, isDemoMode } from './supabase'
import { fetchLoanBundle } from './loansData'
import { DEFAULT_RATES } from './loans'
import { useLeadRatings } from './useLeadRatings'
import { resolveForecast, avgFundedLoan, mpgPerAccount, forecastLines } from './forecast'

const EMPTY = { loans: [], rates: DEFAULT_RATES, settings: resolveForecast(null), mpgMetrics: {}, at: 0, error: null }
let store = EMPTY
let inflight = null
const listeners = new Set()

export function __resetForecastForTest() {
  store = EMPTY
  inflight = null
}

export function refreshForecastInputs() {
  if (isDemoMode) return Promise.resolve(store)
  inflight ??= (async () => {
    try {
      const [bundle, settings, metrics] = await Promise.all([
        fetchLoanBundle(),
        supabase.from('settings').select('value').eq('key', 'forecast').maybeSingle(),
        supabase
          .from('metrics_daily')
          .select('date, metric_key, value')
          .eq('business_id', 'mpg')
          .in('metric_key', ['rev_monthly_residual', 'rev_active_merchants'])
          .order('date', { ascending: false })
          .limit(24),
      ])
      const latest = (key) => (metrics.data || []).find((m) => m.metric_key === key)?.value ?? null
      store = {
        loans: bundle.data?.loans || [],
        rates: bundle.data?.rates || DEFAULT_RATES,
        settings: resolveForecast(settings.data?.value),
        mpgMetrics: { residual: latest('rev_monthly_residual'), merchants: latest('rev_active_merchants') },
        at: Date.now(),
        error: bundle.error?.message || settings.error?.message || metrics.error?.message || null,
      }
    } finally {
      inflight = null
      listeners.forEach((fn) => fn(store))
    }
    return store
  })()
  return inflight
}

// -> { lines, settings, loading, error }
export function useForecast(now = Date.now()) {
  const [snap, setSnap] = useState(store)
  const ratings = useLeadRatings()
  useEffect(() => {
    listeners.add(setSnap)
    if (!store.at && !inflight) refreshForecastInputs()
    else setSnap(store)
    return () => listeners.delete(setSnap)
  }, [])
  const monthKey = new Date(now).getMonth()
  return useMemo(() => {
    const lines = forecastLines({
      ratings,
      loans: snap.loans,
      rates: snap.rates,
      settings: snap.settings,
      avgLoan: avgFundedLoan(snap.loans, now),
      mpgAccount: mpgPerAccount(snap.mpgMetrics, snap.settings),
      now,
    })
    return { lines, settings: snap.settings, loading: !snap.at && !isDemoMode, error: snap.error }
    // Recompute on new inputs or a new month, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, ratings, monthKey])
}
```

- [ ] **Step 2: Check the metric keys exist**

Run: `grep -n "rev_monthly_residual\|rev_active_merchants" src/lib/reports.js`
Expected: both keys are listed with `biz: 'mpg'`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/useForecastInputs.js
git commit -m "feat: shared forecast inputs hook"
```

---

### Task 13: Overview forecast card

**Files:**
- Create: `src/components/ForecastCard.jsx`
- Modify: `src/pages/Overview.jsx` (imports; render near `<IncomeCard ...>`, about line 682)
- Test: `src/pages/Overview.render.test.jsx`

- [ ] **Step 1: Look at the render test's fake Supabase**

Run: `sed -n 15,120p src/pages/Overview.render.test.jsx`

Find the following:
- how `TABLES` feeds `from(table)`,
- whether paged reads use `.range`,
- the name of the mount helper,
- where `beforeEach` resets state.

- [ ] **Step 2: Write the failing render test**

Add a `lead_ratings` entry to `TABLES`, shaped like the other array tables:

```js
  lead_ratings: [
    { contact_id: 'r1', business_id: 'bay', temperature: 'hot', est_amount: 400000, close_month: null, rated_at: new Date().toISOString(), score_at_rating: 10, contact: { name: 'Rae Rated', score: 10, tier: 'warm' } },
  ],
```

In the file's `beforeEach`, also call the store resets. Import them at the top, after the `vi.mock` of `../lib/supabase`, the same way the page is imported:

```js
const { __resetRatingsForTest } = await import('../lib/useLeadRatings')
const { __resetForecastForTest } = await import('../lib/useForecastInputs')
// in beforeEach:
__resetRatingsForTest()
__resetForecastForTest()
```

Add the test, using the file's mount helper in place of `render()` if its name differs:

```js
it('shows the forecast card with this month and next', async () => {
  await render()
  const card = document.querySelector('[data-card="forecast"]')
  expect(card.textContent).toContain('Forecast')
  expect(card.textContent).toContain('This month')
  expect(card.textContent).toContain('Next month')
  // Hot at 60% of 400,000 x 1.25% = 3,000, due next month by default.
  expect(card.textContent).toContain('$3,000')
})
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run src/pages/Overview.render.test.jsx`
Expected: FAIL, because there is no `[data-card="forecast"]`.

- [ ] **Step 4: Implement `ForecastCard.jsx`**

```jsx
// Overview: expected payout this month and next (forecast.js). Bayway is
// funded + weighted pipeline; MPG is expected accounts until residuals exist.
import { Link } from 'react-router-dom'
import { forecastByMonth, monthKeyOf } from '../lib/forecast'

const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`

function Column({ label, f, biz }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="text-[12px] font-semibold text-muted">{label}</div>
      {biz !== 'mpg' && (
        <div className="mt-1">
          <div className="num text-[22px] font-bold">{money(f.bay.expected)}</div>
          <div className="text-[12px] text-muted">
            Bayway · funded {money(f.bay.funded)} · weighted {money(f.bay.weighted)}
            {f.bay.est > 0 && ` · ${f.bay.est} est.`}
          </div>
        </div>
      )}
      {biz !== 'bay' && (
        <div className="mt-2 text-[13px]">
          MPG ·{' '}
          {f.mpg.expected != null ? (
            <span className="num font-semibold">
              {money(f.mpg.expected)}
              {f.mpg.est > 0 && ' est.'}
            </span>
          ) : (
            <span className="num font-semibold">{f.mpg.accounts} accounts expected</span>
          )}
        </div>
      )}
    </div>
  )
}

export default function ForecastCard({ forecast, biz, now = Date.now() }) {
  const { lines, loading, error } = forecast
  const thisMonth = forecastByMonth(lines, monthKeyOf(now))
  const nextMonth = forecastByMonth(lines, monthKeyOf(now, 1))
  return (
    <section data-card="forecast" className="rounded-card border border-line bg-panel p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-[15px] font-semibold">Forecast</h3>
        <Link to="/settings" className="text-[12px] text-muted hover:text-[color:var(--text)]">
          Odds
        </Link>
      </div>
      {error && <div className="mt-2 text-[12px] text-red-700">{error}</div>}
      {loading ? (
        <div className="mt-3 text-[13px] text-muted">Loading…</div>
      ) : (
        <div className="mt-3 flex gap-6">
          <Column label="This month" f={thisMonth} biz={biz} />
          <Column label="Next month" f={nextMonth} biz={biz} />
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 5: Wire it into `Overview.jsx`**

Add imports:

```js
import ForecastCard from '../components/ForecastCard'
import { useForecast } from '../lib/useForecastInputs'
```

In `Overview()`, after `const pq = usePriorityQueue(biz)`:

```js
  const forecast = useForecast()
```

In the JSX, right before `<IncomeCard model={view.income} biz={biz} />`:

```jsx
            <ForecastCard forecast={forecast} biz={biz} />
```

- [ ] **Step 6: Run it to see it pass**

Run: `npx vitest run src/pages/Overview.render.test.jsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/ForecastCard.jsx src/pages/Overview.jsx src/pages/Overview.render.test.jsx
git commit -m "feat: Overview forecast card"
```

---

### Task 14: Pipeline temperature filter and "Pays first" sort

**Files:**
- Modify: `src/lib/pipelineView.js` (`SORTS`; new `TEMP_FILTERS` and `filterByTemperature`; the `sortRows` signature)
- Modify: `src/pages/Pipeline.jsx`:
  - imports
  - `Toolbar` props and markup (lines 100–145)
  - state (about line 790)
  - render (about lines 905–953)
- Test: `src/lib/pipelineView.test.js`
- Test: `src/pages/Pipeline.render.test.jsx`

- [ ] **Step 1: Write the failing unit tests**

Append to `src/lib/pipelineView.test.js`, adding `TEMP_FILTERS, filterByTemperature` to its import. `rules` and `NOW` already exist at the top of that file; check with `grep -n "^const rules\|^const NOW" src/lib/pipelineView.test.js`.

```js
describe('temperature filter', () => {
  const rows = [{ id: 'h', temperature: 'hot' }, { id: 'c', temperature: 'cold' }, { id: 'n' }]
  it('lists All, Hot, Warm, Cold, Unrated', () => {
    expect(TEMP_FILTERS.map((f) => f.id)).toEqual(['all', 'hot', 'warm', 'cold', 'unrated'])
  })
  it('filters by temperature, or unrated', () => {
    expect(filterByTemperature(rows, 'all')).toBe(rows)
    expect(filterByTemperature(rows, 'hot').map((r) => r.id)).toEqual(['h'])
    expect(filterByTemperature(rows, 'unrated').map((r) => r.id)).toEqual(['n'])
  })
})

describe('pays first sort', () => {
  it('uses the forecast lines passed in', () => {
    const rows = [{ id: 'a' }, { id: 'b' }]
    const lines = [{ contactId: 'b', payDate: '2026-11-05', payout: 100, odds: 60 }]
    expect(sortRows(rows, 'pays_first', rules, NOW, { lines }).map((r) => r.id)).toEqual(['b', 'a'])
  })
  it('is offered as a sort', () => {
    expect(SORTS.map((s) => s.id)).toContain('pays_first')
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/pipelineView.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement in `pipelineView.js`**

Add the import:

```js
import { sortPaysFirst } from './forecast'
```

Replace `SORTS`, and add the filter below it:

```js
export const SORTS = [
  { id: 'urgent', label: 'Most urgent' },
  { id: 'pays_first', label: 'Pays first' },
  { id: 'touch', label: 'Oldest touch' },
  { id: 'newest', label: 'Newest lead' },
  { id: 'name', label: 'Name' },
]

export const TEMP_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'hot', label: 'Hot' },
  { id: 'warm', label: 'Warm' },
  { id: 'cold', label: 'Cold' },
  { id: 'unrated', label: 'Unrated' },
]

export function filterByTemperature(rows, temp) {
  if (!temp || temp === 'all') return rows
  if (temp === 'unrated') return rows.filter((r) => !r.temperature)
  return rows.filter((r) => r.temperature === temp)
}
```

Change the head of `sortRows`, keeping the rest as is:

```js
// A new array; ties keep their order. extra.lines: forecast lines for 'pays_first'.
export function sortRows(rows, sort, rules, now = Date.now(), extra = {}) {
  if (sort === 'urgent') return sortByHealth(rows, rules, now)
  if (sort === 'pays_first') return sortPaysFirst(rows, extra.lines || [])
```

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run src/lib/pipelineView.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing render test**

Run `sed -n 1,80p src/pages/Pipeline.render.test.jsx` to read its fake Supabase. In `from(table)`, add a branch so `table === 'lead_ratings'` returns `DATA.ratings || []` through the same paged-read path that `DATA.rows` uses. Then:
- set `DATA.ratings = []` in `beforeEach`,
- call `__resetRatingsForTest()` and `__resetForecastForTest()` in `beforeEach`, imported as in Task 13.

Append:

```js
describe('Pipeline temperature', () => {
  it('shows the temperature pill and filters by it', async () => {
    DATA.rows = [
      { ...card('h', 'Hal Hot', 'Contacted/Working') },
      { ...card('u', 'Uma Unrated', 'Contacted/Working') },
    ]
    DATA.ratings = [{ contact_id: 'h', business_id: 'bay', temperature: 'hot', est_amount: null, close_month: null, contact: { name: 'Hal Hot', score: 0, tier: 'warm' } }]
    await mount()
    expect(cardEl('h').querySelector('[data-health="temp"]').textContent).toBe('Hot')
    const select = document.querySelector('select[aria-label="Temperature"]')
    await act(async () => {
      select.value = 'hot'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(cardEl('u')).toBeNull()
  })
})
```

- [ ] **Step 6: Wire `Pipeline.jsx`**

Add imports:

```js
import { useLeadRatings } from '../lib/useLeadRatings'
import { withRatings } from '../lib/leadRatings'
import { useForecast } from '../lib/useForecastInputs'
```

Change the line-22 import to include `TEMP_FILTERS, filterByTemperature`.

In `Toolbar`, add the props `temp, onTemp`, and put this after the Sort `<label>…</label>`:

```jsx
        <label className="flex h-[42px] items-center gap-2 rounded-[10px] border border-line2 bg-panel px-3 text-muted">
          <select
            aria-label="Temperature"
            value={temp}
            onChange={(e) => onTemp(e.target.value)}
            className="bg-transparent text-[14px] font-medium text-[#344054] outline-none"
          >
            {TEMP_FILTERS.map((o) => (
              <option key={o.id} value={o.id}>
                Temperature: {o.label}
              </option>
            ))}
          </select>
        </label>
```

In the page component, next to `const [sort, setSort] = useState('urgent')`:

```js
  const [temp, setTemp] = useState('all')
  const ratings = useLeadRatings()
  const forecast = useForecast()
```

Change the render section:

```js
  const rated = withRatings(rows, ratings)
  const visible = rated.filter((r) => pending[r.id] !== 'Lost')
  const shown = withPendingMoves(filterByTemperature(filterRows(visible, query), temp), pending)
  const extra = { lines: forecast.lines }
```

Then:
- In the two `sortRows(…, sort, rules, now)` calls (the `groups` `sortCards` callback and the `ListView` `rows` prop), add `extra` as the fifth argument.
- Pass `temp={temp} onTemp={setTemp}` to `<Toolbar …>`.
- Change the `ListView` / `GroupedView` `key` to `` `${sort}|${query}|${temp}` ``.
- Change the empty-result message to:

```jsx
              {query.trim() ? `No leads match “${query.trim()}”.` : 'No leads with that temperature.'}
```

- [ ] **Step 7: Run it to see it pass**

Run: `npx vitest run src/pages/Pipeline.render.test.jsx src/lib/pipelineView.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/pipelineView.js src/lib/pipelineView.test.js src/pages/Pipeline.jsx src/pages/Pipeline.render.test.jsx
git commit -m "feat: Pipeline temperature filter and Pays first sort"
```

---

### Task 15: Temperature on Log call

**Files:**
- Modify: `src/components/QuickActions.jsx` (`useSubmit.send` returns the summary; `LogCallForm` state, markup and `submit`; imports)
- Test: `src/components/QuickActions.render.test.jsx`

- [ ] **Step 1: Prepare the test's fake Supabase**

Run `sed -n 20,70p src/components/QuickActions.render.test.jsx`. In the fake query object, add `upsert: async (row) => { upserts.push(row); return { error: null } }`. Declare `const upserts = []` at module level, and clear it in `beforeEach` with `upserts.length = 0`. Also call `__resetRatingsForTest()` in `beforeEach`.

To see how the existing Interested test picks a follow-up date, run `grep -n "Interested" src/components/QuickActions.render.test.jsx`. Copy that date step where the tests below say `pickDate()`.

- [ ] **Step 2: Write the failing render tests**

Inside `describe('QuickActions: Log call next step', ...)`:

```js
  it('offers Hot / Warm / Cold only after a conversation, and saves the rating with the call', async () => {
    ok()
    invoke.mockResolvedValueOnce({ data: { status: 'ok', results: [{ step: 'set_temperature', ok: true }] }, error: null })
    await mount(bay)
    await click(byLabel('Log call'))
    await click(byText('No Answer'))
    expect(document.querySelector('[aria-label="Temperature"]')).toBe(null)
    await click(byText('Interested'))
    await click(byText('Hot'))
    const amount = document.querySelector('[aria-label="Estimated loan amount"]')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(amount, '350,000')
      amount.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await pickDate()
    await click(save())
    expect(invoke.mock.calls[0][1].body.action).toBe('log_call')
    expect(upserts[0]).toMatchObject({ contact_id: 'c1', business_id: 'bay', temperature: 'hot', est_amount: 350000 })
    expect(invoke.mock.calls[1][1].body).toMatchObject({ action: 'set_temperature', payload: { temperature: 'hot' } })
  })

  it('a call with no temperature picked saves no rating', async () => {
    ok()
    await mount(bay)
    await click(byLabel('Log call'))
    await click(byText('Interested'))
    await pickDate()
    await click(save())
    expect(upserts).toEqual([])
  })
```

Define `pickDate` at the top of this describe as the steps the existing Interested test uses. If Interested already defaults to a valid follow-up date (preset "tomorrow"), it is `const pickDate = async () => {}`.

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run src/components/QuickActions.render.test.jsx`
Expected: FAIL, because there is no Temperature group.

- [ ] **Step 4: Implement**

Imports: add `isConversation` to the existing `../lib/crmActions` import list, then:

```js
import { TEMPERATURES, TEMP_LABEL } from '../lib/leadRatings'
import { saveRating } from '../lib/useLeadRatings'
```

`showToast` is already imported from `./Toaster`.

In `useSubmit.send`, change `if (busyRef.current) return` to `if (busyRef.current) return null`. Add `return summary` as the last line of `send`, after the `if/else`.

In `LogCallForm`, under `const [reason, setReason] = useState(null)`:

```js
  // Optional after a conversation (spec 2026-11-03): saved with the call.
  const [temperature, setTemperature] = useState(null)
  const [estAmount, setEstAmount] = useState('')
```

Replace `submit`:

```js
  const submit = async () => {
    let request
    try {
      const dueDate = nextStep === 'follow_up' ? followUpDate(preset, new Date(), picked) : null
      calendar.prepare({ businessId, contactId, dayKey: dueDate, time: nextStep === 'follow_up' ? time : '', title })
      request = buildActionRequest({
        action: 'log_call',
        contactId,
        outcome,
        note,
        durationMin: Number(duration),
        nextStep,
        followUp: nextStep === 'follow_up' ? { dueDate, title } : null,
        noNextStepReason: nextStep === 'none' ? reason : null,
        completeTaskId: openTask && completeOpen ? openTask.id : null,
        setStage: advance,
      })
    } catch (e) {
      setResult({ tone: 'error', text: e.message, failed: [] })
      return
    }
    const summary = await send(request)
    const temp = isConversation(outcome) ? temperature : null
    if (!temp || !summary || summary.tone === 'error') return
    const amount = businessId === 'bay' && (temp === 'hot' || temp === 'warm') && estAmount ? Number(estAmount) : null
    const saved = await saveRating({ contactId, businessId, temperature: temp, estAmount: amount })
    if (!saved.ok) showToast({ tone: 'error', text: `Temperature not saved: ${saved.error}` })
    else if (saved.tagError) showToast({ tone: 'error', text: `Temperature saved; FUB tag not updated: ${saved.tagError}` })
  }
```

Insert this markup right after the Outcome chips' closing `</div>` (the `OUTCOMES.map` block), before the duration field. Find the spot with `grep -n "OUTCOMES.map" src/components/QuickActions.jsx`.

```jsx
      {isConversation(outcome) && (
        <>
          <div className="mb-1.5 mt-3 text-[12px] font-semibold text-muted">Temperature (optional)</div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Temperature">
            {TEMPERATURES.map((k) => (
              <Chip key={k} t={t} active={temperature === k} onClick={() => setTemperature(temperature === k ? null : k)}>
                {TEMP_LABEL[k]}
              </Chip>
            ))}
          </div>
          {businessId === 'bay' && (temperature === 'hot' || temperature === 'warm') && (
            <input
              aria-label="Estimated loan amount"
              inputMode="numeric"
              placeholder="Est. loan amount (optional)"
              value={estAmount}
              onChange={(e) => setEstAmount(e.target.value.replace(/[^\d]/g, ''))}
              className={`${inputCls} mt-2`}
            />
          )}
        </>
      )}
```

- [ ] **Step 5: Run it to see it pass**

Run: `npx vitest run src/components/QuickActions.render.test.jsx src/components/Dialer.render.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/QuickActions.jsx src/components/QuickActions.render.test.jsx
git commit -m "feat: Hot / Warm / Cold on Log call after a conversation"
```

---

### Task 16: Temperature on the Person sheet

**Files:**
- Create: `src/components/TemperaturePicker.jsx`
- Modify: `src/components/PersonSheet.jsx` (imports; the `h` computation; the block under `HealthPills`)
- Test: `src/components/SearchPalette.render.test.jsx`, which already opens a Person sheet

- [ ] **Step 1: Implement `TemperaturePicker.jsx`**

```jsx
// Rate or re-rate a lead from the Person sheet. Tapping a temperature saves at
// once; the amount (Bayway Hot/Warm) and close month save with Save.
// saveRating also sets the FUB tag for Bayway.
import { useState } from 'react'
import { TEMPERATURES, TEMP_LABEL, closeMonthOf } from '../lib/leadRatings'
import { saveRating } from '../lib/useLeadRatings'
import { showToast } from './Toaster'

const monthOptions = (now = Date.now()) =>
  Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now)
    d.setDate(1)
    d.setMonth(d.getMonth() + i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
    return { key, label: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) }
  })

export default function TemperaturePicker({ contactId, businessId, rating, onSaved }) {
  const [amount, setAmount] = useState(rating?.est_amount ? String(rating.est_amount) : '')
  const [month, setMonth] = useState(rating ? closeMonthOf(rating) : '')
  const [busy, setBusy] = useState(false)

  const save = async (temperature, closeMonth) => {
    setBusy(true)
    const res = await saveRating({
      contactId,
      businessId,
      temperature,
      estAmount: businessId === 'bay' && amount ? Number(amount) : null,
      closeMonth,
    })
    setBusy(false)
    if (!res.ok) showToast({ tone: 'error', text: `Temperature not saved: ${res.error}` })
    else if (res.tagError) showToast({ tone: 'error', text: `Temperature saved; FUB tag not updated: ${res.tagError}` })
    else onSaved?.(temperature)
  }

  return (
    <div className="flex flex-col gap-2" data-temperature-picker>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Temperature">
        {TEMPERATURES.map((k) => (
          <button
            key={k}
            type="button"
            disabled={busy}
            aria-pressed={rating?.temperature === k}
            // Same temperature keeps the chosen month; a new one takes its default.
            onClick={() => save(k, rating?.temperature === k ? month || null : null)}
            className={`min-h-[36px] rounded-[10px] border px-3 text-[12.5px] font-semibold ${
              rating?.temperature === k ? 'border-[color:var(--text)] text-[color:var(--text)]' : 'border-line2 text-muted'
            }`}
          >
            {TEMP_LABEL[k]}
          </button>
        ))}
      </div>
      {rating && (
        <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
          {businessId === 'bay' && rating.temperature !== 'cold' && (
            <input
              aria-label="Estimated loan amount"
              inputMode="numeric"
              placeholder="Est. loan amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))}
              className="w-36 rounded-[10px] border border-line2 bg-panel px-2 py-1.5"
            />
          )}
          <select aria-label="Expected close month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-[10px] border border-line2 bg-panel px-2 py-1.5">
            {monthOptions().map((o) => (
              <option key={o.key} value={o.key}>
                Closes {o.label}
              </option>
            ))}
          </select>
          <button type="button" disabled={busy} onClick={() => save(rating.temperature, month || null)} className="rounded-[10px] border border-line2 px-3 py-1.5 font-semibold">
            Save
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Wire `PersonSheet.jsx`**

Add imports:

```js
import TemperaturePicker from './TemperaturePicker'
import { useLeadRatings } from '../lib/useLeadRatings'
```

Before `const h = ...`:

```js
  const ratings = useLeadRatings()
  const rating = person ? ratings.get(person.id) || null : null
```

Change `h` so the sheet's pills include temperature:

```js
  const h = board && rules ? cardHealth({ ...board, temperature: rating?.temperature, rating }, rules) : null
```

Add right after the `HealthPills` block's closing `)}`:

```jsx
          <TemperaturePicker key={rating?.temperature || 'none'} contactId={person.id} businessId={biz} rating={rating} />
```

- [ ] **Step 3: Extend the Search palette render test**

In `src/components/SearchPalette.render.test.jsx`, inside "picks with the arrow keys and Enter…" and after the sheet assertions, add:

```js
    expect(sheet.querySelector('[aria-label="Temperature"]')).not.toBe(null)
```

- [ ] **Step 4: Run it**

Run: `npx vitest run src/components/SearchPalette.render.test.jsx`

Expected: PASS. If that file's fake Supabase throws for `lead_ratings`, return `{ data: [], error: null }` for it the way the file handles other tables.

- [ ] **Step 5: Commit**

```bash
git add src/components/TemperaturePicker.jsx src/components/PersonSheet.jsx src/components/SearchPalette.render.test.jsx
git commit -m "feat: rate a lead from the Person sheet"
```

---

### Task 17: Rate leads screen at `/rate`

**Files:**
- Create: `src/pages/RateLeads.jsx`
- Modify: `src/App.jsx` (import; route)
- Test: `src/pages/RateLeads.render.test.jsx`

- [ ] **Step 1: Write the failing render test**

```jsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import React from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const saved = []
vi.mock('../lib/usePriorityQueue', () => ({
  usePriorityQueue: () => ({
    signals: [
      { id: 'a', business_id: 'bay', name: 'Ann Active', stage: 'Contacted/Working', is_active: true, is_hot: true, last_outbound_call_at: '2026-10-30T10:00:00Z' },
      { id: 'b', business_id: 'mpg', name: 'Bo Called', stage: 'Open', is_active: true, is_hot: false, last_outbound_call_at: '2026-10-29T10:00:00Z' },
      { id: 'c', business_id: 'bay', name: 'Cy Never', stage: 'New Lead', is_active: true, last_outbound_call_at: null },
    ],
    loading: false,
    error: null,
  }),
}))
vi.mock('../lib/useLeadRatings', () => ({
  useLeadRatings: () => new Map(),
  saveRating: async (r) => {
    saved.push(r)
    return { ok: true }
  },
}))

const { default: RateLeads } = await import('./RateLeads')

let root
let el
beforeEach(() => {
  saved.length = 0
  el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
})

const key = (k) => act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: k })))

describe('Rate leads', () => {
  it('walks called, unrated leads by keyboard, suggesting Hot from the hot flag', async () => {
    await act(async () => root.render(<MemoryRouter><RateLeads /></MemoryRouter>))
    expect(el.textContent).toContain('1 of 2')
    expect(el.textContent).toContain('Ann Active')
    expect(el.textContent).toContain('Suggested: Hot')
    await key('Enter')
    expect(saved[0]).toMatchObject({ contactId: 'a', businessId: 'bay', temperature: 'hot' })
    expect(el.textContent).toContain('Bo Called')
    await key('c')
    expect(saved[1]).toMatchObject({ contactId: 'b', temperature: 'cold' })
    expect(el.textContent).toContain('All rated')
    expect(el.textContent).not.toContain('Cy Never')
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/pages/RateLeads.render.test.jsx`
Expected: FAIL, the module isn't found.

- [ ] **Step 3: Implement `RateLeads.jsx`**

```jsx
// One-time rating pass (spec 2026-11-03, section 1): active leads with at
// least one outbound call and no temperature yet. H / W / C rate and move on,
// S skips, Enter takes the suggestion (Hot when the lead already reads as hot).
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import { usePriorityQueue } from '../lib/usePriorityQueue'
import { useLeadRatings, saveRating } from '../lib/useLeadRatings'
import { TEMPERATURES, TEMP_LABEL } from '../lib/leadRatings'

const KEYS = { h: 'hot', w: 'warm', c: 'cold' }

export default function RateLeads() {
  const { signals, loading, error } = usePriorityQueue('all')
  const ratings = useLeadRatings()
  // Fixed when it first loads, so rating a lead doesn't reshuffle the list.
  const [list, setList] = useState(null)
  const [i, setI] = useState(0)
  const [busy, setBusy] = useState(false)

  const candidates = useMemo(
    () =>
      (signals || [])
        .filter((r) => r.is_active && r.last_outbound_call_at && !ratings.has(r.id))
        .sort((a, b) =>
          a.business_id === b.business_id ? String(a.name || '').localeCompare(String(b.name || '')) : a.business_id === 'bay' ? -1 : 1,
        ),
    [signals, ratings],
  )
  useEffect(() => {
    if (list === null && !loading) setList(candidates)
  }, [list, loading, candidates])

  const lead = list?.[i]
  const suggested = lead?.is_hot ? 'hot' : null

  const rate = async (temperature) => {
    if (!lead || busy) return
    setBusy(true)
    await saveRating({ contactId: lead.id, businessId: lead.business_id, temperature })
    setBusy(false)
    setI((n) => n + 1)
  }

  useEffect(() => {
    const onKey = (e) => {
      const k = e.key.toLowerCase()
      if (KEYS[k]) rate(KEYS[k])
      else if (k === 's') setI((n) => n + 1)
      else if (k === 'enter' && suggested) rate(suggested)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div>
      <PageHeader title="Rate leads" subtitle="One pass over leads you've called: H Hot, W Warm, C Cold, S skip, Enter for the suggestion." />
      {error && <div className="mt-4 text-sm text-red-700">{error}</div>}
      {(loading || list === null) && <div className="mt-6 text-sm text-muted">Loading…</div>}
      {list && !lead && (
        <div className="mt-6 rounded-card border border-line bg-panel px-6 py-10 text-center text-sm text-muted">
          All rated. <Link to="/" className="font-semibold">Back to Overview</Link>
        </div>
      )}
      {lead && (
        <div className="mt-6 max-w-md rounded-card border border-line bg-panel p-5">
          <div className="num text-[12px] text-muted">
            {i + 1} of {list.length}
          </div>
          <div className="mt-1 text-[18px] font-bold">{lead.name || '(no name)'}</div>
          <div className="text-[13px] text-muted">
            {lead.business_id === 'bay' ? 'Bayway' : 'MPG'} · {lead.stage || '—'}
          </div>
          {suggested && <div className="mt-2 text-[12.5px] font-semibold">Suggested: {TEMP_LABEL[suggested]}</div>}
          <div className="mt-4 flex gap-2">
            {TEMPERATURES.map((k) => (
              <button key={k} type="button" disabled={busy} onClick={() => rate(k)} className="min-h-[44px] flex-1 rounded-[10px] border border-line2 font-semibold">
                {TEMP_LABEL[k]}
              </button>
            ))}
            <button type="button" onClick={() => setI((n) => n + 1)} className="min-h-[44px] rounded-[10px] px-3 text-muted">
              Skip
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Add the route in `App.jsx`**

Add `import RateLeads from './pages/RateLeads'` with the other page imports. Next to the `/tasks` route, add:

```jsx
              <Route path="/rate" element={<RateLeads />} />
```

- [ ] **Step 5: Run it to see it pass**

Run: `npx vitest run src/pages/RateLeads.render.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pages/RateLeads.jsx src/pages/RateLeads.render.test.jsx src/App.jsx
git commit -m "feat: Rate leads screen for the launch backfill"
```

---

### Task 18: Settings page with forecast odds

**Files:**
- Create: `src/pages/Settings.jsx`
- Modify: `src/App.jsx` (replace the `/settings` `PagePlaceholder` element)
- Test: `src/pages/Settings.render.test.jsx`

- [ ] **Step 1: Write the failing render test**

```jsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import React from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const upserts = []
vi.mock('../lib/supabase', () => {
  const q = {
    select: () => q,
    eq: () => q,
    maybeSingle: async () => ({ data: { value: { temp_odds: { hot: 70 } } }, error: null }),
    upsert: async (row) => {
      upserts.push(row)
      return { error: null }
    },
  }
  return { isDemoMode: false, supabase: { from: () => q } }
})
vi.mock('../lib/useForecastInputs', () => ({ refreshForecastInputs: async () => {} }))

const { default: Settings } = await import('./Settings')

describe('Settings: forecast odds', () => {
  it('loads saved odds over the defaults and saves changes', async () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    await act(async () => createRoot(el).render(<MemoryRouter><Settings /></MemoryRouter>))
    await act(async () => {})
    const hot = el.querySelector('input[aria-label="Hot odds"]')
    const warm = el.querySelector('input[aria-label="Warm odds"]')
    expect(hot.value).toBe('70')
    expect(warm.value).toBe('30')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(warm, '35')
      warm.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => [...el.querySelectorAll('button')].find((b) => b.textContent === 'Save odds').click())
    expect(upserts[0]).toMatchObject({ key: 'forecast', value: { temp_odds: { hot: 70, warm: 35, cold: 10 } } })
    expect(el.querySelector('a[href="/rate"]')).not.toBe(null)
  })
})
```

If `PageHeader` renders `SyncDot`, which calls `useSyncHealth` against `supabase.from(...).order(...)`, add `order: () => q` and `limit: () => q` to the fake `q`.

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/pages/Settings.render.test.jsx`
Expected: FAIL, the module isn't found.

- [ ] **Step 3: Implement `Settings.jsx`**

```jsx
// Settings: forecast odds (spec 2026-11-03, section 2) and the Rate leads link.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import { supabase, isDemoMode } from '../lib/supabase'
import { resolveForecast } from '../lib/forecast'
import { refreshForecastInputs } from '../lib/useForecastInputs'

const FIELDS = [
  ['temp_odds', 'hot', 'Hot odds', '%'],
  ['temp_odds', 'warm', 'Warm odds', '%'],
  ['temp_odds', 'cold', 'Cold odds', '%'],
  ['arive_odds', 'prospect', 'Arive prospect odds', '%'],
  ['arive_odds', 'processing', 'Arive processing odds', '%'],
  ['arive_odds', 'closing', 'Arive closing odds', '%'],
  ['close_offset_months', 'hot', 'Hot closes in (months)', ''],
  ['close_offset_months', 'warm', 'Warm closes in (months)', ''],
  ['close_offset_months', 'cold', 'Cold closes in (months)', ''],
]

export default function Settings() {
  const [form, setForm] = useState(() => resolveForecast(null))
  const [status, setStatus] = useState(null)

  useEffect(() => {
    if (isDemoMode) return
    Promise.resolve(supabase.from('settings').select('value').eq('key', 'forecast').maybeSingle()).then(({ data }) =>
      setForm(resolveForecast(data?.value)),
    )
  }, [])

  const set = (group, k, v) => setForm((f) => ({ ...f, [group]: { ...f[group], [k]: v } }))

  const save = async () => {
    // resolveForecast turns the text inputs back into numbers and fills blanks.
    const value = resolveForecast(form)
    const { error } = await supabase.from('settings').upsert({ key: 'forecast', value }, { onConflict: 'key' })
    setStatus(error ? `Not saved: ${error.message}` : 'Saved')
    if (!error) {
      setForm(value)
      refreshForecastInputs()
    }
  }

  return (
    <div>
      <PageHeader title="Settings" subtitle="Forecast odds and lead temperature." />
      <section className="mt-6 max-w-xl rounded-card border border-line bg-panel p-5">
        <h3 className="text-[15px] font-semibold">Forecast</h3>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {FIELDS.map(([group, k, label, unit]) => (
            <label key={`${group}.${k}`} className="flex flex-col gap-1 text-[12.5px] text-muted">
              {label}
              <span className="flex items-center gap-1">
                <input
                  aria-label={label}
                  inputMode="numeric"
                  value={String(form[group][k] ?? '')}
                  onChange={(e) => set(group, k, e.target.value.replace(/[^\d]/g, ''))}
                  className="w-20 rounded-[10px] border border-line2 bg-panel px-2 py-1.5 text-[13px] text-[color:var(--text)]"
                />
                {unit}
              </span>
            </label>
          ))}
          <label className="flex flex-col gap-1 text-[12.5px] text-muted sm:col-span-3">
            MPG est. residual per account (until residuals arrive)
            <input
              aria-label="MPG est. residual per account"
              inputMode="numeric"
              value={form.mpg_est_residual_per_account == null ? '' : String(form.mpg_est_residual_per_account)}
              onChange={(e) => setForm((f) => ({ ...f, mpg_est_residual_per_account: e.target.value.replace(/[^\d]/g, '') || null }))}
              className="w-28 rounded-[10px] border border-line2 bg-panel px-2 py-1.5 text-[13px] text-[color:var(--text)]"
            />
          </label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button type="button" onClick={save} className="btn-primary rounded-[10px] px-4 py-2 text-[13px] font-semibold">
            Save odds
          </button>
          {status && <span className="text-[12.5px] text-muted">{status}</span>}
        </div>
      </section>
      <section className="mt-4 max-w-xl rounded-card border border-line bg-panel p-5 text-[13px]">
        <h3 className="text-[15px] font-semibold">Lead temperature</h3>
        <p className="mt-1 text-muted">Rate the leads you've already called, one at a time.</p>
        <Link to="/rate" className="mt-2 inline-block font-semibold">
          Open Rate leads
        </Link>
      </section>
    </div>
  )
}
```

- [ ] **Step 4: Replace the placeholder in `App.jsx`**

Add `import Settings from './pages/Settings'`. Then change the `/settings` route to:

```jsx
                <Route path="/settings" element={<Settings />} />
```

Run `grep -n "PagePlaceholder" src/App.jsx`. If nothing else uses `PagePlaceholder`, remove its import.

- [ ] **Step 5: Run it to see it pass**

Run: `npx vitest run src/pages/Settings.render.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Settings.jsx src/pages/Settings.render.test.jsx src/App.jsx
git commit -m "feat: Settings page with forecast odds"
```

---

### Task 19: Full check, PR, and production rollout (needs Chandler's OK)

- [ ] **Step 1: Run the whole suite and the build**

```bash
npx vitest run
```

Expected: every file passes, the 87 existing files plus about 7 new ones.

```bash
npx vite build
```

Expected: "built in …" and no errors.

- [ ] **Step 2: Push and open the PR, only when Chandler asks**

```bash
git push -u origin feat/lead-temperature
```

Open the PR against `main`. Its body lists the production steps below as unchecked boxes.

- [ ] **Step 3: Production rollout. Ask Chandler first; each of these changes production**

1. Apply the migration from the **main checkout**, which holds the `supabase/.temp` link. Run this before merging the UI:

   ```bash
   supabase db push
   ```

   Expected: `0054_lead_ratings.sql` is applied.

2. Deploy the two changed functions. Each keeps the JWT setting it already has. `crm-action` verifies the JWT, because it checks the signed-in user. `score-fub-leads` runs from pg_cron with `--no-verify-jwt`. Confirm with `grep -rn "verify_jwt\|no-verify-jwt" supabase/config.toml docs/ | head`.

   ```bash
   supabase functions deploy crm-action
   ```

   ```bash
   supabase functions deploy score-fub-leads --no-verify-jwt
   ```

3. Check it live on the ZZ Test record in FUB:
   1. Rate it Hot from the Person sheet, and confirm FUB shows the `Hot` tag.
   2. Rate it Warm, and confirm `Hot` is gone and `Warm` is there.
4. Merge the PR so Vercel deploys the UI. The UI reads `lead_ratings`, so the migration in step 1 must already be applied.
5. Open `/rate` and do the launch rating pass.

- [ ] **Step 4: What this plan doesn't do**

- The briefings (spec section 3) and the assistant login are separate plans.
- `lead_ratings` RLS lets any signed-in user read and write until the assistant work tightens it.
