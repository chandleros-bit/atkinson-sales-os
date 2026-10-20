# Tier 1 Pipeline Flow: Design

**Date:** 2026-10-19
**Status:** Approved in chat 2026-10-19 (Chandler: keep all recommendations; stuck thresholds unchanged)
**Source:** CRM comparison in chat (Pipedrive, FollowUpBoss, monday CRM). Tier 1 = suggestions 1–4 plus 12 (speed-to-lead), moved up by Chandler.

## Problem

The board shows where a lead *is* but not whether it is *moving*. A card in Attempted looks the same whether its follow-up is tomorrow, three days overdue, or missing. New leads sit with no sense of the clock. Calls get logged with no next step, so "No next step" fills Up Next. Dragging to the parked column means scrolling to the far right. And the sidebar search button does nothing.

## Scope

Five features, each shippable on its own:

1. **Card health.** Next-step dot and "stuck in stage" on every pipeline card (Pipedrive).
2. **Speed-to-lead timer.** Live clock on new, uncalled leads (FollowUpBoss).
3. **Required next step.** Logging a call needs a follow-up or an explicit "no next step" (Pipedrive / FUB).
4. **Drop zones.** A bar along the bottom while dragging, for off-flow moves (Pipedrive).
5. **Global search + quick add.** Ctrl+K palette and a "+ New" menu (Pipedrive / monday).

**Out of scope:** the full lead record panel and call-through-a-list session (Tier 2), inbox, views, reports, automations and AI nudges. Search's person sheet (5) is built so the Tier 2 panel can grow out of it.

## Data: five more columns on the board views

`v_lead_signals` (0029) computes every health field: `stage_since`, `open_task_count`, `oldest_open_due_at`, `crm_created_at`, `last_outbound_call_at`. But the board can't simply reuse that view, because it filters rows out. It drops snoozed leads and leads with no Up Next reason, so a card with nothing wrong would have no signal row.

So migration `0034` adds those five columns to the END of `v_active_pipeline` and `v_mpg_contacts`, keeping `create or replace view` valid (as in 0022). It uses the same expressions as `v_lead_signals`: the open-task aggregate over `tasks where is_completed = false`, the call max over `activities`, and the `crm_created_at` expression from 0029. The Pipeline page adds the five names to `cfg.columns`. It remains one query per board.

Thresholds live in the existing `settings.priority_rules` JSON, read through `resolveRules`. Missing keys fall back to `DEFAULT_RULES`, so the saved row keeps working:

```js
stuck_days_by_stage: {
  'New Lead': 2, 'Attempted': 5, 'Contacted/Working': 7,
  'Application/Estimate Sent': 7, 'Application Received': 14,
  // 'Nurture / Credit Repair': never stuck
},
stuck_days: 14,              // existing; still the fallback (MPG, unknown stages)
speed_to_lead_minutes: 5,
```

Up Next's "Stuck in stage" bucket switches from the flat `stuck_days` to `stuckDaysFor(stage, rules)`. A red card on the board and a "Stuck" row in Up Next then always agree.

## 1. Card health

A pure helper `cardHealth(row, rules, now)` in `src/lib/pipeline.js` returns `{ next, stuck }`.

**`next`, from the open tasks (same day rules as Up Next, `dueDayKey` / `dayKey`):**

| State | Rule | Dot | Text |
|---|---|---|---|
| overdue | `open_task_count > 0` and oldest due day < today | red | "Follow-up 2d overdue" |
| today | oldest due day = today | amber | "Due today" |
| scheduled | oldest due day > today | green | "Next: Fri Oct 24" |
| none | no open task | grey | "No next step" |
| parked | stage is Nurture / Credit Repair | none | not shown |

The dot is never the only signal: the text sits beside it. This needs no new colours. Red, amber and green reuse the urgent, `--bay-gold` and `--bay` tokens.

**`stuck`:** whole days since `stage_since` ≥ `stuckDaysFor(stage)`. The card's left accent bar turns red and a line reads "9d in Attempted". When `stage_since` is null (the stage predates tracking, per 0029), it isn't marked stuck and no warning shows.

**Column header:** the count plus a quiet summary, e.g. "21 · 4 overdue · 2 stuck".

