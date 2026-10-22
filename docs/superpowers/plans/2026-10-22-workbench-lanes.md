# Workbench slice 2 · Calls + Work lanes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Priority page becomes the **Workbench**: the Up Next queue as the **Calls** lane beside a **Work** lane driven by CRM state, a header that counts both, the nav item renamed, and a Calls | Work switch on a phone.

**Architecture:**
- **`src/lib/workbench.js`** (pure): `buildWorkGroups({ pipeline, mpgTasks, rules, now })` returns the three groups in the decided order. Each item carries `{ key, kind, contactId, taskId, name, title, why, late }`.
  - **Estimates to Work (Bayway):** `v_active_pipeline` rows in Contacted/Working, oldest `stage_since` first.
    - "Why": "Working N days" (unknown start: "In Contacted/Working"), or the follow-up overdue text when that's later.
    - Late when the stage passes its stuck limit (7 days) or a follow-up is overdue.
  - **Applications to Review (Bayway):** Application Received rows, those with missing docs first, then oldest first.
    - "Why": "N docs missing", else "In Application Received N days".
    - Late when docs are missing or past 14 days.
  - **Statement/Proposal Review (MPG):** open Zoho tasks (`v_tasks`, business `mpg`), earliest due first.
    - Title: the task title. "Why": its due label. Late when overdue.
- **`src/pages/Workbench.jsx`:**
  - Header: "Calls x / cap" from the Up Next counts, and "Work n open".
  - Left lane: the existing `Priority` list, rendered `embedded` (no page header of its own).
  - Right lane: `WorkLane`, where each item has **Open** (the existing `PersonSheet`) and **Done**:
    - Estimate: a pick sheet, *Estimate sent* or *Application sent*, which sends the existing `set_stage`.
    - MPG task: the existing `complete_task`.
    - Applications: Open only; "Mark reviewed" (the weekly review) needs storage and arrives with slice 3.
  - Phone: a Calls | Work switch shows one lane at a time.
  - The Work lane reloads after a Done or any Quick Action (`crm-action:done`).
- **Routing and nav:** `/priority` renders `Workbench` (links keep working), `/workbench` aliases it, and the sidebar item reads **Workbench**.

**Spec:** `docs/superpowers/specs/2026-10-22-workbench-design.md`, slice 2 and decisions 1, 2, 4. UI only, no migration; writes use existing crm-action steps.

### Task 1: `buildWorkGroups` (TDD)
- Tests: each group's selection, order, why text and late flag; MPG tasks from `v_tasks`; empty inputs.
- Implement. Commit.

### Task 2: Workbench page (TDD)
- Render tests:
  - Both lanes show; header counts.
  - Estimate Done → pick "Estimate sent" → `set_stage estimate_sent`.
  - MPG Done → `complete_task`.
  - Open → person sheet.
  - Phone switch shows one lane.
- Implement `Workbench.jsx`, `WorkLane`, Priority `embedded`. Commit.

### Task 3: Nav + routes
- `/priority` and `/workbench` render the Workbench; the sidebar reads "Workbench". Run `npm test` and the build. Commit.

### Task 4: Ship
- Browser check on a signed-in preview (read-only, no Done clicks on real leads). PR.
