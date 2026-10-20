# Tier 1 · Global Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Find anyone from anywhere. The sidebar ⌕ button (dead today), **Ctrl+K / ⌘K**, **/** (outside text fields) and a new search icon in the phone top bar all open one search palette. It has three groups: **People** (both books, off-board contacts included), **Open tasks**, and **Go to** (pages). Picking a person opens a **person sheet** with stage, phone/email, the card-health line, last note, Quick Actions and an "Open in FollowUpBoss/Zoho" link. The sheet is the seed of the Tier 2 lead panel.

**Architecture:**
- **Migration `0036_search_people.sql`:**
  - `v_people` (security invoker) gives one row per contact: `id, business_id, name, company, phone, email, last_touch_at, stage, on_board, crm_profile_url`. Bayway `stage` comes from `derive_stage()` with the FUB person stage as fallback. `on_board` means the lead is on its pipeline board.
  - `search_people(q, prefer, max_rows)`, SQL and security invoker:
    - Matches name, company or email (case-insensitive substring, with `%` and `_` escaped).
    - Matches phone on digits only once the query has 3 or more digits.
    - Ranks name-prefix first, then word-prefix, then the current book, then on-board, then most recent touch.
- **`src/lib/search.js` (pure):** `cleanQuery`, `digitsOf`, `matchPages`, `PAGES`, `MIN_QUERY`.
- **`src/lib/useSearch.js`:**
  - Debounced 150 ms; nothing is sent below 2 characters.
  - Each request gets a sequence number, so stale responses are dropped.
  - Calls `rpc('search_people')` plus open tasks from `v_tasks` (`title` or `contact_name` ilike, limit 5).
- **`src/components/SearchPalette.jsx`:**
  - Mounted once in `Layout`.
  - Opened by `openSearch()` (a window event) and the shortcuts.
  - Arrow keys and Enter select; Esc closes; focus returns to where it was.
- **`src/components/PersonSheet.jsx`:**
  - Loads `v_people` by id when opened from a task.
  - Loads the board row (`v_active_pipeline` / `v_mpg_contacts`) for health and last note.
  - Shows `QuickActions` with `openTaskCount`.
- **`QuickActions.jsx`:** exports `Sheet` for reuse.

**Spec:** `docs/superpowers/specs/2026-10-19-tier1-pipeline-flow-design.md`, section 5 (search only; the quick-add menu is slice 7).

**Branch / PR:** `feat/search-palette`. The migration is applied only after Chandler's yes. Read-only feature: no CRM writes, except through the existing Quick Actions.

---

### Task 1: Migration 0036 + dry run
- [ ] Write `v_people` and `search_people`, and `grant execute … to authenticated`.
- [ ] Dry run (BEGIN + migration + DO-block JSON, rolled back). Check:
  - The `v_people` count equals the `contacts` count.
  - A name search, a 4-digit phone search and a company search each return rows.
  - A 1-character query returns 0.
  - `%` is treated literally.
- [ ] Commit `feat: search_people over both books`.

### Task 2: Pure helpers (`search.js`)
- [ ] Tests:
  - `cleanQuery` trims and strips `, ( ) " * % \`.
  - `digitsOf('(713) 555-01')` is `'71355501'`.
  - `matchPages('pipe')` lists both pipelines.
  - `matchPages('')` is empty.
- [ ] Implement. Commit.

### Task 3: Palette (`useSearch`, `SearchPalette`)
- [ ] Render tests (fake Supabase with `rpc`; `MemoryRouter`; `BusinessContext` mocked):
  - Ctrl+K opens the palette with the input focused. "/" inside an input does nothing.
  - One character sends nothing. "jo" sends `rpc('search_people', { q: 'jo', prefer: null, max_rows: 8 })` once, after the debounce.
  - People and Open tasks render under their headings, with a book badge.
  - ArrowDown + Enter on a person opens the person sheet.
  - Esc closes the palette and focus returns to the opener.
  - A slow first response that arrives after a newer one is ignored.
  - A page result navigates.
- [ ] Implement. Commit.

### Task 4: Person sheet + wiring
- [ ] Render tests:
  - The sheet shows name, stage, phone, the health line ("No next step") and "Open in FollowUpBoss".
  - Quick Actions render for a Bayway lead.
  - A task result opens the sheet for the task's contact (loaded from `v_people`).
  - The sidebar ⌕ button opens the palette.
- [ ] Implement:
  - `PersonSheet`.
  - `Sheet` export.
  - `Layout` mounts `SearchPalette` and gains a search button in `MobileBar`.
  - The `Sidebar` ⌕ button calls `openSearch`.
- [ ] Run `npm test` and `npm run build`. Commit.

### Task 5: Ship
- [ ] Ask before `supabase db push --linked`.
- [ ] Browser check, read-only: search a name, a phone fragment and a company; open a person; Esc; Ctrl+K and "/".
- [ ] Push, open the PR, bind it.
