# Reference Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/reference` page for Chandler and Shelby with four calculators (bank statement income, loan payment, DSCR, TRID dates), a lender AE directory and quick links with an address lookup.

**Architecture:** Calculators are pure functions in `src/lib/calc/` rendered by small React components; nothing is saved. Lenders and links live in two new tables (migration 0058) that the owner and the assistant can read and write, nobody else. One page with tabs kept in the URL; the Person sheet's Loan tab links into it with the lead's address.

**Tech Stack:** React 18 + Vite + react-router, Supabase (Postgres RLS), Vitest (node + jsdom render tests).

**Spec:** `docs/superpowers/specs/2026-11-05-reference-section-design.md`

**Ground rules (repo):**
- Worktree `.claude/worktrees/reference-section`, branch `feat/reference-section`. Commit as the configured git user, no author overrides. Every commit message ends with the `Co-Authored-By` line the session gives.
- Nothing touches production (migration, merge) without Chandler's OK in chat. Pushing also needs his OK.
- Supabase reads in `src/` carry a `.limit()` (the row-cap audit test fails otherwise).

---

## File structure

| File | Responsibility |
|---|---|
| Create `supabase/migrations/0058_reference.sql` | Two tables, RLS, stamp trigger, link seed |
| Create `supabase/tests/reference.sql` | Rolled-back access checks |
| Create `src/lib/calc/parse.js` (+test) | `parseAmount`, `money`, `pct` |
| Create `src/lib/calc/loanPayment.js` (+test) | Payment math, `monthlyPI`, `loanFromPI` |
| Create `src/lib/calc/dscr.js` (+test) | Ratio and largest loan |
| Create `src/lib/calc/bankStatement.js` (+test) | Month labels, qualifying income, trend, large months, summary |
| Create `src/lib/calc/trid.js` (+test) | Federal holidays, business days, TRID dates |
| Create `src/lib/referenceLinks.js` (+test) | Lookup URLs, lead address, URL check, link grouping |
| Create `src/lib/useReferenceLenders.js`, `src/lib/useReferenceLinks.js` | Table reads and writes |
| Create `src/components/reference/Field.jsx` | Labeled text input used by every calculator |
| Create `src/components/reference/BankStatementCalc.jsx`, `LoanCalc.jsx`, `TridCalc.jsx`, `LendersTab.jsx`, `LinksTab.jsx` | The tabs |
| Create `src/pages/Reference.jsx` (+ render test) | Tabs and URL state |
| Modify `src/lib/roles.js` (+test), `src/components/Icon.jsx`, `src/components/Sidebar.jsx`, `src/App.jsx` | Route, nav, assistant access |
| Modify `src/lib/useContactCard.js`, `src/components/PersonSheet.jsx` (+test) | "Look up property" on the Loan tab |

---

### Task 1: Database (migration 0058 and its test)

**Files:**
- Create: `supabase/tests/reference.sql`
- Create: `supabase/migrations/0058_reference.sql`

- [ ] **Step 1: Write the database test**

```sql
-- Reference section access (spec 2026-11-05-reference-section-design.md).
-- Runs as postgres, impersonates the owner, a fake assistant and a login with
-- no role, and ROLLS BACK. Run: npx supabase db query --linked -f supabase/tests/reference.sql
begin;

insert into public.user_roles (user_id, role, books, name)
values ('00000000-0000-4000-8000-0000000000a3', 'assistant', array['bay'], 'Ref Assistant');

set local role authenticated;

-- Owner.
select set_config('request.jwt.claims', '{"sub":"2cbf8825-be9d-429a-a4ed-3c3915d09c1d","role":"authenticated"}', true);
do $$
declare n int; who text;
begin
  insert into public.reference_lenders (lender, ae_name, comp_notes) values ('Ref Test Lender', 'Ann AE', '1.25%');
  select updated_by_name into who from public.reference_lenders where lender = 'Ref Test Lender';
  if who is distinct from 'Chandler Atkinson' then raise exception 'FAIL: stamp gave %', who; end if;
  select count(*) into n from public.reference_links;
  if n < 10 then raise exception 'FAIL: owner sees % seeded links', n; end if;
  begin
    insert into public.reference_links (title, url, grp) values ('Bad', 'ftp://x', 'Test');
    raise exception 'FAIL: non-http link accepted';
  exception when check_violation then null;
  end;
  raise notice 'owner reference: all checks passed';
end $$;

-- Assistant: full read and write, comp included.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
do $$
declare n int; who text;
begin
  select count(*) into n from public.reference_lenders where lender = 'Ref Test Lender' and comp_notes = '1.25%';
  if n <> 1 then raise exception 'FAIL: assistant cannot read the lender and its comp'; end if;
  update public.reference_lenders set ae_phone = '7135550100' where lender = 'Ref Test Lender';
  select updated_by_name into who from public.reference_lenders where lender = 'Ref Test Lender';
  if who is distinct from 'Ref Assistant' then raise exception 'FAIL: assistant stamp gave %', who; end if;
  insert into public.reference_links (title, url, grp) values ('Ref Link', 'https://example.com', 'Test');
  delete from public.reference_links where title = 'Ref Link';
  delete from public.reference_lenders where lender = 'Ref Test Lender';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: assistant could not delete'; end if;
  raise notice 'assistant reference: all checks passed';
end $$;

-- No role: nothing.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000ff","role":"authenticated"}', true);
do $$
declare n int;
begin
  select count(*) into n from public.reference_links;
  if n <> 0 then raise exception 'FAIL: roleless login reads % links', n; end if;
  begin
    insert into public.reference_lenders (lender) values ('Sneaky');
    raise exception 'FAIL: roleless insert allowed';
  exception when insufficient_privilege then null;
  end;
  raise notice 'no-role reference: all checks passed';
end $$;

rollback;
```

- [ ] **Step 2: Write the migration**

```sql
-- Reference section (spec 2026-11-05-reference-section-design.md): lender AE
-- directory and quick links. Owner and assistant read and write everything,
-- comp notes included; any other login sees nothing.

create table if not exists public.reference_lenders (
  id              uuid primary key default gen_random_uuid(),
  lender          text not null,
  ae_name         text,
  ae_phone        text,
  ae_email        text,
  portal_url      text,
  programs        text[] not null default '{}',
  min_fico        int,
  max_ltv         numeric,
  turn_time       text,
  comp_notes      text,
  notes           text,
  updated_at      timestamptz not null default now(),
  updated_by_name text
);

create table if not exists public.reference_links (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  url          text not null check (url ~* '^https?://'),
  grp          text not null,
  sort         int not null default 0,
  copy_address boolean not null default false
);

alter table public.reference_lenders enable row level security;
alter table public.reference_links enable row level security;

drop policy if exists "owner or assistant all reference_lenders" on public.reference_lenders;
create policy "owner or assistant all reference_lenders" on public.reference_lenders
  for all to authenticated
  using (public.app_role() in ('owner', 'assistant'))
  with check (public.app_role() in ('owner', 'assistant'));

drop policy if exists "owner or assistant all reference_links" on public.reference_links;
create policy "owner or assistant all reference_links" on public.reference_links
  for all to authenticated
  using (public.app_role() in ('owner', 'assistant'))
  with check (public.app_role() in ('owner', 'assistant'));

create or replace function public.reference_lenders_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by_name := (select name from user_roles where user_id = auth.uid());
  return new;
end
$$;
revoke all on function public.reference_lenders_stamp() from public, anon, authenticated;

drop trigger if exists reference_lenders_stamp on public.reference_lenders;
create trigger reference_lenders_stamp
  before insert or update on public.reference_lenders
  for each row execute function public.reference_lenders_stamp();

-- Seed links once (editable afterwards).
insert into public.reference_links (title, url, grp, sort, copy_address)
select * from (values
  ('HAR.com',                    'https://www.har.com/',                                              'Property', 1, false),
  ('TitlePro247',                'https://www.titlepro247.com/',                                      'Property', 2, true),
  ('HCAD (Harris)',              'https://hcad.org/',                                                 'Property', 3, true),
  ('Fort Bend CAD',              'https://esearch.fbcad.org/',                                        'Property', 4, true),
  ('Montgomery CAD',             'https://mcad-tx.org/',                                              'Property', 5, true),
  ('Galveston CAD',              'https://galvestoncad.org/',                                         'Property', 6, true),
  ('Brazoria CAD',               'https://brazoriacad.org/',                                          'Property', 7, true),
  ('FEMA flood map',             'https://msc.fema.gov/portal/search',                                'Property', 8, false),
  ('USDA eligibility',           'https://eligibility.sc.egov.usda.gov/eligibility/welcomeAction.do', 'Property', 9, false),
  ('Texas SOS (SOSDirect)',      'https://www.sos.state.tx.us/corp/sosda/index.shtml',               'Business checks', 1, false),
  ('Comptroller entity search',  'https://comptroller.texas.gov/taxes/franchise/account-status/search', 'Business checks', 2, false),
  ('NMLS Consumer Access',       'https://www.nmlsconsumeraccess.org/',                               'Licensing', 1, false),
  ('TREC license search',        'https://www.trec.texas.gov/license-search',                         'Licensing', 2, false),
  ('Fannie Mae loan lookup',     'https://www.knowyouroptions.com/loan-lookup',                       'Loan lookups', 1, false),
  ('Freddie Mac loan lookup',    'https://ww3.freddiemac.com/loanlookup/',                            'Loan lookups', 2, false)
) as v(title, url, grp, sort, copy_address)
where not exists (select 1 from public.reference_links);
```

- [ ] **Step 3: Confirm the three URLs automated checks could not reach**

Open each in the in-app browser (they refuse scripted requests): `https://www.nmlsconsumeraccess.org/`, `https://www.knowyouroptions.com/loan-lookup`, `https://ww3.freddiemac.com/loanlookup/`. If one lands on a "not found" page, find the current address on that site's home page and change the seed row.

- [ ] **Step 4: Dry run (read-only)**

Run: `npx supabase db push --dry-run`
Expected: only `0058_reference.sql` listed. Do not apply; that is rollout.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0058_reference.sql supabase/tests/reference.sql
git commit -m "feat: reference lenders and links tables (migration 0058)"
```

---

### Task 2: `parse.js`

**Files:** Create `src/lib/calc/parse.js`, `src/lib/calc/parse.test.js`

- [ ] **Step 1: Failing test**

```js
import { describe, it, expect } from 'vitest'
import { parseAmount, money, pct } from './parse'

describe('parseAmount', () => {
  it('reads plain, dollar, comma and percent text', () => {
    expect(parseAmount('1200')).toBe(1200)
    expect(parseAmount('$1,200.50')).toBe(1200.5)
    expect(parseAmount('20%')).toBe(20)
    expect(parseAmount(' 7.125 ')).toBe(7.125)
  })
  it('returns null for blank or junk', () => {
    for (const s of ['', '  ', '$', 'abc', null, undefined, '-']) expect(parseAmount(s)).toBe(null)
  })
})