**Card order inside a column (replaces `sortByAttention` on the board only):** overdue, then stuck, then none, then today, then scheduled. Ties break on oldest last touch, as now. Overview keeps `sortByAttention`.

**Kept:** the last-touch line, docs block, last note and Quick Actions. The health line goes directly under the name/phone.

Applies to both books. MPG uses the fallback `stuck_days`.

## 2. Speed-to-lead timer

**Shows when:** `crm_created_at` is within `new_lead_days` (7), there is no outbound call ever (`last_outbound_call_at` null), and the lead is not parked or lost. That is the same test as Up Next's `new_lead` bucket.

**Where:**
- Pipeline cards in Bayway's New Lead column and MPG's Not Contacted / Open columns. It replaces the health dot there; a brand-new lead's real "next step" is the first call.
- Up Next `new_lead` rows. `reasonText` switches to minutes under an hour: "New lead · 12m, not called".
- The browser tab title gets a prefix while any timer is red: "(1) New lead waiting · Atkinson Sales OS".

**Display:** "4m", "1h 12m", then "2d" past 48h. Neutral under `speed_to_lead_minutes`, red at or after it. One shared 30-second ticker per page re-renders the labels, not one interval per card. Wall-clock time; see open question 3.

**Freshness: the part that limits this feature.** People, activity and task syncs poll every 15 minutes, so with polling alone a lead can surface already 15 minutes old. A call made from the FUB app can also keep a timer running for up to 15 minutes after it happened. A call logged from the dashboard mirrors at once.

- **Recommended:** `fub-webhook` already exists for `peopleCreated` / `peopleUpdated` but may not be registered in FUB. Step 1: confirm it is registered and receiving. Step 2: add `callsCreated` handling (re-fetch the call and upsert through the existing activity mapper, then `link_fub_orphans`). Registering webhooks is done by Chandler in FUB Admin → API.
- **Board refresh:** Pipeline and Up Next do a quiet reload every 60 seconds while the tab is visible (`visibilitychange`). Today neither page polls.
- MPG/Zoho stays on the 15-minute poll. Its timers are as fresh as the last sync.

## 3. Required next step

**Log call form (`LogCallForm` in `QuickActions.jsx`).** The on/off follow-up toggle becomes a required **Next step** choice with three options:

- **Follow-up**: the existing date presets and title, unchanged.
- **Already scheduled**: shown only when the lead has an open task due *after* today (one bounded `v_tasks` query, beside the existing due-today one). It reads "Follow up: Sam · Fri Oct 24".
- **No next step**: a reason chip is required: Not interested · Bad number · Moving to Nurture · Other.

**Defaults:**
- Left Message, No Answer and Busy (`FOLLOW_UP_ON`) preselect Follow-up / tomorrow, as today.
- **Interested** joins that set. A connected, interested lead is the one that most needs a dated next step; today it gets none by default.
- Not Interested and Bad Number preselect nothing, so Save stays disabled until a deliberate choice. Completing the overdue task ("Complete task" checkbox) does not count as a next step.

**What gets written:**
- Follow-up: unchanged (`follow_up` in the `log_call` payload).
- Already scheduled: nothing extra.
- No next step: the reason goes into the `crm_actions` payload (`no_next_step_reason`) for the audit trail only. Nothing extra is written to FUB or Zoho; see open question 4.
- **Moving to Nurture** (Bayway only): `planSteps` gains an optional `set_stage` step after the follow-up step: `{ step: 'set_stage', target: 'credit_repair' }`. One submit then logs the call and parks the lead. `shouldStop` already halts later steps when the call itself fails.

**After a stage move (drag or Move stage).** If the move succeeds, the target is not Nurture / Lost, and the lead has no open task, a small "Next step for Sam?" sheet opens. It offers the follow-up presets plus **Skip**. Skip is allowed, and the lead then shows in Up Next as "No next step" as it would today. The move itself never waits on this sheet.

## 4. Drop zones

**While a Bayway card is dragging,** a fixed bar slides up along the bottom of the viewport, on top of the board. Each zone highlights on `dragover`. Drag stays gated on `flags.bay`; touch screens keep using Move stage, which gets the same targets.

