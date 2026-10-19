# Browser Row-Cap Fix + Quick Actions (CRM Write-Back v1): Design

**Date:** 2026-10-16
**Status:** Draft, pending Chandler's review
**Touches:** `src/lib/` (new `fetchAll.js`, new `crmActions.js`), `src/pages/Contacts.jsx`, `src/pages/Overview.jsx`, `src/pages/Reports.jsx`, `src/pages/Pipeline.jsx`, `src/pages/PriorityLeads.jsx`, `src/pages/Tasks.jsx`, `src/components/MyTasks.jsx`, `src/components/Sidebar.jsx`, new `src/components/QuickActions.jsx`, new `supabase/functions/crm-action/`, new `supabase/functions/_shared/fub-write.ts` and `zoho-write.ts`, new migration `0028_crm_actions.sql`

## Problem

Two separate problems, shipped as two parts. Part 1 ships first and alone.

1. **Bug: the browser silently drops rows past 1,000.** PostgREST caps a single response at 1,000 rows and does not error when it truncates. The edge functions already handle this with `fetchAll` in `_shared/db.ts` (see the comment there). The frontend never got the same treatment. Several browser queries do a bare `.select()` against tables and views that only grow. The Bayway book was about 826 contacts in July, so this is close to or already past the line.

2. **Feature: the dashboard can't act.** Every screen tells Chandler what to do next (Priority Leads, stale cards, My Tasks), but doing it means switching to FollowUpBoss or Zoho, finding the person, and clicking through. The My Tasks checkbox is local-only and resets on reload. The sidebar "+ New Task" button does nothing. v1 adds a small set of write-back actions so the most common follow-up loop (call, outcome, next follow-up) happens in one place.

## Part 1: Browser Row-Cap Fix

### New helper

`src/lib/fetchAll.js`, a browser copy of the edge-function helper. It cannot import `supabase/functions/_shared/db.ts` directly because that file imports from `esm.sh` for Deno.

```
// makeQuery: () => a fresh PostgREST query builder (no .range applied yet).
// Pages with .range() in 1,000-row steps until a short page comes back.
// Throws on the first error. Never returns a silently partial result.
fetchAll(makeQuery, { pageSize = 1000 } = {}) -> Promise<Row[]>
```

`makeQuery` must be a factory, not a builder, because a Supabase query builder can only be awaited once.

Unit tests in `src/lib/fetchAll.test.js` with a mocked builder: single short page returns as-is; exactly 1,000 then 0 returns 1,000; 1,000 + 1,000 + 37 returns 2,037; error on page 2 throws (does not return page 1); range offsets are 0-999, 1000-1999, 2000-2999.

### Queries to fix

Rule: any browser read that is not bounded by `.range()`, `.limit()`, `.maybeSingle()`, `{ head: true }`, or a date window must either go through `fetchAll` or push its filter down to the server.

| File | Query | Fix |
|---|---|---|
| `Contacts.jsx` `load()` | `from(config.source).select('*')`, both books | `fetchAll` |
| `Overview.jsx` `bayTagged` | all Bayway contacts, only to find HOT-tagged ones in the browser | **Push down** (preferred): filter on the tag server-side, e.g. `.filter('raw->tags', 'cs', '["HOT"]')`. Verify the tag name against `buildBayHotRows`. If the jsonb filter misbehaves, fall back to `fetchAll`. |
| `Overview.jsx` `bayPipe` | `v_active_pipeline` for Bayway | `fetchAll` |
| `Overview.jsx` `mpgLeads` | `v_mpg_contacts` | `fetchAll` (MPG lead volume grows with the lead generator) |
| `Overview.jsx` `leads` | `v_priority_leads` for Bayway | `fetchAll` |
| `Overview.jsx` `deals`, `tasks` | `deals`, `v_tasks` | `fetchAll` |
| `Reports.jsx` | `deals`, `v_active_pipeline` | `fetchAll` |
| `MyTasks.jsx` | `v_tasks` | `fetchAll` |

`Overview.jsx` runs its queries through one `Promise.all` keyed object. Wrap each affected entry so it resolves to `{ data, error }` the same shape as today, so the downstream `res[k].error` / `res[k].data` handling does not change:

```
const all = (make) => fetchAll(make).then((data) => ({ data, error: null }), (e) => ({ data: null, error: e }))
```

Calendar, Activity, and Tasks board queries are already bounded by date windows or `.range()` and are left alone.

### Guard against regression