describe('formatting', () => {
  it('money rounds to dollars or cents', () => {
    expect(money(2661.214)).toBe('$2,661')
    expect(money(2661.214, true)).toBe('$2,661.21')
    expect(money(null)).toBe('-')
  })
  it('pct', () => {
    expect(pct(80)).toBe('80.0%')
    expect(pct(null)).toBe('-')
  })
})
```

- [ ] **Step 2:** Run `npx vitest run src/lib/calc/parse.test.js`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```js
// Text-box input and display helpers for the Reference calculators.
// "$1,200" -> 1200, "20%" -> 20, "" -> null.
export function parseAmount(s) {
  if (s === null || s === undefined) return null
  const t = String(s).replace(/[$,%\s]/g, '')
  if (t === '' || t === '-' || t === '.') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

const ok = (n) => typeof n === 'number' && Number.isFinite(n)

export function money(n, cents = false) {
  if (!ok(n)) return '-'
  const d = cents ? 2 : 0
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: d, maximumFractionDigits: d })
}

export const pct = (n, digits = 1) => (ok(n) ? `${n.toFixed(digits)}%` : '-')
```

- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** Commit: `git add src/lib/calc/parse.js src/lib/calc/parse.test.js && git commit -m "feat: calculator input parsing and formatting"`

---

### Task 3: `loanPayment.js`

**Files:** Create `src/lib/calc/loanPayment.js`, `src/lib/calc/loanPayment.test.js`

- [ ] **Step 1: Failing test**

```js
import { describe, it, expect } from 'vitest'
import { monthlyPI, loanFromPI, loanPayment } from './loanPayment'

const base = { price: 500000, downMode: 'pct', down: 20, rate: 7, years: 30, taxesYear: null, insuranceYear: 2400, hoaMonth: 50, miRate: null, closingPct: null }

describe('monthlyPI', () => {
  it('$400,000 at 7% for 30 years', () => {
    expect(monthlyPI(400000, 7, 30).toFixed(2)).toBe('2661.21')
  })
  it('zero rate divides evenly; missing rate gives null', () => {
    expect(monthlyPI(360000, 0, 30)).toBe(1000)
    expect(monthlyPI(400000, null, 30)).toBe(null)
  })
  it('loanFromPI inverts monthlyPI', () => {
    expect(loanFromPI(monthlyPI(400000, 7, 30), 7, 30)).toBeCloseTo(400000, 6)
    expect(loanFromPI(1000, 0, 30)).toBe(360000)
  })
})

describe('loanPayment', () => {
  it('breaks out the payment at 80% LTV with default taxes and no MI', () => {
    const p = loanPayment(base)
    expect(p.loan).toBe(400000)
    expect(p.ltv).toBe(80)
    expect(p.pi.toFixed(2)).toBe('2661.21')
    expect(p.taxes).toBeCloseTo((500000 * 0.022) / 12, 6)
    expect(p.insurance).toBe(200)
    expect(p.hoa).toBe(50)
    expect(p.miOn).toBe(false)
    expect(p.mi).toBe(0)
    expect(p.total).toBeCloseTo(p.pi + p.taxes + 200 + 50, 6)
    expect(p.closing).toBe(15000)
    expect(p.cashToClose).toBe(115000)
  })
  it('adds MI over 80% LTV and takes a dollar down payment', () => {
    const p = loanPayment({ ...base, downMode: 'amt', down: 25000 })
    expect(p.loan).toBe(475000)
    expect(p.ltv).toBe(95)
    expect(p.miOn).toBe(true)
    expect(p.mi).toBeCloseTo((475000 * 0.005) / 12, 6)
  })
  it('uses typed taxes over the default', () => {
    expect(loanPayment({ ...base, taxesYear: 6000 }).taxes).toBe(500)
  })
  it('has no total until there is a rate', () => {
    expect(loanPayment({ ...base, rate: null }).total).toBe(null)
  })
})
```

- [ ] **Step 2:** Run `npx vitest run src/lib/calc/loanPayment.test.js`. Expected: FAIL.

- [ ] **Step 3: Implement**

```js
// Loan payment math (spec section 3). Inputs are numbers or null.
export const DEFAULT_TAX_RATE = 2.2 // % of price per year (Houston-area estimate)
export const DEFAULT_MI_RATE = 0.5 // % of loan per year, only over 80% LTV
export const DEFAULT_CLOSING_PCT = 3 // % of price

export function monthlyPI(loan, ratePct, years) {
  const n = (years || 0) * 12
  if (!(loan > 0) || !(n > 0) || ratePct === null || ratePct === undefined) return null
  const r = ratePct / 100 / 12
  if (r === 0) return loan / n
  return (loan * r) / (1 - Math.pow(1 + r, -n))
}

export function loanFromPI(pi, ratePct, years) {
  const n = (years || 0) * 12
  if (!(pi > 0) || !(n > 0) || ratePct === null || ratePct === undefined) return null
  const r = ratePct / 100 / 12
  if (r === 0) return pi * n
  return (pi * (1 - Math.pow(1 + r, -n))) / r
}

// i: { price, downMode: 'pct'|'amt', down, rate, years, taxesYear, insuranceYear,
//      hoaMonth, miRate, closingPct }. taxesYear null = DEFAULT_TAX_RATE of price.
export function loanPayment(i) {
  const price = i.price || 0
  const downAmt = i.downMode === 'amt' ? i.down || 0 : (price * (i.down ?? 0)) / 100
  const loan = Math.max(0, price - downAmt)
  const ltv = price > 0 ? (loan / price) * 100 : null
  const pi = monthlyPI(loan, i.rate, i.years)
  const taxes = (i.taxesYear ?? (price * DEFAULT_TAX_RATE) / 100) / 12
  const insurance = (i.insuranceYear || 0) / 12
  const hoa = i.hoaMonth || 0
  const miOn = ltv !== null && ltv > 80
  const mi = miOn ? (loan * (i.miRate ?? DEFAULT_MI_RATE)) / 100 / 12 : 0
  const total = pi === null ? null : pi + taxes + insurance + hoa + mi
  const closing = (price * (i.closingPct ?? DEFAULT_CLOSING_PCT)) / 100
  return { price, downAmt, loan, ltv, pi, taxes, insurance, hoa, mi, miOn, total, closing, cashToClose: downAmt + closing }
}
```

- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** Commit: `git add src/lib/calc/loanPayment.js src/lib/calc/loanPayment.test.js && git commit -m "feat: loan payment math"`

---

### Task 4: `dscr.js`

**Files:** Create `src/lib/calc/dscr.js`, `src/lib/calc/dscr.test.js`

- [ ] **Step 1: Failing test**

```js
import { describe, it, expect } from 'vitest'
import { dscr } from './dscr'
import { loanPayment } from './loanPayment'

const base = { price: 300000, downMode: 'pct', down: 25, rate: 7.5, years: 30, taxesYear: 6000, insuranceYear: 1800, hoaMonth: 0, miRate: null, closingPct: null }

describe('dscr', () => {
  it('rent over the full payment, against the minimum', () => {
    const r = dscr(base, 2500, 1)
    const total = loanPayment(base).total
    expect(r.ratio).toBeCloseTo(2500 / total, 6)
    expect(r.pass).toBe(r.ratio >= 1)
  })
  it('largest loan round-trips to the minimum ratio', () => {
    const r = dscr(base, 2500, 1.1)
    const at = loanPayment({ ...base, downMode: 'amt', down: base.price - r.maxLoan })
    expect(at.pi + at.taxes + at.insurance + at.hoa).toBeCloseTo(2500 / 1.1, 2)
    expect(r.maxLtv).toBeCloseTo((r.maxLoan / 300000) * 100, 6)
  })
  it('says when rent does not cover taxes, insurance and HOA', () => {
    const r = dscr({ ...base, hoaMonth: 3000 }, 2500, 1)
    expect(r.uncovered).toBe(true)
    expect(r.maxLoan).toBe(null)
  })
  it('waits for rent', () => {
    expect(dscr(base, null, 1).ratio).toBe(null)
  })
})
```

- [ ] **Step 2:** Run `npx vitest run src/lib/calc/dscr.test.js`. Expected: FAIL.

- [ ] **Step 3: Implement**

```js
// DSCR (spec section 4): rent / full payment, and the largest loan whose
// payment (P&I, taxes, insurance, HOA; MI left out) meets the minimum.
import { loanPayment, loanFromPI } from './loanPayment'

export function dscr(inputs, rent, minDscr = 1) {
  const payment = loanPayment(inputs)
  const ratio = payment.total && rent > 0 ? rent / payment.total : null
  const budget = rent > 0 && minDscr > 0 ? rent / minDscr - payment.taxes - payment.insurance - payment.hoa : null
  const maxLoan = budget !== null && budget > 0 ? loanFromPI(budget, inputs.rate, inputs.years) : null
  return {
    payment,
    ratio,
    pass: ratio === null ? null : ratio >= minDscr,
    budget,
    maxLoan,
    maxLtv: maxLoan !== null && payment.price > 0 ? (maxLoan / payment.price) * 100 : null,
    uncovered: budget !== null && budget <= 0,
  }
}
```

- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** Commit: `git add src/lib/calc/dscr.js src/lib/calc/dscr.test.js && git commit -m "feat: DSCR ratio and largest loan"`

---

### Task 5: `bankStatement.js`

**Files:** Create `src/lib/calc/bankStatement.js`, `src/lib/calc/bankStatement.test.js`

- [ ] **Step 1: Failing test**

```js
import { describe, it, expect } from 'vitest'
import { monthLabels, bankStatement, bankSummary, DEFAULT_EXPENSE } from './bankStatement'

const NOW = Date.parse('2026-11-05T15:00:00Z')
const rows = (vals) => vals.map((v) => ({ deposits: v, exclude: null }))

describe('monthLabels', () => {
  it('starts at last month, newest first', () => {
    const l = monthLabels(12, NOW)
    expect(l[0]).toBe('Oct 2026')
    expect(l[11]).toBe('Nov 2025')
    expect(monthLabels(24, NOW)[23]).toBe('Nov 2024')
  })
})

describe('bankStatement', () => {
  it('12 months averaging $40,000 at 50% and 100% ownership qualify $20,000', () => {
    const r = bankStatement({ months: 12, ownership: 100, expense: 50, rows: rows(Array(12).fill(40000)) })
    expect(r.average).toBe(40000)
    expect(r.income).toBe(20000)
    expect(r.entered).toBe(12)
    expect(r.trend).toBe(null)
  })
  it('subtracts exclusions, counts blank months as 0, applies ownership', () => {
    const rs = rows(Array(12).fill(null))
    rs[0] = { deposits: 50000, exclude: 2000 }
    rs[1] = { deposits: 1000, exclude: 5000 }
    const r = bankStatement({ months: 12, ownership: 50, expense: 0, rows: rs })
    expect(r.counted[0]).toBe(48000)
    expect(r.counted[1]).toBe(0)
    expect(r.counted[2]).toBe(null)
    expect(r.entered).toBe(2)
    expect(r.average).toBe(4000)
    expect(r.income).toBe(2000)
  })
  it('24-month trend compares the last 12 to the prior 12', () => {
    const r = bankStatement({ months: 24, ownership: 100, expense: 50, rows: rows([...Array(12).fill(36000), ...Array(12).fill(40000)]) })
    expect(r.trend).toBeCloseTo(-10, 6)
  })
  it('flags months 50% or more above the average', () => {
    const vals = Array(12).fill(40000)
    vals[2] = 70000
    const r = bankStatement({ months: 12, ownership: 100, expense: 50, rows: rows(vals) })
    expect(r.large[2]).toBe(true)
    expect(r.large[0]).toBe(false)
  })
  it('defaults: business 50%, personal 0%', () => {
    expect(DEFAULT_EXPENSE).toEqual({ business: 50, personal: 0 })
  })
})

