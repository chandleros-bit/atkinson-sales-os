# Task Completion Sync Fix + My Tasks Overview Section — Design

**Date:** 2026-07-22
**Status:** Approved for planning
**Touches:** `supabase/functions/fub-task-sync/`, `supabase/functions/_shared/fub-tasks.ts`, `src/lib/overview.js`, `src/pages/Overview.jsx`

## Problem

Two related asks on the unified Tasks path:

1. **Bug — completions don't sync.** Completing a task in FollowUpBoss does not remove it from the dashboard. The board (`v_tasks`) shows only rows where `tasks.is_completed = false`, so a task drops off only when the sync flips that flag to `true`. It never does.

2. **Feature — My Tasks on the Overview.** The Overview has no task surface. Add a compact "My Tasks" card showing the 5 most-pressing dated tasks (overdue + today) with a "Show all" link to the Tasks page.

## Part 1 — Sync Fix

### Root cause

The board drops a task only when `tasks.is_completed` flips to `true`. The single path to that flip today is the incremental pull re-fetching the now-completed task via `fetchTasksUpdatedSince` (`updatedAfter` window, any status) in `fub-task-sync/index.ts`.

FUB's `/tasks` list endpoint does not reliably return completed tasks to an `updatedAfter` pull — the completed task simply never re-appears in the fetched set, so its row is never upserted with `is_completed = true` and it stays on the board indefinitely. The Sync Status screen stays green because new and changed *open* tasks keep flowing; the completion failure is silent.

This is confirmed to the extent that: the `fub-tasks` sync is green and recent (rules out "never runs" / stuck first-run mode), yet completed tasks persist on the board. The remaining ambiguity (list excludes completed vs. completion flag mis-read) is resolved by a fix that is correct under either.

### Chosen approach — Open-set reconciliation

Each `fub-task-sync` run, after the existing upsert of changed tasks, additionally:

1. Fetch the full set of **currently-open** FUB task ids via the existing `fetchOpenTasks()` (account-wide, `isCompleted: false`).
2. Compute the set of our rows that are `source_crm = 'fub'` AND `is_completed = false` whose `external_id` is **not** in that open set.
3. Mark those rows `is_completed = true` (a single `update ... in (...)`), which drops them from `v_tasks` on the next screen load.

This is self-healing (any historically-stuck row clears on the next run) and correct regardless of how FUB reports completion:

- If the list **excludes** completed tasks → the completed task's id leaves the open set → reconciliation marks it. ✓
- If the list **includes** completed tasks with a correct flag → the incremental upsert already carries `is_completed = true`. ✓
- If the list includes completed tasks with a *wrong* flag → unlikely (`isCompleted` is the documented field); we still read the flag as belt-and-suspenders.

### Safety guard against false mass-clear

Reconciliation runs **only if the open-set fetch succeeded.** `fetchOpenTasks` → `fubGet` throws on any non-2xx response, which aborts the whole run inside the existing `try` **before** reconciliation executes. So a transient FUB API failure logs an error and changes nothing; it can never wrongly mark all open tasks completed.

**Empty-open-set guard (implementation deviation — deliberate).** The original design here said an empty open set (legitimately: everything is done) should be allowed to clear all rows. During implementation this was tightened: a non-2xx is not the only way the fetch can be untrustworthy. The `/tasks` response shape is **unverified** (see the header comment in `_shared/fub-tasks.ts`), and a `200 OK` whose body doesn't match the expected list key makes `pick()` return `[]` — indistinguishable from a genuine "zero open tasks" without extra signal. Trusting that empty set would mass-complete the whole board.

So reconciliation is guarded by `trustOpenSet = openExternalIds.size > 0 || ourOpen.length === 0`: it proceeds when FUB returned at least one open task, or when we hold no open rows anyway. It **skips** (logging `reconcile skipped: empty open set`) only in the "FUB says zero, but we still hold open rows" case.

Tradeoff, accepted: the fail-safe direction is to *not* clear on an ambiguous empty response. The cost is that if the book legitimately empties to zero while some rows are still stuck open in our table, those specific rows won't reconcile until at least one FUB task is open again (then the whole backlog clears at once). This is self-healing and non-destructive, and the common "just completed my last task" case is already handled by the incremental flag path (those rows are upserted `is_completed=true` in step 2, so `ourOpen` won't include them). **Follow-up:** once Task 5's live check confirms the `/tasks` response shape (ideally its `_metadata.total`), the guard can be relaxed to distinguish a real zero from a malformed body, restoring the original "empty means done" behavior safely.

### Ordering within the run

1. Build contact/deal id maps (unchanged).
2. Incremental (or first-run) fetch + upsert of changed/open tasks (unchanged).
3. **New:** fetch open-task id set; reconcile completed; count marked-completed.
4. `logSync('fub-tasks', 'ok', ...)` with a summary line extended to include `reconciled-completed:N`.