| Zone | Writes | Needs |
|---|---|---|
| **Nurture / Credit Repair** | `set_stage` `credit_repair` (exists) | nothing new |
| **Lost** | new target `lost`: tag `Lost` | open question 1 |
| **Closed** | deferred | open question 1 |

**Lost, as proposed:**
- `STAGE_TARGETS` gains `{ key: 'lost', tag: 'Lost', keep: ['lost'] }`. `lost` joins `WORKFLOW`, so moving a lead back to any column removes it.
- `bayStageFromTags` returns null (off the board) when the `lost` tag is present, checked before the parked rule. `derive_stage()` gets the same rule in a new migration, run with the stage trigger disabled for the re-backfill, as in 0031/0033. Off-board leads already drop out of the board and Up Next.
- A drop opens a reason sheet (Not interested · Went elsewhere · Unreachable · Not qualified), in the same style as `ChooseTarget`. The reason is written as a FUB note: "Marked Lost: Went elsewhere".
- A 10-second **Undo** toast re-runs `set_stage` to the column the card came from.
- **Manual FUB step:** Chandler adds "Tag is not Lost" to Smart Lists 01–09. Without it, lost leads stay in his FUB lists, because their FUB person stage is still Lead.

**Why tags, not FUB person stages:** person stages can only be changed by the FUB account owner. The same limit drove the tag design in `2026-10-19-bayway-stage-tags-design.md`.

The zones exist mainly so you don't scroll right. If more far-right drops are wanted later, any board column can become a zone; that is not proposed now.

## 5. Global search and quick add

**Open with:**
- the sidebar ⌕ button (finally wired up)
- Ctrl+K / ⌘K
- `/` when focus is not in a text field
- a new search icon in the phone `MobileBar`

**Palette:** a centred modal on desktop and a full-screen sheet on phones. It has an input, then grouped results: **People**, **Open tasks**, **Go to** (pages). Arrow keys and Enter select, Esc closes, and focus returns to where it was.

**Data:**
- New RPC `search_people(q text, max_rows int default 8)`, `security invoker`.
  - Matches name, company and email with `ilike`. Phone matches on digits only: `regexp_replace(phone, '\D', '', 'g') like '%' || digits(q) || '%'`, when `q` has 3 or more digits.
  - Returns `id, business_id, name, company, phone, email, stage, on_board, crm_profile_url`.
  - Order: exact/prefix name match first, then current book first (per `BusinessFilter`), then newest touch.
  - Covers both books and off-board contacts (Nurture, past clients): search finds anyone. Only Chandler's contacts exist after 0030, so there is no owner filter to add.
- Open tasks: `v_tasks` `ilike` on title or contact name, open only, `limit 5`.
- Requests are debounced 150ms, need at least 2 characters, and drop stale responses.

**Choosing a person** opens a **person sheet**:
- name, book badge, stage
- phone / email
- the card-health line (from 1)
- last note
- the existing `QuickActions` row (Call, Log call, Note, Follow-up, Move stage)
- "Open in FollowUpBoss / Zoho ↗"

It is a small component meant to become the Tier 2 lead panel. Choosing a task opens the same sheet for the task's contact with the task highlighted. Choosing a page navigates.

**Quick add:** the sidebar's "+ New Task" button becomes **+ New**, a menu with:
- **Log call…**, **Note…** and **Follow-up…**: the palette opens in "Who?" mode, then the existing Quick Actions sheet opens for the chosen contact.
- **Task…**: the existing `NewTaskDialog`, unchanged.
- **New lead…**: see below. This is the last slice and can be cut.

**New lead (last slice, flag-gated).** A new crm-action `create_contact`:
- **Form fields:** book, first and last name, phone, email, note. MPG also asks for company (Zoho requires it).
- **Duplicate check before any write:** the form runs `search_people` on phone and email. A match shows "Already in FollowUpBoss: Sam Lee", with Open instead of Create.
- **Bayway:** `POST /events` (type Registration, source "Atkinson Sales OS"), so FUB's lead flow and action plans fire as for any other lead. Assignment to Chandler (`FUB_USER_ID`) must be confirmed on the ZZ Test record first.
- **MPG:** Zoho `POST /Leads` with `Lead_Status = 'Not Contacted'`.
- The new person is mirrored back through `mapContact`, using the same claim-first idempotency on `client_action_id`.
- **Live testing:** ZZ Test Sales OS only.