describe('bankSummary', () => {
  it('writes a plain-text summary', () => {
    const input = { months: 12, account: 'business', ownership: 100, expense: 50, rows: rows(Array(12).fill(40000)) }
    const s = bankSummary(input, bankStatement(input), monthLabels(12, NOW))
    expect(s).toContain('Bank statement income (12 months, business, 50% expense, 100% ownership)')
    expect(s).toContain('Average monthly deposits: $40,000')
    expect(s).toContain('Qualifying monthly income: $20,000')
  })
})
```

- [ ] **Step 2:** Run `npx vitest run src/lib/calc/bankStatement.test.js`. Expected: FAIL.

- [ ] **Step 3: Implement**

```js
// Bank statement income (spec section 2). rows: newest month first,
// { deposits, exclude } numbers or null. Blank months count as $0.
import { money, pct } from './parse'

export const DEFAULT_EXPENSE = { business: 50, personal: 0 }
const LARGE = 1.5

export function monthLabels(count, now = Date.now()) {
  const d = new Date(now)
  const out = []
  for (let i = 1; i <= count; i++) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1))
    out.push(new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', year: 'numeric' }).format(m))
  }
  return out
}

export function bankStatement({ months, ownership, expense, rows }) {
  const counted = Array.from({ length: months }, (_, i) => {
    const r = rows[i]
    if (!r || r.deposits === null || r.deposits === undefined) return null
    return Math.max(0, (r.deposits || 0) - (r.exclude || 0))
  })
  const sumOf = (list) => list.reduce((s, v) => s + (v || 0), 0)
  const average = months ? sumOf(counted) / months : 0
  const income = average * (1 - (expense ?? 0) / 100) * ((ownership ?? 100) / 100)
  let trend = null
  if (months === 24) {
    const recent = sumOf(counted.slice(0, 12))
    const prior = sumOf(counted.slice(12, 24))
    trend = prior > 0 ? ((recent - prior) / prior) * 100 : null
  }
  const large = counted.map((v) => v !== null && average > 0 && v >= average * LARGE)
  return { counted, entered: counted.filter((v) => v !== null).length, average, income, trend, large }
}

export function bankSummary(input, r, labels) {
  const lines = [
    `Bank statement income (${input.months} months, ${input.account}, ${input.expense ?? 0}% expense, ${input.ownership ?? 100}% ownership)`,
    `Average monthly deposits: ${money(r.average)}`,
    `Qualifying monthly income: ${money(r.income)}`,
  ]
  if (r.trend !== null) lines.push(`Trend, last 12 vs prior 12: ${pct(r.trend)}`)
  const big = r.large.map((on, i) => (on ? `${labels[i]} ${money(r.counted[i])}` : null)).filter(Boolean)
  if (big.length) lines.push(`Large months: ${big.join(', ')}`)
  lines.push(`Months entered: ${r.entered} of ${input.months}`)
  return lines.join('\n')
}
```

- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** Commit: `git add src/lib/calc/bankStatement.js src/lib/calc/bankStatement.test.js && git commit -m "feat: bank statement income math"`

---

### Task 6: `trid.js`

**Files:** Create `src/lib/calc/trid.js`, `src/lib/calc/trid.test.js`

- [ ] **Step 1: Failing test**

```js
import { describe, it, expect } from 'vitest'
import { federalHolidays, isGeneralBusinessDay, isSpecificBusinessDay, addBizDays, tridDates } from './trid'

describe('federalHolidays', () => {
  it('2026 observed dates', () => {
    const h = federalHolidays(2026)
    for (const d of ['2026-01-01', '2026-01-19', '2026-02-16', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-10-12', '2026-11-11', '2026-11-26', '2026-12-25']) {
      expect(h.has(d)).toBe(true)
    }
    expect(h.has('2026-07-04')).toBe(false)
  })
  it('a Saturday New Year is observed the Friday before, in the prior year', () => {
    expect(federalHolidays(2022).has('2021-12-31')).toBe(true) // Jan 1 2022 was a Saturday
    expect(isGeneralBusinessDay('2021-12-31')).toBe(false)
  })
})

describe('business days', () => {
  it('general: weekdays without holidays; specific: all but Sundays and holidays', () => {
    expect(isGeneralBusinessDay('2026-11-28')).toBe(false) // Saturday
    expect(isSpecificBusinessDay('2026-11-28')).toBe(true)
    expect(isSpecificBusinessDay('2026-11-29')).toBe(false) // Sunday
    expect(isSpecificBusinessDay('2026-11-26')).toBe(false) // Thanksgiving
  })
  it('addBizDays goes back with a negative count', () => {
    expect(addBizDays('2026-12-28', -3, isSpecificBusinessDay)).toBe('2026-12-23')
  })
})

describe('tridDates', () => {
  it('application Mon Nov 23 2026, delivered in person', () => {
    const t = tridDates({ application: '2026-11-23', mailed: false, closing: '2026-12-28' })
    expect(t.leBy).toBe('2026-11-27') // skips Thanksgiving
    expect(t.leReceived).toBe('2026-11-27')
    expect(t.earliestClosing).toBe('2026-12-05') // skips Sunday Nov 29
    expect(t.cdReceiveBy).toBe('2026-12-23') // skips Sunday and Christmas
    expect(t.cdSendBy).toBe('2026-12-23')
  })
  it('mailed adds 3 specific business days each way', () => {
    const t = tridDates({ application: '2026-11-23', mailed: true, closing: '2026-12-28' })
    expect(t.leReceived).toBe('2026-12-01')
    expect(t.cdSendBy).toBe('2026-12-19')
  })
  it('no closing date, no Closing Disclosure dates', () => {
    const t = tridDates({ application: '2026-11-23', mailed: false, closing: null })
    expect(t.cdReceiveBy).toBe(null)
    expect(t.cdSendBy).toBe(null)
  })
})
```

- [ ] **Step 2:** Run `npx vitest run src/lib/calc/trid.test.js`. Expected: FAIL.

- [ ] **Step 3: Implement**

```js
// TRID planning dates (spec section 5). Dates are 'YYYY-MM-DD' keys; all
// arithmetic is UTC so no time zone can shift a day. Separate from
// briefingTime.addBusinessDays, which counts weekdays only.
const DAY = 86400000
const toKey = (ms) => new Date(ms).toISOString().slice(0, 10)
const toMs = (key) => Date.parse(`${key}T00:00:00Z`)
const weekday = (key) => new Date(toMs(key)).getUTCDay()

// nth weekday (0=Sun..6=Sat) of a month; n = -1 for the last one.
function nthWeekday(year, month, dow, n) {
  if (n > 0) {
    const first = new Date(Date.UTC(year, month, 1)).getUTCDay()
    return Date.UTC(year, month, 1 + ((dow - first + 7) % 7) + (n - 1) * 7)
  }
  const lastDay = new Date(Date.UTC(year, month + 1, 0))
  return Date.UTC(year, month, lastDay.getUTCDate() - ((lastDay.getUTCDay() - dow + 7) % 7))
}

// Fixed-date holidays move to Friday (Saturday) or Monday (Sunday).
function observed(ms) {
  const d = new Date(ms).getUTCDay()
  return d === 6 ? ms - DAY : d === 0 ? ms + DAY : ms
}

const cache = new Map()
export function federalHolidays(year) {
  if (cache.has(year)) return cache.get(year)
  const fixed = [[0, 1], [5, 19], [6, 4], [10, 11], [11, 25]].map(([m, d]) => observed(Date.UTC(year, m, d)))
  const floating = [
    nthWeekday(year, 0, 1, 3), // MLK Day
    nthWeekday(year, 1, 1, 3), // Washington's Birthday
    nthWeekday(year, 4, 1, -1), // Memorial Day
    nthWeekday(year, 8, 1, 1), // Labor Day
    nthWeekday(year, 9, 1, 2), // Columbus Day
    nthWeekday(year, 10, 4, 4), // Thanksgiving
  ]
  const set = new Set([...fixed, ...floating].map(toKey))
  cache.set(year, set)
  return set
}

// Next year's New Year's Day can be observed on Dec 31 of this year.
const isHoliday = (key) => {
  const y = Number(key.slice(0, 4))
  return federalHolidays(y).has(key) || federalHolidays(y + 1).has(key)
}

export const isGeneralBusinessDay = (key) => {
  const d = weekday(key)
  return d !== 0 && d !== 6 && !isHoliday(key)
}
export const isSpecificBusinessDay = (key) => weekday(key) !== 0 && !isHoliday(key)

export function addBizDays(key, n, isBiz) {
  let ms = toMs(key)
  const step = n < 0 ? -DAY : DAY
  let left = Math.abs(n)
  while (left > 0) {
    ms += step
    if (isBiz(toKey(ms))) left -= 1
  }
  return toKey(ms)
}

export function tridDates({ application, mailed, closing }) {
  const leBy = addBizDays(application, 3, isGeneralBusinessDay)
  const leReceived = mailed ? addBizDays(leBy, 3, isSpecificBusinessDay) : leBy
  const earliestClosing = addBizDays(leBy, 7, isSpecificBusinessDay)
  const cdReceiveBy = closing ? addBizDays(closing, -3, isSpecificBusinessDay) : null
  const cdSendBy = cdReceiveBy && mailed ? addBizDays(cdReceiveBy, -3, isSpecificBusinessDay) : cdReceiveBy
  return { leBy, leReceived, earliestClosing, cdReceiveBy, cdSendBy }
}
```

- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** Commit: `git add src/lib/calc/trid.js src/lib/calc/trid.test.js && git commit -m "feat: TRID planning dates with federal holidays"`

---

### Task 7: `referenceLinks.js`

**Files:** Create `src/lib/referenceLinks.js`, `src/lib/referenceLinks.test.js`

- [ ] **Step 1: Failing test**

```js
import { describe, it, expect } from 'vitest'
import { lookupUrls, leadAddress, isHttpUrl, groupLinks, GROUP_ORDER } from './referenceLinks'

describe('lookupUrls', () => {
  it('puts the address in each search link', () => {
    const u = lookupUrls('3042 Oak Forest Dr, Houston, TX 77018')
    expect(u.har).toBe('https://www.har.com/search/dosearch?quicksearch=3042%20Oak%20Forest%20Dr%2C%20Houston%2C%20TX%2077018')
    expect(u.maps).toBe('https://www.google.com/maps/search/?api=1&query=3042%20Oak%20Forest%20Dr%2C%20Houston%2C%20TX%2077018')
    expect(u.zillow).toBe('https://www.zillow.com/homes/3042-Oak-Forest-Dr-Houston-TX-77018_rb/')
  })
})

describe('leadAddress', () => {
  it('formats the first address with a street', () => {
    expect(leadAddress({ addresses: [{ street: '3042 Oak Forest Dr ', city: 'Houston', state: 'TX', code: '77018' }] })).toBe('3042 Oak Forest Dr, Houston, TX 77018')
  })
  it('skips city-only entries and missing data', () => {
    expect(leadAddress({ addresses: [{ city: 'Houston', state: 'TX' }] })).toBe(null)
    expect(leadAddress({})).toBe(null)
    expect(leadAddress(null)).toBe(null)
  })
})

describe('isHttpUrl and groupLinks', () => {
  it('accepts http(s) only', () => {
    expect(isHttpUrl('https://har.com')).toBe(true)
    expect(isHttpUrl('har.com')).toBe(false)
    expect(isHttpUrl('ftp://x')).toBe(false)
  })
  it('groups in the fixed order, others after, sorted by sort', () => {
    const g = groupLinks([
      { id: 1, grp: 'Licensing', sort: 2, title: 'B' },
      { id: 2, grp: 'Zeta', sort: 1, title: 'Z' },
      { id: 3, grp: 'Property', sort: 1, title: 'A' },
      { id: 4, grp: 'Licensing', sort: 1, title: 'C' },
    ])
    expect(g.map((x) => x.grp)).toEqual(['Property', 'Licensing', 'Zeta'])
    expect(g[1].links.map((l) => l.id)).toEqual([4, 1])
    expect(GROUP_ORDER[0]).toBe('Property')
  })
})
```

- [ ] **Step 2:** Run `npx vitest run src/lib/referenceLinks.test.js`. Expected: FAIL.

- [ ] **Step 3: Implement**

```js
// Reference > Links helpers (spec section 7). Pure.
export const GROUP_ORDER = ['Property', 'Business checks', 'Licensing', 'Loan lookups']

export function lookupUrls(address) {
  const a = String(address || '').trim()
  const enc = encodeURIComponent(a)
  const slug = a.replace(/,/g, ' ').trim().split(/\s+/).join('-')
  return {
    har: `https://www.har.com/search/dosearch?quicksearch=${enc}`,
    maps: `https://www.google.com/maps/search/?api=1&query=${enc}`,
    zillow: `https://www.zillow.com/homes/${encodeURIComponent(slug)}_rb/`,
  }
}

// FUB raw.addresses -> "street, city, ST zip"; null without a street.
export function leadAddress(raw) {
  const list = Array.isArray(raw?.addresses) ? raw.addresses : []
  const a = list.find((x) => x && String(x.street || '').trim())
  if (!a) return null
  const stateZip = [a.state, a.code].filter(Boolean).join(' ')
  return [String(a.street).trim(), a.city, stateZip].filter(Boolean).join(', ')
}

export const isHttpUrl = (u) => /^https?:\/\/\S+$/i.test(String(u || '').trim())

export function groupLinks(rows) {
  const by = new Map()
  for (const r of rows) {
    if (!by.has(r.grp)) by.set(r.grp, [])
    by.get(r.grp).push(r)
  }
  const rank = (g) => {
    const i = GROUP_ORDER.indexOf(g)
    return i === -1 ? GROUP_ORDER.length : i
  }
  return [...by.keys()]
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((grp) => ({ grp, links: by.get(grp).slice().sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title)) }))
}
```

- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** Commit: `git add src/lib/referenceLinks.js src/lib/referenceLinks.test.js && git commit -m "feat: reference link helpers and lead address"`

---

### Task 8: Route, nav and assistant access

**Files:** Modify `src/lib/roles.js`, `src/lib/roles.test.js`, `src/components/Icon.jsx`, `src/components/Sidebar.jsx`, `src/App.jsx`; create a placeholder `src/pages/Reference.jsx` (filled in Task 10).

- [ ] **Step 1: Failing test**

In `src/lib/roles.test.js`, in "keeps the assistant to Workbench, Tasks and Pipeline", add `'/reference'` to the allowed list:

```js
    for (const p of ['/workbench', '/priority', '/tasks', '/pipeline', '/bayway/pipeline', '/reference']) expect(canVisit('assistant', p)).toBe(true)
