# Priority Queue ("Up Next") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** One ranked "Up Next" list across both books at `/priority`, showing who to call next and why. It also gets a sidebar badge (buckets 1 to 3) and an Overview card (top 5).

**Architecture:** Migration `0029` adds a `derive_stage()` SQL function (now used by `v_active_pipeline`), stage tracking on `contacts` (`stage_key`, `stage_since`, a trigger), `lead_snoozes`, a `priority_rules` settings row, and `v_lead_signals`, which returns one row per *candidate* lead with its activity and task aggregates. The pure `src/lib/priorityQueue.js` turns those rows into buckets, an order, and reason text. A shared `usePriorityQueue()` hook feeds the page, the sidebar badge and the Overview card from one fetch, and refreshes on window focus, after a snooze, and after any Quick Action.

**Spec:** `docs/superpowers/specs/2026-10-18-priority-queue-design.md`

---

## Decisions from the data check (2026-10-18, live)

| Check | Result | Decision (Chandler) |
|---|---|---|
| Bayway outbound calls, 30 days | 82 (~3/day), plus 82 notes, 1 inbound | "I dial a lot more": `use_crm_last_activity_fallback: true` |
| MPG calls/notes logged in Zoho, 30 days | 0 | MPG active = `Open`, `Pending`, `Initial lead follow up` (~20 leads). The 627 `Initial lead` records only show if new, tasked, or calling in. |
| MPG Lead Status picklist | `Initial lead` 627, `Open` 18, `Pending` 1, `Initial lead follow up` 1 | `mpg_hot_statuses: []` (no hot status exists), `mpg_dead_statuses: []` |
| Bayway `Realtors` person stage | 213 contacts | Realtors appear **only** under "They reached out" (`bay_partner_stages`) |

## Where this plan differs from the spec

1. **The fallback applies to touch age only.** With the fallback on, `crm_last_activity_at` counts toward "last touch" for buckets 4 (hot, going cold) and 7 (gone quiet), and for the "last touch" label. It does **not** apply to:
   - **Bucket 1:** FUB's `lastActivity` moves on the inbound call itself, so that bucket could never fire.
   - **Bucket 2:** "not yet called" stays strictly "no outbound call logged".
2. **Settings keys added:** `mpg_active_statuses`, `bay_partner_stages` and `bay_excluded_stages` (`Nurture`, `Closed`, `Lost`), replacing values the spec hard-coded. Lost-looking stage names use the board's `LOST_KEYWORDS`, mirrored in SQL.
3. **One fetch, filtered in the browser.** Each business filter comes from the same ~300-row result set (not a per-filter query), so the page, the badge and the card always agree (acceptance 8 and 9).
4. **Needs Attention is already gone** from the Overview: a 2026 redesign unmounted it and kept the code "in case". The spec says to delete it once Up Next is live, so this build removes `NeedsAttentionCard`, `buildBayHotRows`, the attention view-model, and the `bayTagged` query. That query fetched all 1,217 Bayway contacts on every Overview load just to feed the unmounted card. `sortByAttention` and `isMpgOpen` stay, since Pipeline and the KPIs still use them.
5. **Up Next on the Overview** gets its own full-width row under the KPIs, since there's no Needs Attention slot left to take.
6. **"Touched today"** counts distinct contacts in the current queue's candidate set that got an outbound call or a note today.

## Tasks

1. Migration `0029_priority_queue.sql`: `derive_stage` and `v_active_pipeline` re-pointed to it (no output change, checked live with an md5 of `id:stage` before and after); `stage_key`/`stage_since` + backfill (with `stage_since` left null) **before** creating the trigger; the trigger; `lead_snoozes` + RLS; the `priority_rules` row; `v_lead_signals`.
2. `src/lib/priorityQueue.js` + tests: one describe per bucket (including the "one day short" case), ordering, exclusions, `stage_since = null`, the fallback both on and off, an old inbound not firing, a 5 PM task at 9 AM, the partner rule, the Decide chip, and `groupForDisplay`.
3. `src/lib/usePriorityQueue.js`: shared fetch and cache, `refreshPriorityQueue()`; `invokeCrmAction` fires a refresh on success.
4. `src/pages/Priority.jsx`, mobile first: header with "N touched today · M to go", bucket groups, rows (the row itself is a `tel:` link; the actions sheet holds Quick Actions, Open in CRM and Snooze), the daily cap with "Show all N", the empty state, and "Stage tracking started …" under Stuck.
5. Route `/priority`; Sidebar "Priority" first under OVERVIEW with the urgent badge.
6. Overview Up Next card (top 5, "See all →") and the dead Needs Attention code removed.
7. Checkpoint: apply `0029` live, run the no-change check, check acceptance in the browser, open the PR.
