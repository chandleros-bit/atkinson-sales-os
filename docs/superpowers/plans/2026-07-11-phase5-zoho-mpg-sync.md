# Phase 5 — Zoho (MPG) CRM Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a scheduled `zoho-sync` Edge Function that pulls Zoho CRM (MPG) into the existing Supabase tables tagged `business_id='mpg'`/`source_crm='zoho'`, and guard the existing Bayway Overview so incoming MPG data can't leak in.

**Architecture:** New `_shared/zoho.ts` (OAuth2 token refresh + paginated GET client + pure field mappers) and `zoho-sync/index.ts` (mirrors `fub-sync`, reuses `_shared/db.ts`). Cron migration `0005` schedules it. One small `Overview.jsx` guard scopes two queries to `bay`. Read-only; no schema migration. MPG screens deferred.

**Tech Stack:** Supabase Edge Functions (Deno/TypeScript), Zoho CRM v2 REST API (OAuth2), pg_cron, React (one guard edit), vitest.

**Spec:** `docs/superpowers/specs/2026-07-11-phase5-zoho-mpg-sync-design.md`

**Repo:** `C:\Users\Chandler\.claude\projects\atkinson-sales-os-phase1` (Bash `/c/Users/Chandler/.claude/projects/atkinson-sales-os-phase1`). Linked Supabase `cnmipfxwqnbtkohfixkf`. Git author must remain `chandleros-bit <chandler.dashboard@gmail.com>` — never override; push only in the final task.

**Reused (do not modify):** `_shared/db.ts` (`serviceClient()`, `logSync(db, source, status, records_upserted, message?)`). `SyncStatus.jsx` already defines the `zoho` source row. Migration `0002` is the cron template. Public anon key (safe to commit, used only for the cron gateway):
`eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubWlwZnh3cW5idGtvaGZpeGtmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2Mzc5NjYsImV4cCI6MjA5OTIxMzk2Nn0.tcOKs7O5gGAT2HsfiKKwI90TQ-CYVXSMB4yL9RvuxJU`

---

### Task 1: `_shared/zoho.ts` — OAuth client + mappers (TDD)

**Files:**
- Create: `supabase/functions/_shared/zoho.ts`
- Test: `supabase/functions/_shared/zoho.test.js`

The pure functions (`getCredentials`, `mapStage`, `mapContact`, `mapDeal`) are unit-tested. The
I/O functions (`getAccessToken`, `zohoGet`, `zohoList`, `fetchDealStages`, `fetchLeads`,
`fetchContacts`, `fetchDeals`) use `Deno.env`/`fetch` inside their bodies only, so importing the
module in vitest (Node) is safe — those bodies never run during the mapper tests.

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/_shared/zoho.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { getCredentials, mapStage, mapContact, mapDeal } from './zoho.ts'

const fakeGet = (obj) => (k) => obj[k]

describe('getCredentials', () => {
  it('throws listing all missing required secrets', () => {
    expect(() => getCredentials(fakeGet({}))).toThrow(
      /ZOHO_CLIENT_ID.*ZOHO_CLIENT_SECRET.*ZOHO_REFRESH_TOKEN/,
    )
  })
  it('returns config with default hosts when only required secrets are set', () => {
    const c = getCredentials(fakeGet({ ZOHO_CLIENT_ID: 'a', ZOHO_CLIENT_SECRET: 'b', ZOHO_REFRESH_TOKEN: 'c' }))
    expect(c).toEqual({
      clientId: 'a',
      clientSecret: 'b',
      refreshToken: 'c',
      accountsHost: 'https://accounts.zoho.com',
      apiHost: 'https://www.zohoapis.com',
    })
  })
  it('uses provided data-center hosts', () => {
    const c = getCredentials(
      fakeGet({
        ZOHO_CLIENT_ID: 'a',
        ZOHO_CLIENT_SECRET: 'b',
        ZOHO_REFRESH_TOKEN: 'c',
        ZOHO_ACCOUNTS_HOST: 'https://accounts.zoho.eu',
        ZOHO_API_HOST: 'https://www.zohoapis.eu',
      }),
    )
    expect(c.accountsHost).toBe('https://accounts.zoho.eu')
    expect(c.apiHost).toBe('https://www.zohoapis.eu')
  })
})

