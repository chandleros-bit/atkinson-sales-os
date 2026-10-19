# Quick Actions (CRM Write-Back v1): Design

**Date:** 2026-10-18
**Status:** Draft, pending Chandler's review
**Supersedes:** Part 2 of `2026-10-16-row-cap-fix-and-quick-actions-design.md`. Part 1 of that spec shipped in PR #19. Where the two disagree, this document wins.
**Depends on:** PR #19 merged (this build adds a row to the Sync Status page and reuses `fetchAll`).
**Touches:** new `supabase/functions/crm-action/`, new `supabase/functions/_shared/fub-write.ts`, `_shared/zoho-write.ts`, `_shared/fub.ts` (add `fubSend`), `_shared/zoho.ts` (add `zohoSend`), new migration `0028_crm_actions.sql`, new `src/components/QuickActions.jsx`, new `src/lib/crmActions.js`, `src/pages/Pipeline.jsx`, `src/pages/PriorityLeads.jsx`, `src/pages/Tasks.jsx`, `src/components/MyTasks.jsx`, `src/components/Sidebar.jsx`, `src/pages/SyncStatus.jsx`, new `docs/phase-writeback-setup.md`

## Problem

Every screen tells Chandler who to call next, but acting on it means switching to FollowUpBoss or Zoho, finding the person, and clicking through. The My Tasks checkbox is local-only and resets on reload. The sidebar "+ New Task" button does nothing.

v1 adds a small set of actions that write to the source CRM, so the common loop (call, outcome, next follow-up) happens in the dashboard. This is also the write path the natural-language update feature and the planned Priority tab will reuse, so the component and function must not be tied to any one page.

## What v1 does

| Action | Where it shows | FUB (Bayway) | Zoho (MPG) |
|---|---|---|---|
| **Log call** | Pipeline cards, Priority Leads rows, task rows | `POST /v1/calls` | `POST /crm/v2/Calls` |
| **Add note** | same | `POST /v1/notes` | `POST /crm/v2/Leads/{id}/Notes` |
| **Schedule follow-up** | same, plus sidebar "+ New Task" | `POST /v1/tasks` | `POST /crm/v2/Tasks` |
| **Complete task** | My Tasks rail, Tasks board | `PUT /v1/tasks/{id}` `isCompleted: true` | `PUT /crm/v2/Tasks` `Status: Completed` |
| **Push task** | My Tasks rail, Tasks board | `PUT /v1/tasks/{id}` new due date (verify, see below) | `PUT /crm/v2/Tasks` `Due_Date` |

### The Log call form

This is the main flow. One submit can produce a call, a new task, and a completed task.

- **Outcome** (required, chips): Interested, Not interested, Left message, No answer, Busy, Bad number. These are FUB's six allowed `outcome` values, so Bayway needs no translation. Zoho gets the same label in the call's `Description` and, if the org has a `Call_Result` picklist, a mapped value (one table in `zoho-write.ts`).
- **Note** (optional): one text area. Goes into the call record itself (FUB `note`, Zoho `Description`), not a separate note record. "Add note" stays its own action for notes without a call.
- **Duration** (optional for Bayway, required for MPG): minutes, prefilled 1 for Left message / No answer / Busy / Bad number and 5 for Interested / Not interested. Zoho rejects a completed call without `Call_Duration`, and FUB's call log reads better with it.
- **Schedule follow-up** toggle: presets Tomorrow, In 3 days, Next Monday, Pick a date. On by default for Left message, No answer, Busy. Off for the rest.
- **Complete open task** checkbox: shown only when this contact has an open task due today or overdue. Checked by default.

## Architecture

```
Browser (QuickActions)
  -> supabase.functions.invoke('crm-action', {
       client_action_id, action, contact_id | task_id, payload })
     crm-action (JWT verified + ALLOWED_USER_ID check)
       1. idempotency: client_action_id seen before? return stored result
       2. feature flag: writeback_enabled[business_id] on?
       3. resolve our row (service role) -> business_id, source_crm, external_id, phone
       4. plan steps -> run each against FUB or Zoho
       5. after each CRM success: read the record back, run it through the
          EXISTING sync mapper, upsert the mirror row
       6. write crm_actions row with per-step results
  <- { status: 'ok' | 'partial' | 'error', results: [{ step, ok, crm_id, error }] }
```

