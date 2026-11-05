# Reference section: Design

**Date:** 2026-11-05
**Status:** Approved design; not built.

## Why

Chandler and Shelby keep calculators, lender contacts and property sites scattered across bookmarks, phones and spreadsheets. One Reference page in the OS puts the daily tools in one place for both of them.

## Decisions (2026-11-05)

- **First version:**
  - calculators: bank statement income, loan payment, DSCR, TRID dates;
  - Lenders (AE directory);
  - Links (pinned tiles and an address lookup).
- **No property data service** (no API, no scraping). HAR, Maps and Zillow open with the address in the link; HCAD and TitlePro247 get a copy-address button.
- **Bank statement:** expense factor 50% by default, editable; deposits entered month by month.
- **Access:** Shelby sees and edits everything in this section that Chandler does, comp and pricing notes included. Her access to the rest of the OS is unchanged.

## Second version (not in this spec)

Property lookup with RentCast (records, value, rent estimate, cached per lead) feeding the calculators; the scenario finder built on the Lenders data.

## Approach

One page, `/reference`, with three tabs. The calculators are pure functions run in the browser; nothing is saved. Lenders and links are two new tables, readable and writable by the owner and the assistant (`app_role() in ('owner','assistant')`), invisible to anyone else.

Rejected:
- Storing lenders and links in one `settings` JSON value: two people editing at once would overwrite each other.
- Linking out to a Google Sheet or Notion page: not in the OS, nothing to search or filter.

## 1. Page and navigation

- Route `/reference`, sidebar link "Reference" (icon `book`, or the closest existing icon) in the Insights group under Reports. The assistant does not see Reports, so for her the Insights group holds Reference alone.
- `roles.js`: the assistant's allowed paths add `reference`; the bottom phone nav follows `canVisit` as today.
- Tabs: Calculators, Lenders, Links. The tab is kept in the URL (`/reference?tab=lenders`) so a link can open a tab. Calculators has its own row of choices: Bank statement, Loan payment, DSCR, TRID dates (`?calc=dscr`).
- `/reference?tab=links&address=<text>` opens Links with the address box filled (used by the lead button, section 7).

## 2. Bank statement calculator

Inputs:
- Months: 12 or 24 (default 12).
- Account: Business or Personal (default Business).
- Ownership %: 1 to 100 (default 100).
- Expense factor %: 0 to 100; 50 for Business, 0 for Personal, set when the account type changes and editable after.
- One row per month, newest first, labeled from the current month backwards (e.g. Oct 2026 … Nov 2025): Deposits ($) and Exclude ($, transfers, refunds and unsourced cash).

Results:
- Counted per month = max(0, deposits − exclude).
- Average monthly deposits = sum of counted ÷ months, counting blank months as 0.
- Qualifying monthly income = average × (1 − expense factor) × ownership.
- Trend (24 months only): last 12 months' total against the prior 12, as a percent; shown as a warning color when negative.
- A month's row is flagged "large" when its counted amount is 50% or more above the average.
- Rows filled: "N of M months entered".

Actions: "Copy summary" puts a plain-text summary on the clipboard (inputs, average, qualifying income, trend, large months). "Clear" empties the rows.

## 3. Loan payment calculator

Inputs:
- Price.
- Down payment, typed as % or $ (a toggle); default 20%.
- Rate % (default empty; the result waits for it), term in years (30, 25, 20, 15, 10; default 30).
- Taxes per year: defaults to 2.2% of price, editable as $; once edited, a price change no longer resets it.
- Insurance per year ($), HOA per month ($).
- Mortgage insurance % per year, shown only when LTV is over 80%; default 0.5.
- Closing costs % of price (default 3).

Results:
- Loan amount = price − down payment; LTV = loan ÷ price.
- Principal and interest by the standard amortization formula (rate 0 means loan ÷ months).
- Monthly taxes, insurance, HOA, mortgage insurance (loan × MI% ÷ 12, only over 80% LTV).
- Total monthly payment.
- Cash to close = down payment + closing costs.
- "Copy summary".

