# MPG (Zoho) activity sync setup

Fills the `activities` table so the MPG Activity screen (`/mpg/activity`) has
data. Reuses the existing `ZOHO_CLIENT_ID` / `ZOHO_CLIENT_SECRET` /
`ZOHO_REFRESH_TOKEN` function secrets from Phase 5 — no new secrets required.
This is the Zoho mirror of `phase-activity-fub-setup.md`.

## 1. Deploy the function

```bash
supabase functions deploy zoho-activity-sync --no-verify-jwt --project-ref cnmipfxwqnbtkohfixkf
```

## 2. Apply the migrations

Apply `0024_mpg_activity_view.sql` (the view) and
`0025_schedule_zoho_activity_sync.sql` (the 15-min cron) via your usual
migration path (`supabase db push`, or paste into the SQL editor). No new index
is needed — the feed index from `0011` already covers `business_id = 'mpg'`.

## 3. Trigger a first run manually (PowerShell-safe)

PowerShell aliases `curl` to `Invoke-WebRequest`. Use `curl.exe`:

```powershell
curl.exe -X POST "https://cnmipfxwqnbtkohfixkf.supabase.co/functions/v1/zoho-activity-sync" -H "Authorization: Bearer <ANON_KEY>" -H "Content-Type: application/json"
```

Then open **Sync Status** — a "Zoho activity (MPG)" row should show a recent run
with a nonzero "synced" count. The feed appears on `/mpg/activity`. Until the
Zoho secrets are set the row logs a "credentials not set" error each run,
exactly like `zoho` and `zoho-tasks`.

## 4. Verify field shapes on first run (important)

`_shared/zoho-activity.ts` is written from Zoho CRM's documented module shapes.
On the first live run, confirm against the Media Payments Group account and
adjust if needed:

- **Modules:** `Calls`, `Events`, `Notes`. If a module api name differs, update
  the fetcher call.
- **Dates:** `occurredAt()` per-type field priority — Calls use
  `Call_Start_Time`, Events use `Start_DateTime`, Notes use `Created_Time`. If
  rows land with null `occurred_at`, add the real field name to
  `OCCURRED_FIELDS`.
- **Snippets:** `snippet()` per-type body/subject fields (`Description`,
  `Event_Title`, `Note_Content`).
- **Contact link:** Calls/Events resolve via `Who_Id`; Notes via `Parent_Id` +
  `$se_module` (linked only when the parent is a `Contacts`/`Leads` record). If
  your payloads nest these differently, extend `contactExternalId`.

### Texts and emails are omitted (by design)

Zoho has no first-class, listable Text or Email module the way FUB has
`/calls`/`/notes`. The MPG feed therefore carries **calls, meetings, and
notes**. Each module is fetched in its own try/catch, so one failing module is
recorded in `sync_log.message` under `skipped ...` while the others flow into
the feed.

## Notes

- Read-only: the function only GETs from Zoho and writes to our own tables.
- First run is bounded to the last 90 days (via `If-Modified-Since` on
  `Modified_Time`); subsequent runs are incremental from the last successful run
  (`sync_log` source `zoho-activity`).
