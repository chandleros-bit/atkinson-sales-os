# Quick Actions (CRM write-back) setup

This turns on the Quick Actions icons (log call, add note, schedule follow-up,
complete and push task). Each action writes to FollowUpBoss (Bayway) or Zoho
(MPG) through the `crm-action` edge function, then mirrors the record into
Supabase with the same mappers the scheduled syncs use, so the next sync updates
the same row instead of adding a copy.

Bayway goes first. MPG stays off (`writeback_enabled.mpg = false`) until the
Zoho re-authorization in step 7.

Spec: `docs/superpowers/specs/2026-10-18-quick-actions-writeback-design.md`.

## 0. Order matters

Apply migration `0028` **before** the frontend that uses it is deployed. Priority
Leads and My Tasks select the new `phone` / `contact_phone` view columns, and
those pages error until the migration is in.

## 1. Apply migration 0028

```powershell
supabase db push --project-ref cnmipfxwqnbtkohfixkf
```

This creates `crm_actions` (authenticated users can only read it), adds the
`writeback_enabled` setting (`{"bay": true, "mpg": false}`), and appends a phone
column to `v_priority_leads` and `v_tasks`.

## 2. Set the function secrets

```powershell
supabase secrets set ALLOWED_USER_ID=<your Supabase auth user id> --project-ref cnmipfxwqnbtkohfixkf
```

`ALLOWED_USER_ID` is the only user allowed to write. Anyone else signed in gets
a 403. Find your id in the Supabase dashboard under **Authentication → Users**.

`FUB_USER_ID` is set in step 4, once `whoami` has confirmed it.

## 3. Deploy the function with JWT verification ON

```powershell
supabase functions deploy crm-action --project-ref cnmipfxwqnbtkohfixkf
```

Do **not** add `--no-verify-jwt`. The sync functions use it because pg_cron
calls them. This one is called only by the signed-in app.

## 4. FUB checks (`whoami`)

Sign in to the app, open the browser console, and run:

```js
const { supabase } = await import('/src/lib/supabase.js') // dev server only
await supabase.functions.invoke('crm-action', { body: { client_action_id: crypto.randomUUID(), action: 'whoami' } })
```

It returns `{ id, name, email, role }` for the user who owns `FUB_API_KEY`.

- **The name must be Chandler's.** FUB logs every call under the API key's
  owner. If it's someone else, replace `FUB_API_KEY` with Chandler's key first.
- Then set his FUB user id. Tasks are always assigned to it:

  ```powershell
  supabase secrets set FUB_USER_ID=<id from whoami> --project-ref cnmipfxwqnbtkohfixkf
  ```

## 5. Test record and first live checks (Bayway)

Create a FUB person named **ZZ Test Sales OS** with a phone number. Never test on
real borrowers. Wait for the next `fub-sync` (or run it from Sync Status) so the
person exists in Supabase, then from its Pipeline card or the sidebar's **+ New
Task**:

1. Log call "Left message" with a follow-up for tomorrow. Both should appear on
   the person in FUB under Chandler's name.
2. After the next `fub-activity-sync` and `fub-task-sync`, check there's still
   exactly one copy of each:

   ```sql
   select count(*) from activities where external_id = 'call-<FUB call id>';  -- 1
   select count(*) from tasks where source_crm = 'fub' and external_id = '<FUB task id>';  -- 1
   ```

   The FUB ids are in `crm_actions.results[].crm_id`.

## 6. Push: does FUB's PUT /tasks/{id} accept dueDate?

FUB's API reference doesn't list `dueDate` on task update. Push the test task to
a new date from the Tasks board, then check the task in FUB.

- **The date moved:** nothing to do (`FUB_PUSH_MODE` defaults to `put_due_date`).
- **The date didn't move:** switch Push to complete-and-recreate. The toast then
  says "rescheduled":

  ```powershell
  supabase secrets set FUB_PUSH_MODE=complete_and_recreate --project-ref cnmipfxwqnbtkohfixkf
  ```

## 7. MPG: re-authorize Zoho with write scopes, then turn it on

The current refresh token is read-only. Repeat steps 1–3 of
`docs/phase5-zoho-setup.md` with this scope (least privilege, not `modules.ALL`):

```
ZohoCRM.modules.READ,ZohoCRM.settings.READ,ZohoCRM.modules.Calls.CREATE,ZohoCRM.modules.Notes.CREATE,ZohoCRM.modules.Tasks.CREATE,ZohoCRM.modules.Tasks.UPDATE
```

and set the new `ZOHO_REFRESH_TOKEN`. The syncs keep working, since the new
token still includes READ.

Also confirm the sync user's Zoho **profile** can create Calls (Setup → Users
and Control → Profiles). Meetings already came back `NO_PERMISSION` on read, so
profile permissions are a known risk.

Create a Zoho **Lead** named **ZZ Test Sales OS** and let `zoho-sync` pull it
in. Then turn MPG on for testing:

```sql
update settings set value = jsonb_set(value, '{mpg}', 'true') where key = 'writeback_enabled';
```

Live checks on the test lead:

- **Log call:** if Zoho rejects `Call_Duration`, the format is wrong. Change
  `zohoDuration` in `supabase/functions/_shared/zoho-write.ts` (mm:ss today)
  and redeploy.
- **Call_Result:** if the org has Zoho's stock Call_Result picklist, set
  `ZOHO_CALL_RESULT=true` so calls carry a mapped result.
- **Add note, Schedule follow-up, Complete, Push:** each should show on the lead,
  and the task should appear on the Tasks board under the lead's name.

To turn MPG off again, set `mpg` back to `false` with the same `update`.

## Troubleshooting

- **Sync Status → Write-back** shows the last 24 hours: ok / partial / failed
  counts and the newest error.
- **"Write-back is off for …":** the book's flag in `settings.writeback_enabled`
  is false.
- **403 Forbidden:** the signed-in user isn't `ALLOWED_USER_ID`.
- **"No phone on file in FUB":** FUB requires a phone to log a call. Add one in FUB.
- **A step shows `mirror_error`:** the CRM has the record but the local copy
  failed. The next scheduled sync fixes it.
