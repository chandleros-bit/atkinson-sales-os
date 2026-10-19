# Priority Queue ("Up Next"): Design

**Date:** 2026-10-18
**Status:** Draft, pending Chandler's review
**Depends on:** PR #19 (merged). Works without Quick Actions, and uses them automatically once `2026-10-18-quick-actions-writeback-design.md` ships.
**Touches:** new migration `0029_priority_queue.sql` (view, stage tracking, snoozes, settings), new `src/lib/priorityQueue.js` + tests, new `src/pages/Priority.jsx`, `src/App.jsx`, `src/components/Sidebar.jsx`, `src/pages/Overview.jsx`

## Problem

Leads slip in predictable ways, and today the dashboard only catches one of them.

- A new lead comes in and nobody calls for two days.
- A lead calls or texts back and the callback gets lost.
- A follow-up task passes its due date.
- A lead is mid-pipeline with no next step scheduled at all.
- A HOT lead goes three days without a touch.
- A file sits in one stage for weeks.

Today's tools each show a slice. Priority Leads ranks how *engaged* a Bayway lead is, not how *neglected*. Needs Attention lists HOT and Open leads with a 7-day stale flag. Tasks shows what's scheduled, but not who has nothing scheduled. Nothing combines both books, and nothing tells Chandler "these are the people to call next, in this order, and here's why."

## What it is

One ranked list across both books, at `/priority`, titled **Up Next**. Every row is a lead plus the reason it's on the list. The list is ordered by reason, worst first, so the most urgent person is always the top row. A lead leaves the list when the reason is resolved: a call or note is logged, a task is scheduled, or the stage moves. There's no separate "mark done" button.

This builds on Priority Leads, it doesn't replace it. That page stays as the engagement view. This page is the "who am I about to lose" view, and it uses the Priority Leads score to break ties.

## The reasons (buckets), in rank order

Each lead is checked against every rule. It's shown once, under its **highest** bucket, with any other reasons as small chips on the row.

| # | Bucket | Rule | Why this rank |
|---|---|---|---|
| 1 | **They reached out** | Latest inbound call or text is newer than the latest outbound touch | Someone asked for you. Fastest way to lose a warm lead is to not call back. |
| 2 | **New, not yet called** | Created in the CRM within the last 7 days, and zero outbound calls | Speed to lead. Odds drop sharply after the first hour. |
| 3 | **Follow-up overdue** | Has an open task with a due date before today | You already decided to call. The date passed. |
| 4 | **Hot, going cold** | Bayway: HOT tag or `tier = 'hot'`. MPG: Lead Status in the "hot" list (see Decisions). No human touch in 3+ days | High intent with no recent contact. |
| 5 | **No next step** | In an active stage, no open task at all | Nothing will remind you, so this is the classic crack. |
| 6 | **Stuck in stage** | Same stage for 14+ days | The file isn't moving. Needs a push or a decision. |
| 7 | **Gone quiet** | In an active stage, no human touch in 7+ days | General neglect. Lowest rank because buckets 3 to 6 catch most of these first. |

**Inside a bucket,** sort by days neglected (oldest first). For bucket 2, sort newest first, since minutes matter most on brand-new leads. Ties break on the Priority Leads score (Bayway) and then name.

**Who is excluded everywhere:** stage Nurture, closed won or lost, Bayway stages marked lost on the board, MPG Lead Statuses in the "dead" list (see Decisions), and anyone snoozed (see below).

## "Human touch" means a real touch, not any edit

This is the most important data rule in the spec. **Do not use `contacts.last_touch_at`** for any rule here. For FUB it falls back to `person.updated` (`_shared/fub.ts`, `mapContact`), so a tag change, an automation, or a stage edit counts as a "touch." That would hide exactly the leads this feature exists to catch.

Instead, compute from the `activities` table:

- **last_outbound_at:** latest `call` with `direction = 'outbound'`, or any `note` or `appointment`. Notes count because a logged note means a human looked at the file.
- **last_inbound_at:** latest `call` with `direction = 'inbound'`. Texts join this once FUB texts are synced (deferred today, per the Phase 11 notes).
- **human_touch_at:** the later of the two.

**Setup check before building.** The scoring code notes that "this account logs almost no FUB activity." If most calls happen outside FUB and Zoho, every lead will look neglected and the list will be noise. Run this in the SQL editor first:

```sql
select business_id, count(*) filter (where occurred_at > now() - interval '30 days') as last_30d
from activities where type = 'call' and direction = 'outbound'
group by business_id;
```

If the 30-day counts look roughly like the real number of dials, build as specified. If they're far lower, the fix is upstream, not in this feature: get calls logged (Quick Actions does this, and so does calling from the FUB app). Until then, set `use_crm_last_activity_fallback: true` in settings, which uses FUB's own `lastActivity` (never `updated`) and Zoho's `Last_Activity_Time` as a backup touch date. Default is `false`.

## Data model: migration `0029_priority_queue.sql`

### 1. Stage tracking (for bucket 6)

Today there is no record of when a lead entered its stage. The Bayway stage is derived from `Imported Stage:` tags inside the view `v_active_pipeline`, and `deals.stage_entered_at` is empty because deals aren't synced.

