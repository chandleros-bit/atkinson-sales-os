# Application Sent Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When Chandler moves a Bayway lead to Application Sent, the OS
previews the application-link email. On Send, it tags the FUB lead so an FUB
Automations 2.0 automation sends the email from his Outlook, never twice for
the same lead.

**Architecture:**
- **Copy:** a pure module `_shared/app-email.ts` holds the copy, the three
  versions, the tags and the W2 years. The browser preview and crm-action
  both import it.
- **Server:** crm-action gets a `send_app_email` action with two steps.
  `update_person` (optional) saves a missing email or first name to FUB.
  `app_email` claims a `lead_emails` row, checks FUB tags, publishes the
  templates when the W2 years change, then adds the tag.
- **Browser:** an `AppEmailHost` in `Layout` opens the preview after a
  successful move to `application_sent`.

**Tech Stack:** Supabase edge functions (Deno/TS, tested under vitest), React +
Tailwind, Postgres migration, FollowUpBoss REST API.

**Spec:** `docs/superpowers/specs/2026-11-05-application-sent-email-design.md`

Run all tests with `npx vitest run <path>` from the worktree root.

---

## File map

| File | Role |
| --- | --- |
| `supabase/functions/_shared/app-email.ts` (new) | Versions, tags, W2 years, `renderAppEmail`, `defaultVariant`, `hasAppEmailTag` |
| `supabase/functions/_shared/app-email.test.js` (new) | Unit tests for the above |
| `supabase/functions/_shared/fub-write.ts` | `EMAIL_RE`, `buildFubPersonUpdate`, `buildFubTemplate` |
| `supabase/functions/_shared/write-builders.test.js` | Builder tests |
| `supabase/functions/_shared/bay-stages.test.js` | Stage moves keep App Email tags |
| `supabase/functions/crm-action/app-email-step.ts` (new) | `loadAppEmailSettings`, `appEmailRefusal`, `sendAppEmail` (claim, check, publish, tag, mark) |
| `supabase/functions/crm-action/plan.ts` / `plan.test.js` | Action + steps + `shouldStop` |
| `supabase/functions/crm-action/run.ts` / `run.test.js` | Wiring, preflight, mirror, warning; integration tests |
| `supabase/functions/crm-action/crm.ts` | FUB `updatePerson`, `addTag`, `publishTemplate` |
| `supabase/migrations/0060_lead_emails.sql` (new) | Table, RLS, default settings row |
| `src/lib/writeback.js` | `crm-action:done` detail carries the request |
| `src/lib/appEmail.js` / `appEmail.test.js` (new) | `appEmailOfferFor(detail)`, `openAppEmail(contactId)` |
| `src/lib/crmActions.js` / `crmActions.test.js` | `send_app_email` request, result labels |
| `src/components/AppEmailHost.jsx` / `.render.test.jsx` (new) | Preview dialog |
| `src/components/Layout.jsx` | Mount host |
| `src/components/QuickActions.jsx` | "Application email" button in Move stage sheet |
| `docs/app-email-setup.md` (new) | Chandler's FUB setup and verify list |

---

### Task 1: Copy module `_shared/app-email.ts`

**Files:**
- Create: `supabase/functions/_shared/app-email.ts`
- Test: `supabase/functions/_shared/app-email.test.js`

- [ ] **Step 1: Write failing tests**