```

Run `npx vitest run src/lib/roles.test.js`. Expected: FAIL on `/reference`.

- [ ] **Step 2: Implement**

`src/lib/roles.js`:

```js
const ASSISTANT_PATHS = /^\/(workbench|priority|tasks|pipeline|bayway\/pipeline|reference)(\/|$)/
```

`src/components/Icon.jsx`, add to `ICONS`:

```js
  book: 'M4 4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5z M4 19.5A1.5 1.5 0 0 0 5.5 21H20v-3',
```

`src/components/Sidebar.jsx`, the Insights group becomes:

```js
  { group: 'Insights', items: [
    { to: '/reports', icon: 'reports', label: 'Reports', on: /^\/(reports|analytics)/ },
    { to: '/reference', icon: 'book', label: 'Reference', on: /^\/reference/ },
  ] },
```

`src/pages/Reference.jsx` (placeholder):

```jsx
export default function Reference() {
  return <div aria-label="Reference" />
}
```

`src/App.jsx`: add `import Reference from './pages/Reference'` next to `import Reports from './pages/Reports'`, and the route after `/tasks`:

```jsx
              <Route path="/reference" element={<Reference />} />
```

- [ ] **Step 3:** Run `npx vitest run src/lib/roles.test.js src/components`. Expected: PASS (the Sidebar test's assistant case may list visible links; if it asserts an exact list, add `'Reference'` to the expected assistant and owner lists).
- [ ] **Step 4:** Commit: `git add src/lib/roles.js src/lib/roles.test.js src/components/Icon.jsx src/components/Sidebar.jsx src/App.jsx src/pages/Reference.jsx && git commit -m "feat: Reference route and nav for owner and assistant"` (also `git add` the Sidebar test if Step 3 changed it).

---

### Task 9: Table hooks

**Files:** Create `src/lib/useReferenceLenders.js`, `src/lib/useReferenceLinks.js`

These are covered by the Lenders and Links render tests in Tasks 12 and 13.

- [ ] **Step 1: `useReferenceLenders.js`**

```js
// Reference > Lenders: the reference_lenders table (migration 0058).
import { useCallback, useEffect, useState } from 'react'
import { supabase, isDemoMode } from './supabase'

export const LENDER_FIELDS = ['lender', 'ae_name', 'ae_phone', 'ae_email', 'portal_url', 'programs', 'min_fico', 'max_ltv', 'turn_time', 'comp_notes', 'notes']

export function useReferenceLenders() {
  const [state, setState] = useState({ rows: [], loading: !isDemoMode, error: null })

  const load = useCallback(async () => {
    if (isDemoMode) return
    const { data, error } = await supabase.from('reference_lenders').select('*').order('lender', { ascending: true }).limit(500)
    setState({ rows: data || [], loading: false, error: error?.message ?? null })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const done = async (res) => {
    if (res.error) setState((s) => ({ ...s, error: res.error.message }))
    await load()
    return !res.error
  }

  const save = async (row) => {
    const values = Object.fromEntries(LENDER_FIELDS.map((k) => [k, row[k] ?? null]))
    values.programs = row.programs || []
    return done(row.id ? await supabase.from('reference_lenders').update(values).eq('id', row.id) : await supabase.from('reference_lenders').insert(values))
  }
  const remove = async (id) => done(await supabase.from('reference_lenders').delete().eq('id', id))

  return { ...state, reload: load, save, remove }
}
```

- [ ] **Step 2: `useReferenceLinks.js`**

```js
// Reference > Links: the reference_links table (migration 0058).
import { useCallback, useEffect, useState } from 'react'
import { supabase, isDemoMode } from './supabase'

export function useReferenceLinks() {
  const [state, setState] = useState({ rows: [], loading: !isDemoMode, error: null })

  const load = useCallback(async () => {
    if (isDemoMode) return
    const { data, error } = await supabase.from('reference_links').select('*').order('grp', { ascending: true }).order('sort', { ascending: true }).limit(500)
    setState({ rows: data || [], loading: false, error: error?.message ?? null })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const done = async (res) => {
    if (res?.error) setState((s) => ({ ...s, error: res.error.message }))
    await load()
    return !res?.error
  }

  const save = async (row) => {
    const values = { title: row.title, url: row.url, grp: row.grp, sort: row.sort ?? 0, copy_address: !!row.copy_address }
    return done(row.id ? await supabase.from('reference_links').update(values).eq('id', row.id) : await supabase.from('reference_links').insert(values))
  }
  const remove = async (id) => done(await supabase.from('reference_links').delete().eq('id', id))
  // Swap sort with the neighbor in the same group (dir -1 up, +1 down).
  const move = async (link, groupLinks, dir) => {
    const i = groupLinks.findIndex((l) => l.id === link.id)
    const other = groupLinks[i + dir]
    if (!other) return true
    const a = await supabase.from('reference_links').update({ sort: other.sort === link.sort ? link.sort + dir : other.sort }).eq('id', link.id)
    const b = await supabase.from('reference_links').update({ sort: link.sort }).eq('id', other.id)
    return done(a.error ? a : b)
  }

  return { ...state, reload: load, save, remove, move }
}
```

- [ ] **Step 3:** Commit: `git add src/lib/useReferenceLenders.js src/lib/useReferenceLinks.js && git commit -m "feat: reference table hooks"`

---

### Task 10: Reference page and calculators

**Files:**
- Create: `src/components/reference/Field.jsx`, `BankStatementCalc.jsx`, `LoanCalc.jsx`, `TridCalc.jsx`
- Modify: `src/pages/Reference.jsx` (replace the placeholder)
- Test: `src/pages/Reference.render.test.jsx`

- [ ] **Step 1: Failing render test**

```jsx
// @vitest-environment jsdom
// Reference page: tabs in the URL, calculators update as you type (spec 2026-11-05).
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function query() {
  const q = {}
  for (const m of ['select', 'eq', 'order', 'limit', 'insert', 'update', 'delete']) q[m] = () => q
  q.then = (resolve) => resolve({ data: [], error: null })
  return q
}
vi.mock('../lib/supabase', () => ({ isDemoMode: false, supabase: { from: () => query() } }))

const { default: Reference } = await import('./Reference')

async function mount(url) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () =>
    createRoot(host).render(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/reference" element={<Reference />} />
        </Routes>
      </MemoryRouter>,
    ),
  )
  await act(async () => {})
  return host
}
async function type(host, label, value) {
  const input = host.querySelector(`input[aria-label="${label}"]`)
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const out = (host, key) => host.querySelector(`[data-out="${key}"]`)?.textContent

describe('Reference', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('opens on the bank statement calculator and computes income', async () => {
    const host = await mount('/reference')
    expect(host.querySelector('[role="tab"][aria-selected="true"]').textContent).toBe('Calculators')
    for (let i = 0; i < 12; i++) await type(host, `Deposits month ${i + 1}`, '40000')
    expect(out(host, 'average')).toBe('$40,000')
    expect(out(host, 'income')).toBe('$20,000')
  })

  it('loan payment shows principal and interest', async () => {
    const host = await mount('/reference?calc=payment')
    await type(host, 'Price', '500000')
    await type(host, 'Rate %', '7')
    expect(out(host, 'pi')).toBe('$2,661.21')
    expect(out(host, 'loan')).toBe('$400,000')
  })

  it('DSCR shows the ratio once rent is in', async () => {
    const host = await mount('/reference?calc=dscr')
    await type(host, 'Price', '300000')
    await type(host, 'Rate %', '7.5')
    await type(host, 'Monthly rent', '2500')
    expect(out(host, 'ratio')).toMatch(/^\d\.\d\d$/)
  })

  it('TRID dates from the application date', async () => {
    const host = await mount('/reference?calc=trid')
    await type(host, 'Application date', '2026-11-23')
    expect(out(host, 'leBy')).toBe('Fri, Nov 27, 2026')
  })

  it('tab comes from the URL', async () => {
    const host = await mount('/reference?tab=links')
    expect(host.querySelector('[role="tab"][aria-selected="true"]').textContent).toBe('Links')
  })
})
```

- [ ] **Step 2:** Run `npx vitest run src/pages/Reference.render.test.jsx`. Expected: FAIL.

- [ ] **Step 3: `Field.jsx`**

```jsx
// Labeled text box for the Reference calculators. Values stay strings; the
// calculators parse them with parseAmount.
export default function Field({ label, value, onChange, type = 'text', placeholder, suffix, className = '' }) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="mb-0.5 block text-[11px] font-medium text-muted">{label}</span>
      <span className="flex items-center gap-1">
        <input
          aria-label={label}
          type={type}
          inputMode={type === 'text' ? 'decimal' : undefined}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="w-full min-w-0 rounded-[8px] border border-line2 bg-panel2 px-2.5 py-1.5 text-[13px] outline-none"
        />
        {suffix && <span className="flex-none text-[12px] text-muted">{suffix}</span>}
      </span>
    </label>
  )
}