### Key decisions

**One function, a dispatch table of actions.** One deploy, one auth check, one audit trail.

**The browser sends our uuids, never CRM ids.** The function resolves `source_crm` and `external_id` itself with the service role. A tampered request can only touch records that already exist in our tables.

**JWT verified, single allowed user.** The sync functions are deployed `--no-verify-jwt` because pg_cron calls them. `crm-action` is the opposite: deploy with JWT verification on, then compare the caller's user id against an `ALLOWED_USER_ID` function secret and return 403 on a mismatch. Every table's read policy is `using (true)` for any signed-in user, so this check is what keeps writes to Chandler alone.

**Mirror rows come from the existing sync mappers. This is the most important rule in the spec.** The sync functions namespace activity ids: `fub-activity.ts` and `zoho-activity.ts` both store `external_id` as `` `${type}-${rec.id}` `` (for example `call-48213`), not the bare CRM id. If the mirror wrote `48213`, the next sync would insert `call-48213` beside it and every logged call would count twice in the call metrics. So after each CRM write, the function fetches the created or updated record by id and passes it to the same function the sync uses:

| Step | Mirror via |
|---|---|
| FUB call | `mapActivity(rec, 'call', contactIdByExternal)` from `_shared/fub-activity.ts` |
| FUB task create / complete / push | `mapTask(rec, contactIdByExternal, dealIdByExternal)` from `_shared/fub-tasks.ts` |
| Zoho call | `mapActivity(rec, 'call', contactIdByExternal)` from `_shared/zoho-activity.ts` |
| Zoho task | `mapTask(...)` from `_shared/zoho-tasks.ts` |
| FUB note / Zoho note | the matching `mapActivity(rec, 'note', ...)` |

Upsert with `onConflict: 'source_crm,external_id'`, the same as the syncs. The contact map only needs the one contact, so build a single-entry `Map` instead of loading the whole table.

