# Arive Loans Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upload an Arive Pipeline Report CSV on a new Bayway › Loans page, store one row per loan, rebuild Arive's three dashboard panels, estimate commission, and feed Reports / Overview loan metrics from it.

**Architecture:** The browser parses the CSV (`src/lib/csv.js`), maps rows to loans and builds a preview (`src/lib/ariveImport.js`, pure), then upserts to a new `loans` table through supabase-js under the signed-in user (`src/lib/loansData.js`). Panel maths and metric stats live in `src/lib/loans.js` (pure). Reports and Overview read the same loan bundle.

**Tech Stack:** React 18 + Vite, Tailwind, supabase-js v2, Vitest (+ jsdom for render tests), Postgres migrations in `supabase/migrations/`.

**Spec:** `docs/superpowers/specs/2026-10-30-arive-loans-import-design.md`

**Branch:** `feat/arive-loans` (already created from `origin/main`). Commit without author overrides; the repo's git config is already right.

**Ground rules for this repo**
- Every Supabase list read in `src/` must be bounded or wrapped in `fetchAllSettled(() => … .order('id'))`; `src/lib/rowCap.audit.test.js` fails the suite otherwise.
- Run tests with `npx vitest run <file>`; the whole suite with `npm test`.
- Never commit the real Arive export. Test fixtures use made-up people only.

---

## File map

| File | Responsibility |
|---|---|
| `supabase/migrations/0052_loans.sql` | `loans` table, indexes, RLS, `arive` settings row, write policies |
| `src/lib/csv.js` (+ test) | RFC 4180 CSV → `{ header, rows }` |
| `src/lib/ariveImport.js` (+ test) | stage groups, header check, row → loan, scenario rule, contact match, preview diff |
| `src/lib/loans.js` (+ test) | rates, `estComp`, scenario/open/notInLatest, panel maths, `loanStats` for metrics |
| `src/lib/loansData.js` | Supabase reads/writes: bundle, import save, rates save, loan patch |
| `src/lib/reports.js` (+ test) | metric sources flip; card `note` |
| `src/pages/Reports.jsx` | load bundle, Arive values + notes |
| `src/lib/overviewDash.js` (+ test) | optional `loanStats` / sprint override |
| `src/pages/Overview.jsx` | load bundle, pass stats |
| `src/components/LoanImport.jsx` | file pick → preview → confirm dialog |
| `src/pages/Loans.jsx` (+ render test) | page: header, filters, three panels, table |
| `src/App.jsx`, `src/components/Sidebar.jsx` | route `/bayway/loans`, Loans link |

---

### Task 1: Migration `0052_loans.sql`

**Files:**
- Create: `supabase/migrations/0052_loans.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Arive loans import (docs/superpowers/specs/2026-10-30-arive-loans-import-design.md).
--   * loans: one row per Arive loan, upserted from the browser by
--     arive_loan_id. Import-owned columns are overwritten on every import;
--     scenario_override and comp_override belong to Chandler and the import
--     never sends them. No delete policy: the OS never deletes loans.
--   * settings 'arive': loan officer name and commission rates.
--   * sync_log: the browser logs each import with source 'arive'.

create table if not exists public.loans (
  id uuid primary key default gen_random_uuid(),
  arive_loan_id text not null unique,
  business_id text not null default 'bay' references public.businesses(id),
  loan_officer text,
  role text not null default 'primary' check (role in ('primary', 'assisted')),
  borrower_name text,
  borrower_first text,
  borrower_last text,
  borrower_email text,
  borrower_phone text,
  co_borrower_name text,
  co_borrower_email text,
  contact_id uuid references public.contacts(id) on delete set null,
  amount numeric,
  purpose text,
  stage text,
  stage_group text check (stage_group in ('prospect', 'processing', 'closing', 'funded', 'adverse', 'other')),
  property_address text,
  property_state text,
  lender text,
  title_company text,
  closed_on date,
  funded_on date,
  firm_closing_on date,
  application_on date,
  rate numeric,
  loan_type text,
  term_months int,
  buyer_agent_name text,
  buyer_agent_company text,
  buyer_agent_email text,
  buyer_agent_phone text,
  seller_agent_name text,
  seller_agent_company text,
  seller_agent_email text,
  seller_agent_phone text,
  scenario_auto boolean not null default false,
  scenario_override boolean,
  comp_override numeric,
  raw jsonb,
  first_imported_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists loans_funded_on_idx on public.loans (funded_on);
create index if not exists loans_stage_group_idx on public.loans (stage_group);

alter table public.loans enable row level security;
drop policy if exists "authenticated select loans" on public.loans;
create policy "authenticated select loans" on public.loans
  for select to authenticated using (true);
drop policy if exists "authenticated insert loans" on public.loans;
create policy "authenticated insert loans" on public.loans
  for insert to authenticated with check (true);
drop policy if exists "authenticated update loans" on public.loans;
create policy "authenticated update loans" on public.loans
  for update to authenticated using (true) with check (true);

insert into public.settings (key, value)
values ('arive', '{"lo_name": "Chandler Dean Atkinson", "primary_pct": 1.25, "assisted_pct": 0.75}'::jsonb)
on conflict (key) do nothing;

drop policy if exists "authenticated insert arive settings" on public.settings;
create policy "authenticated insert arive settings" on public.settings
  for insert to authenticated with check (key = 'arive');
drop policy if exists "authenticated update arive settings" on public.settings;
create policy "authenticated update arive settings" on public.settings
  for update to authenticated using (key = 'arive') with check (key = 'arive');

drop policy if exists "authenticated insert arive sync_log" on public.sync_log;
create policy "authenticated insert arive sync_log" on public.sync_log
  for insert to authenticated with check (source = 'arive');
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0052_loans.sql
git commit -m "feat: loans table for the Arive import"
```

(Applying it to the live database is Task 10.)

---

### Task 2: CSV parser

**Files:**
- Create: `src/lib/csv.js`
- Test: `src/lib/csv.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest'
import { parseCsv } from './csv'

describe('parseCsv', () => {
  it('reads a header and rows as objects', () => {
    const { header, rows } = parseCsv('A,B\n1,2\n3,4\n')
    expect(header).toEqual(['A', 'B'])
    expect(rows).toEqual([{ A: '1', B: '2' }, { A: '3', B: '4' }])
  })

  it('keeps commas, doubled quotes and newlines inside quoted fields', () => {
    const { rows } = parseCsv('Title,Note\r\n"WestStar Title, LLC","He said ""hi""\nthen left"\r\n')
    expect(rows).toEqual([{ Title: 'WestStar Title, LLC', Note: 'He said "hi"\nthen left' }])
  })

  it('strips a BOM, trims header names and skips blank lines', () => {
    const { header, rows } = parseCsv('\uFEFF A , B\n\n1,2\n\n')
    expect(header).toEqual(['A', 'B'])
    expect(rows).toEqual([{ A: '1', B: '2' }])
  })

  it('fills missing trailing cells with empty strings', () => {
    expect(parseCsv('A,B,C\n1\n').rows).toEqual([{ A: '1', B: '', C: '' }])
  })

  it('returns no header for empty input', () => {
    expect(parseCsv('')).toEqual({ header: [], rows: [] })
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/csv.test.js`
Expected: FAIL, cannot resolve `./csv`.

- [ ] **Step 3: Implement**

```js
// RFC 4180 CSV for the Arive export: quoted fields may hold commas, newlines
// and doubled quotes. Returns the trimmed header and one object per non-blank
// row, keyed by header; short rows are padded with ''.
export function parseCsv(text) {
  const src = String(text ?? '').replace(/^\uFEFF/, '')
  const records = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field); records.push(row); row = []; field = ''
    } else field += c
  }
  if (field !== '' || row.length) { row.push(field); records.push(row) }
  const nonBlank = records.filter((r) => r.some((v) => v.trim() !== ''))
  if (!nonBlank.length) return { header: [], rows: [] }
  const header = nonBlank[0].map((h) => h.trim())
  const rows = nonBlank.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
  return { header, rows }
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run src/lib/csv.test.js`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/csv.js src/lib/csv.test.js
git commit -m "feat: CSV parser for the Arive export"
```

---

### Task 3: Arive row mapping and import preview

**Files:**
- Create: `src/lib/ariveImport.js`
- Test: `src/lib/ariveImport.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest'
import { parseCsv } from './csv'
import {
  REQUIRED_HEADERS, STAGE_GROUPS, stageGroup, parseUsDate, isScenarioRow, rowToLoan, matchContact, buildPreview,
} from './ariveImport'

const HEADER = 'Primary Borrower,Primary Loan Officer Name,Primary Borrower First Name,Primary Borrower Last Name,Primary Borrower Email,Primary Borrower Cell Phone,Co-Borrower,Co-Borrower Email,ARIVE Loan Id,Total Loan Amount,Loan Purpose,Stage Name,Subject Property,Subject State,Docs Signed / Loan Closed,Loan Funded,Lender,Firm Closing Date,Buyer Agent,Buyer Agent Company Name,Buyer Agent Email,Buyer Agent Phone,Seller Agent,Seller Agent Company Name,Seller Agent Email,Seller Agent Phone,Title Company'
const FIXTURE = [
  HEADER,
  'Gina Park,Chandler Dean Atkinson,Gina,Park,gina.park@example.com,7135550101,Lee Park,lee@example.com,100001,410000,Purchase,Loan Funded,1 Elm St Houston HARRIS TX 77001,Texas,10/2/2026,10/3/2026,UWM,10/2/2026,Rita Agent,Best Realty,rita@example.com,7135550199,,,,,"Lone Star Title, LLC"',
  'Omar Vale,Ronnie Gaydos,Omar,Vale,omar@example.com,,,,100002,,Refinance,App Intake,IL,Illinois,,,,,,,,,,,,,',
  'Test test,Chandler Dean Atkinson,Test,Test,aaa@gmail.com,,,,100003,633750,Refinance,App Intake,,,,,,,,,,,,,,,',
  'Ana Ruiz,Chandler Dean Atkinson,Ana,Ruiz,ana@example.com,,,,100004,250000,Purchase,Underwriting Hold,TX,Texas,,,,,,,,,,,,,',
  ',Chandler Dean Atkinson,,,,,,,,1,Purchase,App Intake,,,,,,,,,,,,,,,',
].join('\n')
const LO = 'Chandler Dean Atkinson'

