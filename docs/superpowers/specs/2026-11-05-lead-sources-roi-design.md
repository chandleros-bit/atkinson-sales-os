# Lead Sources & ROI card (growth 1a): Design

**Date:** 2026-11-05
**Status:** Design approved; spec for review.
**Replaces:** PR 1a in `docs/superpowers/plans/2026-10-28-growth-features-roadmap.md` (written before the Arive import existed).

## Goal

Show, per lead source and book, what came in, what funded, what it earned and what it cost, on the Analytics Lead sources card.

## What changed since the roadmap

- **Real Bayway revenue exists.** The Arive import (0052) stores each loan with `funded_on`, `amount`, `role`, `comp_override` and a `contact_id` link to the FUB lead. `estComp(loan, rates)` in `src/lib/loans.js` already gives the commission. Today: 3 funded loans since 2026-10-05, 2 linked (Lendgo, Realtor Referral).
- **MPG has no won stage.** Current Zoho stages: Open, Not Contacted, Pending, Initial lead follow up, Closed non-compatible.
- **Roles.** Analytics is owner-only (`src/lib/roles.js` keeps the assistant out), so the new tables are owner-only and shared, not per-user.

So the roadmap's "Settings average revenue per close", `growth` settings key and per-user `user_id` columns are dropped.

## Decisions (Chandler, 2026-11-05)

1. **Bayway closed and revenue = funded Arive loans** and their real commission (`estComp`). Not FUB stage × average.
2. **Window = funded in the window.** Loans with `funded_on` in the last N days count, credited to the linked lead's source. Lead counts stay "leads created in the window", as today.
3. **MPG shows leads, contacted, qualified, spend and cost per lead.** No funded, revenue or cost per close until a won stage exists.

## Data

### Migration `0059_lead_roi.sql`

```sql
create table if not exists public.source_aliases (
  id       uuid primary key default gen_random_uuid(),
  book     text not null check (book in ('bay','mpg')),
  raw      text not null,               -- cleaned raw source as sourceTable shows it
  label    text not null,
  is_free  boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (book, raw)
);

create table if not exists public.marketing_spend (
  id       uuid primary key default gen_random_uuid(),
  book     text not null check (book in ('bay','mpg')),
  source   text not null,               -- the label after aliases
  month    date not null check (extract(day from month) = 1),
  amount   numeric(12,2) not null check (amount >= 0),
  updated_at timestamptz not null default now(),
  unique (book, source, month)
);
```

RLS on both: enabled, one policy "owner all" `for all to authenticated using (public.is_owner()) with check (public.is_owner())`. No anon access. A test script `supabase/tests/lead_roi.sql` (rolled back) checks the owner can write and the assistant can neither read nor write.

### Reads (Analytics page)

- The contacts query adds `id`, so a loan's `contact_id` maps to its lead's book and source.
- Loans and rates come from `fetchLoanBundle()` (`src/lib/loansData.js`). It already treats a missing `loans` table as empty.
- `source_aliases` and `marketing_spend` are read with `.limit()` (row-cap audit): aliases `.limit(500)`, spend `.limit(2000)`.

## Logic: `src/lib/roi.js` (pure, vitest)

- `aliasMap(rows)` returns `{ bay: Map(raw → { label, is_free }), mpg: … }`.
- `labelFor(raw, book, map)` returns the alias label, or the raw value.
- `isFree(label, book, map)` is true when any alias row for that label is free.
- `spendInWindow(spendRows, book, label, fromKey, toKey)` sums each month's amount × (days of that month inside the window ÷ days in the month). Days are counted on date keys (`keyDaysBetween`), so DST never skews it. It returns `null` when the source has no spend rows in the window.
- `fundedInWindow(loans, fromMs, toMs)` keeps loans that are Bayway, `stage_group = 'funded'`, not scenarios (`isScenario`), with `funded_on` in the window.
- `roiTable(sourceTable, { book, contactsById, loans, rates, spendRows, aliases, fromMs, toMs })` returns the `sourceTable` rows after merging by label, each with:
  - `funded` and `commission` (Bayway only), from the window's funded loans whose `contact_id` lead has that label;
  - `spend` (`null` = none entered; `'free'` when the label is free);
  - `costPerLead` = spend ÷ leads, and `costPerFunded` = spend ÷ funded. Each is `null` when spend is null/free or the divisor is 0.
