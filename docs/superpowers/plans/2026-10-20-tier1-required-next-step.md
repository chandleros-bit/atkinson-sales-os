# Tier 1 · Required Next Step Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A call can't be logged without saying what happens next: a dated follow-up, the task already on the books, or an explicit "no next step" with a reason. "Moving to Nurture" parks the lead in the same save. After a stage move leaves a lead with nothing scheduled, offer a follow-up (Skip allowed).

**Architecture:**
- **Pure rules in `src/lib/crmActions.js`:** `defaultNextStep`, `NO_NEXT_STEP_REASONS`, `needsNextStepPrompt`, and a `nextStep`-aware `buildActionRequest`. `retryRequestFor` gains the `set_stage` step.
- **The crm-action function:** `log_call` gains an optional trailing `set_stage` step in `plan.ts`. `run.ts` reuses the existing set_stage refusal rules for it.
- **UI:**
  - `QuickActions.jsx`: the Log call form's checkbox becomes a required Next step choice. A new `NextStepPrompt` opens after Move stage.
  - `Pipeline.jsx`: shows the same prompt after a drag.

**Spec:** `docs/superpowers/specs/2026-10-19-tier1-pipeline-flow-design.md`, section 3. Decision 4: the reason is audit-only (`crm_actions.payload`), and nothing extra is written to FUB or Zoho.