describe('stage groups', () => {
  it('maps every Arive stage, case- and space-insensitive', () => {
    expect(stageGroup('App Intake')).toBe('prospect')
    expect(stageGroup('approved w/  conditions')).toBe('processing')
    expect(stageGroup('Clear To Close')).toBe('closing')
    expect(stageGroup('Broker Check Received')).toBe('funded')
    expect(stageGroup('Adverse')).toBe('adverse')
    expect(stageGroup('Underwriting Hold')).toBe('other')
    expect(STAGE_GROUPS.flatMap((g) => g.stages)).toHaveLength(15)
  })
})

describe('parseUsDate', () => {
  it('turns M/D/YYYY into YYYY-MM-DD and blanks into null', () => {
    expect(parseUsDate('10/3/2026')).toBe('2026-10-03')
    expect(parseUsDate('')).toBeNull()
    expect(parseUsDate('soon')).toBeNull()
  })
})

describe('isScenarioRow', () => {
  it('flags placeholder emails, phones and names', () => {
    expect(isScenarioRow({ email: 'aaa@gmail.com' })).toBe(true)
    expect(isScenarioRow({ email: 'x@noone.com' })).toBe(true)
    expect(isScenarioRow({ phone: '1111111111' })).toBe(true)
    expect(isScenarioRow({ first: 'Josh', last: 'DSCR' })).toBe(true)
    expect(isScenarioRow({ name: 'Darren Cost Sheet' })).toBe(true)
    expect(isScenarioRow({ first: 'Gina', last: 'Park', email: 'gina.park@example.com', phone: '7135550101' })).toBe(false)
  })
})

describe('rowToLoan', () => {
  const { rows } = parseCsv(FIXTURE)
  it('maps a full row', () => {
    const l = rowToLoan(rows[0], { loName: LO })
    expect(l).toMatchObject({
      arive_loan_id: '100001', role: 'primary', borrower_name: 'Gina Park', borrower_email: 'gina.park@example.com',
      borrower_phone: '7135550101', co_borrower_name: 'Lee Park', amount: 410000, purpose: 'Purchase',
      stage: 'Loan Funded', stage_group: 'funded', funded_on: '2026-10-03', closed_on: '2026-10-02',
      firm_closing_on: '2026-10-02', lender: 'UWM', title_company: 'Lone Star Title, LLC',
      buyer_agent_name: 'Rita Agent', buyer_agent_phone: '7135550199', seller_agent_name: null,
      scenario_auto: false, application_on: null, rate: null,
    })
    expect(l.raw['ARIVE Loan Id']).toBe('100001')
  })
  it('marks other loan officers as assisted and blank amounts as null', () => {
    expect(rowToLoan(rows[1], { loName: LO })).toMatchObject({ role: 'assisted', amount: null, loan_officer: 'Ronnie Gaydos' })
  })
  it('flags scenario rows', () => {
    expect(rowToLoan(rows[2], { loName: LO }).scenario_auto).toBe(true)
  })
})

describe('matchContact', () => {
  const contacts = [
    { id: 'c1', name: 'Gina Park', email: 'GINA.PARK@example.com', phone: null },
    { id: 'c2', name: 'Someone', email: null, phone: '(713) 555-0101' },
    { id: 'c3', name: 'Ana Ruiz', email: null, phone: null },
    { id: 'c4', name: 'Ana Ruiz', email: null, phone: null },
  ]
  it('matches email first, then phone, then a unique name', () => {
    expect(matchContact({ borrower_email: 'gina.park@example.com', borrower_phone: '7135550101' }, contacts)).toBe('c1')
    expect(matchContact({ borrower_email: 'nope@example.com', borrower_phone: '7135550101' }, contacts)).toBe('c2')
    expect(matchContact({ borrower_name: 'Gina Park' }, contacts)).toBe('c1')
    expect(matchContact({ borrower_name: 'Ana Ruiz' }, contacts)).toBeNull()
  })
  it('never matches a scenario loan', () => {
    expect(matchContact({ borrower_email: 'gina.park@example.com', scenario_auto: true }, contacts)).toBeNull()
  })
})

describe('buildPreview', () => {
  const { header, rows } = parseCsv(FIXTURE)
  const contacts = [{ id: 'c1', name: 'Gina Park', email: 'gina.park@example.com', phone: null }]
  const existing = [
    { arive_loan_id: '100001', stage: 'Clear To Close', amount: 410000 },
    { arive_loan_id: '100002', ...rowToLoan(rows[1], { loName: LO }) },
    { arive_loan_id: '999999', stage: 'App Intake' },
  ]

  it('refuses a file missing required headers', () => {
    const p = buildPreview({ header: ['Lender'], rows: [], existing: [], contacts: [], loName: LO })
    expect(p.error).toContain('ARIVE Loan Id')
    expect(REQUIRED_HEADERS).toHaveLength(5)
  })

  it('sorts rows into new, updated, unchanged and skipped', () => {
    const p = buildPreview({ header, rows, existing, contacts, loName: LO })
    expect(p.error).toBeUndefined()
    expect(p.loans.map((l) => l.arive_loan_id)).toEqual(['100001', '100002', '100003', '100004'])
    expect(p.counts).toEqual({ total: 4, new: 2, updated: 1, unchanged: 1, skipped: 1, scenario: 1, unmatched: 2, missing: 1 })
    expect(p.unknownStages).toEqual(['Underwriting Hold'])
    expect(p.missingIds).toEqual(['999999'])
    expect(p.loans[0].contact_id).toBe('c1')
  })
})
```

Counts explained: `100001` exists with a different stage → updated; `100002` identical → unchanged; `100003` and `100004` new; the row with no loan ID → skipped; `100003` is the scenario; unmatched = loans that are not scenario and found no contact (`100002`, `100004`); `999999` is missing from the file.

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/ariveImport.test.js`
Expected: FAIL, cannot resolve `./ariveImport`.

- [ ] **Step 3: Implement**

