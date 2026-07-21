# Borrower Docs on Bayway Pipeline Cards — Design

**Date:** 2026-07-20
**Status:** Approved, awaiting implementation plan
**Scope:** Bayway only. MPG untouched.

## Problem

Bayway pipeline cards show who a borrower is and when they were last touched, but
not the thing that actually blocks a loan: which documents the borrower still owes,
and how long they have owed them. That information lives in Arive (the LOS) and in a
Google Sheet that an assistant updates daily. The app ignores both.

Cards also omit the last conversation note, so deciding what to do with a card
requires leaving the board.

## Decisions

Reached during brainstorming, with the alternatives that were rejected and why.

| Decision | Rejected alternative | Reason |
|---|---|---|
| Google Sheet as the feed | Arive API | Unknown whether one exists. If it does, it replaces the sheet later and this schema survives. |
| Google Sheet as the feed | Parsing the Arive docs email | Needs an inbound-mail vendor or MS Graph OAuth, plus HTML parsing that breaks on template changes, plus name-based borrower matching. Strictly worse on every axis. |
| Google Sheet as the feed | FUB multi-select custom field | Adds a second place for a human to maintain. The sheet is already maintained daily, so it adds no new labor. |
| Service account auth | Publish-to-web CSV | Published sheets are readable by anyone with the URL and have been search-indexed. This sheet is entirely borrower PII. |
| Sheet is Wide, table is Long | Long sheet | Assistant edits cells instead of adding/removing rows. Under ten doc types, so column count stays sane. |
| Aging computed by the sync | Assistant types dates | Sheet stays fast; the database earns the history. |
| Cards gate on data, not stage | Gate on "Waiting on Docs" | A borrower in App Sent who already owes docs is exactly who needs catching. |

If the doc vocabulary ever grows well past ten types, revisit Wide vs Long.

## Architecture

Same shape as every existing sync: cron, edge function, normalized table,
`security_invoker` view, screen.

```
Google Sheet (assistant, daily)
  ↓ Sheets API, service account, read-only, 15-min cron
supabase/functions/sheets-docs-sync
  ↓ full-snapshot diff, upsert
borrower_doc_tracking + borrower_docs
  ↓ lateral join on contacts.external_id
v_active_pipeline (extended)
  ↓
src/pages/Pipeline.jsx card
```

The sheet is Wide and the table is Long; the function pivots on the way in.

## The sheet contract

One tab named `Doc Status`. Row 1 is headers, matched case-insensitively after
trimming.

| Column | Required | Contents |
|---|---|---|
| `FUB ID` | yes | Number from the FUB profile URL. Join key. |
| `Borrower` | no | Human-readable only. Sync ignores it. |
| *(one per doc type)* | — | `Needed`, `Received`, or blank |
| `Notes` | no | Free text, rendered verbatim on the card |

Doc-type columns are **discovered from the header row at runtime**. Any column that
is not `FUB ID`, `Borrower`, or `Notes` is a doc type. Adding a column in the sheet
surfaces it on cards at the next sync with no deploy.

Starter template — paste into row 1, then apply the validation rule below:

```
FUB ID | Borrower | Paystubs | W2 | Bank Statements | ID | Tax Returns | Notes
```

Example rows:

```
2972 | Sarah Mitchell | Needed   | Needed   | Needed   | Received | Received | Sending W2 tomorrow
3104 | James Ortiz    | Received | Received | Received | Received | Received |
```

**Cell validation:** select the doc-type columns, Data → Data validation → Dropdown,
values `Needed` and `Received`, reject input on invalid. This keeps typos out of the
sync. Blank stays valid and means "not required for this loan."

## Sheet setup (service account)

1. Google Cloud console, create a project (or reuse one).
2. Enable the **Google Sheets API**.
3. Create a **service account**, then create a **JSON key** for it.
4. Share the sheet with the service account's email address, **Viewer** access only.
5. Store the JSON key as Supabase secret `GOOGLE_SERVICE_ACCOUNT_JSON`, and the
   sheet's id (the long string in its URL) as `DOCS_SHEET_ID`.

Viewer, not Editor. The app never writes to the sheet.

## Schema

**Migrations `0021` (tables, RLS, indexes), `0022` (view replace), `0023` (cron).**
0017–0020 are taken by Phase 14.

### `borrower_doc_tracking` — one row per borrower present in the sheet

| Column | Type | Notes |
|---|---|---|
| `id` | bigserial | pk |
| `fub_person_id` | text | unique, join key |
| `contact_id` | uuid | fk to `contacts.id`, nullable |
| `notes` | text | verbatim from sheet |
| `last_seen_at` | timestamptz | stamped every run the row appears |
| `removed_at` | timestamptz | borrower dropped out of the sheet |

The existence of a row here is the "tracked" signal. This is what lets a card
distinguish *not tracked* from *tracked, owes nothing*.

### `borrower_docs` — one row per borrower per doc type

| Column | Type | Notes |
|---|---|---|
| `id` | bigserial | pk |
| `tracking_id` | bigint | fk, unique with `doc_type` |
| `doc_type` | text | from the header row |
| `status` | text | check in (`needed`, `received`) |
| `first_requested_at` | timestamptz | stamped on blank → needed |
| `received_at` | timestamptz | stamped on needed → received |
| `removed_at` | timestamptz | doc column disappeared |

RLS: read-only to `authenticated`, matching `tasks` in 0017. Indexes on
`borrower_doc_tracking.fub_person_id` and `borrower_docs (tracking_id, status)`.

Nothing is ever hard-deleted. A mistaken deletion in the sheet stays recoverable.

### View

`v_active_pipeline` gains two lateral joins, appended at the end so
`create or replace` keeps dependent views valid — same technique as 0016. Both are
null for MPG rows.