**Branch / PR:** `feat/required-next-step` from `main` (after PR #33). One PR.

**Repo rules:**
- Commit as the configured git user.
- End every message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Redeploying `crm-action` (`supabase functions deploy crm-action`) changes production and needs Chandler's go-ahead in chat.
- Live writes go to the **ZZ Test Sales OS** record only.

---

### Task 1: Next-step rules and request building (`crmActions.js`)

**Files:** Modify `src/lib/crmActions.js`; test `src/lib/crmActions.test.js`.

- [ ] **Step 1: Failing tests.**
  - Update the `outcome defaults` test to expect Interested to default to a follow-up.
  - Update the two existing `log_call` request tests to pass `nextStep`.
  - Add tests for `defaultNextStep`, the `none` / `scheduled` payloads, the Nurture park, the reason guard, `retryRequestFor` with `set_stage`, and `needsNextStepPrompt`. The code is the test block in Step 3's commit; see the file.
- [ ] **Step 2: Run them.** `npx vitest run src/lib/crmActions.test.js`. Expect FAIL (`defaultNextStep is not a function`).
- [ ] **Step 3: Implement.**

```js
// Outcomes whose Next step defaults to a dated follow-up.
const FOLLOW_UP_ON = new Set(['Interested', 'Left Message', 'No Answer', 'Busy'])

// Why a call ends with no next step. Audit-only (crm_actions.payload): nothing
// extra is written to the CRM. "Moving to Nurture" also parks a Bayway lead.
export const NO_NEXT_STEP_REASONS = ['Not interested', 'Bad number', 'Moving to Nurture', 'Other']
export const PARK_REASON = 'Moving to Nurture'
export const NEXT_STEPS = ['follow_up', 'scheduled', 'none']

// The Next step the Log call form preselects. A task already on the books
// beats a second follow-up; Not Interested / Bad Number preselect nothing so
// the choice is deliberate.
export function defaultNextStep(outcome, hasFutureTask = false) {
  if (!FOLLOW_UP_ON.has(outcome)) return null
  return hasFutureTask ? 'scheduled' : 'follow_up'
}

// After a stage move: offer a follow-up when nothing is scheduled. Parking in
// Nurture needs none, and callers that don't know the open-task count never prompt.
export function needsNextStepPrompt(targetKey, openTaskCount) {
  if (targetKey === 'credit_repair' || openTaskCount == null) return false
  return !(openTaskCount > 0)
}
```

`buildActionRequest` `log_call` branch, replacing the `followUp.on` block:

```js
    if (!NEXT_STEPS.includes(form.nextStep)) throw new Error('Pick a next step')
    payload.next_step = form.nextStep
    if (form.nextStep === 'follow_up') {
      payload.follow_up = {
        due_date: form.followUp?.dueDate,
        title: trimmed(form.followUp?.title) || 'Follow up',
        type: form.followUp?.type || 'Follow Up',
      }
    }
    if (form.nextStep === 'none') {
      if (!NO_NEXT_STEP_REASONS.includes(form.noNextStepReason)) throw new Error('Pick why there is no next step')
      payload.no_next_step_reason = form.noNextStepReason
      if (form.noNextStepReason === PARK_REASON) payload.set_stage = 'credit_repair'
    }
```

`retryRequestFor`, before the final return:

```js
  if (original.action === 'log_call' && step === 'set_stage') {
    return { client_action_id: id, action: 'set_stage', contact_id: original.contact_id, payload: { target: p.set_stage } }
  }
```

Remove `defaultFollowUpOn` and its import in `QuickActions.jsx`; it's replaced by `defaultNextStep`.

- [ ] **Step 4: Pass.** Re-run `npx vitest run src/lib/crmActions.test.js`.
- [ ] **Step 5: Commit** `feat: next-step rules for Log call`.

### Task 2: crm-action runs the Nurture park after the call

**Files:** Modify `supabase/functions/crm-action/plan.ts` and `run.ts`; test `plan.test.js` and `run.test.js`.

- [ ] **Step 1: Failing tests.**
  - `plan.test.js`: a `log_call` with `complete_task_id`, `follow_up` and `set_stage: 'credit_repair'` plans `['log_call', 'complete_task', 'create_task', 'set_stage']`, with `{ step: 'set_stage', target: 'credit_repair' }` last.
  - `run.test.js`, in the `set_stage` describe:
    - A Bayway `log_call` with `set_stage: 'credit_repair'` calls `logCall`, then `setStage({ externalId: '5001', target: 'credit_repair' })`, and returns `ok`.
    - The same request for MPG is refused with `/Bayway only/`, before anything is sent.
    - A failed call doesn't run `setStage`.
- [ ] **Step 2: Run.** `npx vitest run supabase/functions/crm-action`. Expect FAIL.
- [ ] **Step 3: Implement.**

`plan.ts`, at the end of the `log_call` case, before `return steps`:

```ts
      // "No next step: Moving to Nurture" parks the lead after the call.
      if (p.set_stage) steps.push({ step: 'set_stage', target: p.set_stage })
```

`run.ts`: move the body of `if (req.action === 'set_stage') { ... }` into a helper, and call it for both actions:

```ts
// Bayway stages are FUB tags (bay-stages.ts); MPG's come from Zoho.
function stageRefusal(businessId, contact, key) {
  if (businessId !== 'bay') return 'Move stage is Bayway only; MPG stages come from Zoho'
  if (!STAGE_TARGETS.some((t) => t.key === key)) return `Unknown stage: ${key}`
  const ps = String(contact?.person_stage || '').trim().toLowerCase()
  // Pre-Qualified always reads as Application Received unless parked (Credit Repair).
  if (ps === 'pre-qualified' && !['application_received', 'credit_repair'].includes(key)) {
    return 'This lead is Pre-Qualified in FUB, which always shows as Application Received. Change the FUB stage first.'
  }
  if (ps !== 'lead' && ps !== 'pre-qualified') {
    return `This lead's FUB stage is ${contact?.person_stage || 'empty'}, so it isn't on the board. Set it to Lead in FUB first.`
  }
  return null
}
```

```ts
  if (req.action === 'set_stage') return stageRefusal(businessId, contact, req.payload?.target)
  if (req.action === 'log_call' && req.payload?.set_stage) return stageRefusal(businessId, contact, req.payload.set_stage)
  return null
```

- [ ] **Step 4: Pass.** `npx vitest run supabase/functions/crm-action`.
- [ ] **Step 5: Commit** `feat: Log call can park a Bayway lead in Nurture`.

### Task 3: Required Next step in the Log call form

**Files:** Modify `src/components/QuickActions.jsx`; test `src/components/QuickActions.render.test.jsx`.

- [ ] **Step 1: Failing tests.**
  - Split the mock's `v_tasks` results: `lte` queries return `openTasks.rows` and `gt` queries return `futureTasks.rows`.
  - Update "offers to complete the contact's open task": Interested now sends `follow_up`.
  - Add:
    - Not Interested leaves Log call disabled until "No next step" plus a reason are chosen, then sends `{ next_step: 'none', no_next_step_reason: 'Not interested' }` and no `follow_up`.
    - "Moving to Nurture" sends `set_stage: 'credit_repair'`.
    - A lead with a future task preselects "Already scheduled", shows its title, and sends `next_step: 'scheduled'` with no `follow_up`.
- [ ] **Step 2: Run.** `npx vitest run src/components/QuickActions.render.test.jsx`. Expect FAIL.
- [ ] **Step 3: Implement** in `LogCallForm`:
  - Replace `followOn` / `followTouched` with `nextStep` / `nextTouched` / `reason` / `futureTask`.
  - Add a second bounded `v_tasks` lookup (`.gt('due_at', endOfTodayIso())`, `limit(1)`).
  - The section has chips Follow-up · Already scheduled (only with a future task) · No next step.
  - Follow-up shows the date presets and title.
  - Already scheduled shows the task's title and `dueLabel`.
  - No next step shows reason chips. "Moving to Nurture" appears for Bayway only.
  - Save is disabled until the outcome and next step are complete.
- [ ] **Step 4: Pass.** Run the page tests, then `npm test`.
- [ ] **Step 5: Commit** `feat: Log call requires a next step`.

### Task 4: Next-step prompt after a stage move

**Files:**
- Modify `src/components/QuickActions.jsx` (`NextStepPrompt`, the `openTaskCount` prop, `StageForm` passing its target).
- Modify `src/pages/Pipeline.jsx`: the card passes `openTaskCount`, and the drag success path opens the prompt.
- Test `QuickActions.render.test.jsx` and `Pipeline.render.test.jsx`.

- [ ] **Step 1: Failing tests.**
  - QuickActions: Move stage with `openTaskCount: 0` to Attempted opens "Next step for Jo?". Skip closes it. With `openTaskCount: 2` there's no prompt.
  - Pipeline: dragging a card with `open_task_count: 0` to Attempted opens the prompt after the move succeeds.
- [ ] **Step 2: Run.** Expect FAIL.
- [ ] **Step 3: Implement.**

```jsx
// After a stage move leaves a lead with nothing scheduled: offer a follow-up.
// Skip is fine; the lead then shows in Up Next as "No next step".
export function NextStepPrompt({ businessId, contactId, contactName, onClose, onDone }) {
  const t = tone(businessId)
  const first = String(contactName || '').trim().split(/\s+/)[0]
  const done = (summary, { keepOpen } = {}) => {
    if (!keepOpen) {
      showToast(summary)
      onClose()
    }
    onDone?.(summary)
  }
  return (
    <Sheet title={first ? `Next step for ${first}?` : 'Next step?'} subtitle="Nothing is scheduled for this lead" t={t} onClose={onClose}>
      <FollowUpForm businessId={businessId} contactId={contactId} contactName={contactName} t={t} onSuccess={done} />
      <button type="button" onClick={onClose} className="mt-2 flex min-h-[42px] w-full items-center justify-center rounded-[10px] border border-line2 text-[13.5px] font-semibold text-muted">
        Skip
      </button>
    </Sheet>
  )
}
```

  - `StageForm` remembers the target it sent in a ref and passes `{ target }` to `onSuccess`.
  - `QuickActions` gets an `openTaskCount` prop. On a stage success where `needsNextStepPrompt(target, openTaskCount)` is true, it toasts, calls `onDone`, and switches the sheet to `'nextstep'`.
  - In `Pipeline.jsx`, `moveTo` sets `prompt` to the row when `needsNextStepPrompt(targetKey, row.open_task_count)`, and renders `<NextStepPrompt>` for it.
- [ ] **Step 4: Pass.** Run both page tests, then `npm test`.
- [ ] **Step 5: Commit** `feat: offer a follow-up after a stage move leaves nothing scheduled`.

### Task 5: Deploy, live test, PR

- [ ] **Step 1: Ask Chandler** before `supabase functions deploy crm-action` (production).
- [ ] **Step 2: Live test on ZZ Test Sales OS only**, signed in at the preview:
  - Log call → Not Interested → No next step → Moving to Nurture. Expect "Call logged and stage moved in FollowUpBoss", and the card moves to Nurture / Credit Repair.
  - Move it back to New Lead with Move stage. The prompt appears; choose Skip.
  - Check `crm_actions` for `no_next_step_reason`.
- [ ] **Step 3: Push, open the PR, bind it** with `mcp__ccd_pr__get_status`.
