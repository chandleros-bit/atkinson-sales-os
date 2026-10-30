# Arive loans import — design

Date: 2026-10-30. Status: approved design, not built. This is the "Phase 16
Arive CSV ingestion" deferred in `2026-07-19-phase15-truth-in-reports-design.md`.

## Goal

Bring Bayway's loan pipeline from the Arive LOS into the OS. Chandler exports a
saved Arive Pipeline Report as CSV and uploads it on a new **Bayway › Loans**
page. The OS keeps one row per Arive loan, rebuilds Arive's three dashboard
panels (Pipeline Status, Lender Spread, Loans Funded), estimates commission per
loan, and switches the loan metrics in Reports and Overview from FUB "won"
deals to Arive data.

## Decisions (settled with the user)

- **Source:** a CSV export of a saved Arive Pipeline Report, uploaded by hand.
  No Arive API, no emailed reports (later phases can reuse the same mapper).
- **Approach:** the browser parses the CSV and upserts through supabase-js under
  the signed-in user. No new edge function.
- **Scenario / test files** (placeholder names or emails) are imported and
  flagged, never matched to contacts, and hidden from panels and metrics by
  default. A toggle shows them so totals can be checked against Arive.
- **Loan officer roles:** rows where the primary loan officer is
  `Chandler Dean Atkinson` are `primary`. Any other loan officer (today Ronnie
  Gaydos) means Chandler is the Loan Officer Assistant on the file: `assisted`.
  Both count in pipeline and metrics.
- **Commission estimate:** `primary` = 1.25% of loan amount; `assisted` = 50% of
  a 1.50% broker comp = 0.75% of loan amount. Chandler overrides any loan by
  hand; the import never overwrites the override.
- **Placement:** a new Bayway › Loans page. Reports and Overview read from it.

## The export (as delivered 2026-10-30)

One row per loan, header row, `M/D/YYYY` dates, plain-number amounts, quoted
fields where a value holds a comma (`"WestStar Title, LLC"`). Columns:

`Primary Borrower, Primary Loan Officer Name, Primary Borrower First Name,
Primary Borrower Last Name, Primary Borrower Email, Primary Borrower Cell Phone,
Co-Borrower, Co-Borrower Email, ARIVE Loan Id, Total Loan Amount, Loan Purpose,
Stage Name, Subject Property, Subject State, Docs Signed / Loan Closed,
Loan Funded, Lender, Firm Closing Date, Buyer Agent, Buyer Agent Company Name,
Buyer Agent Email, Buyer Agent Phone, Seller Agent, Seller Agent Company Name,
Seller Agent Email, Seller Agent Phone, Title Company`

**Required headers** (import refuses the file without them): `ARIVE Loan Id`,
`Stage Name`, `Total Loan Amount`, `Primary Loan Officer Name`,
`Primary Borrower`. Everything else is optional; a missing optional column
leaves its field null.

**Optional headers recognised now, not yet in the report:** `Application Date`,
`Note Rate`, `Loan Type`, `Loan Term`. Chandler will add them to the saved
report. They are stored when present; only `Application Date` changes behaviour
(see Pipeline Status).

