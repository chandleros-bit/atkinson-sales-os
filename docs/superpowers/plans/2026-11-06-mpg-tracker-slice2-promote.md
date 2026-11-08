# MPG tracker, slice 2 (promote to Zoho) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send interested walk-ins to Zoho as Open leads. A walk-in is interested when it's Hot or Warm or has any outcome, and statement or later forces it. Each promotion checks Zoho for the same business first, so it never makes a duplicate. A failed promotion is easy to retry from the Daily tracker.

**Architecture:** A new `crm-action` action, `promote_prospect` (MPG, owner only).

- **Duplicate check:** read-only Zoho COQL by phone, then company, before anything is claimed. More than one match returns `{ status: 'choose', candidates }` and writes nothing.
- **The write:** otherwise it claims a `crm_actions` row and runs these steps:
  - `create_lead` (status Open, Lead Source "Chandler", REP "Chandler"), or `link_lead`, which sets an "Initial lead" to Open,
  - then `add_note`,
  - then `create_task` when there's a follow-up date.
- **Mirror and bookkeeping:**
  - The lead is mirrored into `contacts` through the zoho-sync mapper.
  - The function marks the prospect promoted, points the touch at the contact and the `crm_actions` row, and writes the visit's temperature to `lead_ratings`.

The browser side:
- `LogVisitDialog` gets the "Add to Zoho as Open" toggle.
- A shared `ZohoPromote` component runs the promotion and shows Zoho candidates when the business matches more than one lead.
- `DailyTracker` shows "In Zoho", or "Not in Zoho yet · Retry".

**Spec:** `docs/superpowers/specs/2026-11-05-mpg-tracker-touch-log-design.md`, sections Promotion to Zoho, Capture → Log visit, Decisions.

**Decided 2026-11-06 (in addition to the spec):**
- `Lead_Source = 'Chandler'` (both "Chandler" and "Chandler Atkinson" exist; Chandler picked "Chandler").
- `MPG_REP = 'Chandler'` on every promoted lead.
- Duplicate search: Zoho COQL. Phone uses `like '%<last 4>'` on Phone/Mobile, then compares the last 10 digits in code. Company uses `Company = '<name>'`, which is case-insensitive in Zoho. Quotes are escaped by doubling (`''`). Checked live: `\'` is a syntax error.
- Live Lead_Status values: `Open` is a valid picklist value. `Initial lead` (626 leads) is the status the OS hides.
- Live flags: `writeback_enabled.mpg = true`, `create_lead_enabled.mpg = true`. Promotion needs both.

**Tech Stack:** React 18 + Vite + Tailwind, Supabase JS, Supabase Edge Functions (Deno, TypeScript; tested under Vitest with fakes), Vitest jsdom render tests in the repo's own style.

---

## Files

- **Create** `supabase/migrations/0061_mpg_zoho_wanted.sql`: `mpg_prospects.zoho_wanted`.
- **Create** `supabase/functions/_shared/zoho-leads.ts` + `zoho-leads.test.js`: pure COQL builder, lead matcher, lead body builders.
- **Modify** `supabase/functions/crm-action/crm.ts` (+ `crm.test.js`): Zoho adapter `findLeads`, `createLead`, `setLeadStatus`.
- **Modify** `supabase/functions/crm-action/plan.ts` (+ `plan.test.js`): the `promote_prospect` action and its steps.
- **Modify** `supabase/functions/crm-action/run.ts` (+ `run.test.js`): resolve, search, steps, mirror and bookkeeping.
- **Modify** `src/lib/mpgTracker.js` (+ test): `promotionDefault`.
- **Modify** `src/lib/crmActions.js` (+ test): `promote_prospect` request builder.
- **Modify** `src/lib/mpgTouches.js`: write `zoho_wanted`, and join the prospect into the day's touches.
- **Create** `src/components/ZohoPromote.jsx` + `ZohoPromote.render.test.jsx`.
- **Modify** `src/components/LogVisitDialog.jsx` (+ test): the toggle, then promotion after a save.
- **Modify** `src/components/DailyTracker.jsx` (+ test): "In Zoho" / "Not in Zoho yet · Retry".
- **Modify** the spec: slice 2 status and decisions.

