# Phase 11 — FollowUpBoss activity sync setup

Fills the `activities` table so the Bayway Activity screen (`/bayway/activity`)
has data. Reuses the existing `FUB_API_KEY` / `FUB_SYSTEM_KEY` function secrets
from Phase 2 — no new secrets required.

## 1. Deploy the function

```bash
supabase functions deploy fub-activity-sync --no-verify-jwt --project-ref cnmipfxwqnbtkohfixkf
```

## 2. Apply the migrations

Apply `0009_bayway_activity_view.sql` (the view),
`0010_schedule_fub_activity_sync.sql` (the 15-min cron), and
`0011_activities_feed_index.sql` (the feed index) via your usual migration
path (`supabase db push`, or paste into the SQL editor).

## 3. Trigger a first run manually (PowerShell-safe)

PowerShell aliases `curl` to `Invoke-WebRequest`, which does not accept
`-X`/`-H` the same way. Use `curl.exe`:

```powershell
curl.exe -X POST "https://cnmipfxwqnbtkohfixkf.supabase.co/functions/v1/fub-activity-sync" -H "Authorization: Bearer <ANON_KEY>" -H "Content-Type: application/json"
```

Then open **Sync Status** in the app — a "FollowUpBoss activity (Bayway)" row
should show a recent run with a nonzero "synced" count. The feed appears on
`/bayway/activity`.

## 4. Verify field shapes on first run (important)

`_shared/fub-activity.ts` is written from FollowUpBoss's documented API shape.
On the first live run, confirm against your account and adjust if needed:

- **Endpoints / list keys:** `/calls`, `/textMessages`, `/notes`,
  `/appointments`, `/emails`. If a response's top-level array key differs,
  update the `listKeys` argument for that fetcher.
- **Dates:** `occurredAt()` per-type field priority (e.g. appointments use
  `date`/`start`). If rows land with null `occurred_at`, the date field name
  differs — add it to `OCCURRED_FIELDS`.
- **Snippets:** `snippet()` per-type body/subject fields.
- **Contact link:** activities resolve their contact via `personId`. If your
  payloads nest it differently, extend `mapActivity`'s `personId` lookup.

### Texts and emails are omitted (confirmed on the live account)

FollowUpBoss will not list `/textMessages` or `/emails` account-wide — both
return `400` demanding a per-person filter (`personId`/`threadId`/etc.). The
sync fetches each type in its own try/catch, so these two are **skipped** (with
the reason recorded in `sync_log.message` under `skipped ...`) while
`/calls`, `/notes`, and `/appointments` — which do list globally — flow into
the feed. Adding texts/emails later means either per-contact fetching or a
FollowUpBoss webhook; it's deliberately out of the current scope.

## Notes

- Read-only: the function only GETs from FUB and writes to our own tables.
- First run is bounded to the last 90 days; subsequent runs are incremental
  from the last successful run (`sync_log` source `fub-activity`).
