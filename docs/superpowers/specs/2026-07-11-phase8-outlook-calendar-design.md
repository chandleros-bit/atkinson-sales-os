# Phase 8 — Outlook Calendar Sync + Agenda Screen Design

**Date:** 2026-07-11
**Status:** Approved by Chandler (ICS published-feed sync for two Outlook logins; merged agenda list grouped by day; business filter scopes sources; sync + screen together)
**Depends on:** Phase 2 sync infra (`_shared/db.ts`, `sync_log`, pg_cron), the `calendar_events` table (migration `0001`), `BusinessContext` (`useBusiness`), `src/lib/overview.js`.

## Context and approach

The two Outlook calendars are separate logins. Rather than Microsoft Graph OAuth (Azure app
registration × 2), this uses **published ICS feeds**: each Outlook account publishes its
calendar to an `.ics` URL, and an `outlook-sync` Edge Function fetches both, parses them
(including recurring events), and upserts into `calendar_events`. Read-only; the app never
writes to Outlook. Graceful when the URLs aren't set yet (like the Zoho sync).

The merged calendar screen at `/calendar` reads `calendar_events` and renders an agenda.

## Data model (no schema migration)

Uses the existing `calendar_events` (migration `0001`): `id, source_account, external_id,
title, starts_at, ends_at, location, is_all_day, raw, unique(source_account, external_id)`.
Sources: `outlook-mpg`, `outlook-bayway` — both already defined on the Sync Status screen
(`SOURCE_LABELS`). RLS: authenticated read (existing policy). The only migration is `0008`
(cron).

## Architecture

### `supabase/functions/_shared/ics.ts` (new)

- Imports `ICAL` from `https://esm.sh/ical.js@1.5.0` (Mozilla ical.js — pure JS, Deno-safe,
  confirmed reachable).
- `mapEvent(vevent, occurrenceStart?)` (pure, unit-testable): maps an ical.js event (and an
  optional recurrence-occurrence start) to a row `{ external_id, title, starts_at, ends_at,
  location, is_all_day }`. `external_id` = `UID` for single events, `` `${UID}_${startISO}` ``
  for recurrence occurrences (keeps each occurrence unique). `is_all_day` from the DTSTART
  value type (date vs date-time). Times normalized to UTC ISO.
- `fetchAndExpand(url, windowStart, windowEnd)` (I/O): fetch the ICS text; parse with ical.js;
  for each VEVENT, if non-recurring and within the window, emit one row; if recurring, use
  `ICAL.RecurExpansion` to emit occurrences whose start falls in `[windowStart, windowEnd]`
  (hard cap the loop, e.g. 500 occurrences per event, to bound runaway RRULEs). Returns rows.

### `supabase/functions/outlook-sync/index.ts` (new)

`Deno.serve` handler. For each feed `{ source: 'outlook-mpg', envVar: 'OUTLOOK_MPG_ICS_URL' }`
and `{ source: 'outlook-bayway', envVar: 'OUTLOOK_BAYWAY_ICS_URL' }`:
- If the env var is unset → `logSync(db, source, 'error', 0, '<VAR> not set as a function
  secret')` and continue (graceful; the other feed still runs).
- Else `fetchAndExpand(url, now, now + 60 days)`, upsert rows into `calendar_events` with
  `source_account = source` (`onConflict: 'source_account,external_id'`), then
  `logSync(db, source, 'ok', count)`.
- On throw for a feed → log that feed as `error` with the message; don't abort the other feed.
Returns `{ ok, mpg: n, bayway: m }`. Reuses `serviceClient()` / `logSync()` from `_shared/db.ts`.

### Cron (migration `0008_schedule_outlook_sync.sql`)

`cron.schedule('outlook-sync-15min', '*/15 * * * *', …)` → `net.http_post` to the deployed
`outlook-sync` with the public anon bearer (idempotent, same pattern as `0002`/`0005`).

### `src/lib/calendar.js` (new, pure, unit-tested)

- `sourceToBiz(source_account)`: `'outlook-mpg'` → `'mpg'`, `'outlook-bayway'` → `'bay'`, else
  `null`.
- `dayKey(iso)`: local `YYYY-MM-DD` for grouping.
- `dayLabel(iso, now)`: "Today" / "Tomorrow" / "Wed · Jul 15".
- `timeLabel(event)`: "All day" when `is_all_day`, else localized start time ("2:00 PM").
- `groupByDay(events)`: events sorted by `starts_at`, returned as ordered
  `[{ dayKey, label, events }]` (uses `dayKey`/`dayLabel`).

### `src/pages/Calendar.jsx` (new)

- `useBusiness()` → `biz`, `matches`. Loads `calendar_events` for the window
  `starts_at >= startOfToday` and `starts_at < startOfToday + 30 days`, ordered by `starts_at`.
- Filters to events whose `matches(sourceToBiz(source_account))` (All shows both; MPG/Bayway
  scope to their Outlook source).
- Renders day groups (from `groupByDay`); each event row: source dot (`--mpg` / `--bay`),
  `timeLabel`, title, location. Hardened `try/catch/finally`; loading / error / empty states.
- Empty state: "No upcoming events — connect Outlook (see docs/phase8-outlook-setup.md)."
- Demo mode: a small static agenda.
- Route: swap `/calendar` from `PagePlaceholder` to `<Calendar />` in `App.jsx`.

### Setup doc `docs/phase8-outlook-setup.md`

Per Outlook login: **Outlook on the web → Settings → Calendar → Shared calendars → Publish a
calendar → "Can view all details" → copy the ICS link**. Then
`supabase secrets set OUTLOOK_MPG_ICS_URL=… OUTLOOK_BAYWAY_ICS_URL=…`. Trigger a run; check
Sync Status. Notes the publish-feed refresh lag (Microsoft updates the feed periodically) and
that the ICS URL is a semi-public token (keep it unshared).

## Edge cases

- Feed URL unset → that source logs "not set" error; other feed still syncs; screen shows
  whatever exists.
- All-day events → `is_all_day` true, `timeLabel` "All day", sort before timed events same day.
- Recurring events → expanded within the 60-day window; per-event occurrence cap.
- No events in window → empty-state message.
- Query/parse error → logged to `sync_log.message` (visible on Sync Status) / inline strip on
  the screen; one feed failing never blocks the other.
- Timezones → ical.js resolves VTIMEZONE; stored as UTC ISO; displayed in the browser's local
  time.

## Verification plan

1. `npm test` — `calendar.test.js` (sourceToBiz, dayLabel Today/Tomorrow/date, timeLabel
   all-day vs timed, groupByDay ordering/grouping) and `ics.test.js` (`mapEvent`: single vs
   occurrence external_id, all-day detection, UTC normalization). Existing tests still pass.
2. `npm run build` passes.
3. Deploy `outlook-sync`; migration `0008` pushed. With no ICS secrets, a manual trigger logs
   both `outlook-mpg` and `outlook-bayway` as "not set" errors on Sync Status (graceful).
4. If Chandler publishes the feeds and sets the secrets: trigger a run; confirm
   `calendar_events` gains rows and the `/calendar` agenda renders them grouped by day, with
   the business filter scoping sources; no console errors.
5. Screenshot; deploy (push). (Screen degrades to the empty state until feeds are live.)

## Out of scope (deferred)

- Microsoft Graph / OAuth path; writing to Outlook; event detail/RSVP
- Month/week grid layouts; drag; reminders
- Non-Outlook calendars (the connected Google calendar)
