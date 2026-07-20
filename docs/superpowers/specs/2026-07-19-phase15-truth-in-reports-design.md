# Phase 15 — Truth in Reports

**Date:** 2026-07-19
**Status:** Approved, ready for planning
**Supersedes parts of:** `2026-07-13-phase12-reports-design.md` (the `live | derived | manual` source model)

## Problem

`/reports` renders 39 metrics. Five of them are tagged `live` and read the `deals`
table: `loans_closed`, `loan_volume`, `pipeline_value`, `rev_closings`,
`rev_loan_volume`. Bayway does not run loans through FollowUpBoss Deals — the loan
pipeline lives in the Arive LOS, and FUB holds contacts and person-stages only.

So `deals` is empty, and those five cards render `0` and `$0` as if measured. That
is worse than a blank: a scoreboard that reports zero loan volume with the same
visual weight as a real number is actively misleading. Two derived metrics
(`rev_avg_per_closing`, `rev_combined_income`) inherit the problem.

Separately, 26 of the 39 metrics require manual entry, six of them daily. Some of
those have a real automated source available today and were only manual because
nothing had been built to read it.

## Root cause

The metric registry gives each entry a single `value` and a `source` label. That
model cannot distinguish **measured zero** from **nothing is measuring this**. Both
collapse to `0`.

## The model

Every metric card carries two slots:

- **`entered`** — what was typed into `metrics_daily`
- **`measured`** — what synced data can prove: `number | null`. `null` means *no
  source*, and must never render as `0`.

| Case | entered | measured | Card renders |
|---|---|---|---|
| Loan volume, pre-Arive | — | `null` | `—` + *"no source — Arive import pending"* |
| Calls, none logged in FUB | 20 | `0` | **20** + *"0 logged in FUB"* |
| Follow-ups, partly logged | 25 | `8` | **25** + *"8 completed in FUB"* |
| Total database | — | `828` | **828** |

`source` stops being a label and becomes a contract:

| Contract | Meaning |
|---|---|
| `manual` | entered only |
| `measured` | measured only |
| `both` | dual display — entered is primary, measured is the subline |
| `derived` | computed from other metrics |

Target, pace, and progress bar key off the **primary** number. A card with `20`
entered paces against 20, not against the 3 FUB logged.

## Scope

### In

1. Dual-value model in the registry and card renderer.
2. The five Arive metrics reclassified `both` with a `null` measured resolver — they
   read `—`, not `$0`, the day this ships.
3. `contacts.first_seen_at` → automated `new_contacts`, backfilled from history.
4. `tasks.completed_at` → automated `followups`.
5. `calls` and `live_conversations` resolvers reading `activities`.
6. FUB tag audit → decide the fate of the four `db_*` category metrics.

### Out (deferred, with reasons)

| Deferred | Reason |
|---|---|
| Arive CSV ingestion | Phase 16. Only work that writes to a table other features read; earns its own spec. |
| `zoho-activity-sync` (MPG calls) | Own phase. Live check found the Zoho `Calls` module holds **2 records, both cancelled, both `Call_Duration: null`, both `Who_Id: null`**. Building it is a full new edge function + mapper + cron for near-zero data. Its real payoff is unblocking the `/mpg/activity` placeholder, which should be its own phase's headline. |
| All MPG revenue metrics | Residual dollars do not exist in Zoho (only `Residual_Split` %). They live in the processor portal. Portfolio judged too small to justify ingestion. |
| Calendar-derived meeting counts | ICS mapper stores title, location, times only — no attendees, no description. Title-keyword matching would silently undercount. Rejected as false precision. |
| Entered-vs-logged gap as a tracked metric | The card subline already makes the gap visible. Turning it into a metric with its own target and history is a separate feature. |

## Data model

### Migration 0021 — `contacts.first_seen_at timestamptz`

- Nullable, `default now()`. **Not** included in the sync payload, so upserts set it
  on insert and never touch it on update. No sync-function change needed.
- Backfilled from `raw->>'created'`. `mapContact` stores the entire FUB person object
  in `contacts.raw` (`_shared/fub.ts:112`), so existing contacts get real first-seen
  dates and the metric has history from day one.
- **Unverified:** the `created` field name on FUB's person payload. Confirm against a
  live row before writing the backfill. If absent, the column stays null for existing
  rows and `new_contacts` counts from ship date forward. Nulls are never counted as
  "new today".

### Migration 0022 — `tasks.completed_at timestamptz`

- Set by the mapper when `is_completed` flips true.
- **Unverified:** FUB's completed-date field name. Fall back to the record's `updated`
  timestamp if absent.
- Partial index on `(business_id, completed_at)` where `is_completed`.
- `v_tasks` untouched — stays open-only (`0018`), `/tasks` screen unaffected.

Both migrations are additive and nullable. No backfill can break an existing read.

**Note:** completed tasks already sync. `tasks.is_completed` exists (0017) and
`fub-task-sync` already pulls any status on incremental runs
(`_shared/fub-tasks.ts:58`). Only the timestamp is missing.

## Backend

### Sync changes

One: `_shared/fub-tasks.ts` mapper sets `completed_at` alongside `is_completed`.
Nothing else in any sync function changes.

### New module `src/lib/measured.js`

`Reports.jsx` already fires 10 parallel queries and assembles results inline
(`Reports.jsx:210-219`). Four more resolvers would push it past readable, so the
measured side moves out:

