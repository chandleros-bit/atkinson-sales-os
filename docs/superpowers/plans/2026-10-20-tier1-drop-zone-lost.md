# Tier 1 · Drop Zone: Lost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mark a Bayway lead Lost from the board. A **Lost** zone sits in the drag bar beside Nurture, and a **Lost** target sits in Move stage. Both ask for a reason (Not interested · Went elsewhere · Unreachable · Not qualified). The reason is written to FUB as a note, "Marked Lost: Went elsewhere". After a drop, a 10-second **Undo** puts the lead back in its column.

**Architecture:**
- **Lost is a tag, not a FUB person stage.** Only the FUB account owner can edit person stages.
- **Stage rules:**
  - `bay-stages.ts` gains `LOST`, the `lost` workflow tag and a `lost` target.
  - `bayStageFromTags` returns `'Lost'` when the tag is present; this beats Credit Repair.
  - SQL `derive_stage()` mirrors that rule (migration `0035`).
- **Keeping Lost leads off the board and out of Up Next:**
  - `v_active_pipeline` filters out `'Lost'`, so the board drops the lead.
  - `v_lead_signals` keeps the stage name, so Up Next's `isLostStage` excludes it with no view change.
  - `v_bayway_contacts` shows "Lost" instead of falling back to "Nurture".
- **crm-action:**
  - `set_stage` to `lost` with a `reason` plans a trailing `add_note` step.
  - FUB `setStage` returns the lead's previous target, and run.ts passes it back as `previous_target` so the UI can undo.
- **UI:**
  - `Toaster` gains an action button (Undo) with a custom duration.
  - The Pipeline drop zone opens a reason sheet.
  - `StageForm` asks for the reason inline.

**Spec:** `docs/superpowers/specs/2026-10-19-tier1-pipeline-flow-design.md`, section 4 (Lost). Approved: tag approach, Closed deferred.

**Manual step for Chandler (in the PR):** add "Tag is not Lost" to Smart Lists 01–09 in FUB. Lost leads keep FUB person stage Lead, so without this they stay in those lists.

**Before this slice:** 0 Bayway contacts carry a `lost` tag (checked 2026-10-20), so the new rule moves nothing off the board on day one.

**Branch / PR:** `feat/drop-zone-lost` from `main`. One PR.

**Repo rules:**
- Migration apply (`supabase db push --linked`) and function deploy (`supabase functions deploy crm-action`) each need Chandler's go-ahead.
- Live writes go to ZZ Test Sales OS only.
- End commits with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Lost stage rules (`bay-stages.ts`)
- [ ] **Failing tests** in `bay-stages.test.js`:
  - `bayStageFromTags(['Lost','attempted'],'Lead')` is `'Lost'`, and Lost beats Credit Repair.
  - A Nurture person stage stays off the board (`null`).
  - `retagForTarget(['attempted','DSCR'],'lost')` gives `['DSCR','Lost']`.
  - Moving back with `retagForTarget(['DSCR','Lost'],'attempted')` gives `['DSCR','attempted']`.
  - The targets list has eight entries, ending in `lost`.
  - `targetForStage(['Lost'],'Lead')` is `'lost'`.
- [ ] **Implement:**

```ts
const LOST = 'Lost'
// STAGE_TAGS: [LOST]: ['lost']  (joins WORKFLOW, so any move removes it)
// bayStageFromTags, right after the ON_BOARD check:
if (STAGE_TAGS[LOST].some((t) => have.has(t))) return LOST
// STAGE_TARGETS, last:
{ key: 'lost', label: 'Lost', stage: LOST, tag: 'Lost', keep: ['lost'] },
```

- [ ] **Commit** `feat: Lost stage tag rules`.

### Task 2: Migration `0035_lost_tag.sql`
- **`derive_stage()`:** add `when exists (select 1 from t where tag = 'lost') then 'Lost'` before the Credit Repair line.
- **`v_active_pipeline`:** same as 0034, with `where stage is not null and stage <> 'Lost'`.
- **`v_bayway_contacts`:** same as 0015, with `coalesce(p.stage, public.derive_stage(c.raw, c.person_stage, c.business_id), 'Nurture')`.
- **Re-backfill `stage_key`** with the stage trigger disabled, as in 0033.
- **Dry run** (BEGIN + migration + DO-block JSON):
  - The Bayway board count is unchanged (no lost tags).
  - `derive_stage('{"tags":["Lost"]}', 'Lead', 'bay')` is `'Lost'`.
