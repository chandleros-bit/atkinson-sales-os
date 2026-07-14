# Phase 12 — Reports / KPI Scoreboard (design)

Date: 2026-07-13
Status: approved

## Goal

Replace the `/reports` placeholder with a **KPI scoreboard** that reflects the
trackers in Chandler's "Atkinson Reports Dashboard" doc — daily/weekly activity
non-negotiables, pipeline KPIs, the database-asset goal, and the combined
revenue dashboard (the $27,500/month North Star).

The doc's metrics span three data realities: some are **live** in Supabase
today, some are **derivable** with caveats, and many have **no source yet**
(mortgage commission $, all merchant residual $, the daily/weekly human-activity
counts, the relationship-category split). Rather than wait on CRM wiring, this
phase pairs the live data with **manual trackers** so the scoreboard is usable
now, with a clean upgrade path as data gets wired.

## Decisions (from brainstorm)

- **Scope:** live data + manual trackers. Build everything that has live data,
  and add a lightweight manual-entry path (into the existing but empty
  `metrics_daily` table) for the metrics that don't. Full CRM wiring
  (FUB commission, Zoho residual $, contact categories) is explicitly **out of
  scope** this phase — those metrics render as manual until wired.
- **Layout:** time-horizon tabs — **Daily / Weekly / Monthly / Revenue** —
  each showing that horizon's scorecard from the doc.
- **Business split:** driven by the existing global MPG / Bayway / All filter
  (`BusinessContext`), same as every other screen. No per-page business toggle.
- **Targets:** seeded from the doc's numbers as code-level defaults, stored in
  the `settings` table (`metric_targets`), editable via a small modal on
  Reports. Progress bars and pace coloring read from there.

## Data reality (why the design is shaped this way)

Audited against the live schema, sync functions, and views. Three buckets:

**Live today**
- Bayway loan pipeline: count + total loan volume `$` by stage (`deals.value`,
  status `open`), via `v_active_pipeline` / `deals`.
- Loans closed + loan volume this month (`deals` where `status = 'won'`).
- Bayway activity counts — calls, notes, appointments — from `activities`
  (texts/emails are **not** synced; known FUB list-endpoint limitation).
- Total database size per book (`contacts` count).
- Stage distribution / funnel for both books.
- MPG leads by status (Zoho; currently thin — ~3 leads, 0 deals).

**Derivable (with caveats)**
- Pre-approvals / applications: countable from **current** stage membership
  ("App Sent", "Pre-Approved" in `LOAN_FLOW_ORDER`), **not** historical
  throughput — no stage-transition history is stored.
- New relationships added: `contacts` has no `created_at` (only `updated_at`),
  so daily "new contacts" can only be approximated → treated as **manual**.

**No source yet → manual**
- Mortgage commission `$` (FUB `deal.price` = loan amount; commission never
  mapped) and everything downstream (gross commission income, avg per closing,
  referral-source revenue — Bayway `referral_partner` is never mapped).
- All Merchant Services revenue: active merchants, processing volume, monthly
  residual, residual growth, avg residual/account (Zoho MPG deals have no dollar
  field — only `Residual_Split` % and free-text pricing).
- Daily/weekly human-activity scorecard: live conversations, follow-ups
  completed, referral asks, social minutes, realtor-vs-owner conversation
  splits, proposals/consultations, meetings (no CRM tags exist for these).
- The 5,000-database category split (Realtors / Past Clients / Business Owners /
  Prospects) — no category field on `contacts`.
- MPG activities entirely (Zoho sync pulls leads/contacts/deals, no activity
  feed).

## Architecture

### Metric registry (the organizing idea)

Every KPI in the doc is one entry in a single registry in `src/lib/reports.js`:

```
{
  key,        // stable metric_key, e.g. 'calls', 'loans_closed'
  label,      // display label
  tab,        // 'daily' | 'weekly' | 'monthly' | 'revenue'
  biz,        // 'mpg' | 'bay' | 'both'
  target,     // default from the doc (overridable via settings)
  source,     // 'live' | 'derived' | 'manual'
  unit,       // 'count' | 'currency' | 'minutes'
  format,     // optional value formatter hint
}
```

The registry drives all four tabs, the progress bars, pace coloring, and the
"manual / not connected yet" badges. When commission or residual data gets
wired later, a metric flips `manual` → `live` by editing one entry plus its
resolver — no page rewrites.

