# Phase 13 — Priority Leads setup

Scores every synced Bayway/FUB contact by engagement + recency, buckets them
into **Hot / Warm / Active / Never Contacted**, and surfaces them at
`/bayway/priority-leads`. Reuses the shared `contacts` and `activities` tables —
no new FUB tables. Reuses the existing `FUB_API_KEY` / `FUB_SYSTEM_KEY` secrets;
**no new secrets required** for this phase.

## 1. Deploy the functions

`fub-activity-sync` changed (it now also pulls **emails** per contact), and
`score-fub-leads` is new:

```bash
supabase functions deploy fub-activity-sync --no-verify-jwt --project-ref cnmipfxwqnbtkohfixkf
supabase functions deploy score-fub-leads  --no-verify-jwt --project-ref cnmipfxwqnbtkohfixkf
```

## 2. Apply the migrations

Apply `0013_priority_leads.sql` (contact columns + `v_priority_leads` view) and
`0014_schedule_score_fub_leads.sql` (nightly cron) via your usual path
(`supabase db push`, or paste into the SQL editor).

## 3. Trigger a first run manually (PowerShell-safe)

`curl` is aliased to `Invoke-WebRequest` in PowerShell; use `curl.exe`. Run the
activity sync first (so emails/activities are current), then the scorer:

```powershell
curl.exe -X POST "https://cnmipfxwqnbtkohfixkf.supabase.co/functions/v1/fub-activity-sync" -H "Authorization: Bearer <ANON_KEY>" -H "Content-Type: application/json"
curl.exe -X POST "https://cnmipfxwqnbtkohfixkf.supabase.co/functions/v1/score-fub-leads"  -H "Authorization: Bearer <ANON_KEY>" -H "Content-Type: application/json"
```

Then open **Sync Status** — a `score-fub-leads` row should show a recent run
with a per-tier summary (`scored N | hot:… warm:… active:… never:…`), and the
Priority Leads panel should populate, sorted by score within each tab.

## 4. Verify field shapes on first run (important)

Same convention as `phase-activity-fub-setup.md`. On the first live run confirm
against your account and adjust in `_shared/fub-activity.ts` if needed:

- **Emails:** the sync fetches `/emails?personId=<id>` for each contact touched
  since the last run. Confirm `/emails` accepts `personId` and that the response
  list key is `emails` (adjust the `fetchEmailsForContact` `listKeys` otherwise).
  Emails land as `activities` rows with `type='email'`; check they appear on
  `/bayway/activity` and that `email:N` shows in the `fub-activity` sync_log
  message. **Cost note:** this is one FUB API call per recently-touched contact
  per 15-min run — bounded by the recency filter, but watch the sync_log counts
  on the first backfill.
- **Call duration:** the score's call-quality weight reads `raw.duration`
  (seconds). If your calls store duration elsewhere, adjust the extraction in
  `score-fub-leads/index.ts`.

## 5. Scoring knobs

All weights and tier thresholds are constants at the top of
`supabase/functions/_shared/scoring.ts` (`WEIGHTS`, `TIER_THRESHOLDS`). Tune and
redeploy `score-fub-leads` — no other code changes needed. Tier precedence
(hot → active → warm → never_contacted) — because this FUB account logs almost
no activity, intent signals rank above activity volume:

- `hot` — carries the `HOT` tag, **or** score ≥ `hotMinScore` and last activity
  within `hotMaxRecencyDays`.
- `active` — currently in a derived pipeline stage (`v_active_pipeline`).
- `warm` — has any logged activity but isn't hot/active.
- `never_contacted` — no HOT tag, not in pipeline, and zero activity rows.

### One-time activity backfill

`fub-activity-sync` normally syncs incrementally. To pull history for the
globally-listable types (calls/notes/appointments) in one pass, POST a `since`:

```powershell
curl.exe -X POST "https://cnmipfxwqnbtkohfixkf.supabase.co/functions/v1/fub-activity-sync" -H "Authorization: Bearer <ANON_KEY>" -H "Content-Type: application/json" -d '{"since":"2026-01-17T00:00:00Z"}'
```

The response `counts` show exactly how much FUB returns. (Confirmed on this
account: ~17 activity rows in 6 months — FUB is not where this team logs calls,
so `never_contacted` is large and the HOT tag / pipeline carry the panel. The
email pass stays incremental even during a backfill, to avoid one `/emails`
call per contact across the whole book in a single invocation.) Re-run
`score-fub-leads` afterward to fold new activity into the tiers.

## Notes / schedule

- The cron runs `0 9 * * *` **UTC** = 04:00 America/Chicago during CDT (03:00
  CST in winter) — before the 8:45 AM target. `pg_cron` has no timezone arg;
  shift the hour if you want a fixed local time year-round.
- **Deferred:** AI notes. `contacts.ai_note` / `ai_note_generated_at` columns
  and the panel's collapsed note UI are already in place but stay empty until a
  `generate-lead-notes` function ships. That function will need an
  `ANTHROPIC_API_KEY` Supabase secret (Chandler sets it) and should be chained
  after `score-fub-leads` in the `0014` cron job body.
- **Texts** are still omitted (same account-wide listing limitation as before);
  add them later with the same per-contact pattern used for emails.
