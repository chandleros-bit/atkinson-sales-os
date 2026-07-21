# Phase 8 — Outlook calendar setup (published ICS feeds)

This connects your two Outlook calendars to the dashboard's Calendar screen using
**published calendar links** (ICS) — no Azure app, no OAuth, no passwords. Read-only:
the app only reads the feeds and never writes to Outlook.

Do this once per Outlook login (MPG and Bayway).

## 1. Publish each calendar and copy its ICS link

For **each** Outlook account:

1. Open **Outlook on the web** (outlook.office.com) signed in to that account.
2. **Settings (gear) → Calendar → Shared calendars**.
3. Under **Publish a calendar**, pick the calendar, set permission to
   **"Can view all details"**, click **Publish**.
4. Copy the **ICS** link (ends in `.ics`).

You'll end up with two links — one from the MPG login, one from the Bayway login.

## 2. Set the two links as function secrets

```bash
supabase secrets set OUTLOOK_MPG_ICS_URL="https://outlook.office365.com/owa/calendar/.../calendar.ics"
supabase secrets set OUTLOOK_BAYWAY_ICS_URL="https://outlook.office365.com/owa/calendar/.../calendar.ics"
```

(Keep these links private — anyone with the link can read that calendar.)

## 3. Trigger a sync and check

The function is deployed and runs every 15 minutes, so you don't strictly need to trigger it —
but to sync immediately:

**Windows / PowerShell** (use `curl.exe`, not `curl` — in PowerShell `curl` is an alias for
`Invoke-WebRequest`, which rejects the `-X`/`-H` flags):

```powershell
curl.exe -X POST https://cnmipfxwqnbtkohfixkf.supabase.co/functions/v1/outlook-sync -H "Authorization: Bearer YOUR_ANON_KEY"
```

**macOS / Linux / Git Bash:**

```bash
curl -X POST https://cnmipfxwqnbtkohfixkf.supabase.co/functions/v1/outlook-sync \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

(`YOUR_ANON_KEY` = Supabase → Project Settings → API → anon public.)

Open **Sync Status**: before the secrets are set, "Outlook — MPG" and "Outlook — Bayway"
show a "not set" error; after, they flip to a synced count. Then open **Calendar** to see
the merged agenda (use the All / MPG / Bayway filter to scope it).

## Notes

- **Refresh lag:** Microsoft updates a published ICS feed on its own schedule (often a few
  hours), so new Outlook events may take a while to appear. That's a limitation of published
  feeds, not the sync.
- **Window:** the sync pulls events for the next ~60 days and expands recurring events.
- **Only one login has calendars?** Set just the one URL; the other feed stays "not set" and
  is harmless.

## One-time cleanup after the timezone fix (2026-07-21)

Event times used to be stored 5–6 hours early: `ics.ts` never registered the feed's own
`VTIMEZONE` blocks, so ical.js could not resolve `DTSTART;TZID=...`, fell back to
"floating", and built each timestamp in the host process's timezone — which on the edge
runtime is UTC. A 9:00 AM Houston meeting was stored as `09:00Z` and displayed as 4:00 AM.

**Deploying the fix alone is not enough, and will briefly look like it made things worse.**

Single (non-recurring) events self-heal: their `external_id` is just the UID, so the next
sync overwrites the row with the corrected time. Recurring occurrences do not — their
`external_id` embeds the occurrence start (`uid_2026-07-21T09:00:00.000Z`). Corrected times
produce a *different* key, so the sync inserts new rows and leaves the wrong ones in place.
Every recurring meeting shows up twice, at both the wrong and the right time.

Clear the cached rows once, then re-sync:

```sql
delete from calendar_events
where source_account in ('outlook-mpg', 'outlook-bayway')
  and starts_at >= now();
```

```bash
supabase functions deploy outlook-sync --no-verify-jwt
curl -X POST https://cnmipfxwqnbtkohfixkf.supabase.co/functions/v1/outlook-sync
```

(Use `curl.exe` on Windows — PowerShell aliases `curl` to `Invoke-WebRequest`.)

Deleting is safe here, unlike most tables in this project: `calendar_events` is a pure cache
of the ICS feeds. Nothing is authored in the app, so a re-sync fully rebuilds the 60-day
window. Past events are left alone — they're outside the sync window and would not be
repopulated.

Confirm afterwards that a known meeting reads at its real wall-clock time on **Calendar**,
and that recurring meetings appear once rather than twice.