Reconciliation from the delivered file (scenario files included, matching
Arive's own dashboard): Pre-Approved 7 / $2,780,827, Qualification 2 /
$1,277,000, Approved w/ Conditions 1 / $242,100, Clear To Close 1 / $676,000,
Loan Finalized 2 / $464,033, funded in 2026 3 loans / $1,104,233 (all purchase).

## Data

### Migration `0052_loans.sql`

`loans`, one row per Arive loan:

| Column | Source / meaning |
|---|---|
| `id` uuid pk | |
| `arive_loan_id` text unique not null | `ARIVE Loan Id` — upsert key |
| `business_id` text default `'bay'` | |
| `loan_officer` text | `Primary Loan Officer Name` |
| `role` text check (`primary`,`assisted`) | from `loan_officer` vs the setting |
| `borrower_name`, `borrower_first`, `borrower_last` text | |
| `borrower_email`, `borrower_phone` text | phone stored as 10 digits |
| `co_borrower_name`, `co_borrower_email` text | |
| `contact_id` uuid → `contacts(id)` on delete set null | matched at import |
| `amount` numeric | `Total Loan Amount`, null when blank |
| `purpose` text | `Purchase` / `Refinance` as exported |
| `stage` text | `Stage Name` as exported |
| `stage_group` text | `prospect` `processing` `closing` `funded` `adverse` `other` |
| `property_address`, `property_state` text | `Subject Property`, `Subject State` |
| `lender`, `title_company` text | |
| `closed_on`, `funded_on`, `firm_closing_on`, `application_on` date | |
| `rate` numeric, `loan_type` text, `term_months` int | optional headers |
| `buyer_agent_name`, `_company`, `_email`, `_phone` text | |
| `seller_agent_name`, `_company`, `_email`, `_phone` text | |
| `scenario_auto` bool not null default false | set by the import |
| `scenario_override` bool null | Chandler's toggle; import never writes it |
| `comp_override` numeric null | Chandler's commission; import never writes it |
| `raw` jsonb | the whole CSV row |
| `first_imported_at`, `last_seen_at`, `updated_at` timestamptz | |

Index on `(funded_on)` and `(stage_group)`. RLS: authenticated users select,
insert and update (the browser writes; no delete policy — the OS never deletes
loans).

One `settings` row, key `arive` (inserted `on conflict do nothing`; the app may
update it): `{ "lo_name": "Chandler Dean Atkinson", "primary_pct": 1.25,
"assisted_pct": 0.75 }`. The browser reads it with defaults filled in. RLS lets
authenticated users write the `arive` settings row and insert `sync_log` rows
with `source = 'arive'`.

Each confirmed import writes `sync_log` (`source = 'arive'`,
`records_upserted`, `status`, `message` = the preview summary).

### Stage groups

| Group | Arive stages |
|---|---|
| prospect | App Intake, Qualification, Pre-Approved |
| processing | Loan Setup, Disclosed, Submitted to UW, Approved w/ Conditions, Re-Submittal |
| closing | Clear To Close, Docs Out, Docs Signed |
| funded | Loan Funded, Broker Check Received, Loan Finalized |
| adverse | Adverse |
| other | any stage not listed; imported, and named as a warning in the preview |

Matching is case- and whitespace-insensitive. Display order follows the table.

### Derived values (computed in `src/lib/loans.js`, not stored)

- `isScenario = scenario_override ?? scenario_auto`
- `estComp = comp_override ?? amount × (primary_pct | assisted_pct by role) / 100` (null when amount is null)
- `isOpen = stage_group in (prospect, processing, closing)`
- `notInLatest = last_seen_at < latest arive sync_log ran_at`

## Import

`src/lib/csv.js` — RFC 4180 parser: quoted fields, doubled quotes, CRLF/LF,
trailing blank line, BOM. Returns header + rows as objects. No new dependency.

`src/lib/ariveImport.js` (pure, tested):

1. **Header check:** list missing required headers; refuse with that message.
2. **Row → loan:** trim strings, blanks → null; amounts via `Number` (strip
   `$` and `,`); dates `M/D/YYYY` → `YYYY-MM-DD`; phone → last 10 digits.
   Rows without a loan ID are skipped and counted.
3. **Role:** `primary` when `loan_officer` equals the setting's `lo_name`
   (case-insensitive, collapsed spaces), else `assisted`.
4. **Scenario detection** (`scenario_auto = true` if any):
   - email local part in `aaa`, `123`, `456`, `lead`, `test`, or domain in
     `noone.com`, `123.com`;
   - phone of one repeated digit (`1111111111`);
   - borrower first or last name, case-insensitive, equal to `test`, `tbd`,
     `client`, `dscr`, or the full name containing `cost sheet` or
     `renovation loan`.
   Misses (e.g. "Nydia NO") are fixed with the manual toggle.
5. **Contact match** (Bayway contacts only; scenario rows never match):
   email (case-insensitive) → phone (last 10 digits) → exact full name when
   exactly one contact has it. Otherwise null; counted as unmatched.
6. **Preview diff** against existing loans by `arive_loan_id`: new, updated
   (any import-owned field changed), unchanged, skipped, scenario, unmatched,
   unknown stages, and existing loans absent from this file.

**Confirm** upserts import-owned columns only and sets `last_seen_at` to the
import time on every row in the file (`first_imported_at` only on insert). A
loan absent from the file keeps its old `last_seen_at`, so it shows
"not in latest export". Nothing is deleted. Upsert in one request (the file is
small); on error, show the message and write a `sync_log` error row.

## UI

### Bayway › Loans (`/bayway/loans`)

Sidebar: a **Loans** item (Bayway only) under Pipeline.

- **Header:** "Import CSV" button, "Last import <relative time> · N loans", and a
  rates control (gear) to edit the `arive` setting (rates and loan officer name) — the
  Settings page is still a placeholder.
- **Import dialog** (`src/components/LoanImport.jsx`): pick file → preview
  counts and warnings → Confirm / Cancel.
- **Filters:** role (All / Mine / Assisted) and **Include scenario files**
  (off). Apply to panels and table.
- **Pipeline Status:** count, dollar total and a bar per stage, grouped as the
  stage table, Adverse last. Period selector shows **Now** (all loans) until any
  loan has `application_on`; then YTD and This month filter by `application_on`.
- **Lender Spread:** funded loans per lender in the period (YTD / this month /
  year), top three named, the rest as Others, with a ring.
- **Loans Funded:** count, volume, purchase vs refinance split, and a bar per
  month for the chosen year, by `funded_on`.
- **Loans table:** 25 per page (existing `Pager`). Borrower (links to the
  contact when matched), stage, amount, lender, role, closing or funded date,
  estimated commission (click to edit → `comp_override`; clear to reset),
  scenario toggle (→ `scenario_override`), "not in latest export" badge.
  Default sort: open loans by firm closing date, then funded newest first.

Demo mode renders a fixed set of fake loans.

### Metrics switched to Arive

All exclude scenario files and count both roles. A loan is funded in a window
when its `funded_on` falls in it. "This month" is the month window already
used by Reports.

| Metric | New source |
|---|---|
| Reports `loans_closed`, `rev_closings` | funded loans this month |
| Reports `loan_volume`, `rev_loan_volume` | sum of their `amount` |
| Reports `pipeline_value` | sum of `amount` on open loans |
| Reports `rev_gross_commission` | sum of `estComp` on funded loans this month (becomes `live`; manual entry for it is removed) |
| Reports sprint `bay_funded_loans` | funded loans in the sprint window (becomes `live`) |
| Overview "Loans closed", "Pipeline value", "Gross commission" | same as above; commission card tag changes from "Entered" to "Est. from Arive" |

Each switched Reports card's subline reads "Arive · imported <date>". With no
loans imported yet, those cards show `—` and "no Arive import yet", never `0`;
Overview keeps its current sources (FUB deals, entered commission) until the
first import.

`pre_approvals` and `applications` stay on FUB stages; they move to Arive in a
later change once `Application Date` is in the export.

## Testing

- `csv.test.js`: quotes, embedded commas and quotes, CRLF, BOM, blank tail.
- `ariveImport.test.js`: header check, mapping and dates, role, each scenario
  rule, contact match order, unknown stage, preview diff buckets. Fixture CSV
  with fake people only — the real export never enters the repo.
- `loans.test.js`: stage totals, lender spread with Others, funded by month,
  `estComp` with and without override, scenario filter, `notInLatest`.
- `Loans.render.test.jsx`: demo mode renders the three panels and the table.
- Manual check before merge: preview the real export locally and confirm the
  reconciliation numbers above (scenario files included).

## Out of scope

Arive API or emailed-report automation; Past Client retention tab and
anniversaries; realtor partner ROI (agent columns are stored for it); merging
Arive agents with FUB `contact_relationships`; writing anything back to FUB;
moving `pre_approvals` / `applications` to Arive.