Commands:
- one test file: `npx vitest run <path>`
- the suite: `npx vitest run`. One failure is already on main: `src/lib/briefingBundle.test.js > is up to date with src/lib`.
- build: `npx vite build`.

---

### Task 1: Migration 0061

**Files:** Create `supabase/migrations/0061_mpg_zoho_wanted.sql`

- [ ] **Step 1: Write it**

```sql
-- MPG touch log, slice 2 (spec 2026-11-05, Promotion to Zoho).
-- zoho_wanted: the visit that last touched this prospect asked for it to go to
-- Zoho, and it isn't there yet. The Daily tracker shows "Not in Zoho yet ·
-- Retry" for these. crm-action promote_prospect clears it on success.
alter table public.mpg_prospects
  add column if not exists zoho_wanted boolean not null default false;
```

- [ ] **Step 2: Commit** (`feat: mpg_prospects.zoho_wanted for pending Zoho promotions`). Do not push it to the database; that is Task 9.

---

### Task 2: Pure Zoho lead helpers (TDD)

**Files:** Create `supabase/functions/_shared/zoho-leads.ts`, Test `supabase/functions/_shared/zoho-leads.test.js`

These follow the style of `_shared/zoho-write.ts`: pure, no fetch.

- [ ] **Step 1: Failing tests**

```js
import { describe, it, expect } from 'vitest'
import { coqlString, findLeadsQuery, matchLeads, buildPromotedLead, splitName, INITIAL_LEAD } from './zoho-leads.ts'

describe('coqlString', () => {
  it('quotes and doubles single quotes', () => {
    expect(coqlString("Boeger's Stores")).toBe("'Boeger''s Stores'")
  })
})

describe('findLeadsQuery', () => {
  it('searches phone tails and the exact company', () => {
    expect(findLeadsQuery({ phoneKey: '8324747707', company: "NJR's Salons" })).toBe(
      "select id, Company, First_Name, Last_Name, Phone, Mobile, Lead_Status from Leads where ((Phone like '%7707' or Mobile like '%7707') or Company = 'NJR''s Salons') limit 50",
    )
  })
  it('company only when there is no phone', () => {
    expect(findLeadsQuery({ phoneKey: null, company: 'Feges BBQ' })).toBe(
      "select id, Company, First_Name, Last_Name, Phone, Mobile, Lead_Status from Leads where (Company = 'Feges BBQ') limit 50",
    )
  })
  it('null when there is nothing to search by', () => {
    expect(findLeadsQuery({ phoneKey: null, company: '  ' })).toBe(null)
  })
})

describe('matchLeads', () => {
  const recs = [
    { id: '1', Company: 'NJR Salons', Phone: '432-296-2997', Lead_Status: 'Pending' },
    { id: '2', Company: 'Other', Phone: '(832) 474-7707', Lead_Status: 'Initial lead' },
    { id: '3', Company: 'Third', Phone: '555-111-7707', Mobile: null, Lead_Status: 'Open' },
  ]
  it('keeps a full 10-digit phone match and a case/space-insensitive company match', () => {
    expect(matchLeads(recs, { phoneKey: '8324747707', company: ' njr salons ' }).map((r) => r.id)).toEqual(['1', '2'])
  })
  it('drops a lead that only shares the last 4 digits', () => {
    expect(matchLeads(recs, { phoneKey: '8324747707', company: 'Nope' }).map((r) => r.id)).toEqual(['2'])
  })
  it('maps candidates for the picker', () => {
    const [c] = matchLeads([{ id: '9', Company: 'A', First_Name: 'Jo', Last_Name: 'Lee', Phone: '8324747707', Lead_Status: 'Open' }], { phoneKey: '8324747707', company: 'x' })
    expect(c).toEqual({ id: '9', company: 'A', name: 'Jo Lee', phone: '8324747707', status: 'Open' })
  })
})

describe('splitName', () => {
  it('splits first and last', () => {
    expect(splitName('Jimmy Ray Smith')).toEqual({ firstName: 'Jimmy Ray', lastName: 'Smith' })
    expect(splitName('Jimmy')).toEqual({ firstName: '', lastName: 'Jimmy' })
    expect(splitName('  ')).toEqual({ firstName: '', lastName: '' })
  })
})

describe('buildPromotedLead', () => {
  it('builds an Open lead credited to Chandler', () => {
    expect(buildPromotedLead({
      business: 'Feges BBQ', contactName: 'Patrick Feges', role: 'Owner', phone: '713-555-0101', email: '', address: null,
    })).toEqual({ data: [{
      First_Name: 'Patrick', Last_Name: 'Feges', Company: 'Feges BBQ', Phone: '713-555-0101',
      Designation: 'Owner', Lead_Status: 'Open', Lead_Source: 'Chandler', MPG_REP: 'Chandler',
    }] })
  })
  it('uses the business as Last_Name when there is no contact name', () => {
    const lead = buildPromotedLead({ business: 'Casa Pickle' }).data[0]
    expect(lead.Last_Name).toBe('Casa Pickle')
    expect(lead).not.toHaveProperty('First_Name')
  })
  it('puts the address in Description', () => {
    expect(buildPromotedLead({ business: 'X', address: '1 Main St' }).data[0].Description).toBe('Address: 1 Main St')
  })
  it('needs a business', () => {
    expect(() => buildPromotedLead({ business: ' ' })).toThrow('A Zoho lead needs a company')
  })
})

it('INITIAL_LEAD is the status the OS hides', () => {
  expect(INITIAL_LEAD).toBe('initial lead')
})
```

