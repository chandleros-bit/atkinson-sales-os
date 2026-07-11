# Phase 5 — Zoho (MPG) CRM Sync Design

**Date:** 2026-07-11
**Status:** Approved by Chandler (backend sync only; scheduled, no webhook; guard existing Bayway screens)
**Depends on:** Phase 2 sync infrastructure (`_shared/db.ts`, `sync_log`, pg_cron pattern) and the source-agnostic schema from migration `0001`.

## Context and goal

MPG's merchant-services data lives in Zoho CRM. This phase is the Zoho counterpart to the
Phase 2 FollowUpBoss sync: a scheduled Edge Function that pulls Zoho CRM into the *same*
Supabase tables, tagged `business_id='mpg'`, `source_crm='zoho'`, so the existing schema and
Sync Status screen light up for MPG. Read-only (locked v1): the app and functions never write
back to Zoho.

The MPG-facing Overview/Pipeline **screens are deferred** to a follow-up phase, to be designed
against real synced Zoho data (mirroring how Bayway was done: Phase 2 sync → Phase 3/4 screens).

**Access caveat:** Chandler is unsure he can generate Zoho API credentials. The function and a
step-by-step credential guide are built regardless; until credentials are set, the function
deploys and reports "credentials not set" via `sync_log`, and nothing else breaks.

## Data model reuse (no schema migration)

Existing tables from `0001` are source-agnostic and already have the `mpg` business row.
Zoho rows use `business_id='mpg'`, `source_crm='zoho'`. No *schema* migration is required
(the only migration this phase adds is `0005`, which schedules the cron job — see below).
The `sync_log` source value `zoho` is already a known row on the Sync Status screen
(`SOURCE_LABELS` in `SyncStatus.jsx`), so sync health appears there with no frontend change.

## Architecture

### `supabase/functions/_shared/zoho.ts` (new)

OAuth2 client + field mapping (Zoho CRM API v2).

- `getAccessToken()`: POST `${ZOHO_ACCOUNTS_HOST}/oauth/v2/token` with
  `grant_type=refresh_token`, `client_id`, `client_secret`, `refresh_token`. Returns the
  short-lived access token. Throws a clear error if any secret is missing (so `sync_log`
  shows "ZOHO_* not set as a function secret").
- `zohoGet(accessToken, path, params)`: GET `${ZOHO_API_HOST}/crm/v2/<path>` with
  `Authorization: Zoho-oauthtoken <token>`. Zoho returns HTTP 204 (no content) for empty
  result sets — treat as empty, not an error.
- `zohoList(accessToken, module, sinceIso?)`: paginate `page`/`per_page=200` until
  `info.more_records` is false. When `sinceIso` is provided, send the `If-Modified-Since`
  header for incremental pulls.
- Hosts: `ZOHO_ACCOUNTS_HOST` (default `https://accounts.zoho.com`) and `ZOHO_API_HOST`
  (default `https://www.zohoapis.com`) come from secrets so non-`.com` data centers work.
- Mapping helpers (pure, unit-tested — the mapping is the "known unknowns" surface):
  - `mapStage(zohoStage, sortOrder)` → `{ business_id:'mpg', name, sort_order, is_won,
    is_lost, external_id }`. `is_won`/`is_lost` come from the pipeline metadata stage `type`
    (`Closed Won` / `Closed Lost` / `Open`) — reliable, unlike FUB's keyword guessing.
  - `mapContact(record, kind)` where kind is `'Leads'|'Contacts'` → `{ business_id:'mpg',
    source_crm:'zoho', external_id, name, company, email, phone, owner, person_stage,
    last_touch_at, raw }`. `person_stage` from `Lead_Status` (Leads) or `null` (Contacts).
    `last_touch_at` from `Last_Activity_Time` else `Modified_Time`.
  - `mapDeal(deal, contactIdByExternal, stageIdByExternal)` → deals row. `value` from
    `Amount`; `secondary_value`, `segment_tag` from custom fields (**known unknowns** — see
    below); `expected_close` from `Closing_Date`; `status` from the mapped stage's won/lost.

### `supabase/functions/zoho-sync/index.ts` (new)

`Deno.serve` handler, mirrors `fub-sync`:
1. `getAccessToken()`.
2. Fetch Deal pipeline metadata (`settings/pipelines`), upsert stages
   (`onConflict: business_id,external_id`), build `stageIdByExternal` for `business_id='mpg'`.
