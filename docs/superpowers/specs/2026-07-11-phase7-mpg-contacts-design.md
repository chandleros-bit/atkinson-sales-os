# Phase 7 — MPG Contacts Screen Design

**Date:** 2026-07-11
**Status:** Approved by Chandler (Company + Zoho Status columns; no filter chips; generalize the one Contacts component to serve both businesses)
**Depends on:** Phase 6 Bayway contacts (`src/pages/Contacts.jsx`, `src/lib/contacts.js`).

## Context and data

MPG has 3 contacts synced from Zoho (`business_id='mpg'`, `source_crm='zoho'`). Unlike
Bayway, `company` is populated (the merchant business — "Craft Pita True Mediterranean",
etc.), and there is no Bayway-style pipeline enrichment: the stage is the raw Zoho
`person_stage` (Lead_Status, currently "Open" for all 3). So the MPG table differs from
Bayway: it adds a **Company** column, shows **Zoho status** instead of pipeline stage, and
drops the All/Active/Nurture chips (those are Bayway pipeline concepts).

Rather than a second component, this phase **generalizes the existing `Contacts.jsx`** to
render both businesses from a small per-business config. Bayway behavior must stay identical.

## Screen (`/mpg/contacts`)

Table replacing the current MPG placeholder. Columns:

| Column | Content |
|---|---|
| Name | `name` (or "(no name)") |
| Company | `company` (or "—") |
| Status | `stage` (Zoho lead status) in an MPG-blue pill (`--mpg` / `--mpg-soft`); "—" muted when empty |
| Contact | `phone` else `email` else "no contact info" |
| Last touch | `lastTouchLabel(last_touch_at)` |

- **Search:** matches name, **company**, email, phone (company added).
- **No filter chips** (MPG has no Nurture/Active concept).
- **Sort:** click headers (Name, Company, Status, Last touch); default last-touch desc.
- **Pagination:** 50/page (a no-op at 3 rows; present as MPG grows).
- Header count: "N contacts · showing M". Loading / error / empty states as Bayway.
- Read-only.

Bayway (`/bayway/contacts`) is unchanged: Name · Stage · Contact · Last touch, All/Active/
Nurture chips, enriched-stage pills (green / gold "Waiting on Docs" / muted Nurture).

## Architecture

### Migration `0007_mpg_contacts_view.sql`

```sql
create or replace view public.v_mpg_contacts with (security_invoker = on) as
select c.id, c.name, c.company, c.email, c.phone, c.last_touch_at,
       coalesce(c.person_stage, '—') as stage
from contacts c
where c.business_id = 'mpg';
```

`security_invoker = on` keeps read-only RLS. One row per MPG contact; stage is the raw Zoho
status. No base-schema change.

### `src/lib/contacts.js` (modify: search includes company)

`filterContacts` haystack extends to include `company`:
`` `${r.name || ''} ${r.company || ''} ${r.email || ''} ${r.phone || ''}` ``. Harmless for
Bayway (company empty). `sortContacts` already supports any string key (name/company/stage/
last_touch_at) — no change. Add a test that search matches company; existing tests still pass.

### `src/pages/Contacts.jsx` (generalize — config-driven, one component)

A per-business config drives the table so both businesses share one render path:

```js
const CONFIGS = {
  bay: {
    source: 'v_bayway_contacts',
    columns: ['name', 'stage', 'contact', 'last_touch'],   // no company
    filters: ['all', 'active', 'nurture'],
    stagePill: bayStagePill,   // green / gold Waiting on Docs / muted Nurture
  },
  mpg: {
    source: 'v_mpg_contacts',
    columns: ['name', 'company', 'stage', 'contact', 'last_touch'],
    filters: [],               // no chips
    stagePill: mpgStagePill,   // --mpg accent; muted for '—'
  },
}
```

- The query reads `config.source` with `select('*')` (each view already exposes exactly the
  right columns — bay has no `company`, mpg does); the component maps `config.columns` to cells,
  so a missing field simply isn't rendered.
- Column headers/cells render from `config.columns`. `stage`/`Status` label: header reads
  "Stage" for bay, "Status" for mpg (from config). Sort keys map: name→`name`,
  company→`company`, stage→`stage`, last_touch→`last_touch_at`.
- Filter chips render only if `config.filters.length`; when empty, `stageFilter` stays `'all'`.
- Stage/status pill uses `config.stagePill(stage)`.
- Demo mode: a small static table for the current biz (bay demo unchanged; mpg demo = 2 rows
  with company + status).
- `mpg` no longer early-returns a placeholder — it renders the table (loading/empty handled;
  with real data it shows the 3 rows).

The existing bay column set, chips, pills, default sort, and pagination must be byte-for-byte
equivalent in behavior after the refactor (verified live).

### No route change

`/mpg/contacts` already renders `<Contacts biz="mpg" />`; it now shows the table.

## Edge cases

- Empty `company`/`stage` → "—". Null `last_touch_at` → "—", sorts last.
- MPG with zero rows (if data cleared) → "No contacts" empty state.
- Query error → inline strip; demo mode → static rows.
- Bayway must render exactly as before (regression check in verification).

## Verification plan

1. `npm test` — new `filterContacts` company-search test; existing contacts/overview/pipeline
   tests still pass.
2. `npm run build` passes.
3. Migration `0007` pushed; `v_mpg_contacts` returns 3 rows (name/company/stage populated);
   anon (RLS) cannot read it.
4. Live browser: `/mpg/contacts` shows 3 contacts with Company + Status columns, MPG-blue
   status pills, search matches a company name; **`/bayway/contacts` still shows 826 with the
   All/Active/Nurture chips and enriched pills, unchanged**; no console errors.
5. Screenshot both; deploy (push).

## Out of scope

- Editing / writes; per-contact detail; MPG Overview/Pipeline screens
- Zoho-status-specific filter chips (revisit when MPG has varied statuses)