```js
import { describe, it, expect } from 'vitest'
import {
  APP_EMAIL_VARIANTS, APP_EMAIL_SUBJECT, APP_EMAIL_LINK, FUB_FIRST_NAME,
  variantFor, w2Years, renderAppEmail, defaultVariant, hasAppEmailTag,
} from './app-email.ts'

const NOV = new Date('2026-11-05T15:00:00Z')

describe('w2Years', () => {
  it('is the two years before this one, in Chicago time', () => {
    expect(w2Years(NOV)).toBe('2024 & 2025')
    // 2027-01-01 03:00Z is still Dec 31 in Chicago
    expect(w2Years(new Date('2027-01-01T03:00:00Z'))).toBe('2024 & 2025')
    expect(w2Years(new Date('2027-01-01T08:00:00Z'))).toBe('2025 & 2026')
  })
})

describe('renderAppEmail', () => {
  it('fills name, goal, years and the link; fixes the typo', () => {
    const { subject, html } = renderAppEmail({ variant: 'first_home', firstName: 'Miranda', now: NOV })
    expect(subject).toBe('Your pre-approval: next steps')
    expect(html).toContain('<p>Hey Miranda,</p>')
    expect(html).toContain('about buying your first home!')
    expect(html).toContain(`<a href="${APP_EMAIL_LINK}">Click Here to Start Application</a>`)
    expect(html).toContain('<li>2024 &amp; 2025 W2s</li>')
    expect(html).toContain('I look forward to helping you!')
    expect(html).not.toContain('forwarding')
  })
  it('has each version\'s goal line', () => {
    expect(renderAppEmail({ variant: 'next_home', firstName: 'A', now: NOV }).html).toContain('about buying your next home!')
    expect(renderAppEmail({ variant: 'refinance', firstName: 'A', now: NOV }).html).toContain('about refinancing your home!')
  })
  it('escapes the name in a preview', () => {
    expect(renderAppEmail({ variant: 'first_home', firstName: '<b>Jo</b>', now: NOV }).html).toContain('Hey &lt;b&gt;Jo&lt;/b&gt;,')
  })
  it('uses the FUB merge field, never a real name, for FUB', () => {
    const { html } = renderAppEmail({ variant: 'first_home', firstName: 'Miranda', now: NOV, mode: 'fub' })
    expect(html).toContain(`Hey ${FUB_FIRST_NAME},`)
    expect(html).not.toContain('Miranda')
  })
  it('throws on an unknown version', () => {
    expect(() => renderAppEmail({ variant: 'boat', firstName: 'A' })).toThrow(/Unknown/)
  })
})

describe('tags and versions', () => {
  it('has three versions with distinct tags', () => {
    expect(APP_EMAIL_VARIANTS.map((v) => v.key)).toEqual(['first_home', 'next_home', 'refinance'])
    expect(new Set(APP_EMAIL_VARIANTS.map((v) => v.tag)).size).toBe(3)
    expect(variantFor('refinance').tag).toBe('App Email - Refinance')
    expect(variantFor('nope')).toBeNull()
  })
  it('spots an App Email tag in any casing', () => {
    expect(hasAppEmailTag(['Lead', 'app email - next home'])).toBe(true)
    expect(hasAppEmailTag(['application sent'])).toBe(false)
    expect(hasAppEmailTag(null)).toBe(false)
  })
  it('defaults the version from FUB tags', () => {
    expect(defaultVariant(['Refi', 'Zillow'])).toBe('refinance')
    expect(defaultVariant(['Cash-Out Refinance'])).toBe('refinance')
    expect(defaultVariant(['Move Up Buyer'])).toBe('next_home')
    expect(defaultVariant(['repeat buyer'])).toBe('next_home')
    expect(defaultVariant(['First Time Buyer'])).toBe('first_home')
    expect(defaultVariant([])).toBe('first_home')
  })
})
```

- [ ] **Step 2:** `npx vitest run supabase/functions/_shared/app-email.test.js` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// The Application Sent email (spec 2026-11-05-application-sent-email-design.md).
// One source for the copy: the browser renders the preview from it and
// crm-action publishes it to the three FUB templates FUB's automations send.

export const APP_EMAIL_KEY = 'application_sent'
export const APP_EMAIL_SUBJECT = 'Your pre-approval: next steps'
export const APP_EMAIL_LINK = 'https://baywayhtx.my1003app.com/1851744/register'
// VERIFY on the test lead: FUB's first-name merge field.
export const FUB_FIRST_NAME = '%contact_first_name%'

export const APP_EMAIL_VARIANTS = [
  { key: 'first_home', label: 'First home', goal: 'buying your first home', tag: 'App Email - First Home', template: 'Sales OS - Application - First Home' },
  { key: 'next_home', label: 'Next home', goal: 'buying your next home', tag: 'App Email - Next Home', template: 'Sales OS - Application - Next Home' },
  { key: 'refinance', label: 'Refinance', goal: 'refinancing your home', tag: 'App Email - Refinance', template: 'Sales OS - Application - Refinance' },
]

export const variantFor = (key) => APP_EMAIL_VARIANTS.find((v) => v.key === key) || null

const norm = (t) => String(t ?? '').trim().toLowerCase()
const TAGS = new Set(APP_EMAIL_VARIANTS.map((v) => norm(v.tag)))
export const hasAppEmailTag = (tags) => (Array.isArray(tags) ? tags : []).some((t) => TAGS.has(norm(t)))

