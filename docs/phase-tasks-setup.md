# Phase 13 — Task sync setup (FollowUpBoss + Zoho)

Fills the `tasks` table so the unified **Tasks** screen (`/tasks`) has data.
Reuses the existing `FUB_API_KEY` / `FUB_SYSTEM_KEY` secrets (Phase 2) and the
Zoho secrets (Phase 5) — no new secrets required.

## 1. Deploy the functions

```bash
supabase functions deploy fub-task-sync --no-verify-jwt --project-ref cnmipfxwqnbtkohfixkf
supabase functions deploy zoho-task-sync --no-verify-jwt --project-ref cnmipfxwqnbtkohfixkf
```

## 2. Apply the migrations

Apply `0017_tasks_table.sql`, `0018_tasks_view.sql`,
`0019_schedule_fub_task_sync.sql`, and `0020_schedule_zoho_task_sync.sql`
via your usual path (`supabase db push`, or paste into the SQL editor) — in
that order, since the view depends on the table.

## 3. Trigger a first run manually (PowerShell-safe)

PowerShell aliases `curl` to `Invoke-WebRequest`, which does not accept
`-X`/`-H` the same way. Use `curl.exe`:

```powershell
curl.exe -X POST "https://cnmipfxwqnbtkohfixkf.supabase.co/functions/v1/fub-task-sync" -H "Authorization: Bearer <ANON_KEY>" -H "Content-Type: application/json"
curl.exe -X POST "https://cnmipfxwqnbtkohfixkf.supabase.co/functions/v1/zoho-task-sync" -H "Authorization: Bearer <ANON_KEY>" -H "Content-Type: application/json"
```

Then open **Sync Status** — a "FollowUpBoss tasks (Bayway)" row should show a
recent run with a nonzero "synced" count. The board is at `/tasks`.

## 4. Verify field shapes on the first live run (important)

`_shared/fub-tasks.ts` and `_shared/zoho-tasks.ts` are written from each
vendor's documented shape. Confirm against the live payloads and adjust:

**FollowUpBoss `/tasks`**
- **Lists account-wide?** Some FUB list endpoints refuse to (`/textMessages`
  and `/emails` both `400` demanding a per-person filter — see
  `docs/phase-activity-fub-setup.md`). If `/tasks` behaves the same way, fall
  back to a per-contact fetch bounded to recently-touched contacts, exactly as
  the email pass does in `fub-activity-sync/index.ts`.
- **List key:** the paginator expects a top-level `tasks` array (or
  `_embedded.tasks`). Adjust `listKeys` in `fubListTasks` if it differs.
- **Due date:** `taskDueAt` tries `dueDate`, `due`, `dueAt`. If rows land with
  a null `due_at`, add the real field name.
- **Completion flag:** `taskIsCompleted` reads `isCompleted` then `completed`.
- **Contact link:** tasks resolve via `personId` (or `person.id`). Deals
  resolve via `dealId` when present.
- **Open-only filter:** the first run passes `isCompleted=false`. If FUB
  ignores that param the function still filters completed rows out in code.

**Zoho `Tasks`**
- **Module API name:** `Tasks` (used as the `zohoList` module path).
- **Done status:** `zohoTaskIsCompleted` treats `completed` / `closed` / `done`
  (case-insensitive) as done. Unlike Deals' `Stage`, Tasks' `Status` carries no
  structural flag — it is just a renamable picklist — so if this org uses some
  other word for done, add it, or completed tasks will never leave the board.
- **`Task_Type`:** the mapper reads `Task_Type`, falling back to `Category`.
  Neither is guaranteed to be a real field on this org's Tasks module. Confirm
  with `GET /crm/v2/settings/fields?module=Tasks` (the same trick
  `fetchDealStages` uses for Deals) — if `task_type` comes back null for every
  row, that's this. It is display-only, so a wrong name degrades gracefully.
- **`Due_Date` format:** stored straight into a `timestamptz`. Zoho returns a
  bare `YYYY-MM-DD`, and Postgres anchors that at midnight **UTC** (the
  database session's timezone), not local midnight. Read locally that is the
  previous evening anywhere west of Greenwich, so the screen must not bucket it
  with local getters — `dueDayKey` in `src/lib/tasks.js` detects midnight-UTC
  values and reads them in UTC. If Zoho tasks ever start showing up one day
  early, that is the code path to look at first.
- **`Who_Id` / `What_Id`:** contact and deal resolution. `What_Id` is
  polymorphic; the mapper trusts `$se_module === 'Deals'` when present.

## 4b. Confirm the Zoho secret state before deploying (do this first)

The source design doc assumed `ZOHO_CLIENT_ID` / `ZOHO_CLIENT_SECRET` /
`ZOHO_REFRESH_TOKEN` were still unset, but the MPG Zoho sync went live on
2026-07-17, which implies they are set — and function secrets are project-wide.
Check before deploying, because the two cases behave very differently:

- **Secrets unset:** `zoho-task-sync` logs one "credentials not set" error row
  per run and does nothing else. Harmless.
- **Secrets set (likely):** the function runs for real on its first cron tick.
  Zoho's module list has no server-side status filter, so **the first run
  paginates the org's entire Task history** (200/page) and discards completed
  rows client-side — unlike the FUB side, which bounds its first fetch with
  `isCompleted=false`. At MPG's volume this is expected to be fine, but watch
  that first run: if it errors with a 401 mid-pagination the access token
  expired before the fetch finished, and nothing is upserted — the run wasted
  itself and the next tick starts over. If that happens, the fix is to bound
  the first fetch (a dated `If-Modified-Since`) rather than retrying blindly.

Check the deployed sources on Sync Status, or run
`supabase secrets list --project-ref cnmipfxwqnbtkohfixkf`.

## 5. How completion propagates

The screen shows open tasks only, and nothing is ever deleted:

- **First run** (no prior ok `sync_log` row for the source): open/incomplete
  tasks only, so the full completed history is never imported.
- **Incremental runs:** everything changed since the last successful run,
  regardless of status. A task completed in the CRM flows through on its next
  change, its row flips to `is_completed = true`, and `v_tasks`
  (`where is_completed = false`) drops it from the board automatically.
- No write-back, no deletes, no completing tasks in the dashboard.

## Notes

- Read-only: the functions only GET from FUB/Zoho and write to our own tables.
- If `ZOHO_CLIENT_ID` / `ZOHO_CLIENT_SECRET` / `ZOHO_REFRESH_TOKEN` are unset,
  `zoho-task-sync` logs a "credentials not set" error row every run — expected,
  and visible on Sync Status exactly like `zoho-sync`. MPG tasks appear the
  moment Zoho is switched on. See §4b — the secrets are probably already set.
- Both jobs run every 15 minutes (`fub-task-sync-15min`,
  `zoho-task-sync-15min`). That makes **six** jobs firing on the same
  quarter-hour tick — FollowUpBoss now gets three concurrent callers
  (`fub-sync`, `fub-activity-sync`, `fub-task-sync`) and Zoho two. Well inside
  both vendors' rate limits at this volume, but it is where to look first if
  either CRM starts throttling.
- A task synced in the same tick that its contact is first created can land
  with a null `contact_id`, because the id map is snapshotted before the fetch.
  It self-heals on the next cycle — the upsert is keyed on
  `(source_crm, external_id)`.