On first run (no prior `ok`), step 2 already fetches open-only. Step 3 uses the same open set — reconciling against a table that is empty or freshly-seeded is a no-op or a correct clear; safe either way.

### New pure helper (unit-tested)

In `_shared/fub-tasks.ts`:

```
// openExternalIds: Set<string> of external_ids currently open in FUB.
// ourOpenRows: [{ id, external_id }] of our fub rows still is_completed=false.
// Returns the array of our row ids to mark completed.
reconcileCompleted(openExternalIds, ourOpenRows) -> string[]
```

Tested in `_shared/fub-tasks.test.js`: a row absent from the open set is returned; a row present is not; empty open set returns all row ids; empty rows returns `[]`. `external_id` compared as string on both sides (matches `String(rec.id)` mapping).

### Scope note — Zoho

`zoho-task-sync` likely has the same latent hole (completion not propagating). Out of scope for this change; tracked as a fast follow so this stays a focused, verifiable fix.

## Part 2 — My Tasks Overview Section

### Placement & visibility

- Rendered **above Needs Attention** on all three live Overview views (`AllOverview`, `BayOverview`, `MpgOverview`).
- Respects the active business filter inherently: each view fetches `v_tasks` scoped to its own `business_id` (`bay`, `mpg`, or both for All), the same way each view already scopes its pipeline/leads query.
- Not shown in `DemoOverview` (demo has no live task data); demo is left unchanged.

### Content

- Source rows: `v_tasks` (open tasks only, already filtered by the view).
- Show tasks that are **overdue or due today**, sorted **overdue-first** (most-overdue on top) then today, **capped at 5 total** (5 total on the All view across both books, not per-book).
- Reuses `bucketByDue` / `dueDayKey` / `dueLabel` / `dueTimeOfDay` from `src/lib/tasks.js`, so the section's date bucketing can never disagree with the Tasks board.

### New pure helper (unit-tested)

In `src/lib/overview.js`:

```
// rows: v_tasks rows for the current view. now: Date.now() (injected for tests).
// Returns up to 5 rows, overdue (most-overdue first) then today, each tagged
// with a `bucket` of 'overdue' | 'today' for the row's due-cell rendering.
buildMyTasks(rows, now) -> Task[]  (length <= 5)
```

Built on `bucketByDue`: take the `overdue` group (already sorted ascending = most-overdue first) then the `today` group, concatenate, slice(0, 5). Tested in `overview.test.js`: overdue sorts before today; most-overdue first; tomorrow/upcoming/no-due excluded; cap at 5; empty input → `[]`.

### Component

- Card matching the existing `AttentionCard` shell (rounded card, header row, divider rows).
- **Header:** "My Tasks" + a muted count of overdue+today matches, right-aligned **"Show all →"** as a router `Link` to `/tasks`.
- **Row** (trimmed board row): biz tag · due cell (overdue → `dueLabel`, e.g. "Yesterday" / "Thu · Jul 17"; today → `dueTimeOfDay`, e.g. "9:00a") · title + optional type · contact via `CrmLink`.
- **Overdue accent:** overdue rows use the gold warning color already defined in `BUCKET_META.overdue` (consistent with the board).
- **Empty state:** when nothing is overdue or due today, render the card with a quiet centered line — "You're clear — nothing due today." The section always renders (stable page height, no layout jump).

### Data fetch

Each view's existing `useEffect` `Promise.all` gains one query:

```
supabase.from('v_tasks').select('id, business_id, task_type, title, due_at, priority, contact_name, crm_profile_url')
```

- `AllOverview`: no `business_id` filter (both books).
- `BayOverview`: `.eq('business_id', 'bay')`.
- `MpgOverview`: `.eq('business_id', 'mpg')`.

Result stored in a `myTasks` state slice, passed through `buildMyTasks(rows, Date.now())` for render. Errors fold into the existing per-view `error` handling.

## Testing

- `_shared/fub-tasks.test.js`: `reconcileCompleted` cases above.
- `src/lib/overview.test.js`: `buildMyTasks` cases above.
- Sync function itself is exercised manually via the Sync Status "Run now" path and verified by completing a live FUB task and confirming it drops from the board on the next run (the acceptance check for the bug).

## Acceptance

1. Completing a task in FollowUpBoss removes it from the Tasks board within one sync cycle (~15 min, or immediately via "Run now").
2. Historically-stuck completed tasks clear on the next run without manual intervention.
3. Overview shows a "My Tasks" card above Needs Attention on All / Bayway / MPG, listing ≤5 overdue+today tasks, overdue first, with "Show all" linking to `/tasks`.
4. Empty state renders cleanly when nothing is due.
5. No false mass-clear: a FUB API failure during a run leaves all task rows untouched and logs an error.

## Out of scope

- Zoho task completion parity (fast follow).
- Webhook-driven real-time completion.
- Owner-based filtering of "My Tasks" (all open tasks count as yours on this single-user dashboard).
- Any write-back to a CRM (the app stays read-only).
