# Tier 1 · Quick Add Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the sidebar's "+ New Task" into a **+ New** menu with four items:
- **Log call…**, **Note…** and **Follow-up…** first ask *who*: the search palette opens in pick mode (people only). They then open the existing Quick Actions sheet for that person.
- **Task…** opens the existing New Task dialog, unchanged.

"New lead…" is slice 8, behind a flag.

**Architecture:**
- **`openSearch({ pick })`** passes a `pick` (`'call' | 'note' | 'followup'`) on the existing window event.
- **`SearchPalette` in pick mode:**
  - The placeholder reads "Who is this for?" and the header names the action.
  - Only People are listed, not tasks or pages.
  - Choosing a person renders `QuickActions` with no buttons (`only={[]}`) and `autoOpen={pick}`. `onSheetClose` clears it.
  - A Bayway person with no phone can't have a call logged (FUB needs one), so the palette shows the existing "No phone on file in FUB" toast instead.
- **`QuickActions`:** new `autoOpen` (the sheet to show at mount) and `onSheetClose` (called when that sheet closes) props.
- **`QuickAddMenu.jsx`:**
  - A button plus a popover menu (`role="menu"`).
  - Esc or a click outside closes it.
  - Each item calls `onPick(kind)`.
  - `Sidebar` maps `task` to the New Task dialog and the rest to `openSearch({ pick })`, closing the phone menu first.

**Spec:** `docs/superpowers/specs/2026-10-19-tier1-pipeline-flow-design.md`, section 5 (Quick add). UI only; writes go through the existing Quick Actions. No migration or deploy.

### Task 1: Pick mode
- [ ] Failing tests in `SearchPalette.render.test.jsx`:
  - `openSearch({ pick: 'note' })` shows "Who is this for?" and People only (no Open tasks or Go to).
  - Enter opens the "Add note" sheet for that person.
  - ✕ closes it.
  - Log call for a Bayway person with no phone shows the phone toast and no sheet.
- [ ] Implement `QuickActions` `autoOpen` / `onSheetClose`, then palette pick mode. Commit.

### Task 2: + New menu
- [ ] Failing tests in `QuickAddMenu.render.test.jsx`:
  - The menu opens with Log call / Note / Follow-up / Task.
  - Each item calls `onPick` with its kind and closes the menu.
  - Esc and an outside click close it.
- [ ] Implement `QuickAddMenu` and wire it into `Sidebar`. Run `npm test` and the build. Commit.

### Task 3: Verify and ship
- [ ] Browser check: + New → Note… → search a person → the Add note sheet opens → close it without saving. Check Log call… and Follow-up… the same way, and Task… opens the dialog (cancel it). Nothing is submitted.
- [ ] Push, open the PR, bind it.