Pure, unit-tested helpers (matching the existing `lib/*.js` + `*.test.js`
convention):
- `metricsForTab(registry, tab, biz)` — filter/select what a tab renders.
- `pace(value, target)` → `'on'` | `'behind'` | `'none'` (drives coloring).
- `rollupWeek(dailyRows, weekStart)` — sum `metrics_daily` rows into
  week-to-date per key.
- `sumWon(deals, { from, to })` and `pipelineValue(deals)` — live money helpers.
- `deriveStageCounts(rows, stages)` — snapshot counts for pre-approvals/apps.

### Tabs

Each metric card renders **current → target**, a progress bar, pace coloring
(green on pace / gold behind / muted no-data), and a source tag when not live.

- **Daily** — outbound calls, live conversations, follow-ups, new contacts,
  referral asks, social minutes. Bayway calls/notes/appointments show a **live
  auto-count from `activities`** beside the input as a cross-check. Everything
  else is a "Log today" card → `metrics_daily`. A 7-day trend strip from
  `metrics_daily` history.
- **Weekly** — realtor conversations, business-owner conversations, past-client
  touches, new referral partners, merchant proposals, mortgage consultations,
  plus the 100-conversations weekly target. All manual, rolled up from daily
  logs into week-to-date vs. weekly target.
- **Monthly** — pipeline + database. Live: loans closed, loan volume,
  Bayway pipeline value, total database size. Derived: pre-approvals /
  applications (snapshot, labeled as such). Manual: realtor meetings, businesses
  contacted, owner conversations, proposals, new residual. Database Asset shows
  the live total toward 5,000; the category split renders as manual estimates
  with a "needs a category field to automate" note.
- **Revenue** — the $27,500/month scoreboard. Live: mortgage closings, loan
  volume. Manual (until wired): gross commission income, active merchants,
  processing volume, monthly residual — with avg-per-closing / avg-per-account /
  growth derived from entered values. Combined monthly income vs **$27,500** and
  annualized vs **$330K** shown prominently.

### Data model / backend

New migration `0012_reports_rls.sql`:
- Add authenticated **upsert** (insert + update) RLS policies on `metrics_daily`
  (today read-only, never written) and on the `settings` row keyed
  `metric_targets`. Everything else stays read-only. Edge Functions are
  unaffected (they use the service role).
- Manual metrics upsert into `metrics_daily` on
  `(business_id, date, metric_key)` — the table is already shaped for exactly
  this; `metric_key` values come from the registry.
- Targets stored in `settings` under `metric_targets` (JSONB), seeded in code as
  `DEFAULT_TARGETS` (the doc's numbers) and used as the fallback when the
  settings row is absent.

No changes to sync functions or any existing page.

### Files

- `src/pages/Reports.jsx` — replaces the placeholder route; tab shell + the four
  tab views (may split tab bodies into local components as they grow).
- `src/lib/reports.js` + `src/lib/reports.test.js` — registry, `DEFAULT_TARGETS`,
  and the pure helpers above.
- `supabase/migrations/0012_reports_rls.sql`.

Reads reuse `src/lib/supabase.js`; live queries hit `deals`, `activities`,
`contacts`, and the existing views the same way `Overview.jsx` does.

## Out of scope (this phase)

- Mapping FUB commission, Zoho residual `$`, or Bayway `referral_partner`.
- A `contacts.category` field / the automated 5,000-database split.
- A Zoho activity sync (MPG activity metrics stay manual).
- Historical stage-transition tracking (pre-approval/application throughput
  over time).
- The Settings page build-out — targets are edited via a modal on Reports this
  phase; surfacing them on `/settings` comes with that page's own phase.

## Testing

- `reports.test.js` covers the pure helpers: `metricsForTab` selection by
  tab/biz, `pace` thresholds (on/behind/none, incl. zero-target and no-data),
  `rollupWeek` aggregation across day boundaries, `sumWon`/`pipelineValue` money
  math, and `deriveStageCounts` snapshots.
- Manual verification in the browser preview (dev port 5199): log a daily
  metric, confirm it upserts and the progress bar + 7-day strip update; edit a
  target and confirm the bar re-scales; switch the global MPG/Bayway/All filter
  and confirm each tab re-slices.