- [ ] **Step 2: Run, and see it fail.** `npx vitest run supabase/functions/_shared/zoho-leads.test.js`

- [ ] **Step 3: Implement**

```ts
// Pure helpers for promoting an MPG prospect to a Zoho Lead (crm-action
// promote_prospect; spec 2026-11-05, Promotion to Zoho). No fetch.
// COQL escapes a single quote by doubling it; `\'` is a syntax error (checked
// live 2026-11-06). Company '=' is case-insensitive in Zoho.

export const INITIAL_LEAD = 'initial lead' // lower-cased Lead_Status the OS hides (0044)
const FIELDS = 'id, Company, First_Name, Last_Name, Phone, Mobile, Lead_Status'
const trimmed = (v) => (typeof v === 'string' ? v.trim() : '')

export const coqlString = (s) => `'${String(s).replace(/'/g, "''")}'`

const tenDigits = (raw) => {
  let d = String(raw ?? '').replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1)
  return d.length === 10 ? d : null
}
const norm = (s) => trimmed(String(s ?? '')).replace(/\s+/g, ' ').toLowerCase()

// COQL for leads that might be this business: same phone tail or same company.
export function findLeadsQuery({ phoneKey, company }) {
  const parts = []
  if (phoneKey) {
    const tail = coqlString(`%${phoneKey.slice(-4)}`)
    parts.push(`(Phone like ${tail} or Mobile like ${tail})`)
  }
  if (trimmed(company)) parts.push(`Company = ${coqlString(trimmed(company))}`)
  if (!parts.length) return null
  return `select ${FIELDS} from Leads where (${parts.join(' or ')}) limit 50`
}

// The real matches among the COQL rows: the full 10-digit phone, or the
// company ignoring case and spacing. -> picker-ready candidates.
export function matchLeads(records, { phoneKey, company }) {
  const want = norm(company)
  return (records || [])
    .filter((r) => (phoneKey && (tenDigits(r.Phone) === phoneKey || tenDigits(r.Mobile) === phoneKey)) || (want && norm(r.Company) === want))
    .map((r) => ({
      id: String(r.id),
      company: r.Company || '',
      name: [r.First_Name, r.Last_Name].filter(Boolean).join(' '),
      phone: r.Phone || r.Mobile || '',
      status: r.Lead_Status || '',
    }))
}