- A funded loan with no `contact_id`, or whose contact isn't in the book, goes in a **"Not linked to a lead"** row: funded and commission only.
- Spend on a label that has no leads in the window still shows as a row (leads 0), so money is never hidden.
- The Total row sums leads, progress counts, funded, commission and spend. Its cost per lead and per funded use those totals.
- `kpis(table)` returns new leads, spend, cost per lead and cost per funded for the tiles (MPG: the first three).

`sourceTable` in `src/lib/analytics.js` is unchanged. `roiTable` merges its rows by label and re-derives `rate` from the merged counts.

## UI

### Card (`src/pages/Analytics.jsx`, `SourceTable` grows into the ROI table)

- Title "Lead sources and ROI", subtitle "Leads created and loans funded in the window. Spend prorated by day."
- Window picker keeps the current 30 days / 90 days / 12 months.
- Four KPI tiles per book shown: New leads, Spend, Cost per lead, Cost per funded (MPG: three).
- **Bayway columns:** Source, Leads, To app %, Funded, Commission, Spend, Per lead, Per funded.
- **MPG columns:** Source, Leads, Contacted, Qualified %, Spend, Per lead.
- Merged sources show "(n merged)". Free sources show "free" in Spend and "—" in both cost columns.
- Money is formatted as whole dollars; `null` shows "—".
- A **Spend** button sits next to the window picker.

### Spend sheet (`src/components/SpendSheet.jsx`, uses the existing `Sheet`)

- It opens for the book in view; on "All" it has a Bayway / MPG switch.
- **Grid:** one row per label (from the book's sources in the last 12 months plus any label with spend) and one column per month for the last 12 months, newest first. Cells are money inputs parsed with `parseAmount`. A blank cell means "no row", and clearing a cell deletes that month's row.
- A **Free** checkbox per row upserts `is_free` on that label's alias rows (creating a self-alias `raw = label` if there are none). Free rows collapse under "Free sources".
- **Merge:** pick two or more raw sources, type a label, Save. This upserts one `source_aliases` row per raw value. Each merged label shows its raw values with "Unmerge", which deletes those alias rows.
- **Save** writes the changed cells (upsert on `book, source, month`; delete for cleared cells) and changed aliases, then reloads the card. On error the sheet stays open with the message, and the in-memory edits are kept.

## Errors

- If the loans, aliases or spend reads fail, the card still renders lead counts with one line: "Couldn't load spend or loans: <message>". Analytics never blanks.
- Before migration 0059 is applied, a missing table reads as empty (same `isMissingTable` check).

## Testing

- `roi.test.js`:
  - aliases merge "Realtor" and "Realtor Referral" (counts add up, rate recomputed);
  - one month's spend prorated into a 30-day window that spans two months;
  - no spend gives null costs, not 0, and free gives "free";
  - a funded loan outside the window, a scenario loan and an MPG loan are left out;
  - an unlinked funded loan lands in "Not linked to a lead";
  - commission uses `comp_override` when set;
  - spend on a label with no leads still shows;
  - Total cost per lead uses the totals.
- `Analytics.render.test.jsx`: new columns and tiles render, Spend opens the sheet, and a failed spend read shows the error line while lead rows still show.
- `SpendSheet.render.test.jsx`: editing a cell and saving upserts, clearing deletes, merge writes alias rows, and a save error keeps the sheet open.
- `supabase/tests/lead_roi.sql`: owner can read and write, assistant can't.
- Full suite green, including the row-cap audit.

## Out of scope

- The Overview Lead sources card (keeps `sourceTable` as is).
- Partner share (needs Phase 2 links), speed to first contact, and the Integrations tab (PR 1b).
- MPG funded and revenue (waits on a won stage).
- Marketing items adding to spend (Phase 3).
