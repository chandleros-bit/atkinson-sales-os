# Phase 11 — Bayway Activity Feed (design)

Date: 2026-07-13
Status: approved

## Goal

Ship a global **activity feed** for Bayway (FollowUpBoss) — a day-grouped,
reverse-chronological timeline of recent human touches (calls, texts, emails,
notes, appointments) across the whole book, filterable by type. This unblocks
the `/bayway/activity` route, which has been a placeholder because the
`activities` table was never populated.

MPG (Zoho) is **out of scope** this phase (its Zoho is near-empty: 3 leads, 0
contacts, 0 deals). The screen is built lightly config-driven so MPG can be
lit up later once a Zoho activity sync exists. `/mpg/activity` stays a
placeholder.

## Decisions (from brainstorm)

- **Shape:** global feed (not per-contact history), day-grouped timeline
  (Today / Yesterday / dated headers), most-recent first.
- **Types:** calls, texts, emails, notes, appointments. Excluded from v1:
  inbound lead events (noisy/high-volume) and stage/status changes (neither CRM
  stores them as activity rows; would have to be synthesized).
- **Filtering:** client-side type chips (All · Calls · Texts · Emails · Notes ·
  Appts).
- **Source:** Bayway / FollowUpBoss only.
- **Pagination:** "Load older" button (keeps initial load light), not a fixed
  window.
- **Layout:** mockup A (day-grouped timeline) — matches the Calendar agenda
  pattern already in the app.

## Backend

### New Edge Function: `fub-activity-sync`

Separate from the existing `fub-sync` (which pulls pipelines/stages, people,
deals). Reuses the same `FUB_API_KEY` / `FUB_SYSTEM_KEY` secrets. Runs on its
own pg_cron schedule (~every 15 min).

Rationale for a separate function rather than folding into `fub-sync`:
activities are a distinct, higher-volume concern with their own cadence and
their own `sync_log` line; keeping `fub-sync` untouched reduces risk to the
already-live people/deals sync.

### New shared module: `_shared/fub-activity.ts`

- Fetchers for the FUB activity endpoints: `/calls`, `/textMessages`,
  `/notes`, `/appointments`, and emails. Written from FUB's documented API
  shape with the same **"verify field shapes on first live run"** convention
  the existing `fub.ts` already carries.
- `mapActivity(record, type)` → one normalized `activities` row:
  - `business_id: 'bay'`, `source_crm: 'fub'`
  - `external_id`: **namespaced by type** — `call-<id>`, `text-<id>`,
    `email-<id>`, `note-<id>`, `appt-<id>` — so the
    `unique(source_crm, external_id)` constraint holds across endpoints that
    may reuse numeric ids.
  - `type`: one of `call | text | email | note | appointment`
  - `contact_id`: resolved via an `external_id → contacts.id` map loaded from
    existing FUB contacts (`select id, external_id from contacts where
    source_crm='fub'`), exactly like `fub-sync` resolves deals. Unmatched →
    `null` (activity still stored/shown, contact name blank).
  - `occurred_at`: each endpoint's created/logged timestamp.
  - `notes`: the human-readable snippet — call outcome/note, text body, email
    subject, note body, or appointment title/description.
  - `raw`: full source payload.

### Sync behavior

- Incremental via `updatedAfter`/`since` where the endpoint supports it;
  otherwise a bounded rolling window (last ~90 days).
- Upsert into `activities` on `(source_crm, external_id)`.
- Log one row to `sync_log` with source **`fub-activity`** (records upserted,
  ok/error, message with payload shape on error).

### Known risk (flagged, not blocking)

FUB's public API exposure of **sent emails** is less certain than
calls/texts/notes/appointments. The sync **degrades gracefully**: if the email
endpoint isn't available on the account, the feed simply omits emails and we
revisit. This is verified on first live run and documented in the setup doc.

### New DB view: `v_bayway_activity`

A `security_invoker = on` view (RLS-safe, consistent with `v_bayway_contacts`,
`v_mpg_contacts`, `v_active_pipeline`), joining `activities → contacts`:

| column | source |
| --- | --- |
| `id` | `activities.id` |
| `type` | `activities.type` |
| `occurred_at` | `activities.occurred_at` |
| `contact_id` | `activities.contact_id` |
| `contact_name` | `contacts.name` |
| `company` | `contacts.company` |
| `owner` | `contacts.owner` |
| `snippet` | `activities.notes` |
| `business_id` | `activities.business_id` |

Filtered to `business_id='bay'` and `type in (call,text,email,note,
appointment)`, ordered `occurred_at desc`.

## Frontend

### `src/lib/activity.js` (pure, unit-tested)

- Type metadata: `{ key, label, colorClass }` for each of the five types.
- `filterByType(rows, typeKey)` — `typeKey === 'all'` passes everything.
- `groupByDay(rows, now)` — groups by `occurred_at` in **descending** order,
  reusing the Today / Yesterday / dated-header label logic from `calendar.js`
  (`dayKey` / `dayLabel`). Time-of-day formatting for each row.

### `src/pages/Activity.jsx`

- Light per-business config `ACTIVITY[biz] = { view, copy }`; only `bay` is
  wired this phase.
- Loads the ~150 most-recent rows from `v_bayway_activity` (`occurred_at
  desc`).
- Renders the mockup-A day-grouped timeline: per-row type tag (color-coded),
  time, contact name, snippet (truncated), owner (right, dim).
- Type-filter chips filter the already-loaded rows client-side.
- **"Load older"** button fetches the next window by range/offset and appends.
- Loading / empty / error / demo-mode states matching `Calendar.jsx`
  (demo rows included).
- Rows are display-only in v1 (read-only ethos). Per-contact drill-in is a
  noted future enhancement, not built now.

### Routing & sync status

- `/bayway/activity` → `Activity` (biz `bay`). `/mpg/activity` stays
  `PagePlaceholder`.
- `SyncStatus.jsx`: add `fub-activity` to `SOURCE_LABELS`
  (`{ label: 'FollowUpBoss activity (Bayway)', biz: 'bay' }`) so it shows as its
  own Bayway health row.

## Testing & docs

- Vitest unit tests for `activity.js` helpers (grouping order, day labels,
  type filtering) and the `fub-activity` mappers (namespaced external_id,
  per-type snippet/timestamp mapping, contact resolution) — mirrors
  `zoho.test.js` / `contacts.test.js`. Keep the full suite green and
  `npm run build` clean.
- Setup doc `docs/phase-activity-fub-setup.md`: deploy the function, apply the
  cron migration, verify endpoint/field shapes (especially email) on first
  run, PowerShell-safe `curl.exe` trigger to run it manually.

## Constraints

- Read-only v1: the app only SELECTs; the Edge Function writes with the service
  role.
- Commits stay single-author (`chandleros-bit <chandler.dashboard@gmail.com>`),
  no `Co-Authored-By` trailer — protects the Netlify free-plan single-
  contributor build.

## Out of scope

- MPG / Zoho activity sync and the MPG activity screen (future phase).
- Inbound lead events and stage-change activity.
- Per-contact activity drill-in.
- Any write-back to FollowUpBoss.