```js
// Arive Pipeline Report CSV → loans rows (docs/superpowers/specs/
// 2026-10-30-arive-loans-import-design.md). Pure: no Supabase here.

export const REQUIRED_HEADERS = ['ARIVE Loan Id', 'Stage Name', 'Total Loan Amount', 'Primary Loan Officer Name', 'Primary Borrower']

// Display order for the Pipeline Status panel.
export const STAGE_GROUPS = [
  { key: 'prospect', label: 'Prospect', stages: ['App Intake', 'Qualification', 'Pre-Approved'] },
  { key: 'processing', label: 'Processing', stages: ['Loan Setup', 'Disclosed', 'Submitted to UW', 'Approved w/ Conditions', 'Re-Submittal'] },
  { key: 'closing', label: 'Closing', stages: ['Clear To Close', 'Docs Out', 'Docs Signed'] },
  { key: 'funded', label: 'Funded', stages: ['Loan Funded', 'Broker Check Received', 'Loan Finalized'] },
  { key: 'adverse', label: 'Adverse', stages: ['Adverse'] },
]

const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
const GROUP_OF = new Map(STAGE_GROUPS.flatMap((g) => g.stages.map((s) => [norm(s), g.key])))

export function stageGroup(stage) {
  return GROUP_OF.get(norm(stage)) ?? 'other'
}

const text = (v) => {
  const s = String(v ?? '').trim()
  return s === '' ? null : s
}
const num = (v) => {
  const s = String(v ?? '').replace(/[$,\s]/g, '')
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
const phone10 = (v) => {
  const d = String(v ?? '').replace(/\D/g, '')
  return d.length >= 10 ? d.slice(-10) : null
}

export function parseUsDate(v) {
  const m = String(v ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return null
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
}

const PLACEHOLDER_LOCALS = new Set(['aaa', '123', '456', 'lead', 'test'])
const PLACEHOLDER_DOMAINS = new Set(['noone.com', '123.com'])
const PLACEHOLDER_NAMES = new Set(['test', 'tbd', 'client', 'dscr'])
const PLACEHOLDER_PHRASES = ['cost sheet', 'renovation loan']

// Scenario / test files: quotes and what-ifs Arive keeps as loans.
export function isScenarioRow({ first, last, name, email, phone }) {
  const [local, domain] = norm(email).split('@')
  if (email && (PLACEHOLDER_LOCALS.has(local) || PLACEHOLDER_DOMAINS.has(domain))) return true
  const d = String(phone ?? '').replace(/\D/g, '')
  if (d.length >= 10 && /^(\d)\1+$/.test(d)) return true
  if (PLACEHOLDER_NAMES.has(norm(first)) || PLACEHOLDER_NAMES.has(norm(last))) return true
  const full = norm(name)
  return PLACEHOLDER_PHRASES.some((p) => full.includes(p))
}

export function rowToLoan(row, { loName }) {
  const get = (h) => row[h]
  const first = text(get('Primary Borrower First Name'))
  const last = text(get('Primary Borrower Last Name'))
  const name = text(get('Primary Borrower')) ?? ([first, last].filter(Boolean).join(' ') || null)
  const email = text(get('Primary Borrower Email'))
  const phone = phone10(get('Primary Borrower Cell Phone'))
  const officer = text(get('Primary Loan Officer Name'))
  const stage = text(get('Stage Name'))
  const term = num(get('Loan Term'))
  return {
    arive_loan_id: text(get('ARIVE Loan Id')),
    loan_officer: officer,
    role: norm(officer) === norm(loName) ? 'primary' : 'assisted',
    borrower_name: name,
    borrower_first: first,
    borrower_last: last,
    borrower_email: email,
    borrower_phone: phone,
    co_borrower_name: text(get('Co-Borrower')),
    co_borrower_email: text(get('Co-Borrower Email')),
    amount: num(get('Total Loan Amount')),
    purpose: text(get('Loan Purpose')),
    stage,
    stage_group: stageGroup(stage),
    property_address: text(get('Subject Property')),
    property_state: text(get('Subject State')),
    lender: text(get('Lender')),
    title_company: text(get('Title Company')),
    closed_on: parseUsDate(get('Docs Signed / Loan Closed')),
    funded_on: parseUsDate(get('Loan Funded')),
    firm_closing_on: parseUsDate(get('Firm Closing Date')),
    application_on: parseUsDate(get('Application Date')),
    rate: num(get('Note Rate')),
    loan_type: text(get('Loan Type')),
    term_months: term == null ? null : Math.round(term),
    buyer_agent_name: text(get('Buyer Agent')),
    buyer_agent_company: text(get('Buyer Agent Company Name')),
    buyer_agent_email: text(get('Buyer Agent Email')),
    buyer_agent_phone: phone10(get('Buyer Agent Phone')),
    seller_agent_name: text(get('Seller Agent')),
    seller_agent_company: text(get('Seller Agent Company Name')),
    seller_agent_email: text(get('Seller Agent Email')),
    seller_agent_phone: phone10(get('Seller Agent Phone')),
    scenario_auto: isScenarioRow({ first, last, name, email, phone: get('Primary Borrower Cell Phone') }),
    raw: row,
  }
}

// Bayway contacts: [{ id, name, email, phone }]. Email, then last-10 phone,
// then an exact full name held by exactly one contact.
export function matchContact(loan, contacts) {
  if (loan.scenario_auto) return null
  const email = norm(loan.borrower_email)
  if (email) {
    const hit = contacts.find((c) => norm(c.email) === email)
    if (hit) return hit.id
  }
  if (loan.borrower_phone) {
    const hit = contacts.find((c) => phone10(c.phone) === loan.borrower_phone)
    if (hit) return hit.id
  }
  const name = norm(loan.borrower_name)
  if (name) {
    const hits = contacts.filter((c) => norm(c.name) === name)
    if (hits.length === 1) return hits[0].id
  }
  return null
}

// Columns the import owns; a difference in any of them makes a row "updated".
export const IMPORT_FIELDS = [
  'loan_officer', 'role', 'borrower_name', 'borrower_first', 'borrower_last', 'borrower_email', 'borrower_phone',
  'co_borrower_name', 'co_borrower_email', 'contact_id', 'amount', 'purpose', 'stage', 'stage_group',
  'property_address', 'property_state', 'lender', 'title_company', 'closed_on', 'funded_on', 'firm_closing_on',
  'application_on', 'rate', 'loan_type', 'term_months', 'buyer_agent_name', 'buyer_agent_company',
  'buyer_agent_email', 'buyer_agent_phone', 'seller_agent_name', 'seller_agent_company', 'seller_agent_email',
  'seller_agent_phone', 'scenario_auto',
]

// Blank = null / undefined / ''. Numbers and booleans compare by value
// (PostgREST may hand numerics back as strings); everything else as text.
const same = (a, b) => {
  const blank = (v) => v == null || v === ''
  if (blank(a) || blank(b)) return blank(a) && blank(b)
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b)
  if (typeof a === 'boolean' || typeof b === 'boolean') return String(a) === String(b)
  return String(a) === String(b)
}

// existing: loans already stored ({ arive_loan_id, ...IMPORT_FIELDS }).
// Returns { error } or { loans, counts, unknownStages, missingIds }.
export function buildPreview({ header, rows, existing, contacts, loName }) {
  const missingHeaders = REQUIRED_HEADERS.filter((h) => !header.includes(h))
  if (missingHeaders.length) return { error: `This file is missing: ${missingHeaders.join(', ')}. Export the saved Arive report again.` }
  const byId = new Map(existing.map((l) => [String(l.arive_loan_id), l]))
  const loans = []
  const counts = { total: 0, new: 0, updated: 0, unchanged: 0, skipped: 0, scenario: 0, unmatched: 0, missing: 0 }
  const unknown = new Set()
  const seen = new Set()
  for (const row of rows) {
    const loan = rowToLoan(row, { loName })
    if (!loan.arive_loan_id || seen.has(loan.arive_loan_id)) { counts.skipped++; continue }
    seen.add(loan.arive_loan_id)
    loan.contact_id = matchContact(loan, contacts)
    loans.push(loan)
    if (loan.stage_group === 'other' && loan.stage) unknown.add(loan.stage)
    if (loan.scenario_auto) counts.scenario++
    else if (!loan.contact_id) counts.unmatched++
    const prev = byId.get(loan.arive_loan_id)
    if (!prev) counts.new++
    else if (IMPORT_FIELDS.every((f) => same(loan[f], prev[f]))) counts.unchanged++
    else counts.updated++
  }
  counts.total = loans.length
  const missingIds = existing.map((l) => String(l.arive_loan_id)).filter((id) => !seen.has(id))
  counts.missing = missingIds.length
  return { loans, counts, unknownStages: [...unknown], missingIds }
}
```

Note on the `100002` "unchanged" case in the test: the stored row is the same `rowToLoan` output with `contact_id` undefined, and the preview computes `contact_id: null`; `same(null, undefined)` is true, so it counts as unchanged.

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run src/lib/ariveImport.test.js`
Expected: all pass. If `buildPreview` counts differ, re-read the "Counts explained" note above before changing code.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ariveImport.js src/lib/ariveImport.test.js
git commit -m "feat: map Arive export rows to loans with an import preview"
```

---

### Task 4: Loan maths (`loans.js`)

**Files:**
- Create: `src/lib/loans.js`
- Test: `src/lib/loans.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_RATES, resolveRates, isScenario, isOpen, estComp, notInLatest, filterLoans,
  pipelineStatus, lenderSpread, fundedByMonth, loanStats, hasApplicationDates,
} from './loans'

const L = (o) => ({ role: 'primary', amount: 100000, stage: 'App Intake', stage_group: 'prospect', scenario_auto: false, scenario_override: null, comp_override: null, ...o })
const rates = resolveRates(null)

describe('rates and per-loan values', () => {
  it('fills defaults and ignores junk', () => {
    expect(DEFAULT_RATES).toEqual({ lo_name: 'Chandler Dean Atkinson', primary_pct: 1.25, assisted_pct: 0.75 })
    expect(resolveRates({ primary_pct: 1.5, calls: 100 })).toEqual({ ...DEFAULT_RATES, primary_pct: 1.5 })
  })
  it('estimates commission by role, with an override winning', () => {
    expect(estComp(L({ amount: 400000 }), rates)).toBe(5000)
    expect(estComp(L({ amount: 400000, role: 'assisted' }), rates)).toBe(3000)
    expect(estComp(L({ amount: 400000, comp_override: 4200 }), rates)).toBe(4200)
    expect(estComp(L({ amount: null }), rates)).toBeNull()
  })
  it('lets the manual scenario toggle beat the auto flag', () => {
    expect(isScenario(L({ scenario_auto: true }))).toBe(true)
    expect(isScenario(L({ scenario_auto: true, scenario_override: false }))).toBe(false)
    expect(isScenario(L({ scenario_override: true }))).toBe(true)
  })
  it('knows open loans and stale ones', () => {
    expect(isOpen(L({ stage_group: 'closing' }))).toBe(true)
    expect(isOpen(L({ stage_group: 'funded' }))).toBe(false)
    expect(notInLatest(L({ last_seen_at: '2026-10-01T00:00:00Z' }), '2026-10-30T00:00:00Z')).toBe(true)
    expect(notInLatest(L({ last_seen_at: '2026-10-30T00:00:00Z' }), '2026-10-30T00:00:00Z')).toBe(false)
    expect(notInLatest(L({ last_seen_at: '2026-10-01T00:00:00Z' }), null)).toBe(false)
  })
})

describe('filterLoans', () => {
  const loans = [L({ id: 1 }), L({ id: 2, role: 'assisted' }), L({ id: 3, scenario_auto: true })]
  it('hides scenarios unless asked and filters by role', () => {
    expect(filterLoans(loans, { role: 'all', scenarios: false }).map((l) => l.id)).toEqual([1, 2])
    expect(filterLoans(loans, { role: 'all', scenarios: true }).map((l) => l.id)).toEqual([1, 2, 3])
    expect(filterLoans(loans, { role: 'assisted', scenarios: false }).map((l) => l.id)).toEqual([2])
    expect(filterLoans(loans, { role: 'primary', scenarios: false }).map((l) => l.id)).toEqual([1])
  })
})

describe('panels', () => {
  const loans = [
    L({ stage: 'App Intake', amount: 200000 }),
    L({ stage: 'App Intake', amount: null }),
    L({ stage: 'Clear To Close', stage_group: 'closing', amount: 676000 }),
    L({ stage: 'Loan Finalized', stage_group: 'funded', amount: 253725, lender: 'UWM', purpose: 'Purchase', funded_on: '2026-10-05' }),
    L({ stage: 'Loan Funded', stage_group: 'funded', amount: 640200, lender: 'TLS', purpose: 'Purchase', funded_on: '2026-10-29' }),
    L({ stage: 'Loan Finalized', stage_group: 'funded', amount: 210308, lender: 'Cardinal Financial', purpose: 'Refinance', funded_on: '2026-09-09' }),
    L({ stage: 'Loan Funded', stage_group: 'funded', amount: 100000, lender: 'Newfi', purpose: 'Purchase', funded_on: '2026-08-01' }),
    L({ stage: 'Loan Funded', stage_group: 'funded', amount: 90000, lender: 'Newfi', purpose: 'Purchase', funded_on: '2025-12-01' }),
    L({ stage: 'Mystery', stage_group: 'other', amount: 5 }),
  ]

  it('pipelineStatus groups every stage in order, zeros included', () => {
    const groups = pipelineStatus(loans)
    expect(groups.map((g) => g.key)).toEqual(['prospect', 'processing', 'closing', 'funded', 'adverse', 'other'])
    expect(groups[0].rows[0]).toEqual({ stage: 'App Intake', count: 2, amount: 200000 })
    expect(groups[1].rows.every((r) => r.count === 0)).toBe(true)
    expect(groups[3].rows.find((r) => r.stage === 'Loan Funded')).toEqual({ stage: 'Loan Funded', count: 3, amount: 830200 })
    expect(groups[5].rows).toEqual([{ stage: 'Mystery', count: 1, amount: 5 }])
  })

  it('pipelineStatus drops the other group when empty', () => {
    expect(pipelineStatus([L({})]).map((g) => g.key)).not.toContain('other')
  })

  it('lenderSpread names the top three and folds the rest into Others', () => {
    const s = lenderSpread(loans, { from: '2026-01-01', to: '2027-01-01' })
    expect(s).toEqual({
      total: 4,
      rows: [
        { lender: 'Cardinal Financial', count: 1 },
        { lender: 'Newfi', count: 1 },
        { lender: 'TLS', count: 1 },
        { lender: 'Others', count: 1 },
      ],
    })
  })

  it('fundedByMonth counts a year by funded_on, split by purpose', () => {
    const f = fundedByMonth(loans, 2026)
    expect(f.count).toBe(4)
    expect(f.volume).toBe(1204233)
    expect(f.purchase).toEqual({ count: 3, volume: 993925 })
    expect(f.refinance).toEqual({ count: 1, volume: 210308 })
    expect(f.months[9]).toEqual({ month: 9, count: 2, volume: 893925 })
    expect(f.months).toHaveLength(12)
  })

  it('hasApplicationDates is false until any loan has one', () => {
    expect(hasApplicationDates(loans)).toBe(false)
    expect(hasApplicationDates([L({ application_on: '2026-02-01' })])).toBe(true)
  })
})

describe('loanStats', () => {
  const win = { month: { from: '2026-10-01', to: '2026-11-01' }, prev: { from: '2026-09-01', to: '2026-10-01' }, sprint: { from: '2026-08-01', to: '2026-11-01' } }
  it('returns null with no loans', () => {
    expect(loanStats([], rates, win)).toBeNull()
  })
  it('counts funded loans, volume, commission and open pipeline without scenarios', () => {
    const loans = [
      L({ stage_group: 'funded', funded_on: '2026-10-05', amount: 400000 }),
      L({ stage_group: 'funded', funded_on: '2026-10-20', amount: 200000, role: 'assisted' }),
      L({ stage_group: 'funded', funded_on: '2026-09-15', amount: 300000 }),
      L({ stage_group: 'closing', amount: 500000 }),
      L({ stage_group: 'adverse', amount: 999 }),
      L({ stage_group: 'prospect', amount: 700000, scenario_auto: true }),
    ]
    expect(loanStats(loans, rates, win)).toEqual({
      closed: 2, closedPrev: 1, volume: 600000, commission: 6500, pipeline: 500000, open: 1, sprintFunded: 3,
    })
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/loans.test.js`
Expected: FAIL, cannot resolve `./loans`.

