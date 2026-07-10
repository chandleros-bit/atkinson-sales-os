# Phase 4 — Bayway Pipeline Board Design

**Date:** 2026-07-10
**Status:** Approved by Chandler (honest auto-growing board; curated loan-flow column order; read-only)
**Depends on:** Phase 3 `v_active_pipeline` view (live) and `src/lib/overview.js` helpers

## Context and data reality

The board is driven entirely by the existing `v_active_pipeline` view — no new database work.
As of 2026-07-10 that view returns 25 Bayway rows across two stages: `Pre-Approved` (15)
and `Waiting on Docs` (10). MPG/Zoho is not connected, so the MPG pipeline stays a
placeholder. The app is read-only (locked v1): the board never writes back to FollowUpBoss,
so there is no drag-to-move.

A "kanban board" today is therefore the same 25 people from the Overview, grouped into
columns by stage instead of a single attention-sorted list. It grows automatically as
Chandler adds more `Imported Stage: X` tags in FUB — no code change needed.

## Screen design

### Columns

Rendered left → right in this curated loan-flow order, **but only when the column contains
at least one card** (honest board — empty flow stages are not shown):

1. New Lead
2. Attempted
3. App Sent
4. Waiting on Docs
5. Pre-Approved
6. …any stage not in the list above and not lost-like → appended after #5, alphabetically
7. **Disengaged / Lost** — always rightmost, visually muted; collects any stage whose name
   matches a lost keyword (see rule below)

Today this yields exactly two columns: **Waiting on Docs (10)**, then **Pre-Approved (15)**.

Each column header shows the stage name and a card count. Columns sit in a horizontally
scrolling row; each column is a fixed-width track so 6+ future stages don't crush the layout.

**Lost/disengaged detection:** a stage is routed to the Disengaged/Lost column when its
lowercased name contains any of: `lost`, `dead`, `disengaged`, `withdrawn`, `denied`.
No current data matches, so the column is absent today. (Open item: confirm whether
"disengaged" is a specific FUB tag/value; if so, adjust the keyword set. Non-blocking —
nothing exercises this path yet.)

### Cards (read-only)

Each card shows: person **name**, **phone or email** (phone preferred, else email, else
"no contact info"), and **"last touch Xd ago"** (or "—" when unknown). Bayway green left
stripe. No click action, no drag — read-only per locked v1 scope.

Within a column, cards are sorted by **longest-since-touch first** (reusing
`sortByAttention` from `overview.js`), so the most-neglected loan is at the top.

### Business handling

- `/bayway/pipeline` → live board.
- `/mpg/pipeline` → "Zoho CRM connects in an upcoming phase" placeholder (same as Overview's
  MPG panel).
- Whole-board empty (no active pipeline rows): "No active loans — add stages in
  FollowUpBoss" message, not a bare screen.

## Architecture

### `src/lib/pipeline.js` (new, pure, unit-tested)

- `LOAN_FLOW_ORDER = ['New Lead','Attempted','App Sent','Waiting on Docs','Pre-Approved']`
- `LOST_KEYWORDS = ['lost','dead','disengaged','withdrawn','denied']`
- `isLostStage(stage)` → boolean (lowercased substring match against `LOST_KEYWORDS`).
- `buildColumns(rows)` → ordered array of `{ stage, isLost, cards }`:
  1. group rows by `stage`, ignoring rows whose stage is null/blank/whitespace;
  2. within each group, `sortByAttention(cards)` (imported from `overview.js`);
  3. order groups: lost-like columns last (rightmost); non-lost ordered by index in
     `LOAN_FLOW_ORDER`, with unknown stages after the known ones, alphabetical among
     themselves; multiple lost columns (unlikely) alphabetical among themselves;
  4. drop empty groups (only populated columns returned).

Reuses `sortByAttention` and `lastTouchLabel` from `overview.js` — no duplicated logic.

### `src/pages/Pipeline.jsx` (new)

- Business comes from the `biz` prop set by the route (not the global filter): `biz === 'mpg'`
  renders the MPG placeholder; `biz === 'bay'` renders the live board. Both routes render this
  one component.
- Live path: single query `supabase.from('v_active_pipeline').select('id, business_id, name,
  email, phone, last_touch_at, stage').eq('business_id','bay')`, wrapped in
  try/catch/finally (same hardened pattern as `Overview.jsx`). Renders loading / error strip /
  empty / columns.
- Demo mode (`isDemoMode`): a small static demo board so the shell previews without Supabase.

### `src/App.jsx` (modified)

Swap the two `PagePlaceholder` pipeline routes for the new page. Because the current
placeholders pass `biz` explicitly, the new page takes a `biz` prop:
`<Pipeline biz="bay" />` and `<Pipeline biz="mpg" />`.

## Edge cases

- Null `last_touch_at` → "—", sorts first (via `sortByAttention`).
- Blank/whitespace stage → row ignored (not its own column).
- Query error → compact inline error strip (Overview/SyncStatus pattern); page chrome still
  renders.
- Demo mode → static demo columns, no queries.
- Many columns → horizontal scroll, no layout break.

## Out of scope (deferred)

- Drag-to-move / any write to FUB or Supabase
- Deal dollar values (no deal data in FUB)
- MPG/Zoho data, calendar
- Per-card contact detail pages (Phase 6 Contacts)

## Verification plan

1. `npm test` — new `pipeline.test.js` covers: column order (known stages), unknown-stage
   alphabetical append, lost-keyword routing to rightmost, empty-column drop, blank-stage
   ignore, per-column attention sort. Existing 20 overview tests still pass.
2. `npm run build` passes.
3. Live in the browser (signed in): `/bayway/pipeline` shows exactly two columns —
   Waiting on Docs (10) then Pre-Approved (15) — cards attention-sorted, green stripes;
   `/mpg/pipeline` shows the placeholder; no console errors. Numbers match a direct
   `v_active_pipeline` count.
4. Screenshot shared as proof; then push to deploy.
