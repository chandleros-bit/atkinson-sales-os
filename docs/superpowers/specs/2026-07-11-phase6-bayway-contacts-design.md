# Phase 6 — Bayway Contacts Table Design

**Date:** 2026-07-11
**Status:** Approved by Chandler (enriched stage; All/Active/Nurture filter; default sort last-touch desc; read-only)
**Depends on:** Phase 3 `v_active_pipeline` view and `src/lib/overview.js` (`lastTouchLabel`).

## Context and data

826 Bayway contacts synced from FollowUpBoss. Field fill rates: `name` 826/826,
`phone` 823/826, `email` 738/826, `last_touch_at` 826/826, `owner` 826/826 (always
"Chandler Atkinson"), `company` 0/826. So the table shows name, phone/email, last
touch, and an **enriched stage**; company and owner are omitted (empty / constant).

Raw `person_stage` is only Nurture (799) / Lead (27), so it carries little signal alone.
The table instead shows the pipeline stage (Pre-Approved / Waiting on Docs / New Lead)
for the ~29 active contacts and "Nurture" for the rest — reusing `v_active_pipeline`.

## Screen (`/bayway/contacts`)

Read-only table replacing the current placeholder. Columns:

| Column | Content |
|---|---|
| Name | `name` (or "(no name)") |
| Stage | colored pill — Pre-Approved / Waiting on Docs (green `--bay`), New Lead (green), Nurture (muted `--dim`) |
| Contact | `phone` else `email` else "no contact info" |
| Last touch | `lastTouchLabel(last_touch_at)` — "today" / "Nd ago" / "—" |

- **Search box:** case-insensitive substring match over name, email, phone; filters as
  you type; applies across the full set (not just the current page).
- **Stage filter chips:** All · Active · Nurture. "Active" = stage ≠ Nurture (~29 today);
  "Nurture" = stage == Nurture (~797).
- **Sort:** click a column header to sort by Name, Stage, or Last touch; toggles asc/desc.
  Default: **last_touch_at descending** (most recently touched first; nulls last).
- **Header count:** "826 contacts · showing N" (N = after search+filter).
- **Pagination:** client-side, 50 rows/page, with page controls; search/filter/sort apply
  to the whole set before paging.
- **States:** loading ("Loading contacts…"), error strip (same pattern as Overview/
  SyncStatus), empty-after-filter ("No contacts match").
- **Read-only:** no editing, no row click-through (contact detail is a later phase).

`/mpg/contacts` keeps the existing placeholder (MPG has only 3 leads; its screen is later).

## Architecture

### Migration `0006_bayway_contacts_view.sql`

```sql
create view public.v_bayway_contacts with (security_invoker = on) as
select c.id, c.name, c.email, c.phone, c.last_touch_at,
       coalesce(p.stage, 'Nurture') as stage
from contacts c
left join v_active_pipeline p on p.id = c.id
where c.business_id = 'bay';
```

`security_invoker = on` keeps the app's read-only RLS in force (as with
`v_active_pipeline`). One row per Bayway contact; stage enriched from the pipeline view,
defaulting to "Nurture". No schema change to base tables.

### `src/lib/contacts.js` (new, pure, unit-tested)

- `NURTURE = 'Nurture'`.
- `filterContacts(rows, { query, stageFilter })`:
  - `query`: trimmed, lowercased; keep rows where name/email/phone (lowercased) includes it;
    empty query keeps all.
  - `stageFilter`: `'all'` keeps all; `'active'` keeps `stage !== NURTURE`; `'nurture'`
    keeps `stage === NURTURE`.
- `sortContacts(rows, { key, dir })`: `key` in `name` | `stage` | `last_touch_at`; `dir`
  in `asc` | `desc`. String compares via `localeCompare`; `last_touch_at` compares by time
  with **nulls always last regardless of dir**. Non-mutating (returns a new array).

Reuses `lastTouchLabel` from `overview.js` for display — no duplicated date logic.

### `src/pages/Contacts.jsx` (new)

- `biz` prop: `mpg` → placeholder panel ("Zoho CRM connects in an upcoming phase — MPG
  contacts will appear here."); `bay` → the live table.
- Live path: one query `supabase.from('v_bayway_contacts').select('id, name, email, phone,
  last_touch_at, stage')`, hardened `try/catch/finally` (same as Overview). Holds all rows
  in state; `useMemo` derives filtered→sorted→paged view from `{ query, stageFilter, sortKey,
  sortDir, page }`. Changing search/filter/sort resets to page 1.
- Demo mode: a small static contacts table so the shell previews.

### `src/App.jsx` (modified)

Swap `/bayway/contacts` → `<Contacts biz="bay" />` and `/mpg/contacts` →
`<Contacts biz="mpg" />`. Add the import. Leave all other placeholder routes unchanged.

## Edge cases

- Null `last_touch_at` → "—", sorts last in both directions.
- Missing name → "(no name)"; missing phone and email → "no contact info".
- Search/filter yields zero rows → "No contacts match" (page controls hidden).
- Query error → inline error strip; page chrome still renders.
- Demo mode → static rows, no query.

## Verification plan

1. `npm test` — new `contacts.test.js`: filter by query (name/email/phone, case-insensitive,
   empty keeps all), stageFilter all/active/nurture, sort by each key asc/desc with nulls-last,
   non-mutation. Existing tests still pass.
2. `npm run build` passes.
3. Migration `0006` pushed; verify via a direct count that `v_bayway_contacts` returns 826
   rows and the Active count matches `v_active_pipeline` (~29); confirm anon (RLS) can't read.
4. Live in the browser (signed in): 826 contacts, header count correct; search narrows;
   All/Active/Nurture filter works (Active ≈ 29); stage pills correct; default sort is
   last-touch desc; pagination works; no console errors.
5. Screenshot; deploy (push).

## Out of scope (deferred)

- Editing / any write; per-contact detail pages; MPG contacts screen
- Column customization; CSV export; server-side pagination (826 rows fit in memory)