- Move the stage expression out of `v_active_pipeline` into a SQL function `derive_stage(raw jsonb, person_stage text, business_id text) returns text`, and have the view call it. Its output must not change; add a test query in the migration comments comparing old and new.
- Add `contacts.stage_key text` and `contacts.stage_since timestamptz`.
- Add a `before insert or update` trigger on `contacts`. It computes `derive_stage(...)` (for MPG, `person_stage`) and, when the result differs from `old.stage_key`, sets `stage_key` to it and `stage_since = now()`.
- **Backfill:** set `stage_key` for everyone and leave `stage_since` null. Bucket 6 only fires on leads with a non-null `stage_since`, so it starts working on its own as stages change. The page shows "Stage tracking started <deploy date>" under that bucket until it has 14 days of history. This is honest, and it doesn't flag the whole book as stuck on day one.

### 2. Signals view

One row per **candidate** lead, so the browser never loads the full book:

```
v_lead_signals (security_invoker = on)
  id, business_id, name, company, phone, crm_profile_url,
  stage, stage_since, is_hot, score, tier,
  crm_created_at,          -- FUB raw->>'created', Zoho raw->>'Created_Time'
  last_outbound_at, last_inbound_at, human_touch_at,
  open_task_count, next_task_due_at, overdue_task_count, oldest_overdue_due_at,
  crm_last_activity_at     -- FUB raw->>'lastActivity', Zoho raw->>'Last_Activity_Time'; only for the fallback
```

**Candidate filter** (a lead is in the view if any is true): in an active stage; HOT or tier hot; created in the last 7 days; has an open task; has an inbound call newer than its last outbound. Exclusions from the section above are applied in the view.

Activity and task aggregates come from `lateral` subqueries using the existing indexes (`activities_feed_index` from `0011`, `idx_tasks_contact` from `0017`). Check `explain analyze` on the live data and add `activities (contact_id, type, direction, occurred_at desc)` only if needed.

### 3. Snoozes (app-owned, writable)

Sometimes the right call is "not today" (the borrower is traveling, the merchant said call after the 1st). Snoozing is local to the dashboard and never touches the CRM.

```sql
create table lead_snoozes (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid not null references contacts(id),
  until_date  date not null,
  reason      text,
  user_id     uuid not null default auth.uid(),
  created_at  timestamptz not null default now()
);
-- RLS: authenticated select/insert/delete where user_id = auth.uid().
```

The view excludes contacts with a snooze where `until_date > current_date` (Chicago time; use `(now() at time zone 'America/Chicago')::date`). A lead snoozed 3 or more times in 60 days gets a **"Decide"** chip: move it to Nurture or let it go. This stops snooze from turning into a second place for leads to slip.

### 4. Settings

```json
key: "priority_rules"
{
  "new_lead_days": 7,
  "hot_cold_days": 3,
  "quiet_days": 7,
  "stuck_days": 14,
  "daily_cap": 15,
  "use_crm_last_activity_fallback": false,
  "mpg_hot_statuses": ["Contacted", "Interested"],
  "mpg_dead_statuses": ["Junk Lead", "Lost Lead", "Not Qualified", "Not Contacted"]
}
```

These are read by the browser. Editing them belongs on the Settings page later; for now they're changed in SQL. **Verify the MPG status lists** against the real Zoho Lead Status picklist before shipping. The values above are Zoho's stock defaults, and the Overview's `isMpgOpen` shows this org uses "Open."

## Ranking logic: `src/lib/priorityQueue.js` (pure, unit-tested)

```
// rows: v_lead_signals rows. rules: settings.priority_rules. now: injected.
// Returns [{ ...row, bucket, reasons: [bucket ids], daysNeglected, decide }]
// sorted by bucket rank, then the in-bucket order above.
buildQueue(rows, rules, now) -> QueueRow[]

bucketsFor(row, rules, now) -> bucket ids   // every rule that fires
humanTouchAt(row, rules) -> ISO | null      // applies the fallback flag
groupForDisplay(queue, cap) -> { visible, hiddenCount, counts }
```

Tests (one `describe` per bucket plus ordering):

- Each bucket fires on its rule and not one day short of it.
- A lead matching buckets 3 and 5 shows once, under 3, with a 5 chip.
- Bucket 2 is newest-first; every other bucket is oldest-neglect first.
- A Nurture or lost lead never appears, even if overdue.
- `stage_since = null` never fires bucket 6.
- With the fallback off, `crm_last_activity_at` is ignored; with it on, it counts as a touch.
- An inbound call older than the last outbound does not fire bucket 1.
- All date math uses Chicago local days, the same as `dayKey` in `reports.js`. A task due today at 5 PM is not overdue at 9 AM.

## Page: `src/pages/Priority.jsx` at `/priority`

**Header:** "Up Next", the business filter (All / MPG / Bayway, using the existing context), and a progress line: **"7 touched today · 15 to go."** "Touched today" counts outbound calls and notes logged today on leads that were in the queue. It's a feedback loop, not a quota.

