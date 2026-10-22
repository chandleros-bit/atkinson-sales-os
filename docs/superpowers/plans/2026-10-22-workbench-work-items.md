# Workbench slice 3 · Work items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Work lane remembers what the CRMs can't: a status (Working / Waiting on…), a check-back date, notes, the weekly "Mark reviewed" for applications, your own "+ Work item" tasks, and a "Work done today" progress bar.

**Architecture:**
- **Migration `0041_work_items.sql`:** one app-owned table, per user like `lead_snoozes` (RLS select/insert/update/delete own rows). It never touches a CRM.
  - Columns: `id, user_id, business_id ('bay'|'mpg'), source_key, kind ('estimate'|'application'|'statement'|'custom'), contact_id, title, status ('open'|'working'|'waiting'|'done'), waiting_on, check_back_on date, notes, created_at, updated_at, done_at`.
  - `source_key` is the generated item's key (`estimate:<contact>`, `application:<contact>`, `mpg_task:<task>`), unique per user, so the browser upserts on `(user_id, source_key)`. Custom items have none.
  - A row is created the first time you change a generated item, so CRM data is never copied.
- **`src/lib/workbench.js`:** `buildWorkGroups` also takes `workItems` and `now`:
  - Each generated item picks up its row (status, waiting on, check back, notes).
  - **Done rows hide the item:** an estimate until it re-enters the stage (`stage_since` after `done_at`); an application for 7 days (the weekly review); an MPG task for good.
  - **Waiting** items move to a 4th group, "Waiting on others", until their check-back day, then return to their own group flagged "Check back today" / "Check back N days late".
  - **Custom** items (kind `custom`, not done) form a 5th group, "Other work", each with its own book.
  - `workProgress(workItems, openCount, now)` → `{ done, total }`: rows done today versus open plus done today.
- **`src/lib/workItems.js`:** `saveWorkItem(item, patch)` (upsert by source key, or update a custom row by id) and `addWorkItem({ book, title, contactId })`.
- **`WorkLane`:**
  - **Update** opens a sheet with Open / Working / Waiting on… (Borrower, Lender, Processor, Underwriter, Merchant), a check-back day (Tomorrow / Next Monday / Pick) and notes.
  - **Mark reviewed** on applications.
  - **Done** on custom items. Estimates and MPG tasks also record done after their CRM step succeeds.
  - Each item shows its status pill and the first line of its notes.
- **`Workbench`:** a "Work done / total" bar in the header, and **+ Work item** (title, book, optional lead from search).

**Spec:** `docs/superpowers/specs/2026-10-22-workbench-design.md`, slice 3 and decisions 2 and 3 (no checklists in v1).

### Task 1: Migration 0041 (dry run, then ask before applying)
- [ ] Write the table, RLS and indexes. Dry run in a rolled-back transaction.

### Task 2: Rules (TDD)
- [ ] `buildWorkGroups` with work items: status merge, done hiding, waiting group and check-back return, custom group. `workProgress`.

### Task 3: UI (TDD)
- [ ] Render tests: Update sheet saves Waiting on + check back; Mark reviewed upserts done; + Work item inserts a custom row; header shows Work done/total.
- [ ] Implement `workItems.js`, the `WorkLane` changes and the `Workbench` header.

### Task 4: Ship
- [ ] `npm test`, build. Apply 0041 (after the ask). Live check on a signed-in preview with a custom ZZ test item only. PR.
