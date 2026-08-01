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

### Scope: calls only (as shipped)

The feed carries **calls**. On the first live run against the Media Payments
Group org (2026-08-01) the other two modules were blocked by Zoho permissions,
not by the code:

- **Meetings (`Events`)** → `NO_PERMISSION`: the sync user's profile has no read
  access to the Meetings module. If MPG starts logging meetings there, grant the
  profile Read on Meetings (Setup → Users and Control → Profiles) and re-add
  `['appointment', fetchEvents]` to the `fetchers` list in the function.
- **Notes** → `NOT_SUPPORTED` "supported only for admin users": Zoho's list-all
  Notes API is admin-only. Options: use an admin refresh token and re-add
  `['note', fetchNotes]`, or add a per-contact Notes pass
  (`GET /Contacts/{id}/Notes`, non-admin-safe) mirroring the FUB per-contact
  email pass.

Both mappings (`fetchEvents` / `fetchNotes` and their occurred/snippet/parent
handling) remain in `_shared/zoho-activity.ts` and are unit-tested, so
re-enabling either is a one-line change in the function. Texts and emails have
no listable Zoho module and are out of scope.

## Notes

- Read-only: the function only GETs from Zoho and writes to our own tables.
- First run is bounded to the last 90 days (via `If-Modified-Since` on
  `Modified_Time`); subsequent runs are incremental from the last successful run
  (`sync_log` source `zoho-activity`).