- [ ] **Step 3: Implement**

```js
// Loan maths for the Loans page panels and the Reports / Overview metrics.
// Loans are rows of the `loans` table (see ariveImport.js). Pure.
import { STAGE_GROUPS } from './ariveImport'
import { inWindow } from './reports'

export const DEFAULT_RATES = { lo_name: 'Chandler Dean Atkinson', primary_pct: 1.25, assisted_pct: 0.75 }

// settings 'arive' value -> rates with defaults; unknown keys dropped.
export function resolveRates(saved) {
  const s = saved && typeof saved === 'object' ? saved : {}
  const out = { ...DEFAULT_RATES }
  if (typeof s.lo_name === 'string' && s.lo_name.trim()) out.lo_name = s.lo_name.trim()
  for (const k of ['primary_pct', 'assisted_pct']) if (Number.isFinite(Number(s[k])) && s[k] !== null && s[k] !== '') out[k] = Number(s[k])
  return out
}

export const isScenario = (l) => l.scenario_override ?? !!l.scenario_auto
export const isOpen = (l) => ['prospect', 'processing', 'closing'].includes(l.stage_group)
export const notInLatest = (l, lastImportAt) => !!lastImportAt && !!l.last_seen_at && l.last_seen_at < lastImportAt

export function estComp(l, rates) {
  if (l.comp_override != null) return Number(l.comp_override)
  if (l.amount == null) return null
  const pct = l.role === 'assisted' ? rates.assisted_pct : rates.primary_pct
  return Math.round(Number(l.amount) * pct) / 100
}

// role: 'all' | 'primary' | 'assisted'. scenarios: include scenario files.
export function filterLoans(loans, { role = 'all', scenarios = false } = {}) {
  return loans.filter((l) => (scenarios || !isScenario(l)) && (role === 'all' || l.role === role))
}

const sumAmount = (ls) => ls.reduce((s, l) => s + Number(l.amount || 0), 0)

// Every Arive stage in display order (zeros included), plus an "other" group
// for unknown stages when there are any.
export function pipelineStatus(loans) {
  const groups = STAGE_GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    rows: g.stages.map((stage) => {
      const ls = loans.filter((l) => l.stage_group === g.key && String(l.stage).toLowerCase() === stage.toLowerCase())
      return { stage, count: ls.length, amount: sumAmount(ls) }
    }),
  }))
  const other = loans.filter((l) => l.stage_group === 'other')
  if (other.length) {
    const names = [...new Set(other.map((l) => l.stage || 'Unknown'))].sort()
    groups.push({
      key: 'other',
      label: 'Other',
      rows: names.map((stage) => {
        const ls = other.filter((l) => (l.stage || 'Unknown') === stage)
        return { stage, count: ls.length, amount: sumAmount(ls) }
      }),
    })
  }
  return groups
}

const fundedIn = (loans, { from, to }) => loans.filter((l) => inWindow(l.funded_on, from, to))

// Funded loans per lender in [from, to): top three by count (ties by name),
// the rest as "Others".
export function lenderSpread(loans, win) {
  const funded = fundedIn(loans, win)
  const by = new Map()
  for (const l of funded) {
    const k = l.lender || 'Unknown'
    by.set(k, (by.get(k) || 0) + 1)
  }
  const sorted = [...by.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const rows = sorted.slice(0, 3).map(([lender, count]) => ({ lender, count }))
  const rest = sorted.slice(3).reduce((s, [, c]) => s + c, 0)
  if (rest) rows.push({ lender: 'Others', count: rest })
  return { total: funded.length, rows }
}

// Funded loans in a calendar year by funded_on: totals, purchase vs
// refinance, and twelve months (month is 0-based).
export function fundedByMonth(loans, year) {
  const funded = fundedIn(loans, { from: `${year}-01-01`, to: `${year + 1}-01-01` })
  const part = (ls) => ({ count: ls.length, volume: sumAmount(ls) })
  const isRefi = (l) => /refi/i.test(l.purpose || '')
  return {
    ...part(funded),
    purchase: part(funded.filter((l) => !isRefi(l))),
    refinance: part(funded.filter(isRefi)),
    months: Array.from({ length: 12 }, (_, month) => ({
      month,
      ...part(funded.filter((l) => Number(String(l.funded_on).slice(5, 7)) === month + 1)),
    })),
  }
}

export const hasApplicationDates = (loans) => loans.some((l) => l.application_on)

// Metrics for Reports / Overview. win: { month, prev, sprint } as { from, to }
// YYYY-MM-DD windows. Scenario files never count. null when nothing is imported.
export function loanStats(loans, rates, win) {
  if (!loans.length) return null
  const real = loans.filter((l) => !isScenario(l))
  const month = fundedIn(real, win.month)
  const open = real.filter(isOpen)
  return {
    closed: month.length,
    closedPrev: fundedIn(real, win.prev).length,
    volume: sumAmount(month),
    commission: month.reduce((s, l) => s + Number(estComp(l, rates) || 0), 0),
    pipeline: sumAmount(open),
    open: open.length,
    sprintFunded: fundedIn(real, win.sprint).length,
  }
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run src/lib/loans.test.js`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/loans.js src/lib/loans.test.js
git commit -m "feat: loan panel maths and metric stats"
```

---

### Task 5: Supabase reads and writes (`loansData.js`)

**Files:**
- Create: `src/lib/loansData.js`

No unit test of its own: it is thin glue over supabase-js and is exercised by the Loans render test (Task 9).

- [ ] **Step 1: Implement**

```js
// Supabase glue for loans. Reads return { data, error } like a bare query so
// pages can treat them the same way.
import { supabase } from './supabase'
import { fetchAllSettled } from './fetchAll'
import { resolveRates } from './loans'
import { IMPORT_FIELDS } from './ariveImport'