describe('mapStage', () => {
  it('marks won/lost from forecast_type and keeps display_value as external_id', () => {
    expect(mapStage({ display_value: 'Closed Won', forecast_type: 'closed_won' }, 3)).toEqual({
      business_id: 'mpg',
      name: 'Closed Won',
      sort_order: 3,
      is_won: true,
      is_lost: false,
      external_id: 'Closed Won',
    })
    expect(mapStage({ display_value: 'Lost', forecast_type: 'closed_lost' }, 0).is_lost).toBe(true)
    const open = mapStage({ display_value: 'Proposal', forecast_type: 'open' }, 1)
    expect(open.is_won).toBe(false)
    expect(open.is_lost).toBe(false)
  })
})

describe('mapContact', () => {
  it('maps a Zoho Lead with person_stage from Lead_Status', () => {
    const row = mapContact(
      {
        id: '101',
        Full_Name: 'Jane Doe',
        Company: 'Acme LLC',
        Email: 'j@acme.com',
        Phone: '555-1',
        Owner: { name: 'Chandler Atkinson' },
        Lead_Status: 'Attempted Contact',
        Last_Activity_Time: '2026-07-10T00:00:00Z',
        Modified_Time: '2026-07-11T00:00:00Z',
      },
      'Leads',
    )
    expect(row).toMatchObject({
      business_id: 'mpg',
      source_crm: 'zoho',
      external_id: '101',
      name: 'Jane Doe',
      company: 'Acme LLC',
      email: 'j@acme.com',
      phone: '555-1',
      owner: 'Chandler Atkinson',
      person_stage: 'Attempted Contact',
      last_touch_at: '2026-07-10T00:00:00Z',
    })
  })
  it('maps a Zoho Contact: null person_stage, company from Account_Name, last_touch falls back to Modified_Time', () => {
    const row = mapContact(
      {
        id: '202',
        Full_Name: 'John Roe',
        Account_Name: { name: 'Roe Foods' },
        Email: 'john@roe.com',
        Owner: { name: 'Chandler Atkinson' },
        Modified_Time: '2026-07-09T00:00:00Z',
      },
      'Contacts',
    )
    expect(row.person_stage).toBe(null)
    expect(row.company).toBe('Roe Foods')
    expect(row.last_touch_at).toBe('2026-07-09T00:00:00Z')
  })
})