export function Out({ k, label, children, tone }) {
  return (
    <div className="rounded-[10px] bg-panel2 px-3 py-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div data-out={k} className="num text-[18px] font-semibold" style={tone ? { color: tone } : undefined}>
        {children}
      </div>
    </div>
  )
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
```

- [ ] **Step 4: `BankStatementCalc.jsx`**

```jsx
import { useMemo, useState } from 'react'
import Field, { Out, copyText } from './Field'
import { parseAmount, money, pct } from '../../lib/calc/parse'
import { bankStatement, bankSummary, monthLabels, DEFAULT_EXPENSE } from '../../lib/calc/bankStatement'

const blankRows = (n) => Array.from({ length: n }, () => ({ deposits: '', exclude: '' }))

export default function BankStatementCalc() {
  const [months, setMonths] = useState(12)
  const [account, setAccount] = useState('business')
  const [ownership, setOwnership] = useState('100')
  const [expense, setExpense] = useState(String(DEFAULT_EXPENSE.business))
  const [rows, setRows] = useState(blankRows(24))
  const [copied, setCopied] = useState(false)

  const labels = useMemo(() => monthLabels(months), [months])
  const input = {
    months,
    account,
    ownership: parseAmount(ownership) ?? 100,
    expense: parseAmount(expense) ?? 0,
    rows: rows.map((r) => ({ deposits: parseAmount(r.deposits), exclude: parseAmount(r.exclude) })),
  }
  const r = bankStatement(input)
  const setRow = (i, k, v) => setRows((rs) => rs.map((row, j) => (j === i ? { ...row, [k]: v } : row)))
  const pickAccount = (a) => {
    setAccount(a)
    setExpense(String(DEFAULT_EXPENSE[a]))
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="block">
          <span className="mb-0.5 block text-[11px] font-medium text-muted">Months</span>
          <select aria-label="Months" value={months} onChange={(e) => setMonths(Number(e.target.value))} className="w-full rounded-[8px] border border-line2 bg-panel2 px-2 py-1.5 text-[13px]">
            <option value={12}>12</option>
            <option value={24}>24</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[11px] font-medium text-muted">Account</span>
          <select aria-label="Account" value={account} onChange={(e) => pickAccount(e.target.value)} className="w-full rounded-[8px] border border-line2 bg-panel2 px-2 py-1.5 text-[13px]">
            <option value="business">Business</option>
            <option value="personal">Personal</option>
          </select>
        </label>
        <Field label="Ownership %" value={ownership} onChange={setOwnership} suffix="%" />
        <Field label="Expense factor %" value={expense} onChange={setExpense} suffix="%" />
      </div>

      <table className="w-full table-fixed text-[12.5px]">
        <thead>
          <tr className="text-left text-[11px] text-muted">
            <th className="w-[26%] py-1 font-medium">Month</th>
            <th className="py-1 font-medium">Deposits</th>
            <th className="py-1 font-medium">Exclude</th>
            <th className="w-[26%] py-1 text-right font-medium">Counted</th>
          </tr>
        </thead>
        <tbody>
          {labels.map((label, i) => (
            <tr key={label} className="border-t border-line" data-large={r.large[i] || undefined}>
              <td className="py-1">{label}</td>
              <td className="py-1 pr-2">
                <input aria-label={`Deposits month ${i + 1}`} inputMode="decimal" value={rows[i].deposits} onChange={(e) => setRow(i, 'deposits', e.target.value)} className="w-full rounded-[6px] border border-line2 bg-panel2 px-2 py-1" />
              </td>
              <td className="py-1 pr-2">
                <input aria-label={`Exclude month ${i + 1}`} inputMode="decimal" value={rows[i].exclude} onChange={(e) => setRow(i, 'exclude', e.target.value)} className="w-full rounded-[6px] border border-line2 bg-panel2 px-2 py-1" />
              </td>
              <td className="num py-1 text-right" style={r.large[i] ? { color: '#b54708' } : undefined}>
                {r.counted[i] === null ? '' : money(r.counted[i])}
                {r.large[i] ? ' · large' : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Out k="average" label="Average monthly deposits">{money(r.average)}</Out>
        <Out k="income" label="Qualifying monthly income">{money(r.income)}</Out>
        {months === 24 && (
          <Out k="trend" label="Last 12 vs prior 12" tone={r.trend !== null && r.trend < 0 ? '#b54708' : undefined}>
            {pct(r.trend)}
          </Out>
        )}
      </div>
      <div className="flex items-center gap-3 text-[12.5px]">
        <span className="text-muted">
          {r.entered} of {months} months entered
        </span>
        <button type="button" className="font-semibold text-[#1d4ed8]" onClick={async () => setCopied(await copyText(bankSummary(input, r, labels)))}>
          {copied ? 'Copied' : 'Copy summary'}
        </button>
        <button type="button" className="text-muted" onClick={() => setRows(blankRows(24))}>
          Clear
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: `LoanCalc.jsx`** (payment and DSCR modes share one input set; `Reference.jsx` keeps that state so switching keeps the numbers)

```jsx
import Field, { Out, copyText } from './Field'
import { useState } from 'react'
import { parseAmount, money, pct } from '../../lib/calc/parse'
import { loanPayment, DEFAULT_TAX_RATE } from '../../lib/calc/loanPayment'
import { dscr } from '../../lib/calc/dscr'

export const LOAN_DEFAULTS = { price: '', downMode: 'pct', down: '20', rate: '', years: '30', taxes: '', taxesEdited: false, insurance: '', hoa: '', mi: '0.5', closing: '3', rent: '', minDscr: '1.00' }

export function loanInputs(v) {
  return {
    price: parseAmount(v.price) ?? 0,
    downMode: v.downMode,
    down: parseAmount(v.down) ?? 0,
    rate: parseAmount(v.rate),
    years: parseAmount(v.years) ?? 30,
    taxesYear: v.taxesEdited ? parseAmount(v.taxes) ?? 0 : null,
    insuranceYear: parseAmount(v.insurance) ?? 0,
    hoaMonth: parseAmount(v.hoa) ?? 0,
    miRate: parseAmount(v.mi),
    closingPct: parseAmount(v.closing),
  }
}

// v / setV: the shared input state (LOAN_DEFAULTS shape). mode: 'payment' | 'dscr'.
export default function LoanCalc({ mode, v, setV }) {
  const [copied, setCopied] = useState(false)
  const set = (k) => (val) => setV((s) => ({ ...s, [k]: val, ...(k === 'taxes' ? { taxesEdited: true } : {}) }))
  const i = loanInputs(v)
  const p = loanPayment(i)
  const d = mode === 'dscr' ? dscr(i, parseAmount(v.rent), parseAmount(v.minDscr) ?? 1) : null
  const taxesShown = v.taxesEdited ? v.taxes : i.price ? String(Math.round((i.price * DEFAULT_TAX_RATE) / 100)) : ''

  const summary = () => {
    const lines = [
      `Price ${money(p.price)} · Loan ${money(p.loan)} · LTV ${pct(p.ltv)}`,
      `Rate ${v.rate || '-'}% · ${v.years} years`,
      `P&I ${money(p.pi, true)} · Taxes ${money(p.taxes, true)} · Insurance ${money(p.insurance, true)} · HOA ${money(p.hoa, true)}${p.miOn ? ` · MI ${money(p.mi, true)}` : ''}`,
      `Total monthly ${money(p.total, true)} · Cash to close ${money(p.cashToClose)}`,
    ]
    if (d) lines.push(`Rent ${money(parseAmount(v.rent))} · DSCR ${d.ratio === null ? '-' : d.ratio.toFixed(2)} (min ${v.minDscr}) · Largest loan ${money(d.maxLoan)}`)
    return lines.join('\n')
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Field label="Price" value={v.price} onChange={set('price')} />
        <div>
          <Field label={v.downMode === 'pct' ? 'Down payment %' : 'Down payment $'} value={v.down} onChange={set('down')} />
          <button type="button" className="mt-0.5 text-[11px] text-[#1d4ed8]" onClick={() => setV((s) => ({ ...s, downMode: s.downMode === 'pct' ? 'amt' : 'pct', down: '' }))}>
            Use {v.downMode === 'pct' ? '$' : '%'}
          </button>
        </div>
        <Field label="Rate %" value={v.rate} onChange={set('rate')} />
        <label className="block">
          <span className="mb-0.5 block text-[11px] font-medium text-muted">Term</span>
          <select aria-label="Term" value={v.years} onChange={(e) => set('years')(e.target.value)} className="w-full rounded-[8px] border border-line2 bg-panel2 px-2 py-1.5 text-[13px]">
            {['30', '25', '20', '15', '10'].map((y) => (
              <option key={y} value={y}>
                {y} years
              </option>
            ))}
          </select>
        </label>
        <Field label="Taxes per year" value={taxesShown} onChange={set('taxes')} />
        <Field label="Insurance per year" value={v.insurance} onChange={set('insurance')} />
        <Field label="HOA per month" value={v.hoa} onChange={set('hoa')} />
        {p.miOn && <Field label="Mortgage insurance %" value={v.mi} onChange={set('mi')} />}
        <Field label="Closing costs %" value={v.closing} onChange={set('closing')} />
        {mode === 'dscr' && <Field label="Monthly rent" value={v.rent} onChange={set('rent')} />}
        {mode === 'dscr' && <Field label="Minimum DSCR" value={v.minDscr} onChange={set('minDscr')} />}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Out k="loan" label="Loan amount">{money(p.loan)}</Out>
        <Out k="ltv" label="LTV">{pct(p.ltv)}</Out>
        <Out k="pi" label="Principal and interest">{money(p.pi, true)}</Out>
        <Out k="total" label="Total monthly">{money(p.total, true)}</Out>
      </div>
      <div className="text-[12.5px] text-muted">
        Taxes {money(p.taxes, true)} · Insurance {money(p.insurance, true)} · HOA {money(p.hoa, true)}
        {p.miOn ? ` · MI ${money(p.mi, true)}` : ''} · Cash to close {money(p.cashToClose)}
      </div>

      {d && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Out k="ratio" label={`DSCR (minimum ${v.minDscr || '1.00'})`} tone={d.pass === null ? undefined : d.pass ? '#067647' : '#b42318'}>
            {d.ratio === null ? '-' : d.ratio.toFixed(2)}
          </Out>
          <Out k="maxLoan" label="Largest loan at the minimum">
            {d.uncovered ? 'Rent does not cover taxes, insurance and HOA at this minimum' : `${money(d.maxLoan)}${d.maxLtv !== null ? ` · ${pct(d.maxLtv)} LTV` : ''}`}
          </Out>
        </div>
      )}
      <button type="button" className="self-start text-[12.5px] font-semibold text-[#1d4ed8]" onClick={async () => setCopied(await copyText(summary()))}>
        {copied ? 'Copied' : 'Copy summary'}
      </button>
    </div>
  )
}
```

- [ ] **Step 6: `TridCalc.jsx`**

```jsx
import { useState } from 'react'
import Field, { Out } from './Field'
import { tridDates } from '../../lib/calc/trid'
import { chicagoDateKey } from '../../lib/briefingTime'

const nice = (key) =>
  key ? new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${key}T00:00:00Z`)) : '-'
const valid = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))

export default function TridCalc() {
  const [application, setApplication] = useState(chicagoDateKey(Date.now()))
  const [mailed, setMailed] = useState(false)
  const [closing, setClosing] = useState('')
  const t = valid(application) ? tridDates({ application, mailed, closing: valid(closing) ? closing : null }) : null

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Field label="Application date" type="date" value={application} onChange={setApplication} />
        <label className="block">
          <span className="mb-0.5 block text-[11px] font-medium text-muted">Delivery</span>
          <select aria-label="Delivery" value={mailed ? 'mail' : 'hand'} onChange={(e) => setMailed(e.target.value === 'mail')} className="w-full rounded-[8px] border border-line2 bg-panel2 px-2 py-1.5 text-[13px]">
            <option value="hand">In person or email</option>
            <option value="mail">Mailed</option>
          </select>
        </label>
        <Field label="Planned closing (optional)" type="date" value={closing} onChange={setClosing} />
      </div>
      {t && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Out k="leBy" label="Loan Estimate must go out by">{nice(t.leBy)}</Out>
          <Out k="leReceived" label="Loan Estimate counts as received">{nice(t.leReceived)}</Out>
          <Out k="earliestClosing" label="Earliest closing">{nice(t.earliestClosing)}</Out>
          {t.cdReceiveBy && <Out k="cdReceiveBy" label="Closing Disclosure received by">{nice(t.cdReceiveBy)}</Out>}
          {t.cdReceiveBy && mailed && <Out k="cdSendBy" label="Closing Disclosure mailed by">{nice(t.cdSendBy)}</Out>}
        </div>
      )}
      <p className="text-[12px] text-muted">Planning dates. The lender's disclosure system is the official record.</p>
    </div>
  )
}
```

- [ ] **Step 7: `Reference.jsx`**

```jsx
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import BankStatementCalc from '../components/reference/BankStatementCalc'
import LoanCalc, { LOAN_DEFAULTS } from '../components/reference/LoanCalc'
import TridCalc from '../components/reference/TridCalc'
import LendersTab from '../components/reference/LendersTab'
import LinksTab from '../components/reference/LinksTab'

// Reference (spec 2026-11-05): calculators, lender AEs and quick links for
// Chandler and Shelby alike. ?tab=calculators|lenders|links, ?calc=bank|payment|dscr|trid.
const TABS = [
  { id: 'calculators', label: 'Calculators' },
  { id: 'lenders', label: 'Lenders' },
  { id: 'links', label: 'Links' },
]
const CALCS = [
  { id: 'bank', label: 'Bank statement' },
  { id: 'payment', label: 'Loan payment' },
  { id: 'dscr', label: 'DSCR' },
  { id: 'trid', label: 'TRID dates' },
]

export default function Reference() {
  const [params, setParams] = useSearchParams()
  const calc = CALCS.some((c) => c.id === params.get('calc')) ? params.get('calc') : 'bank'
  const tab = TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'calculators'
  const [loan, setLoan] = useState(LOAN_DEFAULTS)
  const go = (next) => setParams(Object.fromEntries(Object.entries({ tab, calc, ...next }).filter(([k, v]) => v && !(k === 'tab' && v === 'calculators'))), { replace: true })

  return (
    <div className="flex flex-col gap-4 pt-4">
      <PageHeader title="Reference" note="Calculators, lender contacts and quick links." />
      <div role="tablist" aria-label="Reference" className="flex gap-5 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => go({ tab: t.id, calc: t.id === 'calculators' ? calc : undefined })}
            className={`-mb-px border-b-2 pb-2 text-[13.5px] ${tab === t.id ? 'border-[color:var(--text)] font-semibold' : 'border-transparent text-muted'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'calculators' && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {CALCS.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={calc === c.id}
                onClick={() => go({ tab: 'calculators', calc: c.id })}
                className={`rounded-[8px] border px-3 py-1 text-[12.5px] ${calc === c.id ? 'border-[color:var(--text)] font-semibold' : 'border-line2 text-muted'}`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="cc-card p-4">
            {calc === 'bank' && <BankStatementCalc />}
            {calc === 'payment' && <LoanCalc mode="payment" v={loan} setV={setLoan} />}
            {calc === 'dscr' && <LoanCalc mode="dscr" v={loan} setV={setLoan} />}
            {calc === 'trid' && <TridCalc />}
          </div>
        </>
      )}
      {tab === 'lenders' && <LendersTab />}
      {tab === 'links' && <LinksTab initialAddress={params.get('address') || ''} />}
    </div>
  )
}
```

For this task, create minimal `LendersTab.jsx` and `LinksTab.jsx` so the page imports resolve (Tasks 11 and 12 replace them):

```jsx
// src/components/reference/LendersTab.jsx (replaced in Task 11)
export default function LendersTab() {
  return <div aria-label="Lenders" />
}
```

```jsx
// src/components/reference/LinksTab.jsx (replaced in Task 12)
export default function LinksTab() {
  return <div aria-label="Links" />
}
```

- [ ] **Step 8:** Run `npx vitest run src/pages/Reference.render.test.jsx`. Expected: PASS (5 tests). If `PageHeader` requires props it is not given, pass what its other callers pass (see `src/pages/Tasks.jsx`).
- [ ] **Step 9:** Commit: `git add src/components/reference src/pages/Reference.jsx src/pages/Reference.render.test.jsx && git commit -m "feat: Reference page with four calculators"`

---

### Task 11: Lenders tab

**Files:** Replace `src/components/reference/LendersTab.jsx`; test `src/components/reference/LendersTab.render.test.jsx`

- [ ] **Step 1: Failing render test**

```jsx
// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const calls = []
let ROWS = []
function query(table) {
  const q = { _t: table }
  for (const m of ['select', 'order', 'limit']) q[m] = () => q
  q.eq = (k, v) => (calls.push(['eq', k, v]), q)
  q.insert = (v) => (calls.push(['insert', v]), q)
  q.update = (v) => (calls.push(['update', v]), q)
  q.delete = () => (calls.push(['delete']), q)
  q.then = (resolve) => resolve({ data: ROWS, error: null })
  return q
}
vi.mock('../../lib/supabase', () => ({ isDemoMode: false, supabase: { from: (t) => query(t) } }))

const { default: LendersTab } = await import('./LendersTab')

async function mount() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => createRoot(host).render(<LendersTab />))
  await act(async () => {})
  return host
}
async function type(el, value) {
  await act(async () => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const btn = (label) => document.querySelector(`[aria-label="${label}"]`)

describe('LendersTab', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    calls.length = 0
    ROWS = [
      { id: 'l1', lender: 'Acme Non-QM', ae_name: 'Dana Ruiz', ae_phone: '7135550100', ae_email: 'dana@acme.test', portal_url: 'https://acme.test', programs: ['Bank statement', 'DSCR'], min_fico: 620, max_ltv: 80, turn_time: 'UW 48h', comp_notes: '1.5%', notes: null, updated_at: '2026-11-05T15:00:00Z', updated_by_name: 'Shelby Atkinson' },
      { id: 'l2', lender: 'Beta FHA', ae_name: 'Ben', programs: ['FHA'], updated_at: '2026-11-04T15:00:00Z' },
    ]
  })

  it('lists lenders with contact links and who updated them', async () => {
    const host = await mount()
    expect([...host.querySelectorAll('[data-lender]')].map((r) => r.getAttribute('data-lender'))).toEqual(['Acme Non-QM', 'Beta FHA'])
    const acme = host.querySelector('[data-lender="Acme Non-QM"]')
    expect(acme.querySelector('a[href="tel:7135550100"]')).not.toBe(null)
    expect(acme.querySelector('a[href="mailto:dana@acme.test"]')).not.toBe(null)
    expect(acme.textContent).toContain('1.5%')
    expect(acme.textContent).toContain('Updated Nov 5 · Shelby')
  })

  it('filters by search and program', async () => {
    const host = await mount()
    await type(host.querySelector('input[aria-label="Search lenders"]'), 'dana')
    expect(host.querySelectorAll('[data-lender]')).toHaveLength(1)
    await type(host.querySelector('input[aria-label="Search lenders"]'), '')
    await act(async () => btn('Filter FHA').click())
    expect([...host.querySelectorAll('[data-lender]')].map((r) => r.getAttribute('data-lender'))).toEqual(['Beta FHA'])
  })

  it('adds a lender', async () => {
    await mount()
    await act(async () => btn('Add lender').click())
    await type(document.querySelector('input[aria-label="Lender"]'), 'Gamma Bank')
    await type(document.querySelector('input[aria-label="Programs"]'), 'DSCR, ITIN')
    await act(async () => btn('Save lender').click())
    const ins = calls.find((c) => c[0] === 'insert')
    expect(ins[1]).toMatchObject({ lender: 'Gamma Bank', programs: ['DSCR', 'ITIN'] })
  })

  it('deletes after confirm', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await mount()
    await act(async () => btn('Edit Beta FHA').click())
    await act(async () => btn('Delete lender').click())
    expect(calls.some((c) => c[0] === 'delete')).toBe(true)
    expect(calls).toContainEqual(['eq', 'id', 'l2'])
  })
})
```

- [ ] **Step 2:** Run `npx vitest run src/components/reference/LendersTab.render.test.jsx`. Expected: FAIL.

- [ ] **Step 3: Implement `LendersTab.jsx`**

```jsx
import { useMemo, useState } from 'react'
import { useReferenceLenders } from '../../lib/useReferenceLenders'
import { Sheet } from '../QuickActions'
import Field from './Field'
import { parseAmount } from '../../lib/calc/parse'
import { formatPhone } from '../../lib/phone'

export const PROGRAMS = ['Bank statement', 'DSCR', 'ITIN', 'Foreign national', 'Non-warrantable condo', 'Conventional', 'FHA', 'VA']
const TONE = { accent: 'var(--text)' }
const shortDate = (iso) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' }).format(new Date(iso))
const firstName = (n) => String(n || '').trim().split(/\s+/)[0]
const EMPTY = { lender: '', ae_name: '', ae_phone: '', ae_email: '', portal_url: '', programs: '', min_fico: '', max_ltv: '', turn_time: '', comp_notes: '', notes: '' }

function LenderForm({ initial, onSave, onDelete, onClose, error }) {
  const [f, setF] = useState(() => (initial ? { ...EMPTY, ...Object.fromEntries(Object.entries(initial).map(([k, v]) => [k, v ?? ''])), programs: (initial.programs || []).join(', ') } : EMPTY))
  const [problem, setProblem] = useState(null)
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }))
  const save = () => {
    if (!f.lender.trim()) {
      setProblem('Enter the lender name.')
      return
    }
    onSave({
      ...initial,
      lender: f.lender.trim(),
      ae_name: f.ae_name.trim() || null,
      ae_phone: f.ae_phone.trim() || null,
      ae_email: f.ae_email.trim() || null,
      portal_url: f.portal_url.trim() || null,
      programs: f.programs.split(',').map((p) => p.trim()).filter(Boolean),
      min_fico: parseAmount(f.min_fico),
      max_ltv: parseAmount(f.max_ltv),
      turn_time: f.turn_time.trim() || null,
      comp_notes: f.comp_notes.trim() || null,
      notes: f.notes.trim() || null,
    })
  }
  return (
    <Sheet title={initial ? `Edit ${initial.lender}` : 'Add lender'} t={TONE} onClose={onClose}>
      <div className="grid grid-cols-2 gap-2">
        <Field className="col-span-2" label="Lender" value={f.lender} onChange={set('lender')} />
        <Field label="AE name" value={f.ae_name} onChange={set('ae_name')} />
        <Field label="AE phone" value={f.ae_phone} onChange={set('ae_phone')} />
        <Field className="col-span-2" label="AE email" value={f.ae_email} onChange={set('ae_email')} />
        <Field className="col-span-2" label="Portal URL" value={f.portal_url} onChange={set('portal_url')} />
        <Field className="col-span-2" label="Programs" value={f.programs} onChange={set('programs')} placeholder={PROGRAMS.slice(0, 3).join(', ')} />
        <Field label="Min FICO" value={f.min_fico} onChange={set('min_fico')} />
        <Field label="Max LTV %" value={f.max_ltv} onChange={set('max_ltv')} />
        <Field className="col-span-2" label="Turn time" value={f.turn_time} onChange={set('turn_time')} />
        <Field className="col-span-2" label="Comp and pricing" value={f.comp_notes} onChange={set('comp_notes')} />
        <label className="col-span-2 block">
          <span className="mb-0.5 block text-[11px] font-medium text-muted">Notes</span>
          <textarea aria-label="Notes" rows={3} value={f.notes} onChange={(e) => set('notes')(e.target.value)} className="w-full rounded-[8px] border border-line2 bg-panel2 px-2.5 py-1.5 text-[13px] outline-none" />
        </label>
      </div>
      {(problem || error) && <div className="mt-2 text-[12px] text-[#b42318]">{problem || error}</div>}
      <div className="mt-3 flex items-center gap-2">
        <button type="button" aria-label="Save lender" onClick={save} className="btn-primary rounded-[10px] px-4 py-2 text-[13px] font-semibold">
          Save
        </button>
        {initial && (
          <button type="button" aria-label="Delete lender" onClick={() => window.confirm(`Delete ${initial.lender}?`) && onDelete(initial.id)} className="ml-auto text-[12.5px] text-[#b42318]">
            Delete
          </button>
        )}
      </div>
    </Sheet>
  )
}

export default function LendersTab() {
  const { rows, loading, error, save, remove } = useReferenceLenders()
  const [q, setQ] = useState('')
  const [program, setProgram] = useState(null)
  const [editing, setEditing] = useState(undefined) // undefined closed, null new, row edit

  const programs = useMemo(() => [...new Set([...PROGRAMS, ...rows.flatMap((r) => r.programs || [])])], [rows])
  const shown = rows.filter((r) => {
    const text = `${r.lender} ${r.ae_name || ''} ${r.notes || ''} ${r.comp_notes || ''}`.toLowerCase()
    return (!q.trim() || text.includes(q.trim().toLowerCase())) && (!program || (r.programs || []).includes(program))
  })

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Search lenders" placeholder="Search lender, AE or notes" value={q} onChange={(e) => setQ(e.target.value)} className="min-w-[200px] flex-1 rounded-[8px] border border-line2 bg-panel2 px-2.5 py-1.5 text-[13px] outline-none" />
        <button type="button" aria-label="Add lender" onClick={() => setEditing(null)} className="rounded-[8px] border border-line2 px-3 py-1.5 text-[12.5px] font-semibold">
          + Add lender
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {programs.map((p) => (
          <button key={p} type="button" aria-label={`Filter ${p}`} aria-pressed={program === p} onClick={() => setProgram(program === p ? null : p)} className={`rounded-full border px-2.5 py-0.5 text-[11.5px] ${program === p ? 'border-[color:var(--text)] font-semibold' : 'border-line2 text-muted'}`}>
            {p}
          </button>
        ))}
      </div>
      {error && <div className="text-[12px] text-[#b42318]">{error}</div>}
      {loading ? (
        <div className="text-[13px] text-muted">Loading lenders…</div>
      ) : shown.length === 0 ? (
        <div className="text-[13px] text-muted">{rows.length ? 'No lenders match.' : 'No lenders yet. Add your first AE.'}</div>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((r) => (
            <li key={r.id} data-lender={r.lender} className="cc-card flex flex-col gap-1 p-3 text-[13px]">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold">{r.lender}</span>
                <button type="button" aria-label={`Edit ${r.lender}`} onClick={() => setEditing(r)} className="text-[12px] text-[#1d4ed8]">
                  Edit
                </button>
              </div>
              <div className="text-muted">
                {[r.ae_name, (r.programs || []).join(', '), r.min_fico ? `${r.min_fico}+ FICO` : null, r.max_ltv ? `${r.max_ltv}% LTV max` : null, r.turn_time].filter(Boolean).join(' · ')}
              </div>
              {r.comp_notes && <div>Comp: {r.comp_notes}</div>}
              {r.notes && <div className="whitespace-pre-line text-muted">{r.notes}</div>}
              <div className="flex flex-wrap items-center gap-3 text-[12.5px]">
                {r.ae_phone && <a href={`tel:${r.ae_phone}`} className="text-[#1d4ed8]">Call {formatPhone(r.ae_phone)}</a>}
                {r.ae_email && <a href={`mailto:${r.ae_email}`} className="text-[#1d4ed8]">Email</a>}
                {r.portal_url && <a href={r.portal_url} target="_blank" rel="noreferrer" className="text-[#1d4ed8]">Portal ↗</a>}
                {r.updated_at && <span className="ml-auto text-[11.5px] text-dim">Updated {shortDate(r.updated_at)}{r.updated_by_name ? ` · ${firstName(r.updated_by_name)}` : ''}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing !== undefined && (
        <LenderForm
          initial={editing}
          error={error}
          onClose={() => setEditing(undefined)}
          onSave={async (row) => (await save(row)) && setEditing(undefined)}
          onDelete={async (id) => (await remove(id)) && setEditing(undefined)}
        />
      )}
    </div>
  )
}
```

If `formatPhone` from `src/lib/phone.js` returns something other than a string for a 10-digit number, check its export (`grep -n "export function formatPhone" src/lib/phone.js`) and pass `r.ae_phone` through unchanged instead.

- [ ] **Step 4:** Run the test. Expected: PASS (4 tests).
- [ ] **Step 5:** Commit: `git add src/components/reference/LendersTab.jsx src/components/reference/LendersTab.render.test.jsx && git commit -m "feat: Reference lenders directory"`

---

### Task 12: Links tab

**Files:** Replace `src/components/reference/LinksTab.jsx`; test `src/components/reference/LinksTab.render.test.jsx`

- [ ] **Step 1: Failing render test**

```jsx
// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const calls = []
let ROWS = []
function query() {
  const q = {}
  for (const m of ['select', 'order', 'limit']) q[m] = () => q
  q.eq = (k, v) => (calls.push(['eq', k, v]), q)
  q.insert = (v) => (calls.push(['insert', v]), q)
  q.update = (v) => (calls.push(['update', v]), q)
  q.delete = () => (calls.push(['delete']), q)
  q.then = (resolve) => resolve({ data: ROWS, error: null })
  return q
}
vi.mock('../../lib/supabase', () => ({ isDemoMode: false, supabase: { from: () => query() } }))

const { default: LinksTab } = await import('./LinksTab')

async function mount(props = {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => createRoot(host).render(<LinksTab {...props} />))
  await act(async () => {})
  return host
}
const btn = (label) => document.querySelector(`[aria-label="${label}"]`)

describe('LinksTab', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    calls.length = 0
    ROWS = [
      { id: 'a', title: 'HAR.com', url: 'https://www.har.com/', grp: 'Property', sort: 1, copy_address: false },
      { id: 'b', title: 'HCAD (Harris)', url: 'https://hcad.org/', grp: 'Property', sort: 3, copy_address: true },
      { id: 'c', title: 'TREC license search', url: 'https://www.trec.texas.gov/license-search', grp: 'Licensing', sort: 2, copy_address: false },
    ]
  })

  it('shows tiles by group, opening in a new tab', async () => {
    const host = await mount()
    expect([...host.querySelectorAll('[data-link-group]')].map((g) => g.getAttribute('data-link-group'))).toEqual(['Property', 'Licensing'])
    const har = host.querySelector('a[data-link="HAR.com"]')
    expect(har.getAttribute('href')).toBe('https://www.har.com/')
    expect(har.getAttribute('target')).toBe('_blank')
  })

  it('address lookup builds search links and lists copy-address sites', async () => {
    const host = await mount({ initialAddress: '3042 Oak Forest Dr, Houston, TX 77018' })
    expect(host.querySelector('a[aria-label="Search HAR"]').getAttribute('href')).toContain('quicksearch=3042%20Oak%20Forest%20Dr')
    expect(host.querySelector('a[aria-label="Search Google Maps"]').getAttribute('href')).toContain('query=3042')
    expect(host.querySelector('a[aria-label="Search Zillow"]').getAttribute('href')).toContain('3042-Oak-Forest-Dr')
    expect(host.querySelector('[data-copy-sites]').textContent).toContain('HCAD (Harris)')
  })

  it('edit mode adds and deletes links', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const host = await mount()
    await act(async () => btn('Edit links').click())
    await act(async () => btn('Add link').click())
    const set = async (label, v) => {
      const el = document.querySelector(`input[aria-label="${label}"]`)
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    await set('Title', 'MERS')
    await set('URL', 'https://www.mers-servicerid.org/')
    await set('Group', 'Loan lookups')
    await act(async () => btn('Save link').click())
    expect(calls.find((c) => c[0] === 'insert')[1]).toMatchObject({ title: 'MERS', grp: 'Loan lookups' })
    await act(async () => btn('Delete TREC license search').click())
    expect(calls).toContainEqual(['eq', 'id', 'c'])
  })

  it('refuses a URL without http(s)', async () => {
    await mount()
    await act(async () => btn('Edit links').click())
    await act(async () => btn('Add link').click())
    const el = document.querySelector('input[aria-label="URL"]')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, 'har.com')
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => btn('Save link').click())
    expect(calls.some((c) => c[0] === 'insert')).toBe(false)
    expect(document.body.textContent).toContain('Start the URL with https://')
  })
})
```

- [ ] **Step 2:** Run `npx vitest run src/components/reference/LinksTab.render.test.jsx`. Expected: FAIL.

- [ ] **Step 3: Implement `LinksTab.jsx`**

```jsx
import { useState } from 'react'
import { useReferenceLinks } from '../../lib/useReferenceLinks'
import { groupLinks, lookupUrls, isHttpUrl, GROUP_ORDER } from '../../lib/referenceLinks'
import { Sheet } from '../QuickActions'
import Field, { copyText } from './Field'

const TONE = { accent: 'var(--text)' }
const TILE = 'inline-flex items-center rounded-[8px] border border-line2 px-3 py-1.5 text-[12.5px] hover:bg-hoverbg'

function LinkForm({ initial, onSave, onClose, error }) {
  const [f, setF] = useState(initial ? { ...initial } : { title: '', url: 'https://', grp: GROUP_ORDER[0], copy_address: false })
  const [problem, setProblem] = useState(null)
  const save = () => {
    if (!f.title.trim()) return setProblem('Enter a title.')
    if (!isHttpUrl(f.url)) return setProblem('Start the URL with https://')
    if (!f.grp.trim()) return setProblem('Enter a group.')
    setProblem(null)
    onSave({ ...f, title: f.title.trim(), url: f.url.trim(), grp: f.grp.trim() })
  }
  return (
    <Sheet title={initial ? `Edit ${initial.title}` : 'Add link'} t={TONE} onClose={onClose}>
      <div className="flex flex-col gap-2">
        <Field label="Title" value={f.title} onChange={(v) => setF((s) => ({ ...s, title: v }))} />
        <Field label="URL" value={f.url} onChange={(v) => setF((s) => ({ ...s, url: v }))} />
        <Field label="Group" value={f.grp} onChange={(v) => setF((s) => ({ ...s, grp: v }))} />
        <label className="flex items-center gap-2 text-[12.5px]">
          <input type="checkbox" checked={!!f.copy_address} onChange={(e) => setF((s) => ({ ...s, copy_address: e.target.checked }))} />
          Show under "Copy address" in the lookup
        </label>
      </div>
      {(problem || error) && <div className="mt-2 text-[12px] text-[#b42318]">{problem || error}</div>}
      <button type="button" aria-label="Save link" onClick={save} className="btn-primary mt-3 rounded-[10px] px-4 py-2 text-[13px] font-semibold">
        Save
      </button>
    </Sheet>
  )
}

export default function LinksTab({ initialAddress = '' }) {
  const { rows, loading, error, save, remove, move } = useReferenceLinks()
  const [address, setAddress] = useState(initialAddress)
  const [editMode, setEditMode] = useState(false)
  const [editing, setEditing] = useState(undefined)
  const [copied, setCopied] = useState(false)
  const groups = groupLinks(rows)
  const copySites = rows.filter((r) => r.copy_address)
  const urls = lookupUrls(address)
  const has = address.trim().length > 0

  return (
    <div className="flex flex-col gap-4">
      <div className="cc-card flex flex-col gap-2 p-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-dim">Address lookup</div>
        <input aria-label="Property address" placeholder="Street, city, state zip" value={address} onChange={(e) => setAddress(e.target.value)} className="rounded-[8px] border border-line2 bg-panel2 px-2.5 py-1.5 text-[13px] outline-none" />
        {has && (
          <div className="flex flex-wrap items-center gap-2">
            <a aria-label="Search HAR" href={urls.har} target="_blank" rel="noreferrer" className={TILE}>HAR</a>
            <a aria-label="Search Google Maps" href={urls.maps} target="_blank" rel="noreferrer" className={TILE}>Google Maps</a>
            <a aria-label="Search Zillow" href={urls.zillow} target="_blank" rel="noreferrer" className={TILE}>Zillow</a>
            <button type="button" className={TILE} onClick={async () => setCopied(await copyText(address.trim()))}>
              {copied ? 'Copied' : 'Copy address'}
            </button>
          </div>
        )}
        {has && copySites.length > 0 && (
          <div data-copy-sites className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
            Then paste it into:
            {copySites.map((s) => (
              <a key={s.id} href={s.url} target="_blank" rel="noreferrer" className="text-[#1d4ed8]">
                {s.title} ↗
              </a>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-dim">Quick links</div>
        <div className="flex gap-3 text-[12.5px]">
          {editMode && (
            <button type="button" aria-label="Add link" onClick={() => setEditing(null)} className="font-semibold text-[#1d4ed8]">
              + Add link
            </button>
          )}
          <button type="button" aria-label="Edit links" aria-pressed={editMode} onClick={() => setEditMode((e) => !e)} className="text-muted">
            {editMode ? 'Done' : 'Edit'}
          </button>
        </div>
      </div>
      {error && <div className="text-[12px] text-[#b42318]">{error}</div>}
      {loading && <div className="text-[13px] text-muted">Loading links…</div>}
      {groups.map(({ grp, links }) => (
        <section key={grp} data-link-group={grp}>
          <div className="mb-1.5 text-[12px] font-semibold text-muted">{grp}</div>
          <div className="flex flex-wrap gap-2">
            {links.map((l) =>
              editMode ? (
                <span key={l.id} className={`${TILE} gap-2`}>
                  <button type="button" aria-label={`Edit ${l.title}`} onClick={() => setEditing(l)}>{l.title}</button>
                  <button type="button" aria-label={`Move ${l.title} up`} onClick={() => move(l, links, -1)} className="text-dim">↑</button>
                  <button type="button" aria-label={`Move ${l.title} down`} onClick={() => move(l, links, 1)} className="text-dim">↓</button>
                  <button type="button" aria-label={`Delete ${l.title}`} onClick={() => window.confirm(`Delete ${l.title}?`) && remove(l.id)} className="text-[#b42318]">×</button>
                </span>
              ) : (
                <a key={l.id} data-link={l.title} href={l.url} target="_blank" rel="noreferrer" className={TILE}>
                  {l.title}
                </a>
              ),
            )}
          </div>
        </section>
      ))}
      {editing !== undefined && (
        <LinkForm
          initial={editing}
          error={error}
          onClose={() => setEditing(undefined)}
          onSave={async (row) => {
            const sort = row.id ? row.sort : Math.max(0, ...rows.filter((r) => r.grp === row.grp).map((r) => r.sort)) + 1
            if (await save({ ...row, sort })) setEditing(undefined)
          }}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 4:** Run the test. Expected: PASS (4 tests).
- [ ] **Step 5:** Commit: `git add src/components/reference/LinksTab.jsx src/components/reference/LinksTab.render.test.jsx && git commit -m "feat: Reference quick links and address lookup"`

---

### Task 13: "Look up property" on the Loan tab

**Files:** Modify `src/lib/useContactCard.js`, `src/components/PersonSheet.jsx`, `src/components/PersonSheet.render.test.jsx`

- [ ] **Step 1: Failing test**

In `PersonSheet.render.test.jsx`, change the `contacts` mock to include addresses:

```js
    if (table === 'contacts') return { data: { first_note: DATA.firstNote, owner: 'Chandler Atkinson', tags: ['DSCR'], external_id: '2972', addresses: [{ street: '3042 Oak Forest Dr', city: 'Houston', state: 'TX', code: '77018' }] }, error: null }
```

Add to the Loan test, after the docs assertion:

```js
    const look = dialog.querySelector('a[data-lookup-property]')
    expect(look.getAttribute('href')).toBe('/reference?tab=links&address=3042%20Oak%20Forest%20Dr%2C%20Houston%2C%20TX%2077018')
```

Run `npx vitest run src/components/PersonSheet.render.test.jsx`. Expected: FAIL.

- [ ] **Step 2: Implement**

`src/lib/useContactCard.js`, the contacts select:

```js
      supabase.from('contacts').select('owner, tags:raw->tags, addresses:raw->addresses').eq('id', id).maybeSingle(),
```

`src/components/PersonSheet.jsx`:
- imports: `import { Link } from 'react-router-dom'` and `import { leadAddress } from '../lib/referenceLinks'` (check the file does not already import from `react-router-dom`; if it does, add `Link` to that import).
- `LoanTab` gets an `address` prop and renders, between the Lead form block and `<DocsChecklist …/>`:

```jsx
      {address && (
        <Link data-lookup-property to={`/reference?tab=links&address=${encodeURIComponent(address)}`} className="self-start text-[12.5px] font-semibold text-[#1d4ed8]">
          Look up property ↗
        </Link>
      )}
```

- the call site:

```jsx
            {tab === 'loan' && <LoanTab loan={loanView({ firstNote: notes.firstNote, board })} contactId={id} onDocsChange={load} address={leadAddress({ addresses: extra.contact?.addresses })} />}
```

If the Person sheet renders outside a router anywhere (check `grep -rn "PersonSheetHost" src --include=*.jsx`), every host is inside `BrowserRouter` in `App.jsx`; the render test mounts it the same way the existing tests do. If the existing test has no router and `Link` throws, wrap the test's render in `MemoryRouter`.

- [ ] **Step 3:** Run `npx vitest run src/components/PersonSheet.render.test.jsx src/lib/contactCard.test.js`. Expected: PASS.
- [ ] **Step 4:** Commit: `git add src/lib/useContactCard.js src/components/PersonSheet.jsx src/components/PersonSheet.render.test.jsx && git commit -m "feat: Look up property from a lead's Loan tab"`

---

### Task 14: Full suite, build, browser check

- [ ] **Step 1:** `npx vitest run`. Expected: all pass (the 2 known unhandled errors may print).
- [ ] **Step 2:** `npx vite build`. Expected: built, no errors.
- [ ] **Step 3:** If a dev-server preview is available, open `/reference` and check each calculator on a phone width (375px): no sideways scroll, the bank statement table fits. Otherwise note that the check happens on the live site after merge.
- [ ] **Step 4:** Commit any fixes.

---

### Task 15: Rollout (each step needs Chandler's OK in chat)

- [ ] Push `feat/reference-section`, open the PR.
- [ ] `npx supabase db push --dry-run` (only 0058), then with OK `npx supabase db push`.
- [ ] `npx supabase db query --linked -f supabase/tests/reference.sql`. Expected: exits 0.
- [ ] Merge; open `/reference` on the live site: each calculator, Lenders empty state, Links tiles, the address lookup, and "Look up property" from a Bayway lead.