// { loans, rates, lastImport: { ran_at, records_upserted } | null }
export async function fetchLoanBundle() {
  const [loans, settings, last] = await Promise.all([
    fetchAllSettled(() => supabase.from('loans').select('*').order('id')),
    supabase.from('settings').select('value').eq('key', 'arive').maybeSingle(),
    supabase.from('sync_log').select('ran_at, records_upserted').eq('source', 'arive').eq('status', 'ok')
      .order('ran_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  const error = loans.error || settings.error || last.error
  if (error) return { data: null, error }
  return {
    data: { loans: loans.data || [], rates: resolveRates(settings.data?.value), lastImport: last.data || null },
    error: null,
  }
}

// Bayway contacts for matching, only needed while importing.
export function fetchBayContacts() {
  return fetchAllSettled(() => supabase.from('contacts').select('id, name, email, phone').eq('business_id', 'bay').order('id'))
}

// Upserts the preview's loans (import-owned columns only) and logs the import.
export async function saveImport(preview) {
  const now = new Date().toISOString()
  const payload = preview.loans.map((l) => ({
    arive_loan_id: l.arive_loan_id,
    ...Object.fromEntries(IMPORT_FIELDS.map((f) => [f, l[f] ?? null])),
    raw: l.raw,
    last_seen_at: now,
    updated_at: now,
  }))
  const { error } = await supabase.from('loans').upsert(payload, { onConflict: 'arive_loan_id' })
  const c = preview.counts
  const message = error
    ? error.message
    : `${c.new} new, ${c.updated} updated, ${c.unchanged} unchanged, ${c.scenario} scenario, ${c.unmatched} unmatched, ${c.missing} not in file`
  await supabase.from('sync_log').insert({
    source: 'arive', ran_at: now, records_upserted: error ? 0 : payload.length, status: error ? 'error' : 'ok', message,
  })
  return { error }
}

export function saveRates(rates) {
  return supabase.from('settings').upsert({ key: 'arive', value: rates }, { onConflict: 'key' })
}

// patch: { comp_override } and/or { scenario_override }.
export function saveLoanPatch(id, patch) {
  return supabase.from('loans').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
}
```

- [ ] **Step 2: Run the row-cap audit**

Run: `npx vitest run src/lib/rowCap.audit.test.js`
Expected: PASS (the loans and contacts reads are inside `fetchAllSettled` with `.order('id')`; the others use `.maybeSingle()`; the rest are writes).

- [ ] **Step 3: Commit**

```bash
git add src/lib/loansData.js
git commit -m "feat: loans Supabase reads and writes"
```

---

### Task 6: Reports reads Arive

**Files:**
- Modify: `src/lib/reports.js` (METRICS lines 31-33, 45-47, 70; `metricCardView`; `buildTabModel`)
- Modify: `src/lib/reports.test.js`
- Modify: `src/pages/Reports.jsx` (`MetricCard`, `computeValues`, `load`, `cards`, demo data)

- [ ] **Step 1: Write the failing tests** (append to `src/lib/reports.test.js`)

```js
describe('Arive-sourced metrics', () => {
  it('commission and sprint funded loans are live now', () => {
    const src = (k) => METRICS.find((m) => m.key === k).source
    expect(src('rev_gross_commission')).toBe('live')
    expect(src('bay_funded_loans')).toBe('live')
    expect(ARIVE_KEYS).toEqual(['loans_closed', 'loan_volume', 'pipeline_value', 'rev_closings', 'rev_loan_volume', 'rev_gross_commission', 'bay_funded_loans'])
  })

  it('cards carry an optional note', () => {
    const metric = METRICS.find((m) => m.key === 'loans_closed')
    expect(metricCardView(metric, 2, 5, 'Arive · imported Oct 30').note).toBe('Arive · imported Oct 30')
    expect(metricCardView(metric, 2, 5).note).toBeNull()
    expect(buildTabModel([metric], { loans_closed: null }, {}, { loans_closed: 'no Arive import yet' })[0])
      .toMatchObject({ valueText: '—', note: 'no Arive import yet' })
  })
})
```

Add `METRICS` and `ARIVE_KEYS` to the test file's import from `./reports` if they are not already imported.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/lib/reports.test.js`
Expected: FAIL (`ARIVE_KEYS` undefined; sources still `manual`).

- [ ] **Step 3: Implement in `src/lib/reports.js`**

Change the two METRICS entries' `source` from `'manual'` to `'live'`:

```js
  { key: 'rev_gross_commission',label: 'Gross commission (MTD)',tab: 'revenue', biz: 'bay', source: 'live',    unit: 'currency' },
```
```js
  { key: 'bay_funded_loans',              label: 'Funded loans',           tab: 'sprint', biz: 'bay', source: 'live', unit: 'count' },
```

Add after `METRICS`:

```js
// Metrics read from the Arive loans import (src/lib/loans.js loanStats).
export const ARIVE_KEYS = ['loans_closed', 'loan_volume', 'pipeline_value', 'rev_closings', 'rev_loan_volume', 'rev_gross_commission', 'bay_funded_loans']
```

Replace `metricCardView` and `buildTabModel`:

```js
// metric: a METRICS entry. value: number | null. target: number | undefined.
// note: an optional subline (where the number came from).
export function metricCardView(metric, value, target, note = null) {
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
    note,
  }
}

// metrics: METRICS subset. values: { [key]: number|null }. targets: { [key]: number }.
// notes: { [key]: string }.
export function buildTabModel(metrics, values, targets = {}, notes = {}) {
  return metrics.map((m) => metricCardView(m, values[m.key] ?? null, targets[m.key], notes[m.key] ?? null))
}
```

- [ ] **Step 4: Run to see them pass**

Run: `npx vitest run src/lib/reports.test.js`
Expected: all pass. If an older test asserted `toEqual` on a full `metricCardView` object, add `note: null` to its expected object.

- [ ] **Step 5: Wire `src/pages/Reports.jsx`**

Imports: add `ARIVE_KEYS` to the `../lib/reports` import list, and add

```js
import { fetchLoanBundle } from '../lib/loansData'
import { loanStats, DEFAULT_RATES } from '../lib/loans'
import { prevMonthWindow } from '../lib/overviewDash'
```

In `MetricCard`, under the label row `</div>` (before the progress bar `<div className="mt-3 h-1.5 …">`), add:

```jsx
      {card.note && <div className="mt-1 text-[11px] text-dim">{card.note}</div>}
```

In `load`, add `loanBundle` as the last entry of the destructured `Promise.all` array and `fetchLoanBundle()` as the last promise; include `loanBundle.error` in the `err` chain; and add to `setData({...})`:

```js
        loans: loanBundle.data?.loans || [],
        loanRates: loanBundle.data?.rates || DEFAULT_RATES,
        lastLoanImport: loanBundle.data?.lastImport || null,
```

In `demoReportsData()` return, add:

```js
    loans: [],
    loanRates: DEFAULT_RATES,
    lastLoanImport: null,
```

Above `computeValues`, add:

```js
// Arive numbers for the switched metrics; every key null before the first import.
function ariveValues(data) {
  const s = loanStats(data.loans, data.loanRates, { month: monthWindow(), prev: prevMonthWindow(), sprint: sprintWindow() })
  if (!s) return Object.fromEntries(ARIVE_KEYS.map((k) => [k, null]))
  return {
    loans_closed: s.closed, loan_volume: s.volume, pipeline_value: s.pipeline,
    rev_closings: s.closed, rev_loan_volume: s.volume, rev_gross_commission: s.commission,
    bay_funded_loans: s.sprintFunded,
  }
}

function ariveNotes(data) {
  const text = !data.loans.length
    ? 'no Arive import yet'
    : `Arive · imported ${new Date(data.lastLoanImport?.ran_at || Date.now()).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
  return Object.fromEntries(ARIVE_KEYS.map((k) => [k, text]))
}
```

In `computeValues`, replace the monthly branch with:

```js
  if (tab === 'monthly') {
    const manual = rollupMetrics(bizFilter(data.month))
    const win = monthWindow()
    const arive = ariveValues(data)
    // Board columns from the FUB stage tags (bay-stages.ts).
    const stageCounts = deriveStageCounts(data.activeRows, ['Application/Estimate Sent', 'Application Received', 'Disclosed'])
    const dbTotal =
      biz === 'all' ? data.bayContacts + data.mpgContacts
      : biz === 'bay' ? data.bayContacts
      : data.mpgContacts
    return {
      ...manual,
      // Disclosed files were pre-approved first (they sat in Application Received).
      pre_approvals: stageCounts['Application Received'] + stageCounts.Disclosed,
      applications: stageCounts['Application/Estimate Sent'],
      loans_closed: arive.loans_closed,
      loan_volume: arive.loan_volume,
      pipeline_value: arive.pipeline_value,
      db_total: dbTotal,
      calls_monthly: Number(manual.calls || 0) + callsSince(bizFilter(data.callRows), win.from),
    }
  }
```

The sprint branch becomes:

```js
  if (tab === 'sprint') {
    return { ...rollupMetrics(bizFilter(sprintRows(data.sprint))), bay_funded_loans: ariveValues(data).bay_funded_loans }
  }
```

The revenue branch becomes:

```js
  // revenue
  const manual = rollupMetrics(bizFilter(data.month))
  const arive = ariveValues(data)
  const commission = arive.rev_gross_commission
  const combined = Number(commission || 0) + Number(manual.rev_monthly_residual || 0)
  return {
    ...manual,
    rev_closings: arive.rev_closings,
    rev_loan_volume: arive.rev_loan_volume,
    rev_gross_commission: commission,
    rev_combined_income: combined,
    rev_avg_per_closing: safeDiv(commission, arive.rev_closings),
    rev_avg_residual: safeDiv(manual.rev_monthly_residual, manual.rev_active_merchants),
    rev_annualized: combined * 12,
  }
```

`data.deals` is now unused in Reports. Remove the `deals` fetch from `Promise.all` and its destructured name, `deals.error` from the `err` chain, `deals:` from `setData` and from `demoReportsData()`, and `sumWon`, `countWon`, `pipelineValue` from the `../lib/reports` import. Check with `grep -n "deals\|sumWon\|countWon\|pipelineValue(" src/pages/Reports.jsx`: nothing should remain except the `ariveValues` keys.

In `cards`:

```js
    return buildTabModel(metricsForTab(tab, biz), values, data.targets, ariveNotes(data))
```

- [ ] **Step 6: Run the suite**

Run: `npm test`
Expected: all pass (including `rowCap.audit.test.js`).

- [ ] **Step 7: Commit**

```bash
git add src/lib/reports.js src/lib/reports.test.js src/pages/Reports.jsx
git commit -m "feat: Reports loan metrics and commission come from the Arive import"
```

---

### Task 7: Overview reads Arive after the first import

**Files:**
- Modify: `src/lib/overviewDash.js` (`monthValues`, `kpiCards`, `sprintPace`)
- Modify: `src/lib/overviewDash.test.js`
- Modify: `src/pages/Overview.jsx` (loader + `buildView`)

- [ ] **Step 1: Write the failing tests** (append to `src/lib/overviewDash.test.js`)

```js
describe('Arive loan stats on Overview', () => {
  const loanStats = { closed: 3, closedPrev: 1, volume: 1104233, commission: 13800, pipeline: 900000, open: 4, sprintFunded: 5 }

  it('uses the loan stats instead of FUB deals and entered commission', () => {
    const v = monthValues({ biz: 'bay', metrics, deals, activities, pipeline, now: NOW, loanStats })
    expect(v).toMatchObject({ commission: 13800, loansClosed: 3, loansClosedPrev: 1, pipelineValue: 900000, openLoans: 4, commissionFromArive: true })
    const cards = kpiCards({ biz: 'bay', values: v, targets })
    expect(cards[0]).toMatchObject({ value: 13800, tag: 'Est. from Arive' })
  })

  it('falls back to the old sources without an import', () => {
    const v = monthValues({ biz: 'bay', metrics, deals, activities, pipeline, now: NOW, loanStats: null })
    expect(v).toMatchObject({ commission: 9800, commissionFromArive: false })
    expect(kpiCards({ biz: 'bay', values: v, targets })[0].tag).toBe('Entered')
  })

  it('sprint pace takes measured funded loans', () => {
    const s = sprintPace({ biz: 'bay', metrics: [], targets, now: NOW, measured: { bay_funded_loans: 5 } })
    expect(s.items.find((x) => x.key === 'bay_funded_loans').value).toBe(5)
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/lib/overviewDash.test.js`
Expected: FAIL (`commissionFromArive` undefined, tag still `Entered`, measured ignored).

- [ ] **Step 3: Implement in `src/lib/overviewDash.js`**

`monthValues` signature and the affected return keys:

```js
export function monthValues({ biz, metrics, deals = [], activities = [], pipeline = [], now = Date.now(), loanStats = null }) {
```

```js
  const arive = bay && loanStats ? loanStats : null
  return {
    commission: arive ? arive.commission : bay ? sumMetric(month, 'bay', 'rev_gross_commission') : 0,
    commissionFromArive: !!arive,
    residual: mpg ? sumMetric(month, 'mpg', 'rev_monthly_residual') : 0,
    loansClosed: arive ? arive.closed : bay ? countWon(deals, win) : 0,
    loansClosedPrev: arive ? arive.closedPrev : bay ? countWon(deals, prev) : 0,
```
(keep the other keys as they are, except:)
```js
    pipelineValue: arive ? arive.pipeline : bay ? pipelineValue(deals) : 0,
    openLoans: arive ? arive.open : bay ? deals.filter((d) => d.status === 'open').length : 0,
```

In `kpiCards`, the bay money card's tag:

```js
    ? { id: 'commission', label: 'Gross commission (MTD)', value: v.commission, unit: 'currency', goal: targets.rev_gross_commission, tag: v.commissionFromArive ? 'Est. from Arive' : 'Entered', icon: 'money', tone: 'bay' }
```

`sprintPace`:

```js
export function sprintPace({ biz, metrics, targets, now = Date.now(), measured = {} }) {
  const win = sprintWindow()
  const rows = sprintRows(metrics)
  const elapsed = sprintElapsed(win, now)
  const items = SPRINT_ITEMS.filter((s) => biz === 'all' || s.book === biz).map((s) => {
    const value = measured[s.key] ?? sumMetric(rows, s.book, s.key)
```
(rest unchanged).

- [ ] **Step 4: Run to see them pass**

Run: `npx vitest run src/lib/overviewDash.test.js`
Expected: all pass, old tests included.

- [ ] **Step 5: Wire `src/pages/Overview.jsx`**

Imports:

```js
import { fetchLoanBundle } from '../lib/loansData'
import { loanStats } from '../lib/loans'
import { monthWindow, sprintWindow } from '../lib/reports'
```
(merge `monthWindow` / `sprintWindow` into the existing `../lib/reports` import if there is one; `prevMonthWindow` is already exported from `../lib/overviewDash` — add it to that import.)

In the loader, inside `if (wantsBay) { … }` add:

```js
          q.loans = fetchLoanBundle()
```

In `setData({...})` add:

```js
          loanBundle: res.loans?.data || null,
```

In `buildView(biz, data)`, before `const values = monthValues(...)`:

```js
  const lb = data.loanBundle
  const stats = lb ? loanStats(lb.loans, lb.rates, { month: monthWindow(now), prev: prevMonthWindow(now), sprint: sprintWindow() }) : null
```

Pass `loanStats: stats` into `monthValues({...})`, and change the sprint line to:

```js
    sprint: sprintPace({ biz, metrics: data.metrics, targets: data.targets, now, measured: stats ? { bay_funded_loans: stats.sprintFunded } : {} }),
```

(`now` must be in scope in `buildView`; check how `monthValues` gets `now` there and use the same variable.)

- [ ] **Step 6: Run the suite**

Run: `npm test`
Expected: all pass, including `Overview.render.test.jsx` (its fake `loans` table is empty, so Overview keeps the old sources).

- [ ] **Step 7: Commit**

```bash
git add src/lib/overviewDash.js src/lib/overviewDash.test.js src/pages/Overview.jsx
git commit -m "feat: Overview loan cards switch to Arive after the first import"
```

---

### Task 8: Import dialog

**Files:**
- Create: `src/components/LoanImport.jsx`

- [ ] **Step 1: Implement**

```jsx
// Arive CSV import: pick the export, read the preview, confirm. Parsing and
// the preview are pure (lib/csv.js, lib/ariveImport.js); saving is
// lib/loansData.js.
import { useState } from 'react'
import { parseCsv } from '../lib/csv'
import { buildPreview } from '../lib/ariveImport'
import { fetchBayContacts, saveImport } from '../lib/loansData'

const LINES = [
  ['new', 'new loans'],
  ['updated', 'updated'],
  ['unchanged', 'unchanged'],
  ['scenario', 'scenario files (hidden by default)'],
  ['unmatched', 'not matched to a contact'],
  ['missing', 'in the OS but not in this file (kept)'],
  ['skipped', 'rows skipped (no loan ID or repeated)'],
]

export default function LoanImport({ existing, rates, onClose, onImported }) {
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function pick(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    setPreview(null)
    setBusy(true)
    try {
      const { header, rows } = parseCsv(await file.text())
      const contacts = await fetchBayContacts()
      if (contacts.error) throw contacts.error
      const p = buildPreview({ header, rows, existing, contacts: contacts.data || [], loName: rates.lo_name })
      if (p.error) setError(p.error)
      else setPreview(p)
    } catch (err) {
      setError(String(err?.message || err))
    } finally {
      setBusy(false)
    }
  }

  async function confirm() {
    setBusy(true)
    const { error: err } = await saveImport(preview)
    setBusy(false)
    if (err) { setError(err.message); return }
    onImported()
  }

  return (
    <div role="dialog" aria-label="Import Arive loans" className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-[460px] rounded-card border border-line bg-panel p-5">
        <div className="text-[15px] font-semibold">Import Arive loans</div>
        <p className="mt-1 text-[12.5px] text-muted">Export the saved “OS – Loan Export” Pipeline Report from Arive as CSV and pick it here.</p>
        <input type="file" accept=".csv,text/csv" onChange={pick} disabled={busy} className="mt-3 block w-full text-[13px]" />
        {busy && <div className="mt-3 text-[12.5px] text-muted">Working…</div>}
        {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
        {preview && (
          <div className="mt-4 text-[13px]">
            <div className="font-semibold">{preview.counts.total} loans in this file</div>
            <ul className="mt-2 space-y-0.5">
              {LINES.filter(([k]) => preview.counts[k] > 0).map(([k, label]) => (
                <li key={k}><span className="num font-semibold">{preview.counts[k]}</span> {label}</li>
              ))}
            </ul>
            {preview.unknownStages.length > 0 && (
              <div className="mt-2 text-[12px] text-[color:var(--bay-gold)]">Unknown stages (imported as Other): {preview.unknownStages.join(', ')}</div>
            )}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-[32px] rounded-[9px] border border-line2 px-3 text-[13px] font-semibold">Cancel</button>
          <button
            type="button"
            onClick={confirm}
            disabled={!preview || busy}
            className="min-h-[32px] rounded-[9px] bg-[color:var(--text)] px-3 text-[13px] font-semibold text-white disabled:opacity-40"
          >
            Import {preview ? preview.counts.total : ''} loans
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/LoanImport.jsx
git commit -m "feat: Arive import dialog with preview"
```

(Covered by the page render test in Task 9.)

---

### Task 9: Loans page, route and sidebar link

**Files:**
- Create: `src/pages/Loans.jsx`
- Test: `src/pages/Loans.render.test.jsx`
- Modify: `src/App.jsx` (import + route next to `/bayway/pipeline`)
- Modify: `src/components/Sidebar.jsx` (Books group)

- [ ] **Step 1: Write the failing render test**

```jsx
// @vitest-environment jsdom
// Loans page against a fake Supabase: panels, filters, the scenario toggle,
// and the import dialog's preview. Same createRoot + act style as the other
// render tests.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import React from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const loan = (o) => ({
  id: o.arive_loan_id, role: 'primary', loan_officer: 'Chandler Dean Atkinson', stage: 'App Intake', stage_group: 'prospect',
  amount: 100000, purpose: 'Purchase', lender: null, funded_on: null, firm_closing_on: null, contact_id: null,
  scenario_auto: false, scenario_override: null, comp_override: null, last_seen_at: '2026-10-30T12:00:00Z', ...o,
})
const DATA = {
  loans: [
    loan({ arive_loan_id: '1', borrower_name: 'Gina Park', stage: 'Loan Funded', stage_group: 'funded', amount: 400000, lender: 'UWM', funded_on: '2026-10-03' }),
    loan({ arive_loan_id: '2', borrower_name: 'Omar Vale', role: 'assisted', loan_officer: 'Ronnie Gaydos', amount: 200000 }),
    loan({ arive_loan_id: '3', borrower_name: 'Test Test', scenario_auto: true, amount: 633750 }),
  ],
  updates: [],
}

function query(table) {
  const q = {}
  for (const m of ['select', 'eq', 'gte', 'lt', 'in', 'order', 'limit', 'range', 'or']) q[m] = () => q
  q.maybeSingle = () => ({
    then: (r) => r({
      data: table === 'settings' ? { value: { lo_name: 'Chandler Dean Atkinson', primary_pct: 1.25, assisted_pct: 0.75 } }
        : table === 'sync_log' ? { ran_at: '2026-10-30T12:00:00Z', records_upserted: 3 } : null,
      error: null,
    }),
  })
  q.update = (patch) => { DATA.updates.push(patch); return { eq: () => Promise.resolve({ error: null }) } }
  q.then = (resolve) => resolve({ data: table === 'loans' ? DATA.loans : [], error: null })
  return q
}

vi.mock('../lib/supabase', () => ({ isDemoMode: false, supabase: { from: (t) => query(t) } }))

beforeEach(() => {
  document.body.innerHTML = ''
  DATA.updates = []
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
})

const { default: Loans } = await import('./Loans')

async function render() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    createRoot(host).render(React.createElement(MemoryRouter, null, React.createElement(Loans)))
  })
  await act(async () => {})
  return host
}

describe('Loans page', () => {
  it('shows the three panels and hides scenario files by default', async () => {
    const host = await render()
    const text = host.textContent
    expect(text).toContain('Pipeline Status')
    expect(text).toContain('Lender Spread')
    expect(text).toContain('Loans Funded')
    expect(text).toContain('Gina Park')
    expect(text).toContain('Omar Vale')
    expect(text).not.toContain('Test Test')
    expect(text).toContain('$5,000') // 1.25% of 400,000
    expect(text).toContain('$1,500') // 0.75% of 200,000
  })

  it('shows scenario files when asked and filters by role', async () => {
    const host = await render()
    const box = host.querySelector('input[name="scenarios"]')
    await act(async () => box.click())
    expect(host.textContent).toContain('Test Test')
    const assisted = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Assisted')
    await act(async () => assisted.click())
    expect(host.textContent).not.toContain('Gina Park')
    expect(host.textContent).toContain('Omar Vale')
  })

  it('saves a scenario toggle on a loan', async () => {
    const host = await render()
    const toggle = host.querySelector('[data-loan="2"] input[name="scenario"]')
    await act(async () => toggle.click())
    expect(DATA.updates[0]).toMatchObject({ scenario_override: true })
  })

  it('opens the import dialog', async () => {
    const host = await render()
    const btn = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Import CSV')
    await act(async () => btn.click())
    expect(host.querySelector('[role="dialog"]').textContent).toContain('Import Arive loans')
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/pages/Loans.render.test.jsx`
Expected: FAIL, cannot resolve `./Loans`.

- [ ] **Step 3: Implement `src/pages/Loans.jsx`**

```jsx
// Bayway › Loans: the Arive pipeline, imported from a CSV export
// (docs/superpowers/specs/2026-10-30-arive-loans-import-design.md).
// Panels mirror Arive's dashboard; maths in lib/loans.js.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { isDemoMode } from '../lib/supabase'
import { fetchLoanBundle, saveLoanPatch, saveRates } from '../lib/loansData'
import {
  DEFAULT_RATES, filterLoans, pipelineStatus, lenderSpread, fundedByMonth, estComp, isScenario, isOpen, notInLatest, hasApplicationDates,
} from '../lib/loans'
import { pageSlice } from '../lib/paging'
import { fmtMoney } from '../lib/overviewDash'
import PageHeader from '../components/PageHeader'
import Pager from '../components/Pager'
import PersonLink from '../components/PersonLink'
import LoanImport from '../components/LoanImport'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const ROLES = [['all', 'All'], ['primary', 'Mine'], ['assisted', 'Assisted']]
const money = (n) => (n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US'))
const shortDate = (k) => (k ? new Date(`${String(k).slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—')

function demoBundle() {
  const y = new Date().getFullYear()
  const L = (o) => ({ role: 'primary', stage_group: 'prospect', purpose: 'Purchase', scenario_auto: false, scenario_override: null, comp_override: null, last_seen_at: null, ...o })
  return {
    rates: DEFAULT_RATES,
    lastImport: null,
    loans: [
      L({ id: 'd1', arive_loan_id: 'd1', borrower_name: 'Sample Borrower', stage: 'Pre-Approved', amount: 420000 }),
      L({ id: 'd2', arive_loan_id: 'd2', borrower_name: 'Demo Refi', stage: 'Clear To Close', stage_group: 'closing', amount: 310000, purpose: 'Refinance', lender: 'UWM', firm_closing_on: `${y}-12-05` }),
      L({ id: 'd3', arive_loan_id: 'd3', borrower_name: 'Example Funded', stage: 'Loan Finalized', stage_group: 'funded', amount: 280000, lender: 'Newfi', funded_on: `${y}-03-14` }),
    ],
  }
}

function Panel({ title, right, children }) {
  return (
    <section className="rounded-card border border-line bg-panel p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[14px] font-semibold">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  )
}

function PipelineStatus({ loans, showPeriod }) {
  const groups = pipelineStatus(loans)
  const max = Math.max(1, ...groups.flatMap((g) => g.rows.map((r) => r.count)))
  return (
    <Panel title="Pipeline Status" right={<span className="text-[12px] text-muted">{showPeriod}</span>}>
      {groups.map((g) => (
        <div key={g.key} className="mb-3">
          <div className="mb-1 text-[12.5px] font-semibold">{g.label}</div>
          {g.rows.map((r) => (
            <div key={r.stage} className="grid grid-cols-[minmax(0,1fr)_32px_64px_minmax(0,1.2fr)] items-center gap-2 text-[12.5px]">
              <span className="truncate text-muted">{r.stage}</span>
              <span className="num text-right">{r.count}</span>
              <span className="num text-right text-muted">{fmtMoney(r.amount)}</span>
              <span className="h-2 rounded-sm" style={{ width: `${(r.count / max) * 100}%`, background: r.count ? 'var(--bay)' : 'transparent' }} />
            </div>
          ))}
        </div>
      ))}
    </Panel>
  )
}

function LenderSpread({ loans, year }) {
  const s = lenderSpread(loans, { from: `${year}-01-01`, to: `${year + 1}-01-01` })
  return (
    <Panel title="Lender Spread" right={<span className="text-[12px] text-muted">Funded · {year}</span>}>
      {s.total === 0 ? (
        <p className="text-[12.5px] text-muted">No funded loans in {year}.</p>
      ) : (
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {s.rows.map((r) => (
            <div key={r.lender}>
              <div className="text-[11.5px] uppercase tracking-wide text-muted">{r.lender}</div>
              <div className="num text-[24px] font-light">{r.count}</div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}

function LoansFunded({ loans, year }) {
  const f = fundedByMonth(loans, year)
  const max = Math.max(1, ...f.months.map((m) => m.volume))
  return (
    <Panel title={`${f.count} Loans Funded`} right={<span className="text-[12px] text-muted">{year}</span>}>
      <div className="num text-[30px] font-light">{fmtMoney(f.volume)}</div>
      <div className="mt-2 flex gap-6 text-[12.5px]">
        <div><b className="num">{f.purchase.count}</b> Purchase <span className="text-muted">{money(f.purchase.volume)}</span></div>
        <div><b className="num">{f.refinance.count}</b> Refinance <span className="text-muted">{money(f.refinance.volume)}</span></div>
      </div>
      <div className="mt-4 flex h-[110px] items-end gap-1">
        {f.months.map((m) => (
          <div key={m.month} className="flex flex-1 flex-col items-center gap-1" title={`${MONTHS[m.month]}: ${m.count} · ${money(m.volume)}`}>
            <div className="w-full rounded-t-sm" style={{ height: `${(m.volume / max) * 90}px`, background: m.volume ? 'var(--bay)' : 'transparent' }} />
            <span className="text-[10px] text-muted">{MONTHS[m.month]}</span>
          </div>
        ))}
      </div>
    </Panel>
  )
}

function CompCell({ loan, rates, onSave }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const value = estComp(loan, rates)
  if (!editing) {
    return (
      <button type="button" className="num underline decoration-dotted" title="Click to set this loan's commission" onClick={() => { setDraft(loan.comp_override ?? ''); setEditing(true) }}>
        {money(value)}{loan.comp_override != null ? ' *' : ''}
      </button>
    )
  }
  const commit = () => {
    setEditing(false)
    const v = String(draft).trim()
    onSave(v === '' ? null : Number(v.replace(/[$,]/g, '')))
  }
  return (
    <input
      autoFocus
      className="num w-[90px] rounded border border-line2 px-1 text-right"
      value={draft}
      placeholder="auto"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
    />
  )
}

function RatesEditor({ rates, onSave, onClose }) {
  const [d, setD] = useState(rates)
  const field = (k, label) => (
    <label className="block text-[12px] text-muted">
      {label}
      <input className="mt-1 block w-full rounded border border-line2 px-2 py-1 text-[13px] text-[color:var(--text)]" value={d[k]} onChange={(e) => setD({ ...d, [k]: e.target.value })} />
    </label>
  )
  return (
    <div role="dialog" aria-label="Commission rates" className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-[360px] space-y-3 rounded-card border border-line bg-panel p-5">
        <div className="text-[15px] font-semibold">Commission rates</div>
        {field('lo_name', 'Your name as loan officer in Arive')}
        {field('primary_pct', 'Your loans: % of loan amount')}
        {field('assisted_pct', 'Assisted loans: % of loan amount')}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-[32px] rounded-[9px] border border-line2 px-3 text-[13px] font-semibold">Cancel</button>
          <button type="button" onClick={() => onSave({ lo_name: d.lo_name, primary_pct: Number(d.primary_pct), assisted_pct: Number(d.assisted_pct) })} className="min-h-[32px] rounded-[9px] bg-[color:var(--text)] px-3 text-[13px] font-semibold text-white">Save</button>
        </div>
      </div>
    </div>
  )
}

// Open loans first by firm closing date, then funded newest first, then the rest.
function sortLoans(loans) {
  const rank = (l) => (isOpen(l) ? 0 : l.funded_on ? 1 : 2)
  return [...loans].sort((a, b) =>
    rank(a) - rank(b) ||
    (rank(a) === 0 ? String(a.firm_closing_on || '9999').localeCompare(String(b.firm_closing_on || '9999')) : 0) ||
    (rank(a) === 1 ? String(b.funded_on).localeCompare(String(a.funded_on)) : 0) ||
    String(a.borrower_name || '').localeCompare(String(b.borrower_name || '')))
}

export default function Loans() {
  const [bundle, setBundle] = useState(() => (isDemoMode ? demoBundle() : null))
  const [error, setError] = useState(null)
  const [role, setRole] = useState('all')
  const [scenarios, setScenarios] = useState(false)
  const [page, setPage] = useState(1)
  const [importing, setImporting] = useState(false)
  const [editingRates, setEditingRates] = useState(false)
  const year = new Date().getFullYear()

  const load = useCallback(async () => {
    if (isDemoMode) return
    const { data, error: err } = await fetchLoanBundle()
    if (err) setError(err.message)
    else setBundle(data)
  }, [])
  useEffect(() => { load() }, [load])

  const shown = useMemo(() => (bundle ? sortLoans(filterLoans(bundle.loans, { role, scenarios })) : []), [bundle, role, scenarios])
  const slice = pageSlice(shown, page)

  async function patch(loan, p) {
    setBundle((b) => ({ ...b, loans: b.loans.map((l) => (l.id === loan.id ? { ...l, ...p } : l)) }))
    if (isDemoMode) return
    const { error: err } = await saveLoanPatch(loan.id, p)
    if (err) setError(err.message)
  }

  async function storeRates(r) {
    setEditingRates(false)
    setBundle((b) => ({ ...b, rates: r }))
    if (isDemoMode) return
    const { error: err } = await saveRates(r)
    if (err) setError(err.message)
  }

  const lastImportAt = bundle?.lastImport?.ran_at || null
  const btn = 'min-h-[32px] rounded-[9px] border border-line2 bg-panel px-3 text-[13px] font-semibold'

  return (
    <div>
      <PageHeader
        eyebrow="Bayway"
        eyebrowColor="var(--bay-ink)"
        title="Loans"
        note={bundle && (
          <span className="num text-[12px] text-muted">
            {lastImportAt ? `Last import ${shortDate(lastImportAt)} · ${bundle.loans.length} loans` : 'No Arive import yet'}
          </span>
        )}
        subtitle="Your Arive pipeline, from the saved Pipeline Report export. Re-import any time; loans update by Arive loan ID and nothing is deleted."
        actions={
          <div className="flex gap-2">
            <button type="button" className={btn} onClick={() => setEditingRates(true)} disabled={!bundle}>Rates</button>
            <button type="button" className={btn} onClick={() => setImporting(true)} disabled={!bundle || isDemoMode}>Import CSV</button>
          </div>
        }
      />

      {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      {isDemoMode && <div className="mt-4 rounded-lg border border-line bg-panel px-3 py-2 text-xs text-muted">Demo mode — sample loans. Connect Supabase to import.</div>}
      {!bundle && !error && <div className="mt-6 text-sm text-muted">Loading loans…</div>}

      {bundle && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-[13px]">
            <div className="flex gap-1">
              {ROLES.map(([k, label]) => (
                <button key={k} type="button" aria-pressed={role === k} onClick={() => { setRole(k); setPage(1) }}
                  className={`min-h-[30px] rounded-full border px-3 ${role === k ? 'border-[color:var(--text)] font-semibold' : 'border-line2 text-muted'}`}>
                  {label}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1.5 text-muted">
              <input type="checkbox" name="scenarios" checked={scenarios} onChange={(e) => { setScenarios(e.target.checked); setPage(1) }} />
              Include scenario files
            </label>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3.5 lg:grid-cols-2">
            <PipelineStatus loans={filterLoans(bundle.loans, { role, scenarios })} showPeriod={hasApplicationDates(bundle.loans) ? 'Now' : 'Now · add Application Date for YTD'} />
            <div className="grid gap-3.5">
              <LenderSpread loans={filterLoans(bundle.loans, { role, scenarios })} year={year} />
              <LoansFunded loans={filterLoans(bundle.loans, { role, scenarios })} year={year} />
            </div>
          </div>

          <section className="mt-4 overflow-x-auto rounded-card border border-line bg-panel">
            <table className="w-full min-w-[760px] text-left text-[13px]">
              <thead className="text-[11.5px] uppercase tracking-wide text-muted">
                <tr>
                  {['Borrower', 'Stage', 'Amount', 'Lender', 'Role', 'Closing / funded', 'Est. comp', 'Scenario'].map((h) => (
                    <th key={h} className="px-3 py-2 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {slice.rows.map((l) => (
                  <tr key={l.id} data-loan={l.arive_loan_id} className="border-t border-line">
                    <td className="px-3 py-2">
                      {l.contact_id ? <PersonLink id={l.contact_id}>{l.borrower_name}</PersonLink> : l.borrower_name}
                      {notInLatest(l, lastImportAt) && <span className="ml-2 rounded px-1 text-[10px] font-semibold text-dim" style={{ background: 'var(--hover)' }}>NOT IN LATEST EXPORT</span>}
                    </td>
                    <td className="px-3 py-2">{l.stage}</td>
                    <td className="num px-3 py-2">{money(l.amount)}</td>
                    <td className="px-3 py-2">{l.lender || '—'}</td>
                    <td className="px-3 py-2">{l.role === 'assisted' ? `Assisted (${l.loan_officer})` : 'Mine'}</td>
                    <td className="px-3 py-2">{l.funded_on ? `Funded ${shortDate(l.funded_on)}` : shortDate(l.firm_closing_on)}</td>
                    <td className="px-3 py-2"><CompCell loan={l} rates={bundle.rates} onSave={(v) => patch(l, { comp_override: v })} /></td>
                    <td className="px-3 py-2">
                      <input type="checkbox" name="scenario" checked={isScenario(l)} onChange={(e) => patch(l, { scenario_override: e.target.checked })} />
                    </td>
                  </tr>
                ))}
                {slice.rows.length === 0 && (
                  <tr><td colSpan={8} className="px-3 py-6 text-center text-muted">No loans. Import the Arive export to get started.</td></tr>
                )}
              </tbody>
            </table>
          </section>
          <Pager slice={slice} total={shown.length} onPage={setPage} label="Loan pages" className="mt-3" />
        </>
      )}

      {importing && bundle && (
        <LoanImport
          existing={bundle.loans}
          rates={bundle.rates}
          onClose={() => setImporting(false)}
          onImported={async () => { setImporting(false); await load() }}
        />
      )}
      {editingRates && bundle && <RatesEditor rates={bundle.rates} onSave={storeRates} onClose={() => setEditingRates(false)} />}
    </div>
  )
}
```

- [ ] **Step 4: Route and sidebar**

`src/App.jsx`: add `import Loans from './pages/Loans'` with the other page imports, and next to the `/bayway/pipeline` route:

```jsx
              <Route path="/bayway/loans" element={<Loans />} />
```

`src/components/Sidebar.jsx`, Books group, after the Pipeline item:

```js
    { to: '/bayway/loans', icon: 'money', label: 'Loans', on: /^\/bayway\/loans/ },
```

Update the comment above `LINKS` from "Nine links" to "Ten links" and add "Loans is Bayway only."

`src/components/Sidebar.render.test.jsx` asserts the link list exactly. Rename the test to `'lists ten links in four groups'`, change "nine links" to "ten links" in its header comment, and set the expectation to:

```js
    expect(links).toEqual(['Overview', 'Workbench', 'Calendar', 'Tasks', 'Pipeline', 'Loans', 'Contacts', 'Activity', 'Reports', 'Settings'])
```

- [ ] **Step 5: Run the render test and the suite**

Run: `npx vitest run src/pages/Loans.render.test.jsx`
Expected: 4 passed.

Run: `npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Loans.jsx src/pages/Loans.render.test.jsx src/App.jsx src/components/Sidebar.jsx src/components/Sidebar.render.test.jsx
git commit -m "feat: Bayway Loans page with Arive panels, filters and import"
```

---

### Task 10: Reconcile against the real export, build, apply, ship

**Files:** none committed (the check script lives in the scratchpad).

- [ ] **Step 1: Reconciliation check against the real file** (never copied into the repo)

`src/lib/*.js` imports without file extensions, so plain `node` cannot load it. Use a throwaway Vitest file that is deleted afterwards and never committed. Create `src/lib/reconcile.local.test.js`:

```js
// Throwaway: checks the import against the real Arive export. Delete after use.
import { readFileSync } from 'node:fs'
import { it } from 'vitest'
import { parseCsv } from './csv'
import { buildPreview } from './ariveImport'
import { pipelineStatus, fundedByMonth } from './loans'

it.skipIf(!process.env.ARIVE_CSV)('reconciles with the Arive dashboard', () => {
  const { header, rows } = parseCsv(readFileSync(process.env.ARIVE_CSV, 'utf8'))
  const p = buildPreview({ header, rows, existing: [], contacts: [], loName: 'Chandler Dean Atkinson' })
  console.log(p.counts, p.unknownStages)
  console.log(p.loans.filter((l) => l.scenario_auto).map((l) => l.borrower_name))
  for (const g of pipelineStatus(p.loans)) for (const r of g.rows) if (r.count) console.log(r.stage, r.count, r.amount)
  const f = fundedByMonth(p.loans, 2026)
  console.log('funded', f.count, f.volume, f.purchase, f.refinance)
})
```

Run (Git Bash):

```bash
ARIVE_CSV="C:/Users/Chandler/Downloads/Pipeline - 2026-10-30T18_58_27.873Z.csv" npx vitest run src/lib/reconcile.local.test.js
```

Expected (scenario files included): Pre-Approved 7 / 2780827, Qualification 2 / 1277000, Approved w/ Conditions 1 / 242100, Clear To Close 1 / 676000, Loan Finalized 2 / 464033, Loan Funded 1 / 640200; funded 3 / 1104233, purchase 3, refinance 0; `unknownStages` `[]`. Read the scenario name list: if a real borrower is flagged, tighten the Task 3 rules (with a test) before going on.

Then delete it:

```bash
rm src/lib/reconcile.local.test.js
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: success, no errors.

- [ ] **Step 3: Preview in the browser**

Start the dev server with the preview tool (Vite, `npm run dev`), open `/bayway/loans`, confirm the three panels and table render (demo mode or live), check the console for errors, and screenshot. Check Reports › Monthly / Revenue / Sprint show the Arive notes, and the Sidebar shows Loans.

- [ ] **Step 4: Apply the migration** — needs the user's go-ahead (writes to the live database)

Apply `supabase/migrations/0052_loans.sql` the way earlier migrations were applied (Supabase SQL editor or `supabase db push`). Then import the real CSV on the live Loans page and compare against the reconciliation numbers.

- [ ] **Step 5: Push and open a PR** — needs the user's go-ahead

```bash
git push -u origin feat/arive-loans
gh pr create --title "feat: Arive loans import and Bayway Loans page" --body "<summary + test results>"
```

PR body ends with the Claude Code attribution line.
```