export function splitName(full) {
  const parts = trimmed(full).split(/\s+/).filter(Boolean)
  if (!parts.length) return { firstName: '', lastName: '' }
  if (parts.length === 1) return { firstName: '', lastName: parts[0] }
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts.at(-1) }
}

// POST /crm/v2/Leads body for a promoted prospect.
export function buildPromotedLead({ business, contactName, role, phone, email, address }) {
  const company = trimmed(business)
  if (!company) throw new Error('A Zoho lead needs a company')
  const { firstName, lastName } = splitName(contactName)
  const lead = {}
  if (firstName) lead.First_Name = firstName
  lead.Last_Name = lastName || company
  lead.Company = company
  if (trimmed(phone)) lead.Phone = trimmed(phone)
  if (trimmed(email)) lead.Email = trimmed(email)
  if (trimmed(role)) lead.Designation = trimmed(role)
  if (trimmed(address)) lead.Description = `Address: ${trimmed(address)}`
  lead.Lead_Status = 'Open'
  lead.Lead_Source = 'Chandler'
  lead.MPG_REP = 'Chandler'
  return { data: [lead] }
}
```

- [ ] **Step 4: Run, and see it pass.** Commit (`feat: pure Zoho lead search and promoted-lead builders`).

---

### Task 3: Zoho adapter methods

**Files:** Modify `supabase/functions/crm-action/crm.ts` (the `zohoAdapter`, around line 173) and `crm.test.js` (`describe('zohoAdapter')`, around line 127; follow its fetch-mocking style).

Add these to `send`:

```ts
// Read-only duplicate check before a promotion (COQL). 204 = no rows.
findLeads: async ({ phoneKey, company }) => {
  const q = findLeadsQuery({ phoneKey, company })
  if (!q) return []
  const json = await send('POST', 'coql', { select_query: q })
  return matchLeads(json?.data || [], { phoneKey, company })
},
createLead: async (p) => ({ id: zohoCreatedId(await send('POST', 'Leads', buildPromotedLead(p))) }),
// Only ever sets Open, on an "Initial lead" being linked.
setLeadOpen: async ({ externalId }) => {
  await send('PUT', `Leads/${externalId}`, { data: [{ Lead_Status: 'Open' }] })
  return { id: String(externalId) }
},
```

Import `findLeadsQuery`, `matchLeads` and `buildPromotedLead` from `../_shared/zoho-leads.ts`. **Check `zohoSend` (`_shared/zoho.ts:108`).** It must return parsed JSON for 200, and `null` or `{}` for a 204 with no body. If it throws on an empty body, handle 204 there (smallest change) and test it. Make sure `read.lead(id)` exists. It's used by the existing `create_contact` mirror.

- [ ] **Tests (in `crm.test.js`, fetch mocked like the existing zohoAdapter tests):**
  - `findLeads` POSTs to `…/crm/v2/coql` with the expected `select_query`, and returns the matched candidates only.
  - A 204 response gives `[]`.
  - `createLead` POSTs the `buildPromotedLead` body and returns the new id.
  - `setLeadOpen` PUTs `{ data: [{ Lead_Status: 'Open' }] }` to `Leads/<id>`.
- [ ] Run `npx vitest run supabase/functions/crm-action/crm.test.js`, see it fail, implement, see it pass. Commit (`feat: Zoho adapter find, create and open leads for promotion`).

---

### Task 4: `promote_prospect` in crm-action (TDD)

**Files:** Modify `plan.ts`, `run.ts`, `plan.test.js`, `run.test.js` in `supabase/functions/crm-action/`

**Request shape** (from the browser, Task 5):

```js
{ client_action_id, action: 'promote_prospect', business_id: 'mpg', prospect_id, touch_id,
  payload: { note: 'Walk-in · Warm — …', follow_up: { due_date, title } | undefined,
             link_lead_id?: '4533…', create_new?: true } }