**Daily cap.** Shows the top `daily_cap` rows (default 15), with "Show all 42" underneath. Fifteen people is a real morning. Forty-two is a list nobody finishes, and an unfinished list stops getting opened.

**Rows** are grouped under bucket headings with counts. Each row shows:

- Business badge (row's own color, per the existing rule)
- Name, plus company for MPG
- **The reason in plain words**, e.g. "Called you 2h ago, no callback", "New lead · 26 hours, not called", "Follow-up 3 days overdue", "HOT · 5 days since last touch", "Waiting on Docs · no next step", "In App Sent for 18 days"
- Other reason chips, and the "Decide" chip when it applies
- Stage pill and last human touch ("Last call 9d ago", or "No calls logged")
- Actions:
  - **Call:** a `tel:` link, so it dials from a phone.
  - **Open in CRM:** the existing `CrmLink`.
  - **Quick actions,** if `QuickActions` exists. Render it when the component is present; otherwise render only Call and CRM. After a successful action, reload the queue so the row drops off.
  - **Snooze:** Tomorrow, Next Monday, Pick a date, plus an optional reason.

**Empty state:** "Nobody slipping. Nice work." with the day's touched count.

**Mobile:** this page will mostly be used from a phone between calls. Single column under 640px, the whole row is tappable for Call, and actions sit in a bottom sheet. This is the first page that must work on a phone, so build it mobile first.

## Bubbling up elsewhere

- **Sidebar.** Add **Priority** as the first item under OVERVIEW, with a badge for the count in buckets 1 to 3 (the urgent ones). Use the dual gradient in All mode and the book color otherwise. This is the always-visible nudge.
- **Overview.** Replace the **Needs Attention** card with an **Up Next** card in the same grid slot: the top 5 rows and "See all →". Needs Attention's logic (HOT plus stale, Open plus stale) is a subset of buckets 4 and 7, so keeping both would show the same people twice with different rules. Remove `buildBayHotRows` and the attention builders only after the new card is live and matches.
- **Pipeline cards.** Out of scope here, but the same `bucketsFor` helper can put a small reason chip on each card later.

## Data fetch

One `fetchAllSettled` call on `v_lead_signals` (ordered by `id`, so it passes the row-cap audit), plus the `priority_rules` settings row and today's touched count (a bounded `activities` query with `.gte('occurred_at', startOfToday)`). Filter by business in the query when the filter isn't All. Refresh on page focus and after any action. No realtime.

## Acceptance

1. A test lead created in FUB today, with no calls, appears at the top under "New, not yet called" within one sync cycle.
2. Logging an outbound call on that lead (in FUB, or by Quick Action) removes it from that bucket after the next activity sync, or immediately with Quick Actions.
3. An inbound call from a lead puts them in "They reached out," above everything else, until an outbound call or note is logged.
4. A lead with an open task due yesterday shows "Follow-up 1 day overdue." Completing or pushing the task removes it.
5. A Bayway lead in "Waiting on Docs" with no open task shows "No next step." Scheduling any task removes it.
6. A Nurture lead with an overdue task never appears.
7. Snoozing until Monday hides the lead until Monday, then it comes back on its own. The third snooze in 60 days adds the "Decide" chip.
8. The sidebar badge equals the count of buckets 1 to 3 shown on the page, for each business filter.
9. The Overview "Up Next" card shows the same top 5 as the page.
10. No edits from a FUB automation (tag change, drip email) clear a lead from the list; only the touches defined above do.
11. The page is usable one-handed on a phone: tap a row, it dials.

## Decisions (defaults chosen, change any before planning)

1. **Thresholds:** new lead 7 days, hot going cold 3 days, gone quiet 7 days, stuck 14 days.
2. **Daily cap:** 15 rows, then "Show all."
3. **Notes count as a touch;** FUB automations and edits don't.
4. **Replace Needs Attention** on the Overview with the Up Next card.
5. **MPG hot and dead statuses:** Zoho stock values, to be checked against the real picklist.
6. **Sidebar badge counts buckets 1 to 3 only,** so it means "act now," not "you have a book."
7. **Same thresholds for both books** for v1. Split per book later if MPG's cold-call cadence needs it.

## Build order

1. Run the call-logging SQL check. Decide the fallback flag.
2. `derive_stage` refactor with a no-change check on `v_active_pipeline`; stage columns, trigger, and backfill.
3. `v_lead_signals`, `lead_snoozes`, and the `priority_rules` settings row.
4. `priorityQueue.js` with full tests.
5. `Priority.jsx`, mobile first, plus the route and sidebar item with badge.
6. Overview Up Next card, then remove Needs Attention.
7. Plug in `QuickActions` when that build lands.

## Out of scope

- Push or SMS alerts for bucket 1 and 2 (the speed-to-lead alert). This is the natural next step, and it reuses `bucketsFor` from a scheduled function.
- A morning email digest of the top 15.
- AI notes per lead (the reserved `ai_note` column stays unused).
- Texts and emails as touches until FUB texts are synced.
- Settings page UI for the rules.
- Deal-value weighting (deals aren't synced yet).
