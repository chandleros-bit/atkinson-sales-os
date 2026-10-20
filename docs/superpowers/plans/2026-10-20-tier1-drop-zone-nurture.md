# Tier 1 · Drop Zone: Nurture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While a Bayway card is being dragged, a bar slides up along the bottom of the screen with a "Nurture / Credit Repair" drop zone. Parking a lead no longer means scrolling to the far-right column.

**Architecture:**
- **UI only.** `Pipeline.jsx` gets a `DropZones` component rendered while `drag.draggingId` is set.
- **Data-driven zones.** The list is `DROP_ZONES`; slice 5 adds Lost to it.
- **Drop path.** A drop calls the existing `moveTo(row, 'credit_repair', stage)`, the same `set_stage` write as dropping on the column. No server change.
- **Gating.** Drag stays behind the Bayway write-back flag. Touch screens keep using Move stage, which already lists Nurture / Credit Repair.

**Spec:** `docs/superpowers/specs/2026-10-19-tier1-pipeline-flow-design.md`, section 4 (Nurture zone only; Lost is slice 5).

**Branch / PR:** `feat/drop-zone-nurture` from `main`. One PR.

**Repo rules:**
- Commit as the configured git user.
- End messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Live writes go to ZZ Test Sales OS only.

---

### Task 1: Drop zone bar

**Files:** Modify `src/pages/Pipeline.jsx`; test `src/pages/Pipeline.render.test.jsx`.

- [ ] **Step 1: Failing render tests** (new `describe('Pipeline drop zones')`):
  - The bar is absent until `dragstart`, shows the `credit_repair` zone while dragging, and hides on `dragend`.
  - `dragover` + `drop` on the zone sends `set_stage` `{ target: 'credit_repair' }` for the dragged card. The card shows in Nurture / Credit Repair while the write is in flight. No next-step box opens, because Nurture needs none.
  - A card already in Nurture / Credit Repair gets no zone.
- [ ] **Step 2: Run** `npx vitest run src/pages/Pipeline.render.test.jsx`. Expect FAIL.
- [ ] **Step 3: Implement.**

```jsx
// Off-flow moves while dragging, so parking a lead needs no scroll to the
// far-right column. Slice 5 adds Lost here.
const DROP_ZONES = [{ key: 'credit_repair', stage: 'Nurture / Credit Repair' }]

function DropZones({ drag }) {
  if (!drag?.draggingId) return null
  const zones = DROP_ZONES.filter((z) => z.stage !== drag.draggingStage)
  if (zones.length === 0) return null
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 flex flex-wrap justify-center gap-3 border-t border-line bg-panel/95 px-4 py-3 backdrop-blur"
      data-drop-zones
    >
      {zones.map((z) => {
        const over = drag.over === `zone:${z.key}`
        return (
          <div
            key={z.key}
            data-zone={z.key}
            className="flex min-h-[56px] min-w-[240px] items-center justify-center rounded-card border-2 border-dashed px-4 text-[13px] font-semibold transition-colors"
            style={{
              borderColor: over ? 'var(--bay)' : 'var(--line2)',
              background: over ? 'var(--bay-soft)' : undefined,
              color: over ? 'var(--bay-ink)' : 'var(--muted)',
            }}
            onDragOver={(e) => {
              e.preventDefault()
              if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
              drag.onOver(`zone:${z.key}`)
            }}
            onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget) && drag.onOver(null)}
            onDrop={(e) => {
              e.preventDefault()
              drag.onDropZone(z)
            }}
          >
            Drop here: {z.stage}
          </div>
        )
      })}
    </div>
  )
}
```

  - In `drag`, add `onDropZone: (z) => { const row = …dragged row; reset dragging/over; if (!row || pending[row.id]) return; moveTo(row, z.key, z.stage) }`.
  - Render `<DropZones drag={drag} />` after the board.
- [ ] **Step 4: Run** the page tests, then `npm test` and `npm run build`.
- [ ] **Step 5: Commit** `feat: Nurture drop zone while dragging a Bayway card`.

### Task 2: Verify and PR

- [ ] **Step 1: Check in the browser** (signed in at the preview). Drag ZZ Test Sales OS onto the zone. Expect it to move to Nurture / Credit Repair. Then use Move stage to send it back to New Lead and Skip the follow-up box.
  - Synthetic mouse drags don't trigger HTML5 drag-and-drop in the browser tool, so dispatch `DragEvent`s with a shared `DataTransfer`, as in the drag PR.
- [ ] **Step 2: Push, open the PR, bind it.**