Docs:
- `docs_tracked` boolean
- `docs_outstanding` text[], ordered by `first_requested_at` ascending (oldest
  first), so the two names the card shows are always the two that have been
  outstanding longest
- `docs_outstanding_count` int
- `docs_oldest_requested_at` timestamptz

Last note — newest `activities` row of type `note` for the contact:
- `last_note_snippet` text
- `last_note_at` timestamptz

The note join narrows the pattern already used by `v_bayway_activity` to one row
per contact.

## Sync function

`supabase/functions/sheets-docs-sync`, 15-minute cron, logging to `sync_log` under
source `sheets-docs`.

Full snapshot every run — no cursor, so Phase 14's cursor race cannot occur here.

Per run:
1. Sign an RS256 JWT with the service-account key, exchange for an access token.
2. Read the `Doc Status` tab.
3. Apply the **mass-removal guard** (below) before any write.
4. Resolve `FUB ID` values against `contacts.external_id`. A query error **throws** —
   never proceed with an empty map.
5. Pivot wide rows into `(fub_person_id, doc_type, status)` triples.
6. Diff against current state and stamp transitions.
7. Batched upsert.

### Transition rules

| From | To | Effect |
|---|---|---|
| absent / blank | `Needed` | insert or update, stamp `first_requested_at` |
| `Needed` | `Received` | stamp `received_at` |
| `Received` | `Needed` | clear `received_at`, re-stamp `first_requested_at` |
| present | column gone | stamp `removed_at` |
| borrower present | borrower gone | stamp `removed_at` on tracking row |

### Mass-removal guard

**If the read returns zero rows and the previous run recorded more than zero, abort
with `status='error'` and write nothing.**

A sheet legitimately emptying overnight is not a real scenario; an auth failure,
renamed tab, or revoked share is. Without this guard, such a failure silently stamps
`removed_at` across every borrower and every card flips to "not tracked" while the
sync logs success. Same instinct as Phase 14's throw-on-id-map-error: a
successful-looking empty result is worse than a loud failure.

### Other failure handling

| Failure | Handling |
|---|---|
| Tab missing or renamed | Throw, log, leave data intact |
| Duplicate `FUB ID` rows | Skip both, count in `sync_log.message`. Ambiguous, do not guess. |
| `FUB ID` absent from `contacts` | Store with null `contact_id`, count it. Contact may sync later. |
| Non-numeric or blank `FUB ID` | Skip and count. **Never fall back to name matching.** |
| Unrecognized cell value | Treat as blank, count it |
| Service-account key expired | Auth throws before the diff runs — no partial write |

Name matching is excluded deliberately. Across 826 contacts, a wrong doc list on a
borrower's card is worse than an absent one, because it is confidently wrong.

`_shared/google-auth.ts` holds the JWT signing, isolated and separately tested. It is
the only asymmetric-signing code in the codebase and should never have to be debugged
through the sync.

## Card UI

`src/pages/Pipeline.jsx`, Bayway cards only.

```
┌─────────────────────────────────┐
│ Sarah Mitchell        ↗ CRM     │
│ Waiting on Docs · touched 3d    │
│                                 │
│ ⚠ 3 docs · oldest 12d           │
│   Paystubs, W2 +1               │
│                                 │
│ 💬 "Sending W2 tomorrow, has    │
│    to dig up the 2024 one" · 2d │
└─────────────────────────────────┘
```

Count and aging lead because they are the scannable signal; two doc names plus `+N`
give enough to act on without opening the card. Full list on click, via the card's
existing detail affordance.

The aging badge turns amber past **7 days**, matching `STALE_TOUCH_DAYS` in
`src/lib/overview.js:6`, so the board keeps one consistent notion of "too long."

Last note is one line, truncated at roughly 80 characters, with relative age. It
renders on every Bayway card, not only docs-blocked ones.

### States

| Condition | Card shows |
|---|---|
| Not in sheet | `Docs not tracked`, muted |
| In sheet, zero outstanding | `✓ All docs received`, green |
| Outstanding docs | Count, aging badge, names with `+N` |
| No note on record | Note line omitted entirely, not an empty quote |
| Sync stale > 2 cycles | Muted staleness marker on the docs block |

The stale case reuses `isSyncStale` from `src/lib/calendarRail.js` rather than
introducing a second staleness rule. If the sync breaks, cards must not present
yesterday's doc list as current.

MPG cards are unchanged.

## Testing

Pure functions carry the weight, consistent with prior phases.

- `parseSheet` — wide-to-long pivot, runtime header discovery, skip-and-count rules
- `diffDocs` — every transition in the table above and the timestamp it stamps
- **Mass-removal guard, mutation-tested**: removing the guard must fail a test
- `_shared/google-auth.ts` — JWT construction and signing, tested standalone
- `src/lib/borrowerDocs.js` — summary string, `+N` overflow, 7-day threshold, all
  five card states
- Demo-mode verification on port 5199 using a temporary `.env.local` with blank
  `VITE_` vars (the Phase 14 approach, which avoids tripping the auto-mode
  classifier). Screenshots time out in this environment; use `get_page_text`.

## Out of scope

- **Write-back to the sheet.** Read-only v1 holds; the app never edits the
  assistant's work.
- **The Overview workbench (idea #1).** Separate phase, consumes this data model.
  Sequencing this first is what de-risks it.
- **Arive API.** If it exists, it replaces the sheet as the feed and this schema
  largely survives. Worth checking before building idea #1.
- MPG, per-doc notes, in-app document upload, email parsing.

## Open questions

None blocking. One worth resolving before idea #1: whether Arive exposes an API or
webhooks.