```

**plan.ts:**
- Add `'promote_prospect'` to `ACTIONS`. It is not added to `CONTACT_ACTIONS`, `TASK_ACTIONS` or `ASSISTANT_ACTIONS`.
- `planSteps` returns, in order:
  - `{ step: 'promote' }`,
  - `{ step: 'add_note', subject: 'Walk-in', body: p.note }` when `p.note` is set,
  - `{ step: 'create_task', title: p.follow_up.title || 'Follow up', type: 'Follow Up', dueDate: p.follow_up.due_date }` when `p.follow_up` is set.
- `shouldStop` also stops after a failed `promote`.

**run.ts:**
1. **Resolve.** In `resolve`, for `promote_prospect`:
   - Require `prospect_id` and `touch_id`.
   - Load `mpg_prospects` (`id, user_id, business_name, contact_name, contact_role, phone, phone_key, email, address, temperature, status, zoho_lead_id`) and `mpg_touches` (`id, user_id, prospect_id, temperature`). The function runs with the service role, so check ownership in code: `prospect.user_id === userId`, `touch.user_id === userId`, `touch.prospect_id === prospect.id`. Otherwise refuse `'Prospect not found'`.
   - Refuse `'Already in Zoho'` when `prospect.status === 'promoted'`.
   - The target is `{ businessId: 'mpg', contact: null, task: null, prospect, touch }`.
   - `resolve` is called with `userId`; thread it through.
2. **Search before the claim (read-only, no `crm_actions` row).** This runs after the existing owner checks and before `claim`. It is skipped when `payload.link_lead_id` or `payload.create_new` is given, or when `prospect.zoho_lead_id` is already set.
   - Call `adapters.mpg.send.findLeads({ phoneKey: prospect.phone_key, company: prospect.business_name })`.
   - **More than one candidate:** return `reply(200, { status: 'choose', candidates })` immediately.
   - **Exactly one:** set `target.linkLeadId` to it.
   - **None:** create.
   - **The search throws:** return `reply(200, { status: 'error', error })`.

   Keep the existing order: the write-back flag and owner checks come before the search, so a refused user never reaches Zoho. Move the search after the `settingOn` checks, or repeat them. The simplest way: run the search right after `preflight` and before `claim`, then claim.
3. **Flags.** `promote_prospect` needs both `writeback_enabled.mpg` and `create_lead_enabled.mpg`, the same as `create_contact`. The assistant is refused by the existing `ASSISTANT_ACTIONS` check.
4. **The `promote` step** (in `send`):
   - **Link:** `linkLeadId = payload.link_lead_id || prospect.zoho_lead_id || target.linkLeadId`. Read the lead with `adapter.read.lead(linkLeadId)`. If its `Lead_Status` lower-cased is `'initial lead'`, call `adapter.send.setLeadOpen`. Return `{ id: linkLeadId, linked: true }`.
   - **Create:** `adapter.send.createLead({ business: prospect.business_name, contactName: prospect.contact_name, role: prospect.contact_role, phone: prospect.phone, email: prospect.email, address: prospect.address })`, which returns `{ id }`.
5. **Mirror the `promote` step**, exactly like the `create_contact` branch of `mirror`:
   - `read.lead(out.id)`, then `map.contact`, then upsert `contacts`, then reload that row into `target.contact`.
   - Set `result.contact_id`, `result.lead_id = out.id` and `result.linked = !!out.linked`.
   - The `add_note` and `create_task` steps then attach to `target.contact` as they already do.
6. **Bookkeeping**, after the steps, only when `promote` succeeded. Each write is checked. A failure is put into `result.mirror_error` on the `promote` result and does not change the overall status.
   - `mpg_prospects`: `update { zoho_lead_id: lead_id, status: 'promoted', promoted_at: now, zoho_wanted: false }` where `id = prospect.id and user_id = userId`.
   - `mpg_touches`: `update { contact_id: target.contact?.id ?? null, crm_action_id: <id of this crm_actions row> }` where `id = touch.id and user_id = userId`. Read the row id with `select id from crm_actions where client_action_id = …`.
   - When `touch.temperature || prospect.temperature` and `target.contact`: `lead_ratings` upsert `{ contact_id, business_id: 'mpg', temperature, rated_at: now, rated_by: userId }`, with `onConflict: 'contact_id'`.
   - In `finish`, set `patch.contact_id = target.contact.id`, as `create_contact` does.

**Tests (run.test.js; extend the seed with `mpg_prospects`, `mpg_touches` and `lead_ratings`, plus `create_lead_enabled: { mpg: true }` in settings; give the fake zoho adapter `findLeads`, `createLead`, `setLeadOpen` and `read.lead`, with `map.contact` from `../_shared/zoho.ts`'s `mapContact(rec, 'Leads')`):**
- **No match:** creates a lead with `Lead_Status` Open via `createLead`; mirrors the contact; the note goes on the new lead; the task is created when there's a follow-up; the prospect is marked promoted with `zoho_lead_id` and `zoho_wanted: false`; the touch gets `contact_id` and `crm_action_id`; `lead_ratings` gets the temperature with `rated_by: USER`; the status is `ok`.
- **One match with status "Initial lead":** `setLeadOpen` is called, no create, `results[0].linked === true`.
- **One match with status "Pending":** no `setLeadOpen`, linked.
- **Two matches:** `{ status: 'choose', candidates }`, no `crm_actions` row, no Zoho writes.
- **`link_lead_id` given:** no search, links that lead. **`create_new`:** no search, creates.
- **Refusals:**
  - another user's prospect → `'Prospect not found'`, with no Zoho call;
  - already promoted → `'Already in Zoho'`;
  - `create_lead_enabled.mpg` false → refused and recorded;
  - the assistant role → refused.
- **`createLead` throws:** status `error`, no note or task sent, prospect not marked promoted.
- **The note fails after a create:** status `partial`, and the prospect is still marked promoted.
- **plan.test.js:** step lists with and without a note and a follow-up; `shouldStop('promote', false)` is true.

- [ ] Write the tests, see them fail, implement, see them pass. Run `npx vitest run supabase/functions/crm-action`. Commit (`feat: crm-action promote_prospect creates or links a Zoho Open lead`).

---

### Task 5: Browser helpers (TDD)

**Files:** `src/lib/mpgTracker.js` + test, `src/lib/crmActions.js` + test, `src/lib/mpgTouches.js`

**`promotionDefault`** (mpgTracker.js). Tests:

```js
describe('promotionDefault', () => {
  const o = (x = {}) => ({ dm_conversation: false, statement: false, demo_proposal: false, application: false, boarded: false, ...x })
  it('off for Cold or unrated with no outcomes', () => {
    expect(promotionDefault({ temperature: 'cold', outcomes: o() })).toEqual({ on: false, forced: false })
    expect(promotionDefault({ temperature: null, outcomes: o() })).toEqual({ on: false, forced: false })
  })
  it('on for Hot or Warm', () => {
    expect(promotionDefault({ temperature: 'warm', outcomes: o() })).toEqual({ on: true, forced: false })
  })
  it('on for a decision-maker conversation even when Cold', () => {
    expect(promotionDefault({ temperature: 'cold', outcomes: o({ dm_conversation: true }) })).toEqual({ on: true, forced: false })
  })
  it('forced from statement on', () => {
    for (const k of ['statement', 'demo_proposal', 'application', 'boarded']) {
      expect(promotionDefault({ temperature: null, outcomes: o({ [k]: true }) })).toEqual({ on: true, forced: true })
    }
  })
})
```

```js
// Spec Decisions → Visit promotion: Hot/Warm or any outcome turns "Add to Zoho"
// on by default; statement received or later forces it.
const FORCING = ['statement', 'demo_proposal', 'application', 'boarded']
export function promotionDefault({ temperature, outcomes = {} }) {
  const forced = FORCING.some((k) => !!outcomes[k])
  const on = forced || temperature === 'hot' || temperature === 'warm' || OUTCOMES.some((o) => !!outcomes[o.key])
  return { on, forced }
}
```

**`buildActionRequest` for `promote_prospect`** (crmActions.js). Add it to the `ACTIONS` set. The form is `{ action: 'promote_prospect', prospectId, touchId, note, followUp: { dueDate, title } | null, linkLeadId, createNew }`, and it gives:

```js
{ client_action_id, action: 'promote_prospect', business_id: 'mpg', prospect_id, touch_id,
  payload: { note?, follow_up?: { due_date, title }, link_lead_id?, create_new?: true } }