Add `src/lib/rowCap.audit.test.js`: a Vitest test that reads every `src/**/*.jsx` and `src/**/*.js` file (excluding tests) and fails if it finds a `.from(` chain whose statement contains none of `fetchAll`, `.range(`, `.limit(`, `.maybeSingle(`, `.single(`, `head: true`, `.gte(`, `.lte(`. Allow an explicit opt-out comment `// rowcap-ok: <reason>` on the line above for genuinely small tables (`businesses`, `stages`, `settings`). Crude, but it turns this class of bug from silent into a red test.

### Part 1 acceptance

1. Contacts page shows the same total as `select count(*) from contacts where business_id = 'bay'` in the SQL editor, even past 1,000.
2. Overview Priority Leads and HOT rows include contacts that sort past position 1,000.
3. `npm test` passes, including the new audit test, and fails if a bare `.select()` on `contacts` is reintroduced.

## Part 2: Quick Actions (CRM Write-Back v1)

### What v1 does

Five actions, all writing to the source CRM first and mirroring locally second:

| Action | Where it shows | FUB (Bayway) | Zoho (MPG) |
|---|---|---|---|
| **Log call** | Pipeline cards, Priority Leads rows, task rows | create call on person | create Call on Lead |
| **Add note** | same | create note on person | create Note on Lead |
| **Schedule follow-up** | same, plus sidebar "+ New Task" | create task on person | create Task on Lead |
| **Complete task** | My Tasks rail, Tasks board | mark task complete | set task Status to Completed |
| **Push task** | My Tasks rail, Tasks board | move task due date | move task Due_Date |

The **Log call** form is the main flow and combines three steps in one submit:

- Outcome chips (required): Connected, Left voicemail, No answer, Bad number
- Note (optional, one text area)
- "Schedule follow-up" toggle, with date presets: Tomorrow, In 3 days, Next Monday, Pick a date. Default on when the outcome is Left voicemail or No answer.
- "Complete open task" checkbox, shown only when this contact has an open task due today or overdue. Default on.

One submit can therefore produce a call, a note, a new task, and a completed task. The function runs them in that order and reports each result separately (see Failure handling).

### Architecture

```
Browser (QuickActions)
  -> supabase.functions.invoke('crm-action', { action, contact_id | task_id, payload, client_action_id })
      crm-action edge function (JWT verified, allowed-user check)
        1. idempotency check on client_action_id
        2. resolve our contact/task row (service role) -> business_id, source_crm, external_id
        3. write to FUB or Zoho via _shared/fub-write.ts | zoho-write.ts
        4. mirror locally: activities / tasks / contacts.last_touch_at
        5. record in crm_actions
  <- { ok, results: [{ step, ok, crm_id, error }] }
```

Key decisions:

- **One function, many actions.** One deploy, one auth check, one audit trail. Actions are a dispatch table, not separate functions.
- **The browser sends our ids, never CRM ids.** The client passes `contact_id` or `task_id` (our uuids). The function looks up `source_crm` and `external_id` with the service role. This keeps the client simple and means a tampered request can only act on records already in our tables.
- **CRM first, mirror second.** The CRM is the source of truth. The local mirror only happens after the CRM confirms, and it stores the CRM's returned id as `external_id`, so the next scheduled sync upserts onto the same row (`onConflict: source_crm,external_id`) instead of creating a duplicate.
- **JWT verified.** Unlike the cron-driven sync functions (deployed `--no-verify-jwt`), `crm-action` is deployed with JWT verification on. It also checks the caller's `auth.uid()` against an `ALLOWED_USER_ID` function secret and returns 403 otherwise. This matters because the read policies are `using (true)` for any authenticated user.
- **Idempotent.** The client generates a uuid `client_action_id` per submit. If the same id arrives twice (double tap, flaky mobile signal, retry), the function returns the stored result and does not write again. A call logged twice in FUB is the most likely real-world bug here, and this prevents it.
- **Feature flag per book.** New settings key `writeback_enabled`, value `{ "bay": true, "mpg": false }`. The UI hides actions for a book whose flag is off, and the function refuses them. This lets Bayway ship while the Zoho token is being re-issued, the same "deployed, awaiting secrets" pattern Phase 5 used.

### Local mirror details

- **Log call:** insert into `activities` with `type = 'call'`, `direction = 'outbound'` (column from `0027`), `occurred_at = now()`, `notes` = outcome plus note, `external_id` = CRM call id. Because the auto call counts read outbound calls from `activities`, the Reports and Overview call metrics move the moment the call is logged, not 15 minutes later.
- **Add note:** insert into `activities` with `type = 'note'`.
- **Log call / Add note:** also set `contacts.last_touch_at = now()` so stale flags and "last touch" labels clear immediately. The next sync overwrites it with the CRM's own value, which will match.
- **Schedule follow-up:** upsert into `tasks` with the CRM task id.
- **Complete task:** set `tasks.is_completed = true`. It drops out of `v_tasks` right away.
- **Push task:** update `tasks.due_at`.

