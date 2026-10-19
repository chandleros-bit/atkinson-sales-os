# Quick Actions (CRM Write-Back v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Chandler log a call, add a note, schedule a follow-up, complete a task, and push a task from the dashboard. Each action writes to FollowUpBoss (Bayway) or Zoho (MPG) first and mirrors locally second.

**Architecture:** One JWT-verified edge function, `crm-action`, runs a dispatch table of steps. Its logic lives in `crm-action/run.ts` with the db and CRM clients injected, so it can be unit tested with fakes. `index.ts` only wires real clients. Mirror rows always come from the existing sync mappers, so the next scheduled sync upserts onto the same `(source_crm, external_id)` row. The browser gets one reusable `QuickActions` component that talks only to `supabase.functions.invoke('crm-action')`.

**Tech stack:** React 18, Vite, Vitest (jsdom render tests in the `Overview.render.test.jsx` style, no Testing Library), Supabase Edge Functions (Deno), supabase-js 2.45.

**Spec:** `docs/superpowers/specs/2026-10-18-quick-actions-writeback-design.md`. It supersedes Part 2 of `2026-10-16-row-cap-fix-and-quick-actions-design.md`.

---

## Where this plan differs from the spec (read first)

Found while checking the spec against the code on 2026-10-18:

1. **The Zoho task mapper drops Lead links.** `mapTask` in `_shared/zoho-tasks.ts` resolves the contact only from `Who_Id`. A task on a Lead carries the lead in `What_Id` with `$se_module: 'Leads'`, which is exactly what this build creates. Mirroring through the unchanged mapper would store `contact_id = null`, and so does the existing sync for any Lead task. The fix: `mapTask` falls back to `What_Id` when `$se_module` is `Leads` or `Contacts`, the same rule `zoho-activity.ts` uses. The deal rule stays as it is. This also fixes the sync.
2. **No phone on two read models.** `v_priority_leads` and `v_tasks` don't expose a phone, so their rows can't tell `QuickActions` whether Log call is possible. Migration `0028` recreates both views with `phone` (and `contact_phone` on `v_tasks`) appended as the last column (`create or replace view` allows adding trailing columns). It also adds `contact_id` to `v_priority_leads`, which is just `id`.
3. **Idempotency is claim-first, not check-then-write.** Two requests with the same `client_action_id` arriving together would both pass a "seen before?" read. Instead the function inserts the `crm_actions` row with `status = 'pending'` first, and the `unique` constraint picks the winner. The loser reads the row back and returns it: the stored result, or `{ status: 'pending' }` if the winner is still running. The row is updated with the results at the end. `status` allows `pending | ok | partial | error | refused`.
4. **Refused requests are recorded with `status: 'refused'`** (flag off, missing phone, unknown contact) once the user is trusted. A 403 or a malformed body (no `client_action_id`) writes nothing, since there is no trusted row to write.
5. **A `whoami` action for setup.** Build-order step 2 needs "is `FUB_API_KEY` Chandler's, and what's his FUB user id". Only digests of the secrets are readable locally, so `crm-action` gets a `whoami` action (allowed user only) that calls FUB `GET /v1/me` and returns `{ id, name, email, role }`. No secret leaves the function.
6. **Zoho note mirror.** `zoho-activity-sync` doesn't pull notes, so there's no duplicate risk. The mirror is built by `mapActivity(rec, 'note')` from a read-back of the created note. If the read-back is refused (Zoho's Notes read is `NOT_SUPPORTED` for some profiles), the mirror is built from the create request plus the returned id (`Parent_Id` = lead, `$se_module` = Leads) through the same mapper.
7. **Retry-on-429** lives in `fubSend` / `zohoSend` (one retry, `Retry-After` capped at 5s). The sleep is injected so tests don't wait.
8. **Push for Bayway** goes behind `pushFubTask(...)` with two strategies (`put_due_date` | `complete_and_recreate`), chosen by a `FUB_PUSH_MODE` secret that defaults to `put_due_date`. The live check in Task 9 decides which one to set.

---

## File map

| File | Responsibility |
|---|---|
| `supabase/migrations/0028_crm_actions.sql` | `crm_actions` table + RLS read policy + index; `writeback_enabled` settings row; views with phone |
| `supabase/functions/_shared/fub.ts` | **add** `fubSend(method, path, body, opts)` |
| `supabase/functions/_shared/zoho.ts` | **add** `zohoSend(apiHost, token, method, path, body, opts)`, `zohoRecordError(json)` |
| `supabase/functions/_shared/retry.ts` (+test) | `withRetry429(doFetch, { sleep })` shared by both senders |
| `supabase/functions/_shared/fub-write.ts` (+test) | pure builders: `buildFubCall`, `buildFubNote`, `buildFubTask`, `buildFubTaskUpdate`, `FUB_OUTCOMES` |
| `supabase/functions/_shared/zoho-write.ts` (+test) | pure builders: `buildZohoCall`, `zohoDuration`, `buildZohoNote`, `buildZohoTask`, `buildZohoTaskUpdate`, `zohoCallResult` |
| `supabase/functions/_shared/zoho-tasks.ts` (+test) | Lead fallback in `mapTask` |
| `supabase/functions/crm-action/plan.ts` (+test) | `planSteps(request, openTask)` |
| `supabase/functions/crm-action/run.ts` (+test) | auth result → claim → flag → resolve → steps → mirror → record. Injected `db`, `crm` |
| `supabase/functions/crm-action/crm.ts` | real FUB/Zoho step executors + read-backs (thin, no logic worth faking) |
| `supabase/functions/crm-action/index.ts` | `Deno.serve`: CORS, JWT → user, wire real clients, call `run` |
| `src/lib/crmActions.js` (+test) | `followUpDate`, `defaultFollowUpOn`, `defaultDurationMin`, `buildActionRequest`, `OUTCOMES`, `CRM_LABEL`, `summarizeResult` |
| `src/lib/writeback.js` | `useWritebackFlags()` hook reading `settings.writeback_enabled` (maybeSingle, cached per page load) |
| `src/components/QuickActions.jsx` (+render test) | icon row + popover/sheet forms; calls `crm-action`; `onDone` |
| `src/components/NewTaskDialog.jsx` | sidebar "+ New Task": contact picker (`ilike`, `.limit(10)`) + follow-up form |
| `src/pages/Pipeline.jsx`, `PriorityLeads.jsx`, `Tasks.jsx`, `src/components/MyTasks.jsx`, `Sidebar.jsx` | placement |
| `src/pages/SyncStatus.jsx` | Write-back row (last 24h ok/partial/error, latest error) |
| `docs/phase-writeback-setup.md` | secrets, deploy, FUB checks, Zoho re-auth, flag flip |

---

## Tasks

### Task 1: Pure browser helpers (`src/lib/crmActions.js`)
- [ ] Tests first: `followUpDate('tomorrow', Fri)` → Mon; Sat → Mon; Sun → Mon; Wed → Thu; `'in3'`; `'nextMonday'` on Mon → +7; `'pick'` passes the date through; local-date formatting (no UTC drift at 11pm). `defaultFollowUpOn` true only for Left message / No answer / Busy. `defaultDurationMin` 5 for Interested / Not interested, 1 otherwise. `buildActionRequest` makes a fresh uuid each call, trims the note, drops empty fields, and errors on a missing outcome for `log_call`. `summarizeResult` turns `{status, results}` into user text naming the CRM and the failed step.
- [ ] Implement, run, commit.

### Task 2: Shared retry + senders
- [ ] `_shared/retry.ts` tests: 2xx passes through; 429 then 200 retries once and sleeps `min(Retry-After, 5)` seconds; 429 twice fails; non-429 errors don't retry.
- [ ] Add `fubSend` to `fub.ts` (same headers as `fubGet`, JSON body, throw `FUB <METHOD> <path> -> <status>: <first 300 chars>`). Add `zohoSend` + `zohoRecordError` to `zoho.ts`. Test `zohoRecordError` on a 200 body with `data[0].status === 'error'`.
- [ ] Commit.

### Task 3: FUB + Zoho body builders
- [ ] `fub-write.test.js`: call body has `personId` (number), `phone`, `isIncoming: false`, `outcome`, `note`, `duration` in seconds; rejects an unknown outcome and a missing phone. Note body defaults `subject` to "Note from Sales OS". Task body has `assignedUserId`, `type` defaulting to `Follow Up` (rejects types outside FUB's list), and `dueDate` as `YYYY-MM-DD`. `buildFubTaskUpdate({ complete })` → `{ isCompleted: true }`; `({ dueDate })` → `{ dueDate }`.
- [ ] `zoho-write.test.js`: `zohoDuration(5)` → `'05:00'` (mm:ss; one function to change if the live check says otherwise). `buildZohoCall` uses `Call_Start_Time = now − duration − 1 min` formatted with offset, `Call_Type: 'Outbound'`, `What_Id` + `$se_module: 'Leads'`, `Subject: 'Call: <outcome>'`, `Description` = outcome + note. Note, task and task-update bodies are wrapped in `{ data: [...] }`. `zohoCallResult` maps the six outcomes.
- [ ] Commit.

### Task 4: Zoho `mapTask` Lead fallback
- [ ] Test: a task with `What_Id` on a Lead (`$se_module: 'Leads'`) and no `Who_Id` resolves `contact_id`; `deal_id` stays null; existing tests still pass.
- [ ] Implement, commit.

### Task 5: `planSteps`
- [ ] Tests: log call + complete open + follow-up → `[log_call, complete_task, create_task]`; log call alone → `[log_call]`; `add_note`, `create_task`, `complete_task`, `push_task` → one step each; an unknown action throws; the `complete_task` step carries `openTask.id`. Plus `shouldStop(step, ok)`: true only for a failed `log_call`.
- [ ] Commit.

### Task 6: `run.ts` with fakes
Fake `db` (in-memory tables with `from().select/insert/update/upsert/eq/maybeSingle` covering only what `run.ts` uses) and fake `crm` (records calls, scripted results).
- [ ] Tests:
  - 403 when `userId !== allowedUserId`; nothing written.
  - 400 without `client_action_id`.
  - Same `client_action_id` twice → second returns the stored result and the CRM is called once.
  - Flag off for the book → `refused`, recorded, no CRM call.
  - Contact without phone + `log_call` → `refused` with "No phone on file".
  - Happy path log call + follow-up: CRM order, mirror rows upserted with `onConflict: 'source_crm,external_id'`, FUB call mirror `external_id === 'call-<id>'`, `last_touch_at` bumped, row `status: 'ok'`.
  - Same mirror test for Zoho (`call-<id>`).
  - Failed `log_call` → `error`, later steps not run, no mirror.
  - Failed `create_task` after an ok call → `partial`, results name the failed step.
  - Mirror upsert error after CRM ok → step `ok: true` with `mirror_error` recorded.
  - `complete_task` sets `is_completed` through `mapTask` of the read-back.
- [ ] Implement `run.ts`, commit.

### Task 7: `crm.ts` + `index.ts` + migration
- [ ] `crm.ts`: FUB `logCall/addNote/createTask/completeTask/pushTask/readCall/readNote/readTask/whoami`; Zoho the same set. `pushTask` honors `FUB_PUSH_MODE`.
- [ ] `index.ts`: OPTIONS/CORS; `Authorization: Bearer` → `db.auth.getUser(token)`; 401 if no user; then `run(...)`.
- [ ] `0028_crm_actions.sql`: table (status check includes `pending`, `refused`), RLS + idempotent authenticated-select policy (0017 style), index, settings row, both views recreated with phone appended.
- [ ] `npm test`, commit.

### Task 8: UI
- [ ] `useWritebackFlags` (settings read, `maybeSingle`).
- [ ] `QuickActions.jsx` + render test: double click → one `invoke`; partial → names the step and Retry sends only that step with a new id; error keeps the form; `hasPhone={false}` disables Log call with the tooltip; flag off → renders nothing.
- [ ] Placement: Pipeline card footer (both books), Priority Leads row, My Tasks (replace the local-only checkbox with Complete + Push, optimistic fade, revert on error), Tasks rows, sidebar `NewTaskDialog` (remove the stale title).
- [ ] The open-task lookup in the Log call form: `v_tasks` `.eq('contact_id')` `.lte('due_at', endOfToday)` `.order('due_at')` `.limit(1)`.
- [ ] Row-cap audit stays green. Build. Commit.

### Task 9: Sync Status row + setup doc
- [ ] Write-back row: `crm_actions` where `created_at >= now-24h`, `.order('created_at', desc)`, `.limit(500)`. Counts plus the latest error.
- [ ] `docs/phase-writeback-setup.md`. Commit.

### Task 10: Live (checkpoint with Chandler before each outward step)
- [ ] Apply migration `0028` (`supabase db push`), with approval.
- [ ] Secrets: `ALLOWED_USER_ID` (Chandler's auth uid from the session JWT), with approval.
- [ ] Deploy `crm-action` with JWT verification **on**, with approval. `whoami` → confirm the FUB key owner, then set `FUB_USER_ID`.
- [ ] Chandler creates the "ZZ Test Sales OS" FUB person. Log call + follow-up on it → acceptance 1, 2, 6, 7. Wait for the next `fub-activity-sync` / `fub-task-sync` → acceptance 3 (SQL `count(*) = 1`).
- [ ] Push `dueDate` check → set `FUB_PUSH_MODE` → acceptance 4, 5.
- [ ] 403 check with a non-allowed token (or the unit test if no second user exists). Forced failure → acceptance 10.
- [ ] MPG stays off until Chandler re-authorizes Zoho (doc'd). PR.
