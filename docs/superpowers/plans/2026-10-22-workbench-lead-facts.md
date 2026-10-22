# Workbench slice 1 · Lead source + first-note facts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Up Next / Calls row shows the lead's **source** (FUB `source`, Zoho `Lead_Source`) and its **first note as quick facts**, e.g. "Credit 660-699 · Loan type DSCR Purchase · State North Carolina · Amount $200K - $500K", so it can be read before the call.

**Architecture:**
- **Migration `0040`:**
  - `contacts` gets `first_note`, `first_note_at` and `first_note_checked_at`.
  - `v_lead_signals` gains `lead_source` and `first_note` at the end. MPG `first_note` falls back to the Zoho lead's `Description`.
- **`_shared/fub-first-note.ts`:** pure `cleanNoteText` (strip HTML, decode entities, collapse whitespace, cap at 1000 characters) and `pickFirstNote(notes, events)`. The earliest note body wins; with no notes, the first event's message or description is used. `fetchFirstNote(personId, get)` reads `/notes` and `/events` by `personId`. `backfillFirstNotes(db, get, now)` picks the candidates (below) and writes the results.
- **Candidates:**
  - Bayway contacts whose FUB stage is Lead or Pre-Qualified and that have never been checked.
  - Leads created in the last 3 days that are still without a note, re-checked at most every 30 minutes. A provider's details can land a few seconds after the person.
  - At most 30 per run, newest first, so the 2-minute `fub-sync` backfills in about an hour.
- **`fub-sync`:** calls `backfillFirstNotes` after the people pass and reports `first notes: n` in its log line. A failure on one person is skipped, never fails the run.
- **UI:**
  - `src/lib/noteFacts.js`: `noteFacts(text)` splits on ` / ` or new lines into `key: value` facts, with friendly labels (loan type, loan amount → Amount). Email and phone keys are dropped. Text without that shape becomes a short snippet instead.
  - `UpNextRow`: shows the source tag beside the name, and the facts chips (or snippet) under the reason.

**Spec:** `docs/superpowers/specs/2026-10-22-workbench-design.md` (Calls lane, Data, slice 1).

**Ship:** dry-run 0040, then Chandler's go-ahead to apply it and deploy `fub-sync`. Read-only on FUB (GETs only).

### Task 1: `noteFacts` (TDD)
- Tests:
  - The LendingFlow example gives Credit / Loan type / State / Amount, with email dropped.
  - Newline-separated pairs.
  - Free text gives a snippet.
  - Empty text gives nothing.
- Implement. Commit.

### Task 2: `fub-first-note.ts` (TDD)
- Tests:
  - `cleanNoteText`: HTML and entities stripped, cap applied.
  - `pickFirstNote`: earliest note wins over events; event message used when there are no notes; `null` when both are empty.
  - `fetchFirstNote` with a fake `get`.
  - `backfillFirstNotes` with a fake db: candidate filter, per-person failure skipped, `first_note_checked_at` stamped.
- Implement. Commit.

### Task 3: Migration 0040 + `fub-sync` wiring
- Write the migration.
- Dry run: view row count unchanged; columns present; `lead_source` filled for Bayway; MPG Description used.
- Wire `backfillFirstNotes` into `fub-sync`. Commit.

### Task 4: Up Next rows (TDD)
- Priority render test: source tag and fact chips render; snippet fallback.
- Implement in `UpNextRow`. Commit.

### Task 5: Ship
- Ask Chandler, then apply 0040 and deploy `fub-sync`.
- Watch a few runs fill `first_note` (check CJ Blackman's lead shows the LendingFlow facts).
- Verify in the browser. PR.