## 4. DSCR calculator

Uses the same property and loan inputs as section 3 (the two calculators share one input set, so switching keeps the numbers), plus:
- Monthly rent ($).
- Minimum DSCR (default 1.00).

Results:
- DSCR = rent ÷ total monthly payment (principal and interest, taxes, insurance, HOA; mortgage insurance included when present), two decimals, colored pass or fail against the minimum.
- Largest loan at the minimum: the payment budget is rent ÷ minimum − taxes − insurance − HOA (mortgage insurance left out); the loan is what that principal-and-interest budget pays for at the rate and term. Shown with its LTV against the price. If the budget is zero or below, it reads "Rent does not cover taxes, insurance and HOA at this minimum".
- "Copy summary".

## 5. TRID date calculator

Inputs: application date (default today, Chicago), delivery method (In person or email / Mailed), planned closing date (optional).

Two kinds of business day:
- **General** (Loan Estimate delivery): Monday to Friday, excluding federal holidays.
- **Specific** (waiting periods): every day except Sundays and federal holidays.

Federal holidays: the 11 US legal public holidays, computed per year (fixed dates moved to Friday or Monday when they fall on a weekend, plus Monday holidays such as Memorial Day and Thanksgiving's Thursday).

Results:
- Loan Estimate must go out by: application + 3 general business days.
- Loan Estimate counts as received: same day in person or email; mailed = sent + 3 specific business days.
- Earliest closing: Loan Estimate sent + 7 specific business days.
- If a closing date is given: the Closing Disclosure must be received by closing − 3 specific business days; if mailed, it must be sent 3 specific business days before that.
- A footnote: "Planning dates. The lender's disclosure system is the official record."

## 6. Lenders

Table `public.reference_lenders`:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `lender` | text not null | |
| `ae_name`, `ae_phone`, `ae_email` | text | |
| `portal_url` | text | |
| `programs` | text[] | tags, e.g. `Bank statement`, `DSCR`, `ITIN`, `Foreign national`, `Non-warrantable condo`, `Conventional`, `FHA`, `VA` |
| `min_fico` | int | |
| `max_ltv` | numeric | percent |
| `turn_time` | text | e.g. "UW 48h" |
| `comp_notes` | text | comp and pricing; visible to both |
| `notes` | text | |
| `updated_at` | timestamptz default now() | set on every update by a trigger |
| `updated_by_name` | text | from `user_roles.name`, set by the same trigger |

UI:
- Search box (lender, AE, notes) and program filter chips.
- One card or row per lender: lender, AE, programs, min FICO / max LTV, turn time; Call (`tel:`), Email (`mailto:`), Portal (new tab); "Updated Nov 5 · Shelby".
- Add and Edit open a form sheet with every field; Delete asks to confirm and is a real delete (reference data, no history kept).
- Starts empty; Chandler and Shelby enter their lenders.

## 7. Links

Table `public.reference_links`:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `title` | text not null | |
| `url` | text not null | must start with `https://` or `http://` |
| `grp` | text not null | group heading |
| `sort` | int not null default 0 | order within the group |
| `copy_address` | boolean not null default false | tile also shows "Copy address" in the lookup row |

Seeded by the migration (editable afterwards):
- **Property:** HAR.com, TitlePro247, HCAD (Harris), Fort Bend CAD, Montgomery CAD, Galveston CAD, Brazoria CAD, FEMA flood map, USDA eligibility map. TitlePro247 and the five appraisal districts have `copy_address = true`.
- **Business checks:** Texas Secretary of State (SOSDirect), Texas Comptroller taxable entity search.
- **Licensing:** NMLS Consumer Access, TREC license lookup.
- **Loan lookups:** Fannie Mae loan lookup, Freddie Mac loan lookup.

The build confirms each seeded URL opens the right page; any that moved are fixed in the migration before it is applied.

UI:
- Tiles grouped by `grp`, each opening its URL in a new tab.
- Edit mode (a toggle): add, rename, change URL or group, move up or down, delete with confirm.
- **Address lookup row:** a text box, then buttons:
  - HAR, Google Maps, Zillow: open in a new tab with the address in the link (Maps: `https://www.google.com/maps/search/?api=1&query=<address>`; Zillow: `https://www.zillow.com/homes/<address>_rb/`; HAR: its search URL with the address, confirmed during the build, falling back to a Google search limited to har.com if HAR has no address search link);
  - Copy address: copies the text, then shows the `copy_address` tiles as quick buttons.
- **From a lead:** on the Person sheet's Loan tab (Bayway), when the FUB record has a street address (`contacts.raw.addresses[0].street`; about 1,070 of 1,179 Bayway contacts have an address entry, city-only ones are skipped), a "Look up property" link opens `/reference?tab=links&address=<street, city, state zip>`.

## 8. Database (migration `0058_reference.sql`)

- Both tables with RLS on.
- Policies: select, insert, update, delete for `authenticated` using and with check `public.app_role() in ('owner','assistant')`.
- Trigger `reference_lenders_stamp` (BEFORE INSERT OR UPDATE): `updated_at = now()`, `updated_by_name = (select name from user_roles where user_id = auth.uid())`.
- `reference_links` check: `url ~* '^https?://'`.
- Seed rows for `reference_links` (section 7).

## 9. Code layout

- `src/lib/calc/bankStatement.js`, `loanPayment.js`, `dscr.js`, `trid.js`: pure functions, each with its own tests. `trid.js` holds the holiday and business-day helpers (separate from `briefingTime.addBusinessDays`, which counts weekdays only and stays as is).
- `src/lib/referenceLinks.js`: address-to-URL builders and the lead address formatter (`leadAddress(raw)`), pure and tested.
- `src/lib/useReferenceLenders.js`, `src/lib/useReferenceLinks.js`: load and write the two tables.
- `src/pages/Reference.jsx` (tabs and URL state), `src/components/reference/` for `BankStatementCalc.jsx`, `LoanCalc.jsx` (payment and DSCR share it with a mode), `TridCalc.jsx`, `LendersTab.jsx`, `LinksTab.jsx`.
- Number inputs accept "$1,200", "1200" and "20%"; a shared `parseAmount` helper in `src/lib/calc/parse.js`.

## 10. Testing

- Calculator math against known answers:
  - payment: $400,000 at 7% for 30 years = $2,661.21 principal and interest;
  - qualifying income: 12 months averaging $40,000, 50% factor, 100% ownership = $20,000;
  - DSCR ratio and the largest-loan inverse round-trip (the largest loan's payment gives DSCR equal to the minimum within a cent);
  - TRID dates across a Sunday, a federal holiday (Thanksgiving 2026-11-26, Christmas 2026-12-25) and a Saturday-observed holiday (July 4, 2026 observed Friday July 3).
- `referenceLinks.js`: URL encoding, lead address from `raw.addresses` (street present, city-only skipped).
- Render tests: each calculator updates results on input; Lenders add/edit/delete calls the table; Links edit mode and the address row; the assistant sees the Reference link and can open `/reference`.
- `supabase/tests/reference.sql` (rolled back): owner and assistant can insert, update and delete in both tables; a login with no role reads nothing and cannot insert; the stamp trigger sets `updated_by_name`; a link without `http(s)://` is refused.
- Row-cap audit: lender and link reads carry a `.limit()`.

## Rollout (each step needs Chandler's OK)

1. Push and open the PR.
2. `supabase db push` (dry run first) for 0058.
3. Run `supabase/tests/reference.sql`.
4. Merge; check `/reference` on the live app as both logins if Shelby is available, otherwise as Chandler.

## Out of scope

Property data service, scenario finder, scripts and templates, loan limits table, saved calculator scenarios, attaching a calculation to a lead.