### New migration `0028_crm_actions.sql`

```
create table crm_actions (
  id               uuid primary key default gen_random_uuid(),
  client_action_id uuid not null unique,
  user_id          uuid not null,
  action           text not null,          -- log_call | add_note | create_task | complete_task | push_task
  business_id      text not null references businesses(id),
  contact_id       uuid references contacts(id),
  task_id          uuid references tasks(id),
  request          jsonb not null,
  results          jsonb,                  -- per-step [{ step, ok, crm_id, error }]
  status           text not null,          -- ok | partial | error
  created_at       timestamptz not null default now()
);
-- RLS: authenticated SELECT only. Writes come from the function's service role.
```

Plus the `writeback_enabled` settings row. Leave the existing `metric_targets` write policy alone. The app still never writes to CRM-mirrored tables directly.

### CRM writers

Both writers follow the existing pattern: **pure body builders in `_shared/*-write.ts`, unit-tested**, plus a thin send function.

**FUB (`_shared/fub-write.ts`).** Add `fubSend(method, path, body)` next to `fubGet` in `fub.ts`, with the same Basic auth and `X-System` headers. Endpoints (VERIFY on first live run, same convention as `fub.ts`):

- `POST /v1/calls`: `{ personId, phone, outcome, note, isIncoming: false }`
- `POST /v1/notes`: `{ personId, subject, body }`
- `POST /v1/tasks`: `{ personId, name, type, dueDate }`
- `PUT /v1/tasks/{id}`: `{ isCompleted: true }` or `{ dueDate }`

Map the four outcome chips to FUB's outcome values in one table in the builder so the wording can change in one place.

**Zoho (`_shared/zoho-write.ts`).** Add `zohoSend(apiHost, accessToken, method, path, body)`. MPG's book lives on **Leads**, so related records use `What_Id` with `$se_module: 'Leads'`, the same rule `zoho-activity.ts` already documents for reads. Endpoints (VERIFY on first live run):

- `POST /crm/v2/Calls`: `Subject`, `Call_Type: 'Outbound'`, `Call_Start_Time`, `Call_Duration`, `Call_Result`, `Description`, `What_Id`, `$se_module`
- `POST /crm/v2/Leads/{id}/Notes`: `Note_Title`, `Note_Content`
- `POST /crm/v2/Tasks`: `Subject`, `Due_Date`, `Status: 'Not Started'`, `What_Id`, `$se_module`
- `PUT /crm/v2/Tasks`: `{ data: [{ id, Status: 'Completed' }] }` or `{ data: [{ id, Due_Date }] }`

**Zoho needs a new refresh token.** The current one is read-only (`ZohoCRM.modules.READ,ZohoCRM.settings.READ`, per `docs/phase5-zoho-setup.md`). Re-authorize with those plus `ZohoCRM.modules.Calls.CREATE`, `ZohoCRM.modules.Notes.CREATE`, `ZohoCRM.modules.Tasks.CREATE`, `ZohoCRM.modules.Tasks.UPDATE`. Least privilege, not `modules.ALL`. Also confirm the sync user's Zoho profile can create Calls, since Meetings already came back `NO_PERMISSION` on read. Write these steps into a new `docs/phase-writeback-setup.md`.

### Failure handling

- Each step in a multi-step submit is reported separately. If the call logs but the follow-up task fails, the response is `status: 'partial'` with the failed step named. The UI says exactly that ("Call logged in FUB. Follow-up task failed: <reason>. Retry task") and offers a retry for the failed step only, with a new `client_action_id`.
- A CRM failure never writes the local mirror. A mirror failure after a CRM success is logged in `crm_actions` but reported to the user as success, since the CRM has it and the next sync will heal the mirror.
- Nothing is ever lost silently. Every submit produces a `crm_actions` row, and the Sync Status page gets a "Write-back" row showing the last 24 hours: count ok, count partial/error, and the latest error message.

### UI