- A descriptor per measured metric — table, window, reduction.
- Pure reducers taking already-fetched rows → `number | null`. Unit-testable with no
  Supabase mock, same pattern as `reports.js`.
- `Reports.jsx` keeps fetching and rendering. It stops computing.

### Resolvers

| Metric | Source | Reduction |
|---|---|---|
| `new_contacts` | `contacts.first_seen_at` | count in window, nulls excluded |
| `followups` | `tasks.completed_at` where `is_completed` | count in window |
| `calls` | `activities` type `call` | count in window |
| `live_conversations` | `activities` type `call` | count where duration ≥ threshold |

`live_conversations` counts connected calls, not dials. Reuse the duration threshold
already in `_shared/scoring.ts` rather than inventing a second definition. If the
duration field is absent from `activities.raw`, the resolver returns `null` and the
card degrades to entered-only.

**Known reality:** a six-month FUB pull returned 5 call records across 826 contacts.
Calls happen in FUB's dialer and mobile app but are not being logged. These resolvers
will read near-zero until that habit changes. That is the intended behavior — the
pipe exists before the habit, and the dual-value card makes the gap visible rather
than hiding it.

## Frontend

- `metricCardView(metric, entered, measured, target)` — resolves a primary number
  plus an optional subline. `buildTabModel` threads the second value through. Both
  stay pure; extend existing coverage.
- Registry gains optional `note` — the reason a measured value is absent. Only the
  five Arive metrics carry one today.
- `LogMetrics` includes any metric whose contract accepts entry (`manual` and `both`).
  Net effect: the five Arive metrics become typeable in the interim. The existing
  `${tab}-${biz}` form key and `periodDateFor` write path are unchanged, so no
  cross-period or cross-business write risk is reintroduced.
- Source badge reflects the contract instead of the old label.

No new routes, no new screens. One card component and one form filter.

## Contract assignments

| Contract | Count | Metrics |
|---|---|---|
| `both` | 4 | `calls`, `live_conversations`, `followups`, `new_contacts` |
| `both` (null resolver) | 5 | `loans_closed`, `loan_volume`, `pipeline_value`, `rev_closings`, `rev_loan_volume` |
| `measured` | 3 | `db_total`, `pre_approvals`, `applications` |
| `derived` | 5 | `weekly_conversations`, `rev_combined_income`, `rev_avg_per_closing`, `rev_avg_residual`, `rev_annualized` |
| `manual` | 22 | all remaining |

Total 39, unchanged.

The four `db_*` category metrics (`db_realtors`, `db_past_clients`,
`db_business_owners`, `db_prospects`) are counted in the 22 **pending the tag audit**.
If existing FUB tags map cleanly they move to `measured`; a partial map splits them.
This is the one assignment the spec deliberately leaves open, because it depends on
data only readable with an authenticated session.

**Phase 16 impact:** flipping the Arive metrics on is a swap of four resolver bodies.
No registry churn, no UI change.

## Task order

Two items gate the rest and must come first:

1. **Tag audit** — SQL snippet run in the Supabase SQL editor, returns tag frequency
   across all 828 contacts. `contacts` is `authenticated`-read, so this cannot run
   with the anon key. Output finalizes the registry.
2. **Field verification** — confirm `contacts.raw->>'created'` and FUB's completed-date
   field against live rows. Backfills are written after this, not speculatively.

## Testing

Extend the existing 202 tests.

- `measured.js` reducers: **empty input → `null`, not `0`** — the central assertion of
  this phase. Plus window boundaries and null-field exclusion.
- `metricCardView`: all four cases from the model table.
- Timezone: `first_seen_at` and `completed_at` are real timestamps, not the bare dates
  that caused the Phase 14 midnight-UTC bug — but "did this land today" must still use
  the same local-day boundary as `dayKey`/`dailySeries`, not UTC. A UTC comparison
  misfiles every evening event into tomorrow west of Greenwich. Tests run under
  `America/Chicago` so a regression fails. Mutation-check it, as in Phase 14.

## Rollout

- Migrations 0021/0022 are additive and nullable — safe to push ahead of the frontend.
- Deploy `fub-task-sync`, then open the PR.
- Merge normally. The Netlify single-contributor `--rebase` rule is dead as of the
  Vercel cutover.
- Verify in demo mode on port 5199 via a temp `.env.local` (cleaner than moving `.env`
  aside, which trips the auto-mode classifier). Screenshots time out in this
  environment — use `get_page_text` / `read_page`.
- The measured side cannot be demo-verified (needs real synced rows). The `—` vs `$0`
  fix is the one thing worth eyeballing on the live Vercel deployment once merged.

## Success criteria

1. No metric card renders `0` or `$0` when nothing is measuring it.
2. `new_contacts` and `followups` populate without typing.
3. `calls` and `live_conversations` show both the entered number and the FUB-logged
   number, and the gap is legible at a glance.
4. Phase 16 can turn on Arive metrics by editing resolvers only.

**Explicitly not a goal: a shorter entry form.** `both`-contract metrics still accept
entry, so the daily form keeps all six fields and the form overall *gains* five (the
Arive interim entries). This phase buys correctness and visibility, not less typing.
Typing drops only when logging habits change or Phase 16 lands — and at that point
the Arive five can move from `both` to `measured` and leave the form entirely.