3. Determine `since` = `ran_at` of the latest `status='ok'` `zoho` `sync_log` row (incremental).
4. Fetch Leads + Contacts, map to contacts, upsert (`onConflict: source_crm,external_id`),
   build `contactIdByExternal`.
5. Fetch Deals, map (resolving contact_id/stage_id), upsert.
6. `logSync(db,'zoho','ok',upserted)`; on any throw, `logSync(db,'zoho','error',upserted,msg)`
   and return 500 with the raw message (so Sync Status shows exactly what to fix).

Uses `serviceClient()` and `logSync()` from the existing `_shared/db.ts` (unchanged).

### Cron (migration `0005`)

`supabase/migrations/0005_schedule_zoho_sync.sql`: `cron.schedule('zoho-sync-15min',
'*/15 * * * *', ...)` calling the deployed `zoho-sync` function via `net.http_post` with the
public anon key (same idempotent pattern as `0002`). `pg_cron`/`pg_net` already enabled.

### Frontend guard: `src/pages/Overview.jsx` (modified)

Two queries currently assume all contacts are Bayway. Add `business_id='bay'` scoping so
incoming MPG data cannot leak into the Bayway/All Overview:
- pipeline query: `supabase.from('v_active_pipeline').select(...).eq('business_id','bay')`
- contacts count: `supabase.from('contacts').select('id',{count:'exact',head:true}).eq('business_id','bay')`

No other Overview behavior changes. (The Pipeline board already filters `business_id='bay'`.)
Proper "All"-mode merging of both businesses is deferred to the MPG-screens phase.

## Known unknowns — verify on first real sync

Written from Zoho's documented API; confirm against the live MPG account and adjust
`_shared/zoho.ts`:
- **Custom field API names** for monthly residual (→ `value` if not `Amount`), processing
  volume (→ `secondary_value`), and segment Displacement/Greenfield (→ `segment_tag`).
- **Leads vs Contacts vs Deals usage** — whether MPG's pipeline lives in Deals/Potentials and
  whether prospects are Leads, Contacts, or both. The sync pulls all three; mapping may need
  trimming once the real layout is seen.
- **Data center host** — set `ZOHO_ACCOUNTS_HOST`/`ZOHO_API_HOST` to the account's region.
- **Pipeline/layout** — if MPG uses multiple Deal pipelines, confirm stage `external_id`
  uniqueness across them.

`sync_log.message` records the raw error on the first run, so the Sync Status screen shows
exactly what needs adjusting — same workflow as FUB.

## Setup doc: `docs/phase5-zoho-setup.md`

Click-by-click for the "unsure on API access" case:
1. Register a Self Client at api-console.zoho.com → client ID + secret.
2. Generate a grant token with scope `ZohoCRM.modules.READ` → exchange for a refresh token.
3. `supabase secrets set ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN`
   (+ `ZOHO_ACCOUNTS_HOST` / `ZOHO_API_HOST` if not `.com`).
4. `supabase functions deploy zoho-sync --no-verify-jwt`.
5. Confirm the cron job; trigger one manual run; check Sync Status.
Each step names what to do if it's blocked (e.g. API access not enabled → contact Zoho admin).

## Verification plan

1. `npm test` — new `zoho.test.js` covers pure mapping (`mapStage` won/lost from type,
   `mapContact` field selection + `last_touch_at` fallback, `mapDeal` stage/contact
   resolution) and the missing-secret error path. Existing tests still pass.
2. `npm run build` passes (frontend guard compiles).
3. Deploy `zoho-sync`; with no credentials it returns/loggs "ZOHO_* not set" — confirm Sync
   Status shows the `zoho` row in an error state with that message (graceful, non-breaking).
4. If Chandler completes the credential steps: trigger a manual run, confirm `sync_log` shows
   an `ok` `zoho` row and `contacts`/`deals` gain `business_id='mpg'` rows; spot-check field
   mapping against the known-unknowns list.
5. Re-verify the Bayway Overview is unchanged (nurture count + workbench still bay-only) with
   the new guard — in the browser, numbers match a `business_id='bay'` count.
6. Screenshot / Sync Status evidence; deploy (push).

## Out of scope (deferred)

- MPG Overview/Pipeline/Contacts screens (built later on real Zoho data)
- Zoho webhook / near-real-time (scheduled 15-min only)
- Any write-back to Zoho; Outlook calendars; Reports