```

It throws `'Missing prospect'` or `'Missing visit'` when an id is absent. Follow the file's existing builder style, and give it a fresh `client_action_id` on every call. Add tests mirroring the file's existing `create_contact` tests.

**mpgTouches.js:**
- `saveVisit({ prospect, touch, zohoWanted = false })`:
  - When it inserts a new prospect, include `zoho_wanted: zohoWanted`.
  - When the touch points at an existing prospect and `zohoWanted` is true, also `update({ zoho_wanted: true })` that prospect. Ignore an error here, since the visit is saved anyway.
- `fetchTouchesForDay` selects `'*, mpg_prospects(status, zoho_wanted)'`. PostgREST embeds the FK row as `row.mpg_prospects`.
- Add `setZohoWanted(prospectId, wanted)`.

- [ ] Tests first, see them fail, implement, see them pass, commit (`feat: promotion default, promote_prospect request, zoho_wanted writes`).

---

### Task 6: `ZohoPromote` component (TDD)

**Files:** Create `src/components/ZohoPromote.jsx` + `ZohoPromote.render.test.jsx`

**What it does:** given `{ prospectId, touch, onDone }`, it runs the promotion on mount and renders its own progress. Used inside LogVisitDialog (Task 7) and in a small modal from DailyTracker (Task 8).

- **On mount:** `invokeCrmAction(buildActionRequest({ action: 'promote_prospect', prospectId, touchId: touch.id, note: zohoVisitNote(touch), followUp: touch.follow_up_on ? { dueDate: touch.follow_up_on, title: touch.next_step || 'Follow up' } : null }))`. Show "Adding to Zoho…".
- **`status: 'ok'`:**
  - call `notifyTouchesChanged()`,
  - show the toast "Added to Zoho as Open" or "Linked to <company> in Zoho" (the first result's `linked`; the company is the business name),
  - `onDone({ ok: true, contactId })`.
- **`status: 'partial'`:** toast tone partial, "In Zoho; the note or task didn't save: <first failing error>", then `notifyTouchesChanged()` and `onDone({ ok: true })`.
- **`status: 'choose'`:**
  - render "This business may already be in Zoho" and one button per candidate: `<company> · <name> · <phone> · <status>`. A button resends with `linkLeadId: c.id`.
  - add a **Create a new lead** button that resends with `createNew: true`,
  - and a **Not now** button that calls `onDone({ ok: false })`.
- **`status: 'refused'` / `'error'`:** error toast "Not in Zoho yet: <error>", with `retry` re-running the same promotion. Then `onDone({ ok: false })`.

**Tests** (mock `../lib/supabase` with `functions.invoke`, as LogVisitDialog.render.test.jsx does):
- ok: `invoke` is called once with `action: 'promote_prospect'`, the right ids and note; `onDone({ ok: true, … })`.
- choose: two candidates render, and clicking one sends a second request with `payload.link_lead_id`.
- choose, then "Create a new lead": sends `payload.create_new: true`.
- error: the error toast with a Retry button; clicking Retry invokes again.

- [ ] Tests first, see them fail, implement, see them pass, commit (`feat: ZohoPromote runs a promotion and lets you pick a Zoho match`).

---

### Task 7: Log visit toggle (TDD)

**Files:** Modify `src/components/LogVisitDialog.jsx` + its render test

- **Visibility:** shown only when all of these hold:
  - the business type is `new` or `prospect`,
  - it isn't edit mode,
  - `useWritebackFlags().mpg === true`,
  - `useSettingFlags('create_lead_enabled').mpg === true` (both from `src/lib/writeback.js`).
- **The control:** a checkbox labelled **Add to Zoho as Open**.
  - It follows `promotionDefault({ temperature, outcomes })` live until the user toggles it, then keeps the user's choice (state `zohoChoice: null | boolean`).
  - When forced, it is checked and disabled, with the hint "Statement or later always goes to Zoho".
- **On Save with the toggle on:**
  - call `saveVisit({ ...built, zohoWanted: true })`,
  - then, instead of closing, swap the form for `<ZohoPromote prospectId={saved.prospect_id} touch={saved} onDone={() => onClose()} />`,
  - and still toast "Visit logged" as now.
- **On Save with the toggle off:** unchanged.

**Tests:**
- A new business rated Warm: the toggle is shown checked, Save calls `promote_prospect` after the touch insert, and the prospect row has `zoho_wanted: true`.
- Warm, then untick, then Save: no `promote_prospect`.
- Statement checked: the toggle is checked and disabled.
- A Zoho contact preset: no toggle.
- `create_lead_enabled.mpg` false: no toggle.

- [ ] Tests first, see them fail, implement, see them pass, commit (`feat: Log visit sends interested walk-ins to Zoho as Open`).

---

### Task 8: Daily tracker status (TDD)

**Files:** Modify `src/components/DailyTracker.jsx` + its render test

Each visit row shows one of two tags:
- `In Zoho` when `row.contact_id` is set or `row.mpg_prospects?.status === 'promoted'`;
- `Not in Zoho yet · Retry` when `row.mpg_prospects?.zoho_wanted` is set and it isn't promoted. Retry is a separate button that does not open the edit dialog. It opens a modal holding `<ZohoPromote prospectId={row.prospect_id} touch={row} onDone={close} />`.

The table export (`visitRow`) is unchanged.

**Tests:**
- A promoted row shows "In Zoho".
- A wanted row shows the Retry button, and clicking it mounts ZohoPromote (mocked) with that row.
- A plain row shows neither.
- The Retry click does not open LogVisitDialog.

- [ ] Tests first, see them fail, implement, see them pass, commit (`feat: Daily tracker shows Zoho status and retries pending promotions`).

---

### Task 9: Verify and ship

- [ ] `npx vitest run` passes, apart from the known briefingBundle failure. `npx vite build` passes.
- [ ] Spec: update the status line to "slice 2 built". Under Promotion to Zoho, record the 2026-11-06 decisions: Lead_Source "Chandler", `MPG_REP` "Chandler", the COQL search with doubled quotes, the read-only search before the claim, the `choose` reply, `zoho_wanted`, ZohoPromote, the DailyTracker tags, and that `partial` has no Retry. Commit.
- [ ] **Ask the user first.** Then `npx supabase db push --linked --dry-run` (expect only 0061), then `npx supabase db push --linked`, then `npx supabase functions deploy crm-action` (check `docs/phase-writeback-setup.md` for the repo's deploy flags).
- [ ] **Live check, only with the user's OK:** promote a visit for a made-up business (e.g. "ZZ Test MPG Promote"). Confirm a Zoho Lead with status Open, Lead Source Chandler and REP Chandler, and the note. Afterwards the user deletes or keeps the test lead.
- [ ] Push the branch, open the PR to `main`, and bind it with the ccd_pr tools.