describe('mapDeal', () => {
  const contactIdByExternal = new Map([['101', 'uuid-contact']])
  const stageIndex = new Map([['Proposal', { id: 'uuid-stage', status: 'open' }]])
  it('resolves contact_id and stage_id/status, maps Amount to value', () => {
    const row = mapDeal(
      {
        id: '303',
        Deal_Name: 'Acme merchant',
        Amount: 1250,
        Stage: 'Proposal',
        Closing_Date: '2026-08-01',
        Contact_Name: { id: '101' },
      },
      contactIdByExternal,
      stageIndex,
    )
    expect(row).toMatchObject({
      business_id: 'mpg',
      source_crm: 'zoho',
      external_id: '303',
      contact_id: 'uuid-contact',
      stage_id: 'uuid-stage',
      status: 'open',
      name: 'Acme merchant',
      value: 1250,
      expected_close: '2026-08-01',
    })
  })
  it('leaves contact_id/stage_id null and status open when unresolved', () => {
    const row = mapDeal(
      { id: '304', Stage: 'Unknown', Contact_Name: { id: '999' } },
      contactIdByExternal,
      stageIndex,
    )
    expect(row.contact_id).toBe(null)
    expect(row.stage_id).toBe(null)
    expect(row.status).toBe('open')
    expect(row.value).toBe(null)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run supabase/functions/_shared/zoho.test.js`
Expected: FAIL — cannot resolve `./zoho.ts`.

- [ ] **Step 3: Implement `supabase/functions/_shared/zoho.ts`**

```ts
// Zoho CRM (MPG) OAuth2 client + field mapping for the scheduled MPG sync.
//
// VERIFY BEFORE FIRST REAL RUN: written from Zoho CRM v2's documented API shape.
// The custom-field mappings (monthly residual, processing volume, segment) and
// the data-center host must be confirmed against the live MPG account — see
// docs/phase5-zoho-setup.md. Read-only: this file only GETs from Zoho.

const DEFAULT_ACCOUNTS_HOST = 'https://accounts.zoho.com'
const DEFAULT_API_HOST = 'https://www.zohoapis.com'

// get: (key) => string | undefined  (e.g. Deno.env.get). Pure + unit-testable.
export function getCredentials(get) {
  const required = ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']
  const missing = required.filter((k) => !get(k))
  if (missing.length) {
    throw new Error(`Zoho credentials not set as function secrets: ${missing.join(', ')}`)
  }
  return {
    clientId: get('ZOHO_CLIENT_ID'),
    clientSecret: get('ZOHO_CLIENT_SECRET'),
    refreshToken: get('ZOHO_REFRESH_TOKEN'),
    accountsHost: get('ZOHO_ACCOUNTS_HOST') || DEFAULT_ACCOUNTS_HOST,
    apiHost: get('ZOHO_API_HOST') || DEFAULT_API_HOST,
  }
}

// Refreshes the short-lived access token. Returns { accessToken, apiHost }.
export async function getAccessToken() {
  const c = getCredentials((k) => Deno.env.get(k))
  const url = new URL(`${c.accountsHost}/oauth/v2/token`)
  url.searchParams.set('grant_type', 'refresh_token')
  url.searchParams.set('client_id', c.clientId)
  url.searchParams.set('client_secret', c.clientSecret)
  url.searchParams.set('refresh_token', c.refreshToken)
  const res = await fetch(url, { method: 'POST' })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json.access_token) {
    throw new Error(`Zoho token refresh -> ${res.status}: ${JSON.stringify(json).slice(0, 300)}`)
  }
  return { accessToken: json.access_token, apiHost: c.apiHost }
}

async function zohoGet(apiHost, accessToken, path, params = {}, sinceIso) {
  const url = new URL(`${apiHost}/crm/v2/${path}`)
  Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, String(v)))
  const headers = { Authorization: `Zoho-oauthtoken ${accessToken}` }
  if (sinceIso) headers['If-Modified-Since'] = sinceIso
  const res = await fetch(url, { headers })
  // Zoho returns 204 (no data) / 304 (not modified) for empty result sets.
  if (res.status === 204 || res.status === 304) return { data: [], info: { more_records: false } }
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Zoho GET ${path} -> ${res.status}: ${body.slice(0, 300)}`)
  }
  return res.json()
}

// Paginate a Zoho module list. Zoho uses page/per_page(<=200) + info.more_records.
async function zohoList(apiHost, accessToken, module, sinceIso) {
  const perPage = 200
  let page = 1
  const items = []
  while (true) {
    const json = await zohoGet(apiHost, accessToken, module, { page, per_page: perPage }, sinceIso)
    const rows = json.data || []
    items.push(...rows)
    if (!json.info || !json.info.more_records) break
    page += 1
  }
  return items
}

// Deal Stage picklist (with won/lost type) from module field metadata.
export async function fetchDealStages(apiHost, accessToken) {
  const json = await zohoGet(apiHost, accessToken, 'settings/fields', { module: 'Deals' })
  const fields = json.fields || []
  const stageField = fields.find((f) => f.api_name === 'Stage')
  return (stageField && stageField.pick_list_values) || []
}

export async function fetchLeads(apiHost, accessToken, sinceIso) {
  return zohoList(apiHost, accessToken, 'Leads', sinceIso)
}
export async function fetchContacts(apiHost, accessToken, sinceIso) {
  return zohoList(apiHost, accessToken, 'Contacts', sinceIso)
}
export async function fetchDeals(apiHost, accessToken, sinceIso) {
  return zohoList(apiHost, accessToken, 'Deals', sinceIso)
}

// --- Mapping: Zoho shape -> our normalized tables (business_id 'mpg') --------

export function mapStage(stage, sortOrder) {
  const ft = (stage.forecast_type || '').toLowerCase()
  return {
    business_id: 'mpg',
    name: stage.display_value,
    sort_order: sortOrder,
    is_won: ft === 'closed_won',
    is_lost: ft === 'closed_lost',
    // Zoho deals reference a stage by its display value, so that is our join key.
    external_id: String(stage.display_value),
  }
}

// kind: 'Leads' | 'Contacts'
export function mapContact(rec, kind) {
  const owner = (rec.Owner && (rec.Owner.name || rec.Owner.full_name)) || null
  const company = rec.Company || (rec.Account_Name && rec.Account_Name.name) || null
  return {
    business_id: 'mpg',
    source_crm: 'zoho',
    external_id: String(rec.id),
    name: rec.Full_Name || [rec.First_Name, rec.Last_Name].filter(Boolean).join(' ') || null,
    company,
    email: rec.Email || null,
    phone: rec.Phone || rec.Mobile || null,
    owner,
    person_stage: kind === 'Leads' ? rec.Lead_Status || null : null,
    last_touch_at: rec.Last_Activity_Time || rec.Modified_Time || null,
    raw: rec,
    updated_at: new Date().toISOString(),
  }
}

// contactIdByExternal: Map<zoho contact id (string), our contacts.id (uuid)>
// stageIndex: Map<stage display value (string), { id: uuid, status: 'won'|'lost'|'open' }>
export function mapDeal(deal, contactIdByExternal, stageIndex) {
  const contactExt = deal.Contact_Name && String(deal.Contact_Name.id)
  const st = stageIndex.get(String(deal.Stage))
  return {
    business_id: 'mpg',
    source_crm: 'zoho',
    external_id: String(deal.id),
    contact_id: (contactExt && contactIdByExternal.get(contactExt)) || null,
    stage_id: st ? st.id : null,
    name: deal.Deal_Name || null,
    // TODO verify: MPG monthly residual may be a Zoho custom field, not Amount.
    value: deal.Amount ?? null,
    secondary_value: null, // TODO: processing volume custom field
    expected_close: deal.Closing_Date || null,
    segment_tag: null, // TODO: Displacement/Greenfield custom field or tag
    referral_partner: null,
    next_action_at: null,
    stage_entered_at: null,
    status: st ? st.status : 'open',
    raw: deal,
    updated_at: new Date().toISOString(),
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run supabase/functions/_shared/zoho.test.js`
Expected: PASS — all tests green.

- [ ] **Step 5: Run the full suite (no regressions)**

Run: `npm test`
Expected: all pre-existing tests still pass, plus the new zoho tests.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/zoho.ts supabase/functions/_shared/zoho.test.js
git commit -m "Phase 5: Zoho OAuth client + field mappers with tests"
```

---

### Task 2: `zoho-sync/index.ts` — the sync handler

**Files:**
- Create: `supabase/functions/zoho-sync/index.ts`

Mirrors `fub-sync`: refresh token → stages → Leads+Contacts → Deals, incremental since the last
`ok` run, logging to `sync_log` as source `zoho`. Reuses `_shared/db.ts` unchanged.

- [ ] **Step 1: Create the file**

```ts
// Scheduled Zoho CRM (MPG) sync.
// Triggered every 15 minutes by pg_cron (see docs/phase5-zoho-setup.md).
// Read-only against Zoho: only GETs from Zoho, writes to our own Supabase tables.

import { serviceClient, logSync } from '../_shared/db.ts'
import {
  getAccessToken,
  fetchDealStages,
  fetchLeads,
  fetchContacts,
  fetchDeals,
  mapStage,
  mapContact,
  mapDeal,
} from '../_shared/zoho.ts'

Deno.serve(async () => {
  const db = serviceClient()
  let upserted = 0

  try {
    const { accessToken, apiHost } = await getAccessToken()

    // 1. Deal stages first, so deals can resolve stage_id on insert.
    const stages = await fetchDealStages(apiHost, accessToken)
    const stageRows = stages.map((s, i) => mapStage(s, i))
    if (stageRows.length) {
      const { error } = await db
        .from('stages')
        .upsert(stageRows, { onConflict: 'business_id,external_id' })
      if (error) throw new Error(`stage upsert: ${error.message}`)
      upserted += stageRows.length
    }

    const { data: stageMapRows } = await db
      .from('stages')
      .select('id, external_id, is_won, is_lost')
      .eq('business_id', 'mpg')
    const stageIndex = new Map(
      (stageMapRows || []).map((r) => [
        r.external_id,
        { id: r.id, status: r.is_won ? 'won' : r.is_lost ? 'lost' : 'open' },
      ]),
    )

    // 2. Incremental since the last successful zoho run.
    const { data: lastOk } = await db
      .from('sync_log')
      .select('ran_at')
      .eq('source', 'zoho')
      .eq('status', 'ok')
      .order('ran_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const since = lastOk?.ran_at || null

    // 3. Leads + Contacts -> contacts.
    const [leads, contacts] = await Promise.all([
      fetchLeads(apiHost, accessToken, since),
      fetchContacts(apiHost, accessToken, since),
    ])
    const contactRows = [
      ...leads.map((r) => mapContact(r, 'Leads')),
      ...contacts.map((r) => mapContact(r, 'Contacts')),
    ]
    if (contactRows.length) {
      const { error } = await db
        .from('contacts')
        .upsert(contactRows, { onConflict: 'source_crm,external_id' })
      if (error) throw new Error(`contact upsert: ${error.message}`)
      upserted += contactRows.length
    }

    const { data: contactMapRows } = await db
      .from('contacts')
      .select('id, external_id')
      .eq('source_crm', 'zoho')
    const contactIdByExternal = new Map((contactMapRows || []).map((r) => [r.external_id, r.id]))

    // 4. Deals, resolving contact_id and stage_id.
    const deals = await fetchDeals(apiHost, accessToken, since)
    const dealRows = deals.map((d) => mapDeal(d, contactIdByExternal, stageIndex))
    if (dealRows.length) {
      const { error } = await db
        .from('deals')
        .upsert(dealRows, { onConflict: 'source_crm,external_id' })
      if (error) throw new Error(`deal upsert: ${error.message}`)
      upserted += dealRows.length
    }

    await logSync(db, 'zoho', 'ok', upserted)
    return new Response(JSON.stringify({ ok: true, upserted }), {
      headers: { 'content-type': 'application/json' },
    })
  } catch (err) {
    await logSync(db, 'zoho', 'error', upserted, String(err?.message || err))
    return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
})
```

- [ ] **Step 2: Syntax-check the file** (esbuild transpile; `Deno` globals resolve at runtime, not now):

Run: `npx esbuild supabase/functions/zoho-sync/index.ts --loader:.ts=ts --format=esm > /dev/null && echo SYNTAX_OK`
Expected: prints `SYNTAX_OK` with no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/zoho-sync/index.ts
git commit -m "Phase 5: zoho-sync scheduled handler (stages, leads/contacts, deals)"
```

---

### Task 3: Guard the Bayway Overview — `src/pages/Overview.jsx`

**Files:**
- Modify: `src/pages/Overview.jsx` (two queries in `load()`)

Scope the pipeline query and the contacts count to `business_id='bay'` so incoming MPG rows can't
inflate the Bayway/All Overview.

- [ ] **Step 1: Scope the pipeline query**

Replace:

```jsx
        supabase
          .from('v_active_pipeline')
          .select('id, business_id, name, email, phone, last_touch_at, stage'),
```

with:

```jsx
        supabase
          .from('v_active_pipeline')
          .select('id, business_id, name, email, phone, last_touch_at, stage')
          .eq('business_id', 'bay'),
```

- [ ] **Step 2: Scope the contacts count**

Replace:

```jsx
        supabase.from('contacts').select('id', { count: 'exact', head: true }),
```

with:

```jsx
        supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('business_id', 'bay'),
```

- [ ] **Step 3: Test and build**

Run: `npm test`
Expected: all tests pass (no logic change; the `overview.js` unit tests are unaffected).

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Overview.jsx
git commit -m "Phase 5: scope Bayway Overview queries to business_id=bay (guard vs MPG data)"
```

---

### Task 4: Cron migration `0005` + deploy the function

**Files:**
- Create: `supabase/migrations/0005_schedule_zoho_sync.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0005_schedule_zoho_sync.sql`:

```sql
-- Phase 5: schedule the Zoho (MPG) sync every 15 minutes via pg_cron.
-- Mirrors 0002 (fub-sync). pg_cron/pg_net are already enabled. The bearer is
-- the project's public ANON key (safe to commit) — it only satisfies the
-- functions gateway; zoho-sync is deployed with --no-verify-jwt.
-- Until the ZOHO_* function secrets are set, zoho-sync logs a "credentials not
-- set" error row each run; that is expected and visible on the Sync Status screen.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'zoho-sync-15min',
  '*/15 * * * *',
  $job$
  select net.http_post(
    url := 'https://cnmipfxwqnbtkohfixkf.supabase.co/functions/v1/zoho-sync',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubWlwZnh3cW5idGtvaGZpeGtmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2Mzc5NjYsImV4cCI6MjA5OTIxMzk2Nn0.tcOKs7O5gGAT2HsfiKKwI90TQ-CYVXSMB4yL9RvuxJU',
      'Content-Type', 'application/json'
    )
  );
  $job$
);
```

- [ ] **Step 2: Deploy the function**

Run: `supabase functions deploy zoho-sync --no-verify-jwt`
Expected: "Deployed Functions." (a "Docker is not running" warning is harmless — remote deploy).

- [ ] **Step 3: Push the cron migration**

Run: `yes | supabase db push --linked`
Expected: "Applying migration 0005_schedule_zoho_sync.sql... Finished supabase db push."

- [ ] **Step 4: Trigger one run and confirm the graceful "credentials not set" path**

The function has no ZOHO_* secrets yet, so it must fail cleanly (not crash) and log to `sync_log`.
Anon key fetched at runtime, never printed:

```bash
ANON=$(supabase projects api-keys --project-ref cnmipfxwqnbtkohfixkf | python -c "import sys,json;d=json.load(sys.stdin);print(next(k['api_key'] for k in d['keys'] if k.get('id')=='anon'))")
curl -s -X POST "https://cnmipfxwqnbtkohfixkf.supabase.co/functions/v1/zoho-sync" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json"
echo
SR=$(supabase projects api-keys --project-ref cnmipfxwqnbtkohfixkf | python -c "import sys,json;d=json.load(sys.stdin);print(next(k['api_key'] for k in d['keys'] if k.get('id')=='service_role'))")
curl -s "https://cnmipfxwqnbtkohfixkf.supabase.co/rest/v1/sync_log?select=source,status,message&source=eq.zoho&order=ran_at.desc&limit=1" -H "apikey: $SR" -H "Authorization: Bearer $SR"
```

Expected: the function returns `{"ok":false,"error":"Zoho credentials not set as function secrets: ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN"}`, and the `sync_log` row shows `source: zoho, status: error` with that message. This is the intended graceful state, not a failure of the task.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0005_schedule_zoho_sync.sql
git commit -m "Phase 5: schedule zoho-sync every 15 min via pg_cron"
```

---

### Task 5: Setup doc — `docs/phase5-zoho-setup.md`

**Files:**
- Create: `docs/phase5-zoho-setup.md`

- [ ] **Step 1: Create the file**

```markdown
# Phase 5 — Zoho (MPG) sync setup

This connects the MPG side of the dashboard to Zoho CRM: a scheduled sync every
15 minutes that writes into Supabase. The app only ever reads from Supabase — it
never calls Zoho directly and never writes back to it.

Unlike FollowUpBoss (a static API key), Zoho uses OAuth2: you register an app
once, authorize it with a read-only scope, and get a long-lived **refresh token**
that the sync uses to mint short-lived access tokens.

## 0. Before you start

You'll need admin access to your Zoho account and the Supabase CLI (already set
up from Phase 2). If you're not sure you have API access, step 1 is where you'll
find out — if you can't reach api-console.zoho.com or can't create a client, ask
your Zoho admin to enable API access for your user.

## 1. Register a Self Client and get client ID + secret

1. Go to **https://api-console.zoho.com** and sign in.
2. Click **Add Client → Self Client → Create**.
3. Copy the **Client ID** and **Client Secret**.

## 2. Generate a refresh token (read-only scope)

Still in the Self Client:

1. Open the **Generate Code** tab.
2. Scope: `ZohoCRM.modules.READ,ZohoCRM.settings.READ`
3. Time duration: 10 minutes. Scope Description: anything. Click **Create**, pick
   your CRM portal, **Create** again. Copy the **grant token** (code) shown.
4. Exchange the grant token for a refresh token (run this within 10 minutes;
   replace the three values). Use your data-center accounts host — `.com` shown
   here; use `.eu`, `.in`, `.com.au`, etc. if your account is in that region:

   ```bash
   curl -s -X POST "https://accounts.zoho.com/oauth/v2/token" \
     -d "grant_type=authorization_code" \
     -d "client_id=YOUR_CLIENT_ID" \
     -d "client_secret=YOUR_CLIENT_SECRET" \
     -d "code=YOUR_GRANT_TOKEN"
   ```

   The response includes `"refresh_token": "1000...."`. Copy it — it does not
   expire unless you revoke it.

## 3. Set the function secrets

```bash
supabase secrets set ZOHO_CLIENT_ID=your_client_id
supabase secrets set ZOHO_CLIENT_SECRET=your_client_secret
supabase secrets set ZOHO_REFRESH_TOKEN=your_refresh_token
```

If your account is **not** on the `.com` data center, also set both hosts (match
your region — e.g. `.eu`):

```bash
supabase secrets set ZOHO_ACCOUNTS_HOST=https://accounts.zoho.eu
supabase secrets set ZOHO_API_HOST=https://www.zohoapis.eu
```

## 4. Trigger a sync and check Sync Status

The function is already deployed and scheduled (every 15 min). Trigger one now:

```bash
curl -X POST https://cnmipfxwqnbtkohfixkf.supabase.co/functions/v1/zoho-sync \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

(`YOUR_ANON_KEY` = Supabase → Project Settings → API → anon public.)

Then open the **Sync Status** screen. Before you set the secrets it shows
"Zoho CRM (MPG)" with an error ("credentials not set") — that's expected. After
step 3 it should flip to a green dot with a synced count.

## 5. Verify the data

```sql
select * from sync_log where source = 'zoho' order by ran_at desc limit 5;
select count(*) from contacts where source_crm = 'zoho';
select count(*) from deals where source_crm = 'zoho';
select name, is_won, is_lost from stages where business_id = 'mpg' order by sort_order;
```

## Known unknowns — verify against your real Zoho data

`supabase/functions/_shared/zoho.ts` is written from Zoho's documented API shape.
Check these on the first real sync (the sync logs the raw error to
`sync_log.message`, so the Sync Status screen shows exactly what to adjust):

- **Custom fields** — monthly residual (currently mapped from `Amount`), processing
  volume, and segment (Displacement/Greenfield) are almost certainly Zoho custom
  fields. Find their API names (Zoho → Setup → Developer Space → APIs, or the
  field's API name in the layout) and update `mapDeal()`.
- **Leads vs Contacts vs Deals** — the sync pulls all three. If MPG only uses one
  or two of those modules, the empty fetches are harmless, but confirm where your
  pipeline actually lives.
- **Stage join** — deals reference a stage by its display value; if your Deal
  layout uses multiple pipelines with duplicate stage names, stage matching may
  need a pipeline qualifier.

## Zoho webhook (near-real-time) — later

This phase is scheduled-only (15-min). Zoho's Notifications API can push changes
for near-real-time updates; that's a later addition once the scheduled sync is
confirmed working, mirroring the FollowUpBoss webhook.
```

- [ ] **Step 2: Commit**

```bash
git add docs/phase5-zoho-setup.md
git commit -m "Phase 5: Zoho OAuth credential + deploy setup guide"
```

---

### Task 6: Final verification and deploy

**Files:** none — verification and push only.

- [ ] **Step 1: Confirm the Bayway Overview is unchanged under the new guard**

The atkinson dev server runs on port 5199 (start via the `atkinson-sales-os` preview config if
needed; it requires sign-in — if the login screen shows, ask Chandler to sign in, never enter his
password). In the connected browser, load `http://localhost:5199/` (All view). Confirm the KPI
numbers and workbench are unchanged from Phase 3/4 (all Bayway), and the nurture footnote still
reflects a Bayway-only contact count. Cross-check the guarded count (service key at runtime, not
printed):

```bash
SR=$(supabase projects api-keys --project-ref cnmipfxwqnbtkohfixkf | python -c "import sys,json;d=json.load(sys.stdin);print(next(k['api_key'] for k in d['keys'] if k.get('id')=='service_role'))")
curl -s "https://cnmipfxwqnbtkohfixkf.supabase.co/rest/v1/contacts?select=id&business_id=eq.bay" -H "apikey: $SR" -H "Authorization: Bearer $SR" -H "Prefer: count=exact" -H "Range: 0-0" -o /dev/null -D - | grep -i content-range
```

The Overview's "in nurture" count = (bay contacts) − (bay v_active_pipeline rows); confirm it is
consistent with this bay-only total (i.e. did not jump when MPG data exists). Check the browser
console for errors — expected none.

- [ ] **Step 2: Confirm Sync Status shows the Zoho row**

Navigate to `http://localhost:5199/sync`. Confirm a "Zoho CRM (MPG)" row appears with an error
state / "credentials not set" message (from Task 4's run) — proving the sync surface works end to
end pending credentials.

- [ ] **Step 3: Screenshot proof**

Screenshot the Sync Status screen (showing FUB healthy + Zoho awaiting credentials) and share it.

- [ ] **Step 4: Push (deploys the frontend guard via Netlify)**

```bash
cd /c/Users/Chandler/.claude/projects/atkinson-sales-os-phase1
git log origin/main..HEAD --format='%an <%ae>' | sort -u   # must show only chandleros-bit
git push origin main
```

Expected: push succeeds; Netlify auto-builds the frontend (with the Overview guard).

---

## Out of scope (do not add)

- MPG Overview/Pipeline/Contacts screens (later phase, on real Zoho data)
- Zoho webhook / near-real-time
- Any write-back to Zoho; Outlook calendars; Reports
- Do not modify `_shared/db.ts`, `fub-sync`, `fub-webhook`, `Login.jsx`, or migrations 0001–0004
