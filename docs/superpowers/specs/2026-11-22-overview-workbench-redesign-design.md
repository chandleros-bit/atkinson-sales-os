# Overview and Workbench redesign: Design

**Date:** 2026-11-22
**Status:** Design approved with the decisions below (2026-11-22). Nothing built. Mockups updated to the untimed work lists.
**Mockups:** [Overview Redesign](https://claude.ai/artifact/9pd45dDZVbaizy7Du6pMXP) (desktop and phone) · [Workbench redesign](https://claude.ai/artifact/J74KrvWUpMUnQES4kPmCns) (six screens). Mockup numbers and names are samples.
**Builds on:** `2026-10-22-workbench-design.md`, `2026-11-03-temperature-forecast-briefings-design.md`, `2026-10-30-arive-loans-import-design.md`, `2026-11-05-lead-sources-roi-design.md`, `2026-11-05-mpg-tracker-touch-log-design.md`, the Opportunities and Partners pages, and the Power Dialer (spec 2026-11-20).

---

## Problem

Overview has 11 cards in 4 rows (`src/pages/Overview.jsx`). It opens on numbers (KPI cards, a 30-day chart, a goals gauge, two donuts) and puts the work, "Up Next", in row 4. Workbench also lists calls and has grown its own money panel. The two pages repeat each other, and the forecast is drawn two ways with different goals.

## The split

One rule decides where everything goes:

| Workbench: **today** | Overview: **the month and the whole book** |
|---|---|
| The order of work: Next up and the Calls, Files and Partners work lists | Your day: today's work lists (counts) and Outlook meetings, each list linking into Workbench |
| The dialer and call logging | November goals and pace (monthly) |
| Today's counts: calls, files, partners | The forecast for both books |
| Hard dates (closing disclosure, lock expiry) | Loans in flight (Bayway) and Merchants in flight (MPG) |
| Flags on today's items, "At risk" | Book health: problem counts across the whole book |
| End-of-day wrap | Rate watch summary, source pull-through, trends |

Each page links to the other in one place: Overview's header button **Open Workbench →**; Workbench's side panel card **Gap to goal $X · Forecast on Overview →**. Neither page draws the other's cards.

Both pages follow the All / Bayway / MPG switch (`useBusiness`). Colors use the app tokens only: `--chrome` navy for actions, `--bay` green for Bayway, `--mpg` blue for MPG.

---

## Part A: Overview

Order, top to bottom. On a phone everything stacks in this order, with the new-lead strip and **Open Workbench** above Your day, and This week's focus directly above November goals.

### A1. Header

- Date, greeting, and one summary line built from A3 and A4: "Bayway is tracking $13.6K–$14.8K of $15K · MPG expects 2–3 of 3 new accounts · 13 items in Workbench". Each clause drops when its book is filtered out.
- Book switch, a sync pill (newest ok `sync_log` across FUB, Zoho and Arive; amber when any core source failed, as `SyncDot` does today), and the **Open Workbench →** button.
- `AlertBanner` (`deriveAlert`) stays, under the header.

### A2. Your day

- At the top, a strip for the newest uncalled new lead under 30 minutes old (the same rule Workbench uses for its banner): name, source, loan type, **Call in Workbench →**. Hidden when there is none.
- **Today's work:** three tiles, one per work list (Calls, Files, Partners), each with its count, a flagged count when any are flagged ("3 flagged"), and **Start**, which opens `/workbench?list=<key>`. No times: you work them when the day allows.
- **Meetings:** today's Outlook events (what `TodayAgenda` reads) as a timeline sorted by start time, each with a Bayway or MPG mark the way `TodayAgenda` assigns them.
- Footer link: Calendar.

**A2a. Where the counts come from.** Workbench (B2) owns the work lists. Overview calls the same pure function, `workLists(...)`, so both pages show identical counts.

### A2b. This week's focus

- Its own card at the top of the right-hand column, above November goals (the two stack in the column beside Your day). Keeps today's `WeeklyFocusCard` content (`loadWeeklyFocus`, `setFocusTaskDone`): the focus title and note the Growth bot sets Monday, its 3 tasks as checkboxes with due days, "N of 3 done" and the book, the Friday check-in line when there is one, and a **Workbench →** link.
- When no focus is set, one muted line: "No focus set for this week yet."

### A3. November goals

- Five rows, the briefing goals: Calls, Bayway applications, Bayway loans funded, MPG proposals (merchants moved to Zoho **Submitted** this month), MPG new accounts. Value / target, a bar, and a pace word: **On pace**, **Behind**, or a fact when pace is not meaningful ("2 closing", "1 signed").
- Pace = value ≥ target × (days elapsed / days in month). Reuse `monthlyGoals` in `overviewDash.js`, narrowed to these five keys.
- One footer line names the most behind goal and the nearest item that would move it, taken from the work list (e.g. a statement waiting to be quoted). Omitted when nothing is behind.
- Replaces the KPI cards and the Monthly Goals gauge.

### A4. November forecast (both books)

One card, two halves. Replaces `ForecastCard`, Income Mix and the old KPI money card. A **This month / Next month** toggle stays from the current card.

**Bayway half (dollars).** From `forecastLines` / `forecastByMonth` in `src/lib/forecast.js`, split into three layers:

| Layer | Source | Shown as |
|---|---|---|
| Funded | Arive loans funded this month, `estComp` | Exact |
| Closing | Arive loans with pay month = this month, not funded, × `arive_odds` | Exact (expected value) |
| Leads | Rated leads with no Arive loan, × `temp_odds` | A **range**: low = Hot only, high = Hot + Warm + Cold |

- Headline = Funded + Closing + Leads range ("$13.6K–$14.8K"), against the Bayway commission target. A pill says how far short or over.
- Stacked bar: navy funded, dark green closing, light green for the low end of the lead range and a lighter green for its high end.
- Legend rows name the closing loans ("Grant, Wells").

**MPG half (accounts).** Residuals are not flowing yet, so MPG shows new accounts, per the forecast spec: activated this month + approved but not activated + Σ odds of rated proposals, as a range (low = Hot only). It switches to dollars on its own once `mpgPerAccount` returns a value.

`forecast.js` gains `forecastLayers(lines, month)` → `{ funded, closing, leadsLow, leadsHigh, mpg: { activated, approved, low, high } }`. Pure and unit-tested. The Workbench gap card (B5) reads the same function.

### A5. Loans in flight (Bayway)

- Counts by Arive `stage_group`: prospect (Application), processing, underwriting, clear to close, and funded this month. Underwriting and clear to close come from `loans.stage` text inside the processing and closing groups; the mapping lives in `src/lib/loans.js` beside the stage groups.
- The 5 open loans closing soonest: name, amount, a 5-step milestone bar, closing date (`firm_closing_on`), and one flag line, the most urgent of:
  - closing disclosure due in ≤ 3 business days (`firm_closing_on` − 3 business days, TRID)
  - lock expires before closing (`lock_expires_on` < `firm_closing_on`) or within 5 days
  - docs requested 7+ days ago (borrower docs)
  - buyer's agent not updated in 7+ days (Partners last touch)
  - else "on track", in grey
- Link: Loans.

### A6. Merchants in flight (MPG)

Same shape as A5, using MPG's real stages. The mockup's labels (Interested, Statement in, Proposal out, Signed, Activated) were illustrative; Zoho's picklist is locked.

- Counts: walk-ins logged this month (`mpg_prospects` / `mpg_touches`), then Zoho stages **Open**, **Submitted**, **Approved**, and approved this month.
- The 4 most urgent open merchants: name, monthly volume if known, stage, and one flag line: in stage longer than the stage's rule (`pipelineKpis` "stuck"), no touch in 7+ days, or a follow-up due today.
- Three small tiles: active accounts, residual per month (Reports' `rev_monthly_residual`, "—" until entered), walk-in visits logged this month (`mpg_touches` of kind visit).
- Link: MPG pipeline.

### A7. Book health

Counts across the whole book, both businesses, each a link to the filtered list. Today's share already sits in Workbench's flags, so the card's subtitle says "Whole book".

| Row | Rule | Opens |
|---|---|---|
| Applications quiet 5+ days | Bayway app stage, no outbound touch in 5 days | Pipeline, filtered |
| Docs requested 7+ days ago | borrower docs outstanding ≥ 7 days | Loans / docs view |
| MPG stuck in stage | `pipelineKpis` stuck count for MPG | MPG pipeline, filtered |
| Overdue follow-ups | `v_tasks` past due, both books | Tasks, overdue |
| Partners quiet 30+ days | `touchStatus(p) === 'quiet'` (Partners) | Partners, quiet |

Rows with a count of 0 are hidden. When every row is 0: "Nothing slipping."

### A8. Rate watch (summary of Opportunities)

Opportunities already picks past clients daily (`opportunity_picks`, `opportunity_estimates`, `pmms_weekly`). This card does not compute anything new:

- Headline: this week's 30-year PMMS rate from `pmms_weekly`.
- Today's pending picks with `est_rate` ≥ PMMS + 0.75: name, the estimated rate and balance, and an estimated monthly saving (payment at `est_rate` − payment at PMMS on `est_balance`, 30-year, labeled **Estimate**).
- Link: Opportunities. Bayway only; hidden in the MPG view.
- The mockup's "anniversaries and birthdays" line is out of scope until Opportunities has that data.

### A9. Source pull-through

The Analytics ROI table (`src/lib/roi.js`), last 90 days, top 5 sources by funded or signed count. Bayway: lead → app → funded. MPG: lead → submitted → approved. Bar of three segments; percentage = last step ÷ leads. Replaces Lead Sources and Pipeline Mix. Link: Analytics.

### A10. Trends strip

One card, three cells: touchpoints over 30 days with the change vs the 30 days before (`activitySeries` totals and a small line), the 90-day sprint bars (`sprintPace`), and income this month by book (`incomeMix`). Replaces Activity & Production, 90-Day Sprints and Income Mix as full cards.

### Removed from Overview

KPI cards, Activity & Production chart, Monthly Goals gauge, Pipeline Mix donut, Lead Sources, Income Mix, Up Next, the standalone `ForecastCard`. Their helpers in `overviewDash.js` stay where a new card reuses them; the rest are deleted with their tests.

---

## Part B: Workbench

The Workbench redesign mockup is a larger change than this spec's Overview half. This part fixes the contract between the two pages and the pieces Overview depends on. The full Workbench flow (Next up card, after-call logging, open file, assistant view, end-of-day wrap) gets its own spec, `2026-11-xx-workbench-v2-design.md`, before it is built.

### B1. What Workbench owns

New-lead banner, hard dates, Next up, the three work lists, "New since 8:00", Parked, today's counts (calls, files, partners), "At risk" for today's flagged items, end-of-day wrap.

### B2. Work lists: `workLists({ dialRows, workGroups, themeRows })`

- New pure module `src/lib/workLists.js`. Three lists, **Calls**, **Files**, **Partners**, each ranked by dollars and deadlines as today. They have no start or end time: the order of work is fixed each morning, and Chandler works the lists whenever the day allows.
- Items: Calls = the dial list (`buildDialList`); Files = `buildWorkGroups` (estimates, applications, MPG work, work items); Partners = today's weekday theme list (`buildThemeList`).
- Each list returns `{ key, label, theme, count, flagged, items }`. Overview reads everything but `items`.
- Everywhere the mockups say "block" (Call block, File block, Relationship block, "top of the call block", "ran out of file time"), the build says the list name instead ("Calls", "Files", "Partners"; "top of Calls tomorrow").

### B3. Hard dates

From Arive loans: closing disclosure due (`firm_closing_on` − 3 business days) and lock expiry (`lock_expires_on`), shown when ≤ 14 days away, pinned above everything. Same rules as A5's flags, from one helper in `loans.js` (`hardDates(loans, now)`).

### B4. Removed from Workbench

The November money card and the Pipeline-by-stage card in the side panel. Their content is A4 and A5.

### B5. Gap card

One card in the side panel: "November · Bayway — Gap to goal $X", where X = target − (funded + closing + leadsLow) from `forecastLayers`, linking to `/#forecast`. When the gap is ≤ 0 it reads "Goal covered". Hidden in the assistant view, which shows no dollars.

---

## Shared rules

- **Business days** for the closing-disclosure rule skip Saturdays, Sundays and federal holidays. Add `addBusinessDays(date, n)` to a small date helper with tests.
- **Assistant view:** Overview is owner-only, as today. Workbench's assistant view never shows dollars, the gap card or the forecast.
- **Demo mode:** every new card has demo data in `demoData.js`, matching the mockup's sample people so both pages tell one story.
- **Empty states:** each card has one plain line ("No loans in flight", "Nothing slipping", "No picks above today's rate").

## Data needs

No new tables and no new settings.

Reads Overview adds: `loans` (via `fetchLoanBundle`, already loaded), `opportunity_picks` + `opportunity_estimates` for today, the newest `pmms_weekly` row, `partner_profiles` (quiet count), `mpg_prospects` / `mpg_touches` counts for the month, Outlook events (already read by `TodayAgenda`), and lead ratings (`useLeadRatings`). Reads it drops: the 60-day `activities` pull shrinks to what the trends cell needs.

## Testing

- Unit (vitest): `forecastLayers` (funded/closing/range math, MPG accounts fallback, month toggle), `workLists` (counts, flagged counts, weekday theme), `hardDates` and `addBusinessDays` (holidays, weekends), A5 and A6 flag precedence, A7 counts, A8 saving estimate.
- Render: `Overview.render.test.jsx` rewritten for the new cards in All, Bayway and MPG views, with empty states; `Workbench.render.test.jsx` asserts the money and pipeline panels are gone and the gap card links to the forecast.
- Manual: the phone layout at 390 px; the two pages' work-list counts match.

## Build order

1. `forecastLayers`, `hardDates`, `addBusinessDays`, `workLists` (pure, tested).
2. Overview A1–A4 and the Workbench gap card (B4, B5). Ships the split.
3. Overview A5–A7.
4. Overview A8–A10 and removal of the old cards.
5. Workbench v2 per its own spec.

## Decisions (Chandler, 2026-11-22)

1. **Lead range:** a range. Low = Hot only, high = all rated leads, each × odds (A4).
2. **MPG walk-ins:** walk-in visits logged this month (A6).
3. **No time blocks.** The work happens at different times each day, so Workbench groups work into three untimed **work lists** (Calls, Files, Partners), not "blocks" with set hours. No calendar matching and no block-time setting (A2, B2).
4. **MPG proposals** = merchants moved to Zoho **Submitted** this month (A3).

## Out of scope

Anniversary and birthday touches, Workbench v2's own screens (after-call, open file, assistant view, end-of-day), any new CRM writes, and changes to the briefing email.