- **Commit** `feat: Lost tag keeps a lead off the board`. Apply only after a yes.

### Task 3: crm-action
- [ ] **Failing tests:**
  - `plan.test.js`: `set_stage` `{ target: 'lost', reason: 'Went elsewhere' }` plans `set_stage` then `add_note` with body `Marked Lost: Went elsewhere`.
  - `run.test.js`:
    - A Lost move with a reason calls `setStage` then `addNote`.
    - The result carries `previous_target` from the adapter.
    - A Pre-Qualified lead may be marked Lost.
- [ ] **Implement:**
  - `plan.ts`: in `set_stage`, push the note step when `p.target === 'lost' && p.reason`.
  - `run.ts`:
    - Allow `lost` for Pre-Qualified in `stageRefusal`.
    - After a send, `if (out.previous) result.previous_target = out.previous`.
  - `crm.ts`: FUB `setStage` returns `previous: targetForStage(person.tags, person.stage)`.
- [ ] **Commit** `feat: Lost moves write the reason as a FUB note and report the previous column`.

### Task 4: UI
- [ ] **Failing tests:**
  - `crmActions.test.js`:
    - `LOST_REASONS`.
    - `buildActionRequest` `set_stage` carries `reason`.
    - `needsNextStepPrompt('lost', 0)` is false.
  - `QuickActions.render.test.jsx`:
    - Move stage lists eight targets.
    - Clicking Lost shows the reasons, and nothing is sent until a reason is picked.
    - It then sends `{ target: 'lost', reason }`.
  - `Pipeline.render.test.jsx`:
    - The drag bar shows Nurture and Lost.
    - A drop on Lost opens the reason sheet. A reason sends `set_stage` lost with the reason, and the card leaves the board.
    - The toast offers Undo, which sends `set_stage` back to `previous_target`.
  - `Toaster` (inside the Pipeline test): the Undo button renders on an ok toast.
- [ ] **Implement:**
  - `Toaster`:
    - Add `toast.action = { label, run }` and `toast.duration`.
    - Ok toasts with an action stay up for `duration` (10s).
  - `crmActions`:
    - Add `LOST_REASONS`.
    - In `buildActionRequest`, `set_stage` adds `reason` when given.
    - `needsNextStepPrompt` excludes `lost`.
  - `QuickActions` `StageForm`: Lost opens an inline reason step ("Why is this lead lost?").
  - `Pipeline`:
    - `DROP_ZONES` gains `{ key: 'lost', stage: 'Lost', needsReason: true }`.
    - The `LostReasonSheet` uses the `ChooseTarget` styling.
    - `moveTo(row, key, stage, { reason, undoable })`.
    - Rows moving to Lost are hidden while in flight.
    - On success, the toast reads "{name} marked Lost in FollowUpBoss" with Undo. Undo calls `moveTo(row, previous_target, row.stage)` with no prompt.
- [ ] **Run** `npm test` and `npm run build`. **Commit** `feat: Lost drop zone with reason and Undo`.

### Task 5: Ship
- [ ] Dry-run the migration, then ask Chandler before applying it and deploying `crm-action`.
- [ ] Live test on ZZ Test Sales OS:
  - Drag to Lost and pick "Went elsewhere". The card leaves the board, the FUB note "Marked Lost: Went elsewhere" is written, and ZZ is tagged Lost.
  - Undo returns ZZ to New Lead with the Lost tag gone.
- [ ] Push and open the PR. The PR description carries the Smart List step.

---

## Change after the live test (2026-10-20)

Marking ZZ Test Sales OS Lost started Chandler's FUB action plan **"Lost Leads"**, which set the FUB **person stage to Lost**. Undo removed the tag but couldn't reset the stage, because only the FUB account owner can edit person stages. Decision (Chandler): **remove Undo.** The Lost reason sheet and the Move stage → Lost step now warn: "FollowUpBoss's Lost Leads plan will move this lead to stage Lost. Only the FUB account owner can move it back." `Toaster` stays as it was. crm-action still returns `previous_target`; it's harmless and unused.

Because FUB moves the stage itself, Lost leads leave Smart Lists 01–09 without the "Tag is not Lost" filter change.