Reading the record back costs one extra API call per step. That's worth it: it guarantees the mirror is byte-for-byte what the sync would write, and it doesn't depend on the shape of the create response (Zoho's insert returns only an id).

**Also bump `contacts.last_touch_at = now()`** after a call or note, so stale flags and "last touch" labels clear immediately. The next contact sync overwrites it with the CRM's own value.

**Idempotent.** The client creates a uuid `client_action_id` per submit. A repeat id returns the stored result and writes nothing. This is what prevents a double-logged call from a double tap or a retry on bad signal.

**Feature flag per book.** Settings key `writeback_enabled`, default `{ "bay": true, "mpg": false }`. The UI hides actions for a book whose flag is off, and the function refuses them. MPG turns on after the Zoho re-auth below.

## CRM details (checked against FUB's API reference, 2026-10-18)

### FollowUpBoss

Add `fubSend(method, path, body)` beside `fubGet` in `_shared/fub.ts`, with the same Basic auth and `X-System` headers. Throw on non-2xx with the status and the first 300 characters of the body, the same as `fubGet`.

- **Calls** `POST /v1/calls`. Required: `personId`, `phone`, `isIncoming`. Send `isIncoming: false`, `outcome`, `note`, `duration` in **seconds**.
  - `phone` is required. Use `contacts.phone`. If the contact has no phone, the UI disables Log call for that row with the tooltip "No phone on file in FUB". The function also refuses with a clear error.
  - FUB attributes the call to the user who owns the API key (only admins can set `userId`). **Setup check:** confirm `FUB_API_KEY` is Chandler's key. If it belongs to another user or an admin, every logged call will show under that person.
- **Notes** `POST /v1/notes`. Required: `personId`. Send `subject` ("Note from Sales OS" unless the user types one) and `body`.
- **Tasks** `POST /v1/tasks`. Required: `personId` and **either `assignedUserId` or `assignedTo`**. Add a function secret `FUB_USER_ID` (Chandler's FUB user id) and always send `assignedUserId`. Send `name`, `type` (default `Follow Up`; allowed values are Follow Up, Call, Text, Email, Appointment, Showing, Closing, Open House, Thank You), and `dueDate` as `YYYY-MM-DD`.
- **Complete** `PUT /v1/tasks/{id}` with `{ isCompleted: true }`.
- **Push: verify first.** FUB's reference for `PUT /v1/tasks/{id}` lists `isCompleted`, `name`, `type`, and assignment, but does **not** list `dueDate`. Before building the Push UI for Bayway, run one `PUT` with `{ dueDate }` against the test contact's task and read it back.
  - If it works, ship as specified.
  - If it doesn't, Push for Bayway becomes "complete this task and create a new one on the new date" (two FUB calls, one user tap), and the toast says "Rescheduled". Put this choice behind one function so the rest of the code doesn't care.

### Zoho (MPG)

Add `zohoSend(apiHost, accessToken, method, path, body)` beside `zohoGet`. Zoho wraps bodies as `{ data: [ {...} ] }` and returns per-record `code`/`status`. Treat any record-level `status: 'error'` as a failure even when the HTTP status is 200 or 201.

MPG's book lives on **Leads**, so every related record uses `What_Id` set to the lead id with `$se_module: 'Leads'` (not `Who_Id`, which is for Contacts). This matches what `zoho-activity.ts` already handles on the read side.

- **Calls** `POST /crm/v2/Calls`. Required for a completed call: `Call_Type: 'Outbound'`, `Call_Start_Time` (ISO 8601 with offset), `Call_Duration`. Also send `Subject` ("Call: <outcome>"), `Description`, `What_Id`, `$se_module`.
  - Zoho rejects a completed call whose start time plus duration is later than now. Set `Call_Start_Time = now − duration − 1 minute`.
  - `Call_Duration` format: Zoho's docs are inconsistent between `mm:ss` and `hh:mm`. Verify on the test lead and put the formatter in one pure function.
- **Notes** `POST /crm/v2/Leads/{id}/Notes` with `Note_Title` and `Note_Content`. The read-side block on Notes (`NOT_SUPPORTED`, list-all is admin-only) does not apply to creating a note on one record. `zoho-activity-sync` doesn't pull notes, so the mirror row is the only local copy and there's no duplicate risk.
- **Tasks** `POST /crm/v2/Tasks` with `Subject`, `Due_Date` (`YYYY-MM-DD`), `Status: 'Not Started'`, `What_Id`, `$se_module`.
- **Complete / Push** `PUT /crm/v2/Tasks` with `{ data: [{ id, Status: 'Completed' }] }` or `{ data: [{ id, Due_Date }] }`. Use `'Completed'`, which `zohoTaskIsCompleted` already treats as done.

**Re-authorization required before MPG goes live.** The current refresh token is read-only (`ZohoCRM.modules.READ,ZohoCRM.settings.READ`). Generate a new one with those scopes plus `ZohoCRM.modules.Calls.CREATE`, `ZohoCRM.modules.Notes.CREATE`, `ZohoCRM.modules.Tasks.CREATE`, `ZohoCRM.modules.Tasks.UPDATE`. Use least privilege, not `modules.ALL`. Also confirm the sync user's Zoho profile can create Calls. Meetings already came back `NO_PERMISSION` on read, so profile permissions are a known risk. Write these steps into `docs/phase-writeback-setup.md`, in the same style as `phase5-zoho-setup.md`.

## Migration `0028_crm_actions.sql`

```sql
create table if not exists crm_actions (
  id               uuid primary key default gen_random_uuid(),
  client_action_id uuid not null unique,
  user_id          uuid not null,
  action           text not null,      -- log_call | add_note | create_task | complete_task | push_task
  business_id      text not null references businesses(id),
  contact_id       uuid references contacts(id),
  task_id          uuid references tasks(id),
  request          jsonb not null,
  results          jsonb,              -- [{ step, ok, crm_id, error }]
  status           text not null,      -- ok | partial | error
  created_at       timestamptz not null default now()
);
alter table crm_actions enable row level security;
-- authenticated SELECT only (Sync Status reads it). Writes come from the
-- function's service role. Same drop-then-create idempotent style as 0012.
create index if not exists crm_actions_created_idx on crm_actions (created_at desc);

insert into settings (key, value)
values ('writeback_enabled', '{"bay": true, "mpg": false}')
on conflict (key) do nothing;
```

The app still never writes to CRM-mirrored tables directly. Leave the `metric_targets` policy from `0012` as it is.

## Failure handling

- **Steps run in order and report separately.** A Log call submit runs: call, then complete old task, then create follow-up. If the call succeeds and the follow-up fails, the result is `partial`, and the UI says exactly that: "Call logged in FollowUpBoss. Follow-up task failed: <reason>." It offers **Retry follow-up**, which sends only that step with a new `client_action_id`.
- **Stop on the first failed step?** No. Steps are independent except that nothing after a failed *call* should run, because the user is reacting to that call. Rule: if `log_call` fails, skip the rest and return `error`. Any other failure doesn't block later steps.
- **A CRM failure never writes the mirror.**
- **A mirror failure after a CRM success** is logged in `crm_actions.results` but reported to the user as success, since the CRM has the record and the next sync heals it.
- **Every submit creates a `crm_actions` row,** including refused ones (flag off, 403 excluded, since no user context is trusted there).
- **Sync Status gets a "Write-back" row:** last 24 hours, count ok / partial / error, and the latest error message. Same card style as the existing per-source rows.
- **Rate limits:** FUB and Zoho both throttle. On a 429, retry once after the `Retry-After` value (cap 5 seconds), then fail the step.

## UI

### `src/components/QuickActions.jsx`

Props: `{ businessId, contactId, contactName, hasPhone, openTask?, task? }`. It renders a compact icon row: call, note, follow-up, plus done and push when `task` is passed. Keep it free of page-specific data fetching, so the Priority tab and the natural-language feature can drop it in.

- Popover on desktop, bottom sheet under 640px. Tap targets at least 40px.
- Colors follow the row's own business, never the current filter (existing rule). MPG blue and Bayway green never share an element.
- States: idle; submitting (button disabled with spinner; also the double-submit guard); success (toast naming the CRM, e.g. "Logged in FollowUpBoss"); partial (named failed step with Retry); error (inline message with Retry, form contents kept).
- Optimistic updates only for Complete and Push on task rows (the row fades out or moves to its new day), reverting on error. Log call and notes wait for the response, since a false "done" there would hurt.
- After a successful write, call an `onDone` prop so the parent page reloads its data. No realtime subscription in v1.

### Placement

- `Pipeline.jsx`: card footer, both books.
- `PriorityLeads.jsx`: right side of each row.
- `MyTasks.jsx`: replace the local-only checkbox (`done` state, "Local-only" comment) with a real Complete. Add Push.
- `Tasks.jsx`: Complete and Push on each row.
- `Sidebar.jsx` "+ New Task": opens Schedule follow-up with a contact picker. The picker searches `contacts` server-side (`ilike` on name, `.limit(10)`, only books with write-back on), so it never loads the whole table. Remove the stale `title="Phase 3 - task creation lands with the Overview build"`.

### Open-task lookup for the Log call form

The "Complete open task" checkbox needs this contact's oldest open task due today or earlier. When the form opens, query `v_tasks` with `.eq('contact_id', id)` and `.lte('due_at', endOfToday)`, ordered by `due_at`, `.limit(1)`. That keeps it bounded, so it passes the row-cap audit test from PR #19.

## Pure helpers (unit-tested)

- `src/lib/crmActions.js`
  - `followUpDate(preset, now)` returns a `YYYY-MM-DD` local date. "Tomorrow" on Friday or Saturday returns Monday. "Next Monday" on a Monday returns the following Monday.
  - `defaultFollowUpOn(outcome)` and `defaultDurationMin(outcome)`.
  - `buildActionRequest(form)` returns the request body, including a fresh `client_action_id`.
- `_shared/fub-write.ts`: `buildFubCall`, `buildFubNote`, `buildFubTask`, `buildFubTaskUpdate`.
- `_shared/zoho-write.ts`: `buildZohoCall` (including the start-time-minus-duration rule), `zohoDuration(minutes)`, `buildZohoNote`, `buildZohoTask`, `buildZohoTaskUpdate`, `zohoCallResult(outcome)`, `zohoRecordError(json)` (pulls a record-level error out of a 200 response).
- `crm-action/plan.ts`: `planSteps(request, openTask)` returns the ordered step list. Tested so a Log call with everything on yields `[log_call, complete_task, create_task]`, and a failed `log_call` stops the rest.

## Testing

- Unit tests for every helper above, in the same style as the existing `_shared/*.test.js`.
- A mirror test that proves the namespacing rule: feed a sample FUB call response through the mirror path and assert `external_id === 'call-<id>'`. Do the same for Zoho.
- Component test for `QuickActions` with a mocked `supabase.functions.invoke`: double click sends one request; partial result names the failed step and retries only that step; error keeps form contents; no-phone disables Log call.
- Live checks against one test record per CRM: **"ZZ Test Sales OS"** as a FUB person and a Zoho Lead. Never real borrowers or merchants.

## Acceptance

1. From a Bayway pipeline card, logging "Left message" with a follow-up for tomorrow creates the call and the task in FollowUpBoss under Chandler's name. Both show on the person in FUB within seconds.
2. The Overview and Reports outbound call counts go up by one immediately, with no sync needed.
3. **After the next scheduled sync there is still exactly one row for that call in `activities` and one for that task in `tasks`.** Check with SQL: `select count(*) from activities where external_id = 'call-<id>'` returns 1.
4. Completing a task in My Tasks completes it in FUB, and it stays gone after a reload and after the next sync.
5. Push moves a FUB task to the new date (or reschedules it via complete-and-recreate, per the verification result), and it appears on the right day on the Tasks board.
6. Tapping submit twice quickly logs one call.
7. A contact with no phone shows Log call disabled with the tooltip.
8. With `mpg` write-back off, MPG rows show no actions and the function refuses MPG requests. After the re-auth and turning the flag on, the same flows work for MPG Leads.
9. A signed-in user who isn't `ALLOWED_USER_ID` gets a 403, and nothing is written.
10. A forced CRM failure leaves local tables untouched and shows the error with Retry. Sync Status shows it in the Write-back row.

## Decisions (defaults chosen, change any before planning)

1. **Outcome chips** use FUB's six outcomes: Interested, Not interested, Left message, No answer, Busy, Bad number.
2. **Follow-up presets:** Tomorrow, In 3 days, Next Monday, Pick a date. "Tomorrow" on a Friday means Monday.
3. **Follow-up on by default** for Left message, No answer, Busy.
4. **Duration defaults:** 1 minute for non-connects, 5 for Interested / Not interested.
5. **Follow-up title default:** "Follow up: <first name>", task type `Follow Up`. Editable.
6. **Complete open task when logging a call:** offered only if one is due today or overdue; checked by default.
7. **Bayway first.** MPG after the Zoho re-auth.

## Build order

1. Merge PR #19.
2. Setup checks: confirm `FUB_API_KEY` is Chandler's, find his FUB user id, create the "ZZ Test Sales OS" test records in both CRMs.
3. Migration `0028`; `crm-action` skeleton with auth, idempotency, flag, `crm_actions`, and a no-op action. Deploy with JWT verification on.
4. FUB: `fubSend`, Log call and Add note with mirror-through-mapper. Verify acceptance #3 live before going further.
5. FUB tasks: create, complete. Run the Push `dueDate` check and pick the path.
6. `QuickActions` component, then placement on Pipeline, Priority Leads, My Tasks, Tasks, and the sidebar.
7. Sync Status Write-back row.
8. Zoho re-auth (docs), Zoho writers, live check on the test lead, turn the `mpg` flag on.

## Out of scope

- Natural-language CRM updates (next spec; it calls `crm-action`).
- Moving pipeline stages. FUB stage changes trigger automations, so this gets its own spec.
- Sending texts or emails.
- Editing contact fields.
- Bulk actions.
- An offline queue for actions taken with no signal.
- Realtime updates. Pages reload after an action instead.