export function defaultVariant(tags) {
  const list = (Array.isArray(tags) ? tags : []).map(norm)
  if (list.some((t) => t.includes('refi'))) return 'refinance'
  if (list.some((t) => /move.?up|repeat|second home/.test(t))) return 'next_home'
  return 'first_home'
}

// W2s for a year arrive by Jan 31 of the next, so the last two tax years are
// the two before this calendar year (Chicago time).
export function w2Years(now = new Date()) {
  const y = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric' }).format(now))
  return `${y - 2} & ${y - 1}`
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

// mode 'preview': the lead's real first name (escaped). mode 'fub': FUB's
// merge field, for the template FUB sends.
export function renderAppEmail({ variant, firstName = '', now = new Date(), mode = 'preview' }) {
  const v = variantFor(variant)
  if (!v) throw new Error(`Unknown email version: ${variant}`)
  const name = mode === 'fub' ? FUB_FIRST_NAME : esc(String(firstName).trim())
  const html = [
    `<p>Hey ${name},</p>`,
    `<p>It was nice speaking with you about ${v.goal}!</p>`,
    `<p>To get started, please click this link to create an account and complete the questions for your pre-approval: <a href="${APP_EMAIL_LINK}">Click Here to Start Application</a></p>`,
    '<p>Please upload the following supporting documents:</p>',
    `<ol><li>Last 30 Day Paystubs</li><li>Most Recent 2 Months&#39; Bank Statements</li><li>${esc(w2Years(now))} W2s</li></ol>`,
    "<p>Once I receive your application and supporting documents, I will review within 48 hours. I&#39;ll determine the best programs that fit your situation then we&#39;ll schedule a call to talk through your options.</p>",
    '<p>Feel free to reach out with any questions. I look forward to helping you!</p>',
    '<p>Thank you,</p>',
  ].join('\n')
  return { subject: APP_EMAIL_SUBJECT, html }
}
```

- [ ] **Step 4:** run the test → PASS.
- [ ] **Step 5:** `git commit -m "feat: Application Sent email copy module"`

---

### Task 2: FUB builders

**Files:** Modify `supabase/functions/_shared/fub-write.ts`. Test:
`supabase/functions/_shared/write-builders.test.js`.

- [ ] **Step 1: Failing tests**

```js
describe('buildFubPersonUpdate', () => {
  const person = { emails: [{ value: 'old@x.com', type: 'home', isPrimary: 1 }] }
  it('puts the new email first as primary and keeps the others', () => {
    expect(buildFubPersonUpdate({ person, email: ' New@X.com ' })).toEqual({
      emails: [{ value: 'New@X.com', type: 'home', isPrimary: 1 }, { value: 'old@x.com', type: 'home', isPrimary: 0 }],
    })
  })
  it('does not duplicate an email already on file', () => {
    expect(buildFubPersonUpdate({ person, email: 'OLD@x.com' }).emails).toHaveLength(1)
  })
  it('sets the first name', () => {
    expect(buildFubPersonUpdate({ person: {}, firstName: ' Miranda ' })).toEqual({ firstName: 'Miranda' })
  })
  it('refuses a bad email or nothing to change', () => {
    expect(() => buildFubPersonUpdate({ person, email: 'nope' })).toThrow(/Not an email/)
    expect(() => buildFubPersonUpdate({ person })).toThrow(/Nothing/)
  })
})
describe('buildFubTemplate', () => {
  it('sends name, subject and body', () => {
    expect(buildFubTemplate({ name: 'N', subject: 'S', body: '<p>B</p>' })).toEqual({ name: 'N', subject: 'S', body: '<p>B</p>' })
  })
})
```

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** (append to `fub-write.ts`)

```ts
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// PUT /v1/people/{id}: save an email (as primary) and/or a first name the
// Application email needs. FUB replaces the emails list, so send it whole.
// VERIFY on the test lead: isPrimary as 1/0 is accepted.
export function buildFubPersonUpdate({ person, email, firstName }) {
  const body = {}
  const e = clean(email)
  if (e) {
    if (!EMAIL_RE.test(e)) throw new Error(`Not an email address: ${e}`)
    const others = (person?.emails || [])
      .filter((x) => clean(x?.value) && clean(x.value).toLowerCase() !== e.toLowerCase())
      .map((x) => ({ value: x.value, type: x.type || 'home', isPrimary: 0 }))
    body.emails = [{ value: e, type: 'home', isPrimary: 1 }, ...others]
  }
  const f = clean(firstName)
  if (f) body.firstName = f
  if (!Object.keys(body).length) throw new Error('Nothing to update on the FUB person')
  return body
}

// PUT /v1/templates/{id}. VERIFY on the test lead: FUB's docs list no fields.
export function buildFubTemplate({ name, subject, body }) {
  return { name, subject, body }
}
```

(`clean` is defined above `buildFubLeadEvent`; move `const clean` above
`buildFubPersonUpdate` if needed. `EMAIL_RE` is exported for app-email-step.)

- [ ] **Step 4:** run → PASS. **Step 5:** commit `feat: FUB person-update and template builders`.

---

### Task 3: Stage moves keep the App Email tag

**Files:** Test `supabase/functions/_shared/bay-stages.test.js` (no code
change expected: App Email tags aren't workflow tags).

- [ ] **Step 1:** add

```js
it('keeps the App Email tag through later stage moves', () => {
  const tags = ['application sent', 'App Email - First Home']
  expect(retagForTarget(tags, 'application_received')).toEqual(['App Email - First Home', 'application received'])
  expect(retagForTarget(tags, 'lost')).toContain('App Email - First Home')
})
```

- [ ] **Step 2:** run → PASS. **Step 3:** commit with Task 4.

---

### Task 4: Plan the action

**Files:** `supabase/functions/crm-action/plan.ts`, `plan.test.js`.

- [ ] **Step 1: Failing tests**

```js
describe('send_app_email', () => {
  it('is one app_email step when the lead has what it needs', () => {
    expect(planSteps({ action: 'send_app_email', payload: { variant: 'first_home' } }))
      .toEqual([{ step: 'app_email', variant: 'first_home' }])
  })
  it('saves a typed email / first name first', () => {
    expect(planSteps({ action: 'send_app_email', payload: { variant: 'refinance', email: ' a@b.co ', first_name: 'Mo' } })).toEqual([
      { step: 'update_person', email: 'a@b.co', firstName: 'Mo' },
      { step: 'app_email', variant: 'refinance' },
    ])
  })
  it('stops after a failed update_person', () => {
    expect(shouldStop('update_person', false)).toBe(true)
    expect(shouldStop('update_person', true)).toBe(false)
  })
  it('is a contact action', () => {
    expect(ACTIONS).toContain('send_app_email')
    expect(CONTACT_ACTIONS.has('send_app_email')).toBe(true)
  })
})
```

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement**
  - Add `'send_app_email'` to `ACTIONS` and `CONTACT_ACTIONS`.
  - Add a case to `planSteps`:

  ```ts
  case 'send_app_email': {
    const s = (v) => (typeof v === 'string' ? v.trim() : '')
    const steps = []
    if (s(p.email) || s(p.first_name)) steps.push({ step: 'update_person', email: s(p.email) || null, firstName: s(p.first_name) || null })
    steps.push({ step: 'app_email', variant: p.variant })
    return steps
  }
  ```

  - In `shouldStop`, add `step === 'update_person'`, so nothing is tagged
    without the email.
- [ ] **Step 4:** PASS. **Step 5:** commit `feat: plan send_app_email`.

---

### Task 5: Migration

**Files:** Create `supabase/migrations/0060_lead_emails.sql`.

```sql
-- Application Sent email (spec 2026-11-05-application-sent-email-design.md).
-- One row per lead and templated email: the claim that keeps it from ever
-- going out twice. crm-action (service role) writes; the owner reads.
create table if not exists public.lead_emails (
  id               uuid primary key default gen_random_uuid(),
  contact_id       uuid not null references public.contacts(id) on delete cascade,
  template_key     text not null,
  variant          text not null,
  to_email         text,
  status           text not null check (status in ('pending', 'tagged', 'failed')),
  client_action_id uuid,
  error            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  tagged_at        timestamptz,
  unique (contact_id, template_key)
);

alter table public.lead_emails enable row level security;
drop policy if exists "owner read lead_emails" on public.lead_emails;
create policy "owner read lead_emails" on public.lead_emails
  for select to authenticated using (public.is_owner());

-- Off until the FUB templates and automations exist (docs/app-email-setup.md).
insert into public.settings (key, value)
values ('app_email', '{"enabled": false, "templates": {}, "published_years": null}'::jsonb)
on conflict (key) do nothing;
```

- [ ] Commit `feat: lead_emails table`.

---

### Task 6: `app-email-step.ts` + run wiring + adapter

**Files:**
- Create `supabase/functions/crm-action/app-email-step.ts`
- Modify `run.ts`, `crm.ts`
- Test `run.test.js`

- [ ] **Step 1: Extend the fake DB in `run.test.js`:**
  - `insert` into `lead_emails` returns `23505` when a row with the same
    `contact_id` + `template_key` exists.
  - `update` returns `{ data: matchedRows, error: null }`. Rows are matched
    before the patch is applied, so `.select()` after `.update()` sees them.

- [ ] **Step 2: Failing tests** (new `describe('crm-action run: send_app_email')`):

  Fixture:
  - `settings.app_email = { enabled: true, templates: { first_home: 11, next_home: 12, refinance: 13 }, published_years: null }`
  - contact `c-bay` with `email: 'jo@x.com'`, `person_stage: 'Lead'`
  - fake adapter with `read.person` returning
    `{ id: 4821, firstName: 'Jo', tags: ['application sent'], emails: [{ value: 'jo@x.com' }] }`,
    plus `send.updatePerson`, `send.addTag`, `send.publishTemplate` spies and
    `map.contact` (real `mapContact`).

  Tests:
  1. **Happy path:** publishes 3 templates with FUB-mode HTML, saves
     `published_years: '2024 & 2025'`, then adds `App Email - First Home`.
     The `lead_emails` row ends `tagged`; the response is `status: 'ok'`.
  2. **Years already published:** no `publishTemplate` call.
  3. **Second send:** refused with "already sent". No second `addTag`.
  4. **Racing sends** (two client ids, `Promise.all`): exactly one `addTag`.
  5. **`failed` row:** taken over, and the send goes through.
  6. **Fresh `pending` row** (updated now): refused "already being sent".
     **Stale** (5 min old): taken over.
  7. **App Email tag already in FUB:** refused "Already sent from FUB". The row
     is marked `tagged`, with no `addTag`.
  8. **No email on contact and none given:** refused (preflight), with no
     `lead_emails` row.
  9. **Email given:** `updatePerson` runs before `addTag`, and the order is
     asserted. When `updatePerson` throws, there's no `addTag` and no
     `lead_emails` row.
  10. **Publish fails:**
      - with `published_years: null`, the step fails, the row is `failed` and
        there's no `addTag`;
      - with `published_years: '2023 & 2024'`, the tag is added and the
        result carries `warning`.
  11. **MPG contact:** refused "Bayway only". **`enabled: false`:** refused.
  12. **`addTag` throws:** the row is `failed` with the message, and a retry
      with a new client id succeeds.

- [ ] **Step 3:** run → FAIL.

- [ ] **Step 4: Implement `app-email-step.ts`**

```ts
// crm-action's `app_email` step (spec 2026-11-05-application-sent-email-design.md).
// The OS never sends mail: it tags the FUB lead and FUB's Tag Added
// automation sends the template. lead_emails makes it once per lead.
import { APP_EMAIL_KEY, APP_EMAIL_SUBJECT, APP_EMAIL_VARIANTS, variantFor, hasAppEmailTag, w2Years, renderAppEmail } from '../_shared/app-email.ts'
import { EMAIL_RE } from '../_shared/fub-write.ts'

const STALE_MS = 2 * 60_000
const clean = (v) => (typeof v === 'string' ? v.trim() : '')
const msg = (e) => String(e?.message || e).slice(0, 500)
const day = (iso) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' }).format(new Date(iso))

// A refusal: someone else's claim or a lead already emailed. Not a failure of
// this send, so the row is left as it is.
export class Refusal extends Error {}

export async function loadAppEmailSettings(db) {
  const { data } = await db.from('settings').select('value').eq('key', 'app_email').maybeSingle()
  return data?.value || null
}

export function appEmailRefusal(cfg, payload, contact) {
  if (!cfg?.enabled) return 'The application email is off (settings: app_email)'
  const v = variantFor(payload?.variant)
  if (!v) return `Unknown email version: ${payload?.variant}`
  if (!Number(cfg.templates?.[v.key])) return `No FUB template id for ${v.label} (settings: app_email.templates)`
  const email = clean(payload?.email)
  if (email && !EMAIL_RE.test(email)) return `Not an email address: ${email}`
  if (!email && !clean(contact?.email)) return 'No email on file in FollowUpBoss. Enter one to send.'
  return null
}

async function claim(db, row, now) {
  const ins = await db.from('lead_emails').insert(row)
  if (!ins.error) return
  if (ins.error.code !== '23505') throw new Error(`lead_emails insert: ${ins.error.message}`)
  const { data: prev } = await db.from('lead_emails').select('status, updated_at, tagged_at')
    .eq('contact_id', row.contact_id).eq('template_key', row.template_key).maybeSingle()
  if (prev?.status === 'tagged') throw new Refusal(`Application email already sent ${day(prev.tagged_at || prev.updated_at)}`)
  const stale = prev?.status === 'pending' && now.getTime() - Date.parse(prev.updated_at) > STALE_MS
  if (!prev || (prev.status === 'pending' && !stale)) throw new Refusal('The application email is already being sent')
  const { data: took, error } = await db.from('lead_emails').update(row)
    .eq('contact_id', row.contact_id).eq('template_key', row.template_key)
    .eq('status', prev.status).eq('updated_at', prev.updated_at).select('id')
  if (error) throw new Error(`lead_emails claim: ${error.message}`)
  if (!took?.length) throw new Refusal('The application email is already being sent')
}

// Publish the copy to all three FUB templates when this year's W2 line isn't
// there yet. Returns a warning when an old copy stays live.
async function publishIfStale(db, adapter, cfg, now) {
  const years = w2Years(now)
  if (cfg.published_years === years) return null
  try {
    for (const v of APP_EMAIL_VARIANTS) {
      await adapter.send.publishTemplate({
        id: Number(cfg.templates[v.key]),
        name: v.template,
        subject: APP_EMAIL_SUBJECT,
        body: renderAppEmail({ variant: v.key, now, mode: 'fub' }).html,
      })
    }
    const { error } = await db.from('settings').update({ value: { ...cfg, published_years: years } }).eq('key', 'app_email')
    if (error) throw new Error(`settings: ${error.message}`)
    return null
  } catch (e) {
    if (!cfg.published_years) throw new Error(`Couldn't publish the email templates to FollowUpBoss: ${msg(e)}`)
    return `FollowUpBoss templates still show ${cfg.published_years} W2s (${msg(e)})`
  }
}

export async function sendAppEmail({ db, adapter, contact, variant, cfg, toEmail, clientActionId, now = new Date() }) {
  const v = variantFor(variant)
  if (!v) throw new Refusal(`Unknown email version: ${variant}`)
  const stamp = now.toISOString()
  const key = { contact_id: contact.id, template_key: APP_EMAIL_KEY }
  await claim(db, {
    ...key, variant: v.key, to_email: clean(toEmail) || null, status: 'pending',
    client_action_id: clientActionId, error: null, tagged_at: null, updated_at: stamp,
  }, now)
  const mark = async (patch) => {
    const { error } = await db.from('lead_emails').update({ ...patch, updated_at: new Date().toISOString() })
      .eq('contact_id', key.contact_id).eq('template_key', key.template_key).eq('client_action_id', clientActionId)
    if (error) console.error(`lead_emails mark failed for ${contact.id}: ${error.message}`)
  }
  try {
    const person = await adapter.read.person(contact.external_id)
    if (hasAppEmailTag(person?.tags)) {
      await mark({ status: 'tagged', tagged_at: stamp, error: 'Already tagged in FollowUpBoss' })
      throw new Refusal('Already sent from FollowUpBoss (the lead has an App Email tag)')
    }
    if (!(person?.emails || []).some((e) => clean(e?.value))) throw new Error('No email on file in FollowUpBoss')
    const warning = await publishIfStale(db, adapter, cfg, now)
    await adapter.send.addTag({ externalId: contact.external_id, tag: v.tag })
    await mark({ status: 'tagged', tagged_at: stamp, error: warning })
    return { id: contact.external_id, warning }
  } catch (e) {
    if (!(e instanceof Refusal)) await mark({ status: 'failed', error: msg(e) })
    throw e
  }
}
```

- [ ] **Step 5: Wire `run.ts`**
  - Import `{ loadAppEmailSettings, appEmailRefusal, sendAppEmail }`.
  - `loadContact` selects `email` too.
  - After `resolve`:
    `if (req.action === 'send_app_email') target.appEmail = await loadAppEmailSettings(db)`.
  - In `preflight`:
    `if (req.action === 'send_app_email') return businessId !== 'bay' ? 'The application email is Bayway only' : appEmailRefusal(target.appEmail, req.payload, contact)`.
  - `send(adapter, step, target, ctx)`. New cases:
    - `update_person` → `adapter.send.updatePerson({ externalId, email: step.email, firstName: step.firstName })`
    - `app_email` →
      `sendAppEmail({ db: ctx.db, adapter, contact, variant: step.variant, cfg: target.appEmail, toEmail: ctx.req.payload?.email || contact.email, clientActionId: ctx.req.client_action_id, now: ctx.now })`
  - `mirror`: treat `update_person` and `app_email` like `set_stage`. Re-read
    the person and upsert the contact.
  - The results loop gets `if (out.warning) result.warning = out.warning`.

- [ ] **Step 6: Adapter `crm.ts`** (`fubAdapter().send`):

```ts
// Application email (app-email-step.ts): save a missing email / first name.
updatePerson: async ({ externalId, email, firstName }) => {
  const person = await fubGet(`/people/${externalId}`)
  await fubSend('PUT', `/people/${externalId}`, buildFubPersonUpdate({ person, email, firstName }))
  return { id: externalId }
},
// One more tag, every other tag kept (PUT /people replaces the list).
addTag: async ({ externalId, tag }) => {
  const person = await fubGet(`/people/${externalId}`)
  const tags = person.tags || []
  if (tags.some((t) => String(t).trim().toLowerCase() === tag.toLowerCase())) return { id: externalId, tags }
  await fubSend('PUT', `/people/${externalId}`, { tags: [...tags, tag] })
  return { id: externalId, tags: [...tags, tag] }
},
publishTemplate: async ({ id, name, subject, body }) => {
  await fubSend('PUT', `/templates/${id}`, buildFubTemplate({ name, subject, body }))
  return { id }
},
```

  Add `VERIFY: PUT /templates/{id}` to the header comment.

- [ ] **Step 7:** `npx vitest run supabase/functions` → all PASS.
- [ ] **Step 8:** commit `feat: crm-action send_app_email (FUB tag, once per lead)`.

---

### Task 7: Browser helpers

**Files:**
- Modify `src/lib/writeback.js` and `src/lib/crmActions.js` (+ test)
- Create `src/lib/appEmail.js` (+ test)

- [ ] **Step 1: Failing tests**

```js
// appEmail.test.js
import { appEmailOfferFor } from './appEmail'
const ok = (steps) => steps.map((step) => ({ step, ok: true }))
it('offers after a move to Application Sent', () => {
  expect(appEmailOfferFor({ request: { action: 'set_stage', contact_id: 'c1', payload: { target: 'application_sent' } }, results: ok(['set_stage']) })).toBe('c1')
  expect(appEmailOfferFor({ request: { action: 'log_call', contact_id: 'c1', payload: { set_stage: 'application_sent' } }, results: ok(['log_call', 'set_stage']) })).toBe('c1')
})
it('does not offer for other targets or a failed move', () => {
  expect(appEmailOfferFor({ request: { action: 'set_stage', contact_id: 'c1', payload: { target: 'estimate_sent' } }, results: ok(['set_stage']) })).toBeNull()
  expect(appEmailOfferFor({ request: { action: 'set_stage', contact_id: 'c1', payload: { target: 'application_sent' } }, results: [{ step: 'set_stage', ok: false }] })).toBeNull()
  expect(appEmailOfferFor(null)).toBeNull()
})
```

```js
// crmActions.test.js
it('builds send_app_email', () => {
  const r = buildActionRequest({ action: 'send_app_email', contactId: 'c1', variant: 'refinance', email: ' a@b.co ', firstName: '' })
  expect(r).toMatchObject({ action: 'send_app_email', contact_id: 'c1', payload: { variant: 'refinance', email: 'a@b.co' } })
  expect(r.payload.first_name).toBeUndefined()
})
it('summarizes the email steps', () => {
  expect(summarizeResult({ status: 'ok', results: [{ step: 'app_email', ok: true }] }, 'bay').text).toBe('Application email sent in FollowUpBoss')
})
```

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement**

  `appEmail.js`:

  ```js
  // Application Sent email, browser side. The preview opens after a move to
  // Application Sent (any surface: crm-action:done) or from the Move stage sheet.
  export function appEmailOfferFor(detail) {
    const req = detail?.request
    if (!req?.contact_id) return null
    const moved = (req.action === 'set_stage' && req.payload?.target === 'application_sent') ||
      (req.action === 'log_call' && req.payload?.set_stage === 'application_sent')
    if (!moved) return null
    return (detail.results || []).some((r) => r.step === 'set_stage' && r.ok) ? req.contact_id : null
  }
  export const openAppEmail = (contactId) =>
    window.dispatchEvent(new CustomEvent('app-email:open', { detail: { contactId } }))
  ```

  In `writeback.js`, the dispatch detail becomes `{ ...data, request }`.

  In `crmActions.js`:
  - Add `'send_app_email'` to `ACTIONS`.
  - Add a `buildActionRequest` branch:

    ```js
    if (action === 'send_app_email') {
      const payload = { variant: form.variant }
      if (trimmed(form.email)) payload.email = trimmed(form.email)
      if (trimmed(form.firstName)) payload.first_name = trimmed(form.firstName)
      return { ...base, contact_id: form.contactId, payload }
    }
    ```

  - `DONE.update_person = 'contact saved'`,
    `DONE.app_email = 'application email sent'`.
  - `LABEL.update_person = 'Saving the email'`,
    `LABEL.app_email = 'Application email'`.
- [ ] **Step 4:** PASS. **Step 5:** commit `feat: application email request helpers`.

---

### Task 8: `AppEmailHost` dialog

**Files:**
- Create `src/components/AppEmailHost.jsx` and
  `src/components/AppEmailHost.render.test.jsx`
- Modify `src/components/Layout.jsx` and `src/components/QuickActions.jsx`
  (`StageForm`)

**Behavior:**
- **Listens for** `crm-action:done` (through `appEmailOfferFor`) and
  `app-email:open`. Ignores both when `useAuth().role === 'assistant'`.
- **Loads:**
  - the contact:
    `contacts.select('id, business_id, name, email, raw').eq('id', id).maybeSingle()`
    (first name = `raw.firstName`, tags = `raw.tags`);
  - the lead's `lead_emails` row
    (`select('status, tagged_at, variant').eq('contact_id', id).eq('template_key', 'application_sent')`);
  - `settings` `app_email`.
- **Doesn't open when:**
  - the lead isn't Bayway;
  - the email is off. On a manual open it toasts "The application email is
    off"; on an auto offer it stays silent;
  - the row is `tagged`, or the lead has an App Email tag. It toasts
    "Application email already sent Nov 5" instead.
- **The dialog** (`Sheet`, Bayway tone):
  - **To:** text, or an email input with `aria-label="Lead email"` when none.
  - **First name:** an input when none.
  - **Version:** chips for the three versions, defaulted from
    `defaultVariant(tags)`.
  - **Subject** line, then the preview `div`
    (`dangerouslySetInnerHTML` of `renderAppEmail(...).html`, escaped by the
    module), then **Send** (`SubmitButton`) and **Skip**.
  - **Send** is disabled until there's an email (`EMAIL_RE`) and a first name.
- **On Send:**
  `invokeCrmAction(buildActionRequest({ action: 'send_app_email', contactId, variant, email: typedEmail, firstName: typedFirst }))`
  then `summarizeResult`.
  - `ok`: close and toast. If a result has a `warning`, the toast carries
    "(W2 years not updated in FUB)".
  - Otherwise: show the error inline and keep the dialog open.

**Tests** (mock `../lib/supabase` and `../lib/writeback`, as
`ReminderHost.render.test.jsx` does):
1. Dispatching `crm-action:done` for `application_sent` opens the dialog with
   "Hey Jo," and "buying your first home".
2. An `estimate_sent` move does not open it.
3. A lead with no email shows the email input, and Send stays disabled until
   a valid email is typed.
4. Send calls `invokeCrmAction` with
   `{ action: 'send_app_email', payload: { variant: 'refinance', email } }`
   after picking Refinance.
5. A `tagged` row toasts "already sent" and opens no dialog.
6. Skip closes it without calling `invokeCrmAction`.

**`StageForm`:** for `businessId === 'bay'`, below the targets, add a text
button "Application email…" that calls `openAppEmail(contactId)`.

**`Layout`:** mount `<AppEmailHost />` after `<PersonSheetHost />`.

- [ ] Steps: write the tests, then fail, then implement, then pass, then
      commit `feat: Application email preview dialog`.

---

### Task 9: Setup doc + full checks

- [ ] Create `docs/app-email-setup.md` with the spec's *Setup* and *Verify*
      lists and this SQL:

```sql
update settings set value = jsonb_build_object(
  'enabled', true,
  'templates', jsonb_build_object('first_home', <id>, 'next_home', <id>, 'refinance', <id>),
  'published_years', null)
where key = 'app_email';
```

- [ ] `npx vitest run` (whole suite) → PASS. `npm run build` → OK. `npm run lint` if configured.
- [ ] Commit `docs: Application email setup`.