- **`src/components/QuickActions.jsx`.** A compact icon row (call, note, follow-up, plus done/push when the row is a task). Each opens a small popover on desktop and a bottom sheet under 640px wide. Tap targets at least 40px.
- **Colors follow the row's business,** never the current filter, per the existing rule. MPG blue and Bayway green never appear on the same element.
- **States:** idle, submitting (button disabled, spinner, prevents double submit), success (brief toast naming the CRM: "Logged in FollowUpBoss"), error (inline message with Retry, form contents kept).
- **Optimistic updates** only for Complete and Push on task rows (the row fades out or moves). Revert if the function returns an error. Log call and notes wait for the response, since those are the ones where a false "done" would hurt.
- **Placement:**
  - `Pipeline.jsx` card footer (both books)
  - `PriorityLeads.jsx` row, right side
  - `MyTasks.jsx`: replace the local-only checkbox with a real Complete, add Push
  - `Tasks.jsx` rows: Complete and Push
- **Sidebar "+ New Task".** Opens the Schedule follow-up form with a contact picker. The picker searches `contacts` server-side (`ilike` on name, `.limit(10)`, scoped to books with write-back enabled) so it never pulls the whole table. Remove the stale `title="Phase 3..."` tooltip.

### New pure helpers (unit-tested)

- `src/lib/crmActions.js`: `followUpDate(preset, now)` for Tomorrow / In 3 days / Next Monday (weekend handling per Decisions #2); `defaultFollowUpOn(outcome)`; `buildActionRequest(form)`.
- `_shared/fub-write.ts`: `buildFubCall`, `buildFubNote`, `buildFubTask`, `fubOutcome(chip)`.
- `_shared/zoho-write.ts`: `buildZohoCall`, `buildZohoNote`, `buildZohoTask`, `zohoCallResult(chip)`.
- `crm-action`: `planSteps(request)` returns the ordered step list for a submit. Tested so a Log call with every option on yields `[log_call, add_note?, create_task, complete_task]` in that order.

### Testing

- Unit tests for every helper above, in the same files and style as the existing `_shared/*.test.js`.
- Component test for `QuickActions` with a mocked `supabase.functions.invoke`: double click sends one request; partial result shows the named failed step and a retry; error keeps form contents.
- Live acceptance against one test contact per CRM ("ZZ Test Sales OS" in FUB and in Zoho), not real borrowers or merchants.

### Part 2 acceptance

1. From a Bayway pipeline card, logging a "Left voicemail" call with a follow-up for tomorrow creates the call and the task in FollowUpBoss, and both show on the contact in FUB within seconds.
2. The Overview call count goes up by one immediately, with no sync needed.
3. After the next scheduled sync, there is still exactly one copy of that call in `activities` and one of that task in `tasks`.
4. Completing a task in My Tasks completes it in the CRM and it stays gone after a page reload.
5. Tapping submit twice quickly logs one call, not two.
6. With Zoho write-back off, MPG rows show no actions and the function refuses MPG requests. After the token is re-issued and the flag is on, the same flows work for MPG Leads.
7. A request from a signed-in user who is not `ALLOWED_USER_ID` gets a 403 and writes nothing.
8. A forced CRM failure leaves the local tables untouched and shows the error with Retry.

## Decisions (defaults chosen, change any before planning)

1. **Outcome chips:** Connected, Left voicemail, No answer, Bad number.
2. **Follow-up presets:** Tomorrow, In 3 days, Next Monday, Pick a date. "Tomorrow" on a Friday means Monday.
3. **Follow-up default:** on for Left voicemail and No answer, off for Connected and Bad number.
4. **Complete open task on call:** offered only when the contact has an open task due today or overdue, checked by default.
5. **Follow-up task title default:** "Follow up: <contact name>". Editable.
6. **Bayway ships first,** MPG after the Zoho re-auth.

## Build order (for the implementation plan)

1. Part 1, alone, merged and verified live.
2. Migration `0028`, `crm-action` skeleton with auth, idempotency, `crm_actions`, and feature flag.
3. FUB writers: log call and add note. Verify live on the test contact.
4. FUB tasks: create, complete, push.
5. UI: `QuickActions` on Pipeline, Priority Leads, My Tasks, Tasks. Sidebar "+ New Task".
6. Sync Status "Write-back" row.
7. Zoho re-auth (docs), Zoho writers, flip `mpg` flag on.

## Related, ship alongside Part 1

Not part of this spec's scope but a few lines each, found in the same review:

- `fub-webhook/index.ts`: change `if (expected && ...)` so a missing `FUB_WEBHOOK_SECRET` rejects the request instead of accepting it.
- Supabase Auth: confirm public email signups are off.

## Out of scope

- Natural-language CRM updates (the next spec; it reuses `crm-action` as its write path).
- Moving pipeline stages from the board. Stage changes have downstream automations in FUB, so they get their own spec.
- Sending texts or emails.
- Editing contact fields.
- Bulk actions.
- An offline queue for actions taken with no signal.