## Build order (one PR each)

1. **Card health + per-stage stuck.** Migration `0034` (view columns), `cardHealth`, `stuckDaysFor`, card and column UI, and the Up Next `stuck` switch.
2. **Speed-to-lead.** The timer helper, shared ticker, `reasonText` minutes, tab title, and 60s visible-tab refresh.
3. **Required next step.** `LogCallForm` choice, future-task lookup, `planSteps` `set_stage` step, and post-move sheet.
4. **Drop zones: Nurture.** The bar, highlighting, and existing target. No new tags.
5. **Drop zones: Lost.** The tag target, `bay-stages.ts` and `derive_stage` migration, reason note, and Undo. Only after open question 1 is answered.
6. **Search palette + person sheet.** The `search_people` migration and keyboard shortcuts.
7. **Quick add menu** (existing actions only).
8. **New lead create.** `create_contact` in crm-action.
9. **Webhook freshness.** Verify `fub-webhook` registration and add `callsCreated`. This can run any time after 2.

## Testing

- **Unit (Vitest):**
  - `cardHealth` for every state, with day boundaries in the rep's local day.
  - `stuckDaysFor` fallback.
  - The speed-to-lead label and red threshold.
  - A row with null health columns shows "none", not a crash.
  - The `retagForTarget` / `bayStageFromTags` lost cases.
  - The palette's digit extraction and result ordering.
- **Render (jsdom, `createRoot` + `act`):**
  - The drop bar appears on `dragstart` and hides on `dragend`.
  - A drop on Nurture sends `set_stage` `credit_repair`.
  - Log call Save stays disabled for Not Interested until a next step is chosen.
  - Ctrl+K opens the palette, Esc closes it, and focus is restored.
- **Deno:**
  - `planSteps` ordering with `set_stage` after `follow_up`.
  - `shouldStop` still halts on a failed call.
  - `create_contact` request validation.
- **SQL dry run** (`BEGIN` + migration + `DO` block raising JSON):
  - `derive_stage` with the `lost` tag.
  - `search_people` for name, phone digits and company.
  - Row counts for the board before and after.
- **Live:** ZZ Test Sales OS only (log call with no next step, Nurture via call, drop to Lost then Undo, create lead).

## Open questions (with recommendations)

1. **Lost / Closed zones.** Recommend: ship Nurture first (slice 4), then Lost as a `Lost` tag with the Smart List filter edit (slice 5). Defer Closed: closings already flow through Smart List 10 and person stages set by the account owner.
2. **Stuck thresholds.** Defaults are 2 / 5 / 7 / 7 / 14 days for New Lead → Application Received. Adjust any?
3. **Speed-to-lead clock.** Wall clock (a 2am lead is red by morning) or business hours only (e.g. 8am–8pm Central)? Recommend wall clock to start: simple, honest, and leads arriving overnight are exactly the ones to call first.
4. **"No next step" reason.** Audit-only in `crm_actions` (recommended, keeps FUB history clean), or also appended to the FUB call note?
5. **New lead create.** Keep as the last Tier 1 slice, or move it to Tier 2 with the lead panel? Recommend keeping it last and flag-gated; cut it if slices 1–7 run long.
6. **Webhooks.** OK for Chandler to register `peopleCreated` and `callsCreated` in FUB Admin → API, pointing at `fub-webhook`? Without them, speed-to-lead is accurate only to about 15 minutes.

## Risks

- **Heavier board views.** The new columns aggregate `tasks` and `activities` per contact. Dry-run the migration and time the board query before and after. `activities` already has its feed index (0011); add a `(contact_id, type, direction)` index only if the timing calls for it.
- **Required next step adds friction.** Mitigated by defaults that preselect Follow-up for four of six outcomes (Interested included), so most calls are still two taps and Save.
- **Lost tag drift.** If the Smart List filters aren't updated, FUB and the dashboard disagree on lost leads. The slice 5 PR description carries the exact filter change.
