# Unified Tasks Screen (FollowUpBoss + Zoho) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a global `/tasks` screen listing every open follow-up task from FollowUpBoss (Bayway) and Zoho CRM (MPG), grouped Overdue / Today / Tomorrow / Upcoming / No due date and filtered by the global All / MPG / Bayway control.

**Architecture:** A direct replay of the Phase 11 activity feed. New normalized `tasks` table → two independent read-only Edge Functions (`fub-task-sync`, `zoho-task-sync`) that upsert on `(source_crm, external_id)` → a `security_invoker` view `v_tasks` filtered to `is_completed = false` → a config-light React screen backed by a pure, unit-tested `src/lib/tasks.js`. No existing sync is touched except adding two `export` keywords in `_shared/zoho.ts`.

**Tech Stack:** Supabase Postgres + pg_cron + Deno Edge Functions, React 18 + react-router-dom 6 + Tailwind, Vitest.

**Source spec:** `C:\Users\Chandler\Downloads\2026-07-19-task-sync-fub-zoho-design.md` (status: approved).

---

## Context the implementer needs

- **Repo:** `C:\Users\Chandler\.claude\projects\atkinson-sales-os-phase1`. Dev server `npm run dev` (port 5199). Tests `npm test` (vitest, runs `src/**/*.test.js` and `supabase/functions/_shared/*.test.js`). Build `npm run build`.
- **Supabase project ref:** `cnmipfxwqnbtkohfixkf`.
- **Read-only ethos:** the browser client only SELECTs (RLS grants `select` to `authenticated`). Edge Functions write with the service-role key and bypass RLS. Never add a write path from the app.
- **Hosting is Vercel** as of 2026-07-19. The source spec's "Netlify free-plan single-contributor" constraint is **stale** — merge PRs normally. Keep commits single-author (`chandleros-bit <chandler.dashboard@gmail.com>`, the repo's local git config) and **do not add a `Co-Authored-By` trailer** — that is still the repo's convention. Never pass `-c user.email=` / `-c user.name=` overrides.
- **Patterns to imitate, read them before starting:**
  - `supabase/functions/_shared/fub-activity.ts` — fetcher + pure mapper split, "VERIFY ON FIRST RUN" comment convention.
  - `supabase/functions/fub-activity-sync/index.ts` — id maps, incremental `since` from `sync_log`, per-source try/catch, `logSync`.
  - `supabase/migrations/0009_bayway_activity_view.sql`, `0010_schedule_fub_activity_sync.sql`, `0011_activities_feed_index.sql`.
  - `src/lib/activity.js` + `src/lib/activity.test.js` — pure helpers and their test style.
  - `src/pages/Activity.jsx` — loading / empty / error / demo states and row anatomy.

## File structure

| File | Responsibility |
| --- | --- |
| `supabase/migrations/0017_tasks_table.sql` (create) | `tasks` table, read-only RLS policy, two indexes |
| `supabase/migrations/0018_tasks_view.sql` (create) | `v_tasks` (`security_invoker = on`), open tasks only |
| `supabase/migrations/0019_schedule_fub_task_sync.sql` (create) | `fub-task-sync-15min` pg_cron job |
| `supabase/migrations/0020_schedule_zoho_task_sync.sql` (create) | `zoho-task-sync-15min` pg_cron job |
| `supabase/functions/_shared/fub-tasks.ts` (create) | FUB `/tasks` fetchers + pure `mapTask` |
| `supabase/functions/_shared/fub-tasks.test.js` (create) | Vitest for the FUB mapper |
| `supabase/functions/_shared/zoho-tasks.ts` (create) | Zoho `Tasks` fetcher + pure `mapTask` |
| `supabase/functions/_shared/zoho-tasks.test.js` (create) | Vitest for the Zoho mapper |
| `supabase/functions/_shared/zoho.ts` (modify) | export `zohoGet` / `zohoList` so `zoho-tasks.ts` can reuse them |
| `supabase/functions/fub-task-sync/index.ts` (create) | Scheduled FUB task sync |
| `supabase/functions/zoho-task-sync/index.ts` (create) | Scheduled Zoho task sync |
| `src/lib/tasks.js` (create) | Pure bucketing / labels / priority tokens |
| `src/lib/tasks.test.js` (create) | Vitest for `tasks.js` |
| `src/pages/Tasks.jsx` (create) | The `/tasks` screen |
| `src/App.jsx` (modify) | `<Route path="/tasks" …>` |
| `src/components/Sidebar.jsx` (modify) | **Tasks** item in the OVERVIEW group |
| `src/pages/SyncStatus.jsx` (modify) | `fub-tasks` / `zoho-tasks` rows |
| `docs/phase-tasks-setup.md` (create) | Deploy / migrate / first-run verification doc |

---

### Task 1: `tasks` table migration

**Files:**
- Create: `supabase/migrations/0017_tasks_table.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Phase 13 — unified Tasks screen. Normalized, source-agnostic task table
-- alongside contacts / deals / activities. Populated by fub-task-sync and
-- zoho-task-sync with the service role; the app only SELECTs (read-only RLS,
-- same shape as every table in 0001_init.sql).

create table if not exists tasks (
  id           uuid primary key default gen_random_uuid(),
  business_id  text not null references businesses(id),   -- 'mpg' | 'bay'
  source_crm   text not null,                             -- 'fub' | 'zoho'
  external_id  text not null,                             -- id in the source CRM
  contact_id   uuid references contacts(id),
  deal_id      uuid references deals(id),
  title        text,
  task_type    text,
  due_at       timestamptz,
  priority     text,
  owner        text,
  is_completed boolean not null default false,
  raw          jsonb,
  updated_at   timestamptz not null default now(),
  unique (source_crm, external_id)
);

alter table tasks enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'tasks'
      and policyname = 'authenticated read tasks'
  ) then
    execute 'create policy "authenticated read tasks" on tasks for select to authenticated using (true)';
  end if;
end $$;

-- The board's core filter+sort, and contact resolution / future drill-in.
create index if not exists idx_tasks_open_due on tasks (business_id, is_completed, due_at);
create index if not exists idx_tasks_contact  on tasks (contact_id);
```

- [ ] **Step 2: Sanity-check the SQL parses**

There is no local Postgres in this repo, so verification is by inspection plus the live apply in Task 11. Confirm by eye:
- every referenced table (`businesses`, `contacts`, `deals`) exists in `0001_init.sql` — yes;
- `gen_random_uuid()` is available (`create extension pgcrypto` runs in `0001`) — yes;
- the policy block is idempotent (re-running the migration must not error).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0017_tasks_table.sql
git commit -m "feat: add tasks table with read-only RLS and query indexes"
```

---

### Task 2: `v_tasks` view migration

**Files:**
- Create: `supabase/migrations/0018_tasks_view.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Phase 13 — unified Tasks view. One row per OPEN task, joined to its contact
-- (name / company / CRM deep link) and optional deal. security_invoker = on
-- keeps the app's read-only RLS in force (as with v_bayway_activity).
-- Ascending order — soonest and overdue first, the opposite of the feed.

create or replace view public.v_tasks
with (security_invoker = on) as
select
  t.id,
  t.business_id,
  t.source_crm,
  t.task_type,
  t.title,
  t.due_at,
  t.priority,
  t.owner,
  t.contact_id,
  c.name             as contact_name,
  c.company          as company,
  -- crm_profile_url is NOT a column on `contacts` — it is always computed
  -- per-business from external_id (see 0015/0016). `tasks` spans both books,
  -- so this reuses v_active_pipeline's case-per-business pattern verbatim.
  case c.business_id
    when 'bay' then 'https://baywayhtx.followupboss.com/2/people/view/' || c.external_id
    when 'mpg' then 'https://crm.zoho.com/crm/tab/Leads/' || c.external_id
  end                as crm_profile_url,
  t.deal_id,
  d.name             as deal_name
from tasks t
left join contacts c on c.id = t.contact_id
left join deals    d on d.id = t.deal_id
where t.is_completed = false
order by t.due_at asc nulls last, t.id asc;
```

- [ ] **Step 2: Verify the CRM-link expression matches its precedent**

Run:

```bash
grep -n -A3 "case c.business_id" supabase/migrations/0016_crm_links_everywhere.sql
```

Expected: the same two `when 'bay' … when 'mpg' …` URL prefixes used above. Despite its filename, `0015_contacts_crm_profile_url.sql` adds **no column** to `contacts` — it defines views that compute the URL. Selecting `c.crm_profile_url` off `contacts` would fail with `column c.crm_profile_url does not exist`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0018_tasks_view.sql
git commit -m "feat: add v_tasks view for open tasks across both books"
```

---

### Task 3: FollowUpBoss task fetchers + mapper (TDD)

**Files:**
- Create: `supabase/functions/_shared/fub-tasks.ts`
- Test: `supabase/functions/_shared/fub-tasks.test.js`

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/fub-tasks.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { mapTask, taskDueAt, taskTitle, taskIsCompleted } from './fub-tasks.ts'

describe('taskDueAt', () => {
  it('prefers dueDate then due then dueAt', () => {
    expect(taskDueAt({ dueDate: '2026-07-20T15:00:00Z', due: 'x' })).toBe('2026-07-20T15:00:00Z')
    expect(taskDueAt({ due: '2026-07-21T15:00:00Z' })).toBe('2026-07-21T15:00:00Z')
    expect(taskDueAt({ dueAt: '2026-07-22T15:00:00Z' })).toBe('2026-07-22T15:00:00Z')
  })
  it('returns null when no due field is present', () => {
    expect(taskDueAt({})).toBe(null)
  })
})

describe('taskTitle', () => {
  it('prefers name, then subject, then description', () => {
    expect(taskTitle({ name: 'Call Marcus', description: 'x' })).toBe('Call Marcus')
    expect(taskTitle({ subject: 'Send docs' })).toBe('Send docs')
    expect(taskTitle({ description: 'Follow up' })).toBe('Follow up')
    expect(taskTitle({})).toBe('Task')
  })
})

describe('taskIsCompleted', () => {
  it('reads isCompleted, then completed', () => {
    expect(taskIsCompleted({ isCompleted: true })).toBe(true)
    expect(taskIsCompleted({ completed: true })).toBe(true)
    expect(taskIsCompleted({ isCompleted: false })).toBe(false)
  })
  it('defaults to false when neither field is present', () => {
    expect(taskIsCompleted({})).toBe(false)
  })
})

describe('mapTask', () => {
  const contacts = new Map([['501', 'uuid-contact']])
  const deals = new Map([['900', 'uuid-deal']])

  it('maps a full FUB task onto a tasks row', () => {
    const row = mapTask(
      {
        id: 77,
        name: 'Call Marcus re: rate lock',
        type: 'Call',
        dueDate: '2026-07-20T15:00:00Z',
        priority: 'High',
        assignedTo: 'Chandler Atkinson',
        isCompleted: false,
        personId: 501,
        dealId: 900,
      },
      contacts,
      deals,
    )
    expect(row).toMatchObject({
      business_id: 'bay',
      source_crm: 'fub',
      external_id: '77',
      title: 'Call Marcus re: rate lock',
      task_type: 'Call',
      due_at: '2026-07-20T15:00:00Z',
      priority: 'High',
      owner: 'Chandler Atkinson',
      is_completed: false,
      contact_id: 'uuid-contact',
      deal_id: 'uuid-deal',
    })
    expect(row.raw.id).toBe(77)
    expect(typeof row.updated_at).toBe('string')
  })

  it('leaves contact_id and deal_id null when the ids are unknown', () => {
    const row = mapTask({ id: 78, personId: 999, dealId: 999 }, contacts, deals)
    expect(row.contact_id).toBe(null)
    expect(row.deal_id).toBe(null)
  })

  it('resolves a nested person object and falls back on assignedUserName', () => {
    const row = mapTask(
      { id: 79, person: { id: 501 }, assignedUserName: 'Chandler A.' },
      contacts,
      deals,
    )
    expect(row.contact_id).toBe('uuid-contact')
    expect(row.owner).toBe('Chandler A.')
  })

  it('nulls priority when absent (FUB often has none)', () => {
    expect(mapTask({ id: 80 }, contacts, deals).priority).toBe(null)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- fub-tasks`
Expected: FAIL — `Failed to resolve import "./fub-tasks.ts"`.

- [ ] **Step 3: Write the implementation**

Create `supabase/functions/_shared/fub-tasks.ts`:

```ts
// FollowUpBoss task fetchers + field mapping for the scheduled task sync.
// Normalizes each FUB task into a `tasks` row (business_id 'bay',
// source_crm 'fub').
//
// VERIFY BEFORE FIRST REAL RUN (same convention as fub.ts / fub-activity.ts):
// the /tasks endpoint's list key, the due-date field name, the completion flag,
// and the presence of personId are written from FollowUpBoss's documented shape
// and should be checked against a live response and adjusted here. The sync
// function records the reason for a failed pass in sync_log.message.
//
// NOTE: some FUB list endpoints refuse to list account-wide (/textMessages and
// /emails 400 without a person filter — see fub-activity.ts). If /tasks turns
// out to be one of them, fall back to a per-contact fetch bounded to
// recently-touched contacts, exactly as the email pass does in
// fub-activity-sync/index.ts. See docs/phase-tasks-setup.md.

import { fubGet } from './fub.ts'

// Paginate the FUB /tasks list endpoint. `listKeys` are candidate top-level
// array keys (FUB casing varies by resource); the first present wins.
async function fubListTasks(sinceIso, extraParams = {}) {
  const listKeys = ['tasks']
  const limit = 100
  let offset = 0
  const items = []
  const pick = (json) => {
    for (const k of listKeys) {
      if (Array.isArray(json[k])) return json[k]
      if (Array.isArray(json._embedded?.[k])) return json._embedded[k]
    }
    return []
  }
  while (true) {
    const params = { limit, offset, sort: 'updated', ...extraParams }
    if (sinceIso) params.updatedAfter = sinceIso
    const json = await fubGet('/tasks', params)
    const page = pick(json)
    if (page.length === 0) break
    items.push(...page)
    if (page.length < limit) break
    offset += limit
  }
  return items
}

// First run: open tasks only, so we don't drag in the full completed history.
export const fetchOpenTasks = () => fubListTasks(null, { isCompleted: false })

// Incremental runs: everything changed since the last ok run, ANY status, so a
// task completed in FUB flows through and drops off the board via v_tasks.
export const fetchTasksUpdatedSince = (since) => fubListTasks(since)

// --- Pure mapping helpers (unit-tested) ------------------------------------

export function taskDueAt(rec) {
  return rec.dueDate || rec.due || rec.dueAt || null
}

export function taskTitle(rec) {
  return rec.name || rec.subject || rec.description || 'Task'
}

export function taskIsCompleted(rec) {
  if (typeof rec.isCompleted === 'boolean') return rec.isCompleted
  if (typeof rec.completed === 'boolean') return rec.completed
  return false
}

// contactIdByExternal: Map<fub person id (string), our contacts.id (uuid)>
// dealIdByExternal:    Map<fub deal id (string),   our deals.id (uuid)>
export function mapTask(rec, contactIdByExternal, dealIdByExternal) {
  const personId = rec.personId ?? rec.person?.id ?? null
  const dealId = rec.dealId ?? rec.deal?.id ?? null
  return {
    business_id: 'bay',
    source_crm: 'fub',
    external_id: String(rec.id),
    contact_id: (personId != null && contactIdByExternal.get(String(personId))) || null,
    deal_id: (dealId != null && dealIdByExternal.get(String(dealId))) || null,
    title: taskTitle(rec),
    task_type: rec.type || null,
    due_at: taskDueAt(rec),
    priority: rec.priority || null,
    owner: rec.assignedTo || rec.assignedUserName || null,
    is_completed: taskIsCompleted(rec),
    raw: rec,
    updated_at: new Date().toISOString(),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- fub-tasks`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/fub-tasks.ts supabase/functions/_shared/fub-tasks.test.js
git commit -m "feat: add FollowUpBoss task fetchers and mapper"
```

---

### Task 4: `fub-task-sync` Edge Function

**Files:**
- Create: `supabase/functions/fub-task-sync/index.ts`

There is no test harness for Edge Function entrypoints in this repo (the pure helpers carry the tests; the entrypoint is verified by the live run in Task 11). Follow `fub-activity-sync/index.ts` exactly.

- [ ] **Step 1: Write the function**

```ts
// Scheduled FollowUpBoss TASK sync. Separate from fub-sync and
// fub-activity-sync so it runs on its own cadence and logs its own sync_log
// line ('fub-tasks'). Read-only against FUB: only GETs, never writes back.
// See docs/phase-tasks-setup.md.

import { serviceClient, logSync } from '../_shared/db.ts'
import { fetchOpenTasks, fetchTasksUpdatedSince, mapTask } from '../_shared/fub-tasks.ts'

Deno.serve(async () => {
  const db = serviceClient()
  let upserted = 0

  try {
    // FUB person id -> our contacts.id, and FUB deal id -> our deals.id, so
    // tasks resolve their contact and (optionally) their deal.
    const { data: contactMapRows } = await db
      .from('contacts')
      .select('id, external_id')
      .eq('source_crm', 'fub')
    const contactIdByExternal = new Map((contactMapRows || []).map((r) => [r.external_id, r.id]))

    const { data: dealMapRows } = await db
      .from('deals')
      .select('id, external_id')
      .eq('source_crm', 'fub')
    const dealIdByExternal = new Map((dealMapRows || []).map((r) => [r.external_id, r.id]))

    // Incremental since the last successful run. First run (no prior ok run)
    // pulls OPEN tasks only, so we never drag in the completed history.
    const { data: lastOk } = await db
      .from('sync_log')
      .select('ran_at')
      .eq('source', 'fub-tasks')
      .eq('status', 'ok')
      .order('ran_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const since = lastOk?.ran_at || null

    const records = since ? await fetchTasksUpdatedSince(since) : await fetchOpenTasks()
    let rows = records.map((rec) => mapTask(rec, contactIdByExternal, dealIdByExternal))
    // Defensive: if FUB ignores the isCompleted filter on the first run, drop
    // completed rows here rather than importing history.
    if (!since) rows = rows.filter((r) => !r.is_completed)

    if (rows.length) {
      const { error } = await db.from('tasks').upsert(rows, { onConflict: 'source_crm,external_id' })
      if (error) throw new Error(`task upsert: ${error.message}`)
      upserted += rows.length
    }

    const summary = `${since ? 'incremental' : 'first run (open only)'} | fetched:${records.length} upserted:${upserted}`
    await logSync(db, 'fub-tasks', 'ok', upserted, summary)
    return new Response(JSON.stringify({ ok: true, upserted, fetched: records.length }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  } catch (err) {
    await logSync(db, 'fub-tasks', 'error', upserted, String(err?.message || err))
    return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
})
```

- [ ] **Step 2: Verify the whole suite still passes**

Run: `npm test`
Expected: all files pass (the new function has no test; nothing else regressed).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/fub-task-sync/index.ts
git commit -m "feat: add scheduled fub-task-sync edge function"
```

---

### Task 5: Zoho task fetcher + mapper (TDD)

**Files:**
- Modify: `supabase/functions/_shared/zoho.ts:42` and `:58` (add `export` to `zohoGet` and `zohoList`)
- Create: `supabase/functions/_shared/zoho-tasks.ts`
- Test: `supabase/functions/_shared/zoho-tasks.test.js`

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/zoho-tasks.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { mapTask, zohoTaskIsCompleted } from './zoho-tasks.ts'

describe('zohoTaskIsCompleted', () => {
  it('is true only for the Completed status', () => {
    expect(zohoTaskIsCompleted({ Status: 'Completed' })).toBe(true)
    expect(zohoTaskIsCompleted({ Status: 'completed' })).toBe(true)
    expect(zohoTaskIsCompleted({ Status: 'Not Started' })).toBe(false)
    expect(zohoTaskIsCompleted({ Status: 'In Progress' })).toBe(false)
    expect(zohoTaskIsCompleted({ Status: 'Deferred' })).toBe(false)
  })
  it('defaults to false with no Status', () => {
    expect(zohoTaskIsCompleted({})).toBe(false)
  })
})

describe('mapTask', () => {
  const contacts = new Map([['zc1', 'uuid-contact']])
  const deals = new Map([['zd1', 'uuid-deal']])

  it('maps a full Zoho task onto a tasks row', () => {
    const row = mapTask(
      {
        id: '4400001',
        Subject: 'Send MPG proposal',
        Task_Type: 'Email',
        Due_Date: '2026-07-21',
        Priority: 'High',
        Status: 'Not Started',
        Owner: { name: 'Chandler Atkinson' },
        Who_Id: { id: 'zc1' },
        What_Id: { id: 'zd1' },
        '$se_module': 'Deals',
      },
      contacts,
      deals,
    )
    expect(row).toMatchObject({
      business_id: 'mpg',
      source_crm: 'zoho',
      external_id: '4400001',
      title: 'Send MPG proposal',
      task_type: 'Email',
      due_at: '2026-07-21',
      priority: 'High',
      owner: 'Chandler Atkinson',
      is_completed: false,
      contact_id: 'uuid-contact',
      deal_id: 'uuid-deal',
    })
    expect(row.raw.id).toBe('4400001')
  })

  it('ignores What_Id when it does not point at a Deal', () => {
    const row = mapTask(
      { id: '2', What_Id: { id: 'zd1' }, '$se_module': 'Accounts' },
      contacts,
      deals,
    )
    expect(row.deal_id).toBe(null)
  })

  it('resolves a deal when $se_module is absent but the id is a known deal', () => {
    const row = mapTask({ id: '3', What_Id: { id: 'zd1' } }, contacts, deals)
    expect(row.deal_id).toBe('uuid-deal')
  })

  it('marks a Completed task so v_tasks drops it', () => {
    expect(mapTask({ id: '4', Status: 'Completed' }, contacts, deals).is_completed).toBe(true)
  })

  it('falls back to a placeholder title and null links', () => {
    const row = mapTask({ id: '5' }, contacts, deals)
    expect(row.title).toBe('Task')
    expect(row.contact_id).toBe(null)
    expect(row.deal_id).toBe(null)
    expect(row.due_at).toBe(null)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- zoho-tasks`
Expected: FAIL — `Failed to resolve import "./zoho-tasks.ts"`.

- [ ] **Step 3: Export the two Zoho helpers**

In `supabase/functions/_shared/zoho.ts`, change exactly two lines:

```ts
async function zohoGet(apiHost, accessToken, path, params = {}, sinceIso) {
```

to

```ts
export async function zohoGet(apiHost, accessToken, path, params = {}, sinceIso) {
```

and

```ts
async function zohoList(apiHost, accessToken, module, sinceIso) {
```

to

```ts
export async function zohoList(apiHost, accessToken, module, sinceIso) {
```

Nothing else in `zoho.ts` changes; `zoho-sync` keeps working because internal callers are unaffected.

- [ ] **Step 4: Write the implementation**

Create `supabase/functions/_shared/zoho-tasks.ts`:

```ts
// Zoho CRM (MPG) Tasks fetcher + field mapping for the scheduled task sync.
// Normalizes each Zoho task into a `tasks` row (business_id 'mpg',
// source_crm 'zoho'). Read-only: only GETs from Zoho.
//
// VERIFY BEFORE FIRST REAL RUN (same convention as zoho.ts): the module API
// name ('Tasks'), the Status value that means done, the Due_Date format, and
// that Who_Id / What_Id carry the ids used for contact / deal resolution.
// See docs/phase-tasks-setup.md.

import { zohoList } from './zoho.ts'

// Incremental via If-Modified-Since; 204/304 are handled inside zohoGet.
export async function fetchTasks(apiHost, accessToken, sinceIso) {
  return zohoList(apiHost, accessToken, 'Tasks', sinceIso)
}

// --- Pure mapping helpers (unit-tested) ------------------------------------

export function zohoTaskIsCompleted(rec) {
  return String(rec.Status || '').toLowerCase() === 'completed'
}

// contactIdByExternal: Map<zoho contact id (string), our contacts.id (uuid)>
// dealIdByExternal:    Map<zoho deal id (string),    our deals.id (uuid)>
export function mapTask(rec, contactIdByExternal, dealIdByExternal) {
  const whoId = rec.Who_Id && rec.Who_Id.id ? String(rec.Who_Id.id) : null
  const whatId = rec.What_Id && rec.What_Id.id ? String(rec.What_Id.id) : null
  // What_Id is polymorphic (Deals | Accounts | …). Trust $se_module when Zoho
  // sends it; otherwise accept the id only if it is a deal we already synced.
  const seModule = rec['$se_module'] || null
  const whatIsDeal = seModule ? seModule === 'Deals' : true
  return {
    business_id: 'mpg',
    source_crm: 'zoho',
    external_id: String(rec.id),
    contact_id: (whoId && contactIdByExternal.get(whoId)) || null,
    deal_id: (whatIsDeal && whatId && dealIdByExternal.get(whatId)) || null,
    title: rec.Subject || 'Task',
    task_type: rec.Task_Type || rec.Category || null,
    due_at: rec.Due_Date || null,
    priority: rec.Priority || null,
    owner: (rec.Owner && (rec.Owner.name || rec.Owner.full_name)) || null,
    is_completed: zohoTaskIsCompleted(rec),
    raw: rec,
    updated_at: new Date().toISOString(),
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- zoho-tasks`
Expected: PASS, 7 tests.

- [ ] **Step 6: Run the full suite (the `zoho.ts` edit touches a live sync)**

Run: `npm test`
Expected: all pass, including the existing `zoho.test.js`.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/zoho-tasks.ts supabase/functions/_shared/zoho-tasks.test.js supabase/functions/_shared/zoho.ts
git commit -m "feat: add Zoho task fetcher and mapper"
```

---

### Task 6: `zoho-task-sync` Edge Function

**Files:**
- Create: `supabase/functions/zoho-task-sync/index.ts`

- [ ] **Step 1: Write the function**

```ts
// Scheduled Zoho CRM (MPG) TASK sync. Separate from zoho-sync so it runs on
// its own cadence and logs its own sync_log line ('zoho-tasks'). Read-only
// against Zoho: only GETs, never writes back. Until the ZOHO_CLIENT_ID /
// ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN secrets are set this logs a
// "credentials not set" error row each run — expected, and visible on Sync
// Status exactly like zoho-sync. See docs/phase-tasks-setup.md.

import { serviceClient, logSync } from '../_shared/db.ts'
import { getAccessToken } from '../_shared/zoho.ts'
import { fetchTasks, mapTask } from '../_shared/zoho-tasks.ts'

Deno.serve(async () => {
  const db = serviceClient()
  let upserted = 0

  try {
    const { accessToken, apiHost } = await getAccessToken()

    // Zoho contact id -> our contacts.id, Zoho deal id -> our deals.id.
    const { data: contactMapRows } = await db
      .from('contacts')
      .select('id, external_id')
      .eq('source_crm', 'zoho')
    const contactIdByExternal = new Map((contactMapRows || []).map((r) => [r.external_id, r.id]))

    const { data: dealMapRows } = await db
      .from('deals')
      .select('id, external_id')
      .eq('source_crm', 'zoho')
    const dealIdByExternal = new Map((dealMapRows || []).map((r) => [r.external_id, r.id]))

    // Incremental since the last successful run.
    const { data: lastOk } = await db
      .from('sync_log')
      .select('ran_at')
      .eq('source', 'zoho-tasks')
      .eq('status', 'ok')
      .order('ran_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const since = lastOk?.ran_at || null

    const records = await fetchTasks(apiHost, accessToken, since)
    let rows = records.map((rec) => mapTask(rec, contactIdByExternal, dealIdByExternal))
    // Zoho's list endpoint has no status filter, so the first run drops
    // completed tasks here rather than importing the whole history.
    if (!since) rows = rows.filter((r) => !r.is_completed)

    if (rows.length) {
      const { error } = await db.from('tasks').upsert(rows, { onConflict: 'source_crm,external_id' })
      if (error) throw new Error(`task upsert: ${error.message}`)
      upserted += rows.length
    }

    const summary = `${since ? 'incremental' : 'first run (open only)'} | fetched:${records.length} upserted:${upserted}`
    await logSync(db, 'zoho-tasks', 'ok', upserted, summary)
    return new Response(JSON.stringify({ ok: true, upserted, fetched: records.length }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  } catch (err) {
    await logSync(db, 'zoho-tasks', 'error', upserted, String(err?.message || err))
    return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
})
```

- [ ] **Step 2: Run the suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/zoho-task-sync/index.ts
git commit -m "feat: add scheduled zoho-task-sync edge function"
```

---

### Task 7: pg_cron schedules for both syncs

**Files:**
- Create: `supabase/migrations/0019_schedule_fub_task_sync.sql`
- Create: `supabase/migrations/0020_schedule_zoho_task_sync.sql`

The bearer below is the project's **public anon key**, copied verbatim from `0010_schedule_fub_activity_sync.sql` — safe to commit, and both functions are deployed `--no-verify-jwt`.

- [ ] **Step 1: Write `0019_schedule_fub_task_sync.sql`**

```sql
-- Phase 13: schedule fub-task-sync every 15 minutes via pg_cron.
-- Mirrors 0002/0005/0008/0010. pg_cron/pg_net already enabled. Bearer is the
-- public ANON key (safe to commit); fub-task-sync is deployed --no-verify-jwt.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'fub-task-sync-15min',
  '*/15 * * * *',
  $job$
  select net.http_post(
    url := 'https://cnmipfxwqnbtkohfixkf.supabase.co/functions/v1/fub-task-sync',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubWlwZnh3cW5idGtvaGZpeGtmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2Mzc5NjYsImV4cCI6MjA5OTIxMzk2Nn0.tcOKs7O5gGAT2HsfiKKwI90TQ-CYVXSMB4yL9RvuxJU',
      'Content-Type', 'application/json'
    )
  );
  $job$
);
```

- [ ] **Step 2: Write `0020_schedule_zoho_task_sync.sql`**

```sql
-- Phase 13: schedule zoho-task-sync every 15 minutes via pg_cron.
-- Mirrors 0005/0010/0019. Until the Zoho secrets are set this run logs a
-- "credentials not set" error row each cycle — expected, visible on Sync Status.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'zoho-task-sync-15min',
  '*/15 * * * *',
  $job$
  select net.http_post(
    url := 'https://cnmipfxwqnbtkohfixkf.supabase.co/functions/v1/zoho-task-sync',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubWlwZnh3cW5idGtvaGZpeGtmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2Mzc5NjYsImV4cCI6MjA5OTIxMzk2Nn0.tcOKs7O5gGAT2HsfiKKwI90TQ-CYVXSMB4yL9RvuxJU',
      'Content-Type', 'application/json'
    )
  );
  $job$
);
```

- [ ] **Step 3: Verify the bearer matches the existing cron migration**

Run: `diff <(grep -o 'Bearer ey[A-Za-z0-9._-]*' supabase/migrations/0010_schedule_fub_activity_sync.sql) <(grep -o 'Bearer ey[A-Za-z0-9._-]*' supabase/migrations/0019_schedule_fub_task_sync.sql)`
Expected: no output (identical keys). Use the Bash tool for this — it is POSIX syntax.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0019_schedule_fub_task_sync.sql supabase/migrations/0020_schedule_zoho_task_sync.sql
git commit -m "feat: schedule fub-task-sync and zoho-task-sync every 15 minutes"
```

---

### Task 8: `src/lib/tasks.js` pure helpers (TDD)

**Files:**
- Create: `src/lib/tasks.js`
- Test: `src/lib/tasks.test.js`

**Bucketing rule (decide once, here):** buckets compare **calendar days**, not timestamps — a task due today at 9am is still "Today" at 2pm, not "Overdue". This matters because FUB/Zoho due dates are frequently date-only (midnight local), which under timestamp comparison would push every one of today's tasks into Overdue. Overdue means *an earlier calendar day than today*.

- [ ] **Step 1: Write the failing test**

Create `src/lib/tasks.test.js`:

```js
import { describe, it, expect } from 'vitest'
import {
  BUCKETS,
  bucketByDue,
  dueLabel,
  dueTimeOfDay,
  normalizePriority,
  filterByPriority,
} from './tasks'

const now = new Date('2026-07-19T12:00:00').getTime()

describe('dueLabel', () => {
  it('labels today, tomorrow, and yesterday', () => {
    expect(dueLabel('2026-07-19T09:00:00', now)).toBe('Today')
    expect(dueLabel('2026-07-20T09:00:00', now)).toBe('Tomorrow')
    expect(dueLabel('2026-07-18T09:00:00', now)).toBe('Yesterday')
  })
  it('labels other days by weekday and date', () => {
    expect(dueLabel('2026-07-22T09:00:00', now)).toBe('Wed · Jul 22')
  })
  it('handles a null due date', () => {
    expect(dueLabel(null, now)).toBe('No due date')
  })
})

describe('dueTimeOfDay', () => {
  it('formats a time of day', () => {
    expect(dueTimeOfDay('2026-07-19T09:05:00')).toBe('9:05a')
    expect(dueTimeOfDay('2026-07-19T14:30:00')).toBe('2:30p')
  })
  it('returns an em dash for a null or midnight (date-only) due date', () => {
    expect(dueTimeOfDay(null)).toBe('—')
    expect(dueTimeOfDay('2026-07-19T00:00:00')).toBe('—')
  })
})

describe('normalizePriority', () => {
  it('folds Zoho and FUB values into three keys', () => {
    expect(normalizePriority('Highest')).toBe('high')
    expect(normalizePriority('High')).toBe('high')
    expect(normalizePriority('Normal')).toBe('normal')
    expect(normalizePriority('Medium')).toBe('normal')
    expect(normalizePriority('Low')).toBe('low')
    expect(normalizePriority('Lowest')).toBe('low')
  })
  it('returns null for missing or unknown values', () => {
    expect(normalizePriority(null)).toBe(null)
    expect(normalizePriority('Whatever')).toBe(null)
  })
})

describe('filterByPriority', () => {
  const rows = [{ priority: 'High' }, { priority: 'Normal' }, { priority: null }]
  it('passes everything for "all"', () => {
    expect(filterByPriority(rows, 'all')).toHaveLength(3)
  })
  it('filters on the normalized key', () => {
    expect(filterByPriority(rows, 'high')).toHaveLength(1)
    expect(filterByPriority(rows, 'normal')).toHaveLength(1)
    expect(filterByPriority(rows, 'low')).toHaveLength(0)
  })
})

describe('bucketByDue', () => {
  const rows = [
    { id: 'a', due_at: '2026-07-17T09:00:00' }, // 2 days ago
    { id: 'b', due_at: '2026-07-18T09:00:00' }, // yesterday
    { id: 'c', due_at: '2026-07-19T16:00:00' }, // today, later
    { id: 'd', due_at: '2026-07-19T08:00:00' }, // today, earlier (already past)
    { id: 'e', due_at: '2026-07-20T09:00:00' }, // tomorrow
    { id: 'f', due_at: '2026-07-25T09:00:00' }, // upcoming
    { id: 'g', due_at: null }, // no due date
  ]

  it('returns the five buckets in a fixed order', () => {
    expect(bucketByDue(rows, now).map((b) => b.key)).toEqual([
      'overdue',
      'today',
      'tomorrow',
      'upcoming',
      'none',
    ])
  })

  it('places rows in the right buckets', () => {
    const by = Object.fromEntries(bucketByDue(rows, now).map((b) => [b.key, b.rows.map((r) => r.id)]))
    expect(by.overdue).toEqual(['a', 'b'])
    expect(by.today).toEqual(['d', 'c'])
    expect(by.tomorrow).toEqual(['e'])
    expect(by.upcoming).toEqual(['f'])
    expect(by.none).toEqual(['g'])
  })

  it('keeps a task due earlier today in Today, not Overdue', () => {
    const by = bucketByDue([{ id: 'd', due_at: '2026-07-19T08:00:00' }], now)
    expect(by.find((b) => b.key === 'today').rows).toHaveLength(1)
    expect(by.find((b) => b.key === 'overdue').rows).toHaveLength(0)
  })

  it('sorts every dated bucket ascending (most-overdue first)', () => {
    const overdue = bucketByDue(rows, now).find((b) => b.key === 'overdue')
    expect(overdue.rows.map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('labels each bucket', () => {
    expect(bucketByDue(rows, now).map((b) => b.label)).toEqual([
      'Overdue',
      'Today',
      'Tomorrow',
      'Upcoming',
      'No due date',
    ])
  })

  it('does not mutate the input array', () => {
    const input = [...rows]
    bucketByDue(input, now)
    expect(input.map((r) => r.id)).toEqual(rows.map((r) => r.id))
  })

  it('returns empty buckets rather than dropping them', () => {
    expect(bucketByDue([], now)).toHaveLength(5)
    expect(bucketByDue([], now).every((b) => b.rows.length === 0)).toBe(true)
  })

  it('exposes BUCKETS in the same order it emits', () => {
    expect(BUCKETS.map((b) => b.key)).toEqual(bucketByDue([], now).map((b) => b.key))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tasks`
Expected: FAIL — `Failed to resolve import "./tasks"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/tasks.js`:

```js
// Pure helpers for the unified Tasks screen. No React, no I/O.
// Dates use the browser's local timezone (tasks are stored as UTC ISO or,
// from date-only CRM fields, as a bare date).
import { dayKey } from './calendar'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Buckets are emitted in this order and always all five, so the screen can
// render stable section headers (empty ones are skipped by the page).
export const BUCKETS = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Today' },
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'none', label: 'No due date' },
]

// Overdue gets the gold warning accent already used for the "Stale" pill.
export const BUCKET_META = {
  overdue: { color: 'var(--bay-gold)', border: 'rgba(201,160,82,.4)' },
  today: { color: 'var(--bay)', border: 'rgba(124,173,68,.4)' },
  tomorrow: { color: 'var(--muted)', border: 'var(--line)' },
  upcoming: { color: 'var(--muted)', border: 'var(--line)' },
  none: { color: 'var(--dim)', border: 'var(--line)' },
}

export const PRIORITY_META = {
  high: { label: 'High', color: '#e8785f', border: 'rgba(232,120,95,.4)' },
  normal: { label: 'Normal', color: 'var(--muted)', border: 'var(--line)' },
  low: { label: 'Low', color: 'var(--dim)', border: 'var(--line)' },
}

export const PRIORITY_CHIPS = [
  { key: 'all', label: 'All' },
  { key: 'high', label: 'High' },
  { key: 'normal', label: 'Normal' },
  { key: 'low', label: 'Low' },
]

// FUB and Zoho use different picklists (Zoho: Highest/High/Normal/Low/Lowest;
// FUB often none at all). Fold them into three keys, null when unknown.
export function normalizePriority(p) {
  const v = String(p || '').toLowerCase()
  if (v === 'high' || v === 'highest' || v === 'urgent') return 'high'
  if (v === 'normal' || v === 'medium') return 'normal'
  if (v === 'low' || v === 'lowest') return 'low'
  return null
}

export function filterByPriority(rows, key) {
  if (!key || key === 'all') return rows
  return rows.filter((r) => normalizePriority(r.priority) === key)
}

export function dueLabel(iso, now = Date.now()) {
  if (!iso) return 'No due date'
  const key = dayKey(iso)
  const todayKey = dayKey(new Date(now).toISOString())
  const tmr = new Date(now)
  tmr.setDate(tmr.getDate() + 1)
  const yst = new Date(now)
  yst.setDate(yst.getDate() - 1)
  if (key === todayKey) return 'Today'
  if (key === dayKey(tmr.toISOString())) return 'Tomorrow'
  if (key === dayKey(yst.toISOString())) return 'Yesterday'
  const d = new Date(iso)
  return `${DAYS[d.getDay()]} · ${MONTHS[d.getMonth()]} ${d.getDate()}`
}

// Midnight means "date only" in both CRMs — showing "12:00a" would be a lie.
export function dueTimeOfDay(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const m = d.getMinutes()
  const h24 = d.getHours()
  if (h24 === 0 && m === 0) return '—'
  const ap = h24 >= 12 ? 'p' : 'a'
  const h = h24 % 12 || 12
  return `${h}:${String(m).padStart(2, '0')}${ap}`
}

// rows -> the five buckets in BUCKETS order, each sorted by due_at ascending
// (so the most-overdue is on top). Comparison is by CALENDAR DAY, not
// timestamp: a task due at 9am today is still "Today" at 2pm. CRM due dates
// are often date-only, and timestamp comparison would mark them all overdue.
export function bucketByDue(rows, now = Date.now()) {
  const todayKey = dayKey(new Date(now).toISOString())
  const tmr = new Date(now)
  tmr.setDate(tmr.getDate() + 1)
  const tomorrowKey = dayKey(tmr.toISOString())

  const groups = BUCKETS.map((b) => ({ key: b.key, label: b.label, rows: [] }))
  const byKey = new Map(groups.map((g) => [g.key, g]))

  for (const r of rows) {
    if (!r.due_at) {
      byKey.get('none').rows.push(r)
      continue
    }
    const key = dayKey(r.due_at)
    if (key < todayKey) byKey.get('overdue').rows.push(r)
    else if (key === todayKey) byKey.get('today').rows.push(r)
    else if (key === tomorrowKey) byKey.get('tomorrow').rows.push(r)
    else byKey.get('upcoming').rows.push(r)
  }

  for (const g of groups) {
    if (g.key === 'none') continue
    g.rows.sort((a, b) => new Date(a.due_at) - new Date(b.due_at))
  }
  return groups
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tasks`
Expected: PASS, 16 tests (the `-- tasks` filter also re-runs `fub-tasks` and `zoho-tasks`; those must stay green too).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tasks.js src/lib/tasks.test.js
git commit -m "feat: add pure task bucketing and formatting helpers"
```

---

### Task 9: `src/pages/Tasks.jsx`

**Files:**
- Create: `src/pages/Tasks.jsx`

- [ ] **Step 1: Write the page**

```jsx
import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase, isDemoMode } from '../lib/supabase'
import { useBusiness } from '../context/BusinessContext'
import {
  BUCKET_META,
  PRIORITY_META,
  PRIORITY_CHIPS,
  bucketByDue,
  dueTimeOfDay,
  filterByPriority,
  normalizePriority,
} from '../lib/tasks'
import CrmLink from '../components/CrmLink'

// One generous window; both books together are far under this today. If a book
// ever exceeds it the "Load more" button pages the rest in.
const PER_PAGE = 300

const DEMO_ROWS = [
  { id: 'd1', business_id: 'bay', title: 'Call Marcus re: rate lock', task_type: 'Call', due_at: new Date(Date.now() - 2 * 86400000).toISOString(), priority: 'High', owner: 'You', contact_name: 'Marcus Ramirez', crm_profile_url: '#' },
  { id: 'd2', business_id: 'bay', title: 'Send pre-approval letter', task_type: 'Email', due_at: new Date(Date.now() + 3 * 3600000).toISOString(), priority: 'Normal', owner: 'You', contact_name: 'Priya Nair', crm_profile_url: '#' },
  { id: 'd3', business_id: 'mpg', title: 'Follow up on MPG proposal', task_type: 'Email', due_at: new Date(Date.now() + 26 * 3600000).toISOString(), priority: 'High', owner: 'You', contact_name: 'Northline Retail', crm_profile_url: '#' },
  { id: 'd4', business_id: 'mpg', title: 'Collect statements', task_type: 'Call', due_at: new Date(Date.now() + 5 * 86400000).toISOString(), priority: 'Low', owner: 'You', contact_name: 'Bayside Diner', crm_profile_url: '#' },
  { id: 'd5', business_id: 'bay', title: 'Order appraisal', task_type: null, due_at: null, priority: null, owner: 'You', contact_name: 'Kevin Osei', crm_profile_url: '#' },
]

function BizTag({ business_id }) {
  const mpg = business_id === 'mpg'
  return (
    <span
      className="flex-none rounded px-1.5 py-0.5 text-center text-[9.5px] font-bold tracking-wide"
      style={{
        color: mpg ? 'var(--mpg)' : 'var(--bay)',
        background: mpg ? 'var(--mpg-soft)' : 'var(--bay-soft)',
        width: 46,
      }}
    >
      {mpg ? 'MPG' : 'BAYWAY'}
    </span>
  )
}

function PriorityTag({ priority }) {
  const key = normalizePriority(priority)
  if (!key) return <span className="w-12 flex-none" />
  const m = PRIORITY_META[key]
  return (
    <span
      className="w-12 flex-none rounded px-1.5 py-0.5 text-center text-[10px] font-semibold uppercase tracking-wide"
      style={{ color: m.color, border: `1px solid ${m.border}` }}
    >
      {m.label}
    </span>
  )
}

export default function Tasks() {
  const { matches } = useBusiness()

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(!isDemoMode)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(null)
  const [hasMore, setHasMore] = useState(false)
  const [priorityFilter, setPriorityFilter] = useState('all')

  const fetchPage = useCallback(async (offset) => {
    const { data, error: err } = await supabase
      .from('v_tasks')
      .select('*')
      .order('due_at', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })
      .range(offset, offset + PER_PAGE - 1)
    if (err) throw new Error(err.message)
    return data || []
  }, [])

  const load = useCallback(async () => {
    if (isDemoMode) return
    setLoading(true)
    setError(null)
    try {
      const page = await fetchPage(0)
      setRows(page)
      setHasMore(page.length === PER_PAGE)
    } catch (e) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }, [fetchPage])

  useEffect(() => {
    load()
  }, [load])

  const loadMore = async () => {
    if (loadingMore) return
    setLoadingMore(true)
    try {
      const page = await fetchPage(rows.length)
      setRows((prev) => [...prev, ...page])
      setHasMore(page.length === PER_PAGE)
    } catch (e) {
      setError(String(e?.message || e))
    } finally {
      setLoadingMore(false)
    }
  }

  const sourceRows = isDemoMode ? DEMO_ROWS : rows
  const visible = useMemo(
    () => filterByPriority(sourceRows.filter((r) => matches(r.business_id)), priorityFilter),
    [sourceRows, matches, priorityFilter],
  )
  const groups = useMemo(() => bucketByDue(visible).filter((g) => g.rows.length > 0), [visible])
  const total = visible.length

  return (
    <div>
      <div className="flex items-center gap-3">
        <h2 className="text-[26px] font-bold tracking-tight">Tasks</h2>
        {!loading && !error && <span className="num text-[12px] text-muted">{total} open</span>}
      </div>
      <p className="mt-1 text-sm text-muted">
        Every open follow-up across both books — FollowUpBoss (Bayway) and Zoho (MPG). Read-only:
        complete tasks in the CRM and they drop off here on the next sync.
      </p>

      <div className="mt-4 flex flex-wrap gap-1">
        {PRIORITY_CHIPS.map((c) => (
          <button
            key={c.key}
            onClick={() => setPriorityFilter(c.key)}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
              priorityFilter === c.key ? 'bg-hoverbg text-white' : 'text-muted hover:text-white'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading && <div className="mt-6 text-sm text-muted">Loading tasks…</div>}

      {!loading && !error && sourceRows.length === 0 && (
        <div className="mt-6 rounded-card border border-line bg-panel px-6 py-10 text-center text-sm text-muted">
          No tasks yet — connect the task syncs (see docs/phase-tasks-setup.md).
        </div>
      )}

      {!loading && sourceRows.length > 0 && total === 0 && (
        <div className="mt-6 rounded-card border border-line bg-panel px-6 py-10 text-center text-sm text-muted">
          No open tasks match the current filters.
        </div>
      )}

      {!loading && total > 0 && (
        <div className="mt-5 space-y-5">
          {groups.map((g) => (
            <div key={g.key}>
              <div
                className="mb-2 text-[11px] font-semibold uppercase tracking-wide"
                style={{ color: BUCKET_META[g.key].color }}
              >
                {g.label}
                <span className="num ml-2 text-dim">{g.rows.length}</span>
              </div>
              <div
                className="overflow-hidden rounded-card border bg-panel"
                style={{ borderColor: g.key === 'overdue' ? BUCKET_META.overdue.border : 'var(--line)' }}
              >
                {g.rows.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0 hover:bg-hoverbg"
                  >
                    <BizTag business_id={r.business_id} />
                    <div className="num w-14 flex-none text-[12px] text-muted">
                      {dueTimeOfDay(r.due_at)}
                    </div>
                    <PriorityTag priority={r.priority} />
                    <div className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                      {r.title || '(untitled task)'}
                      {r.task_type && (
                        <span className="ml-2 text-[11px] font-normal text-dim">{r.task_type}</span>
                      )}
                    </div>
                    <div className="w-40 flex-none truncate text-[12.5px] text-muted">
                      <CrmLink url={r.crm_profile_url}>{r.contact_name || '—'}</CrmLink>
                    </div>
                    {r.owner && (
                      <div className="w-28 flex-none truncate text-right text-[11px] text-dim">
                        {r.owner}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && !isDemoMode && hasMore && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="rounded-lg border border-line2 px-4 py-1.5 text-xs font-semibold text-muted hover:text-white disabled:opacity-50"
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/Tasks.jsx
git commit -m "feat: add unified Tasks screen"
```

---

### Task 10: Wire routing, sidebar, and Sync Status

**Files:**
- Modify: `src/App.jsx:13` (import) and `src/App.jsx:44` (route)
- Modify: `src/components/Sidebar.jsx:113` (nav item)
- Modify: `src/pages/SyncStatus.jsx:7` (source labels)

- [ ] **Step 1: Add the route**

In `src/App.jsx`, after the `Reports` import:

```jsx
import Reports from './pages/Reports'
import Tasks from './pages/Tasks'
```

and after the `/reports` route:

```jsx
              <Route path="/reports" element={<Reports />} />
              <Route path="/tasks" element={<Tasks />} />
```

- [ ] **Step 2: Add the sidebar item**

In `src/components/Sidebar.jsx`, inside the OVERVIEW group, after Calendar:

```jsx
          <GroupLabel>OVERVIEW</GroupLabel>
          <Item to="/" icon="▤">Overview</Item>
          <Item to="/calendar" icon="▦">Calendar</Item>
          <Item to="/tasks" icon="✓">Tasks</Item>
          <Item to="/reports" icon="▢">Reports</Item>
```

Leave the existing **"+ New Task"** button untouched — it is the (still unbuilt) write path and is out of scope.

- [ ] **Step 3: Add the two Sync Status rows**

In `src/pages/SyncStatus.jsx`, extend `SOURCE_LABELS`:

```js
const SOURCE_LABELS = {
  fub: { label: 'FollowUpBoss (Bayway)', biz: 'bay' },
  'fub-webhook': { label: 'FollowUpBoss webhook (Bayway)', biz: 'bay' },
  'fub-activity': { label: 'FollowUpBoss activity (Bayway)', biz: 'bay' },
  'fub-tasks': { label: 'FollowUpBoss tasks (Bayway)', biz: 'bay' },
  zoho: { label: 'Zoho CRM (MPG)', biz: 'mpg' },
  'zoho-tasks': { label: 'Zoho tasks (MPG)', biz: 'mpg' },
  'outlook-mpg': { label: 'Outlook — MPG', biz: 'mpg' },
  'outlook-bayway': { label: 'Outlook — Bayway', biz: 'bay' },
}
```

- [ ] **Step 4: Verify in the running app**

Start the dev server with the preview tooling (`preview_start`, config name from `.claude/launch.json`, port 5199 — do **not** run it via a shell tool). Then:
1. `read_page` on `http://localhost:5199/tasks` — expect the "Tasks" heading, the priority chips, and the demo rows grouped Overdue / Today / Tomorrow / Upcoming / No due date.
2. Click the sidebar **Tasks** item and confirm it activates (the active nav item gets the `grad-dual-soft` treatment).
3. Switch the global filter to MPG, then Bayway, and confirm the row count and `BizTag` values change accordingly.
4. `read_console_messages` — expect no errors.

- [ ] **Step 5: Run tests and build**

Run: `npm test && npm run build`
Expected: all tests pass; build completes with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx src/components/Sidebar.jsx src/pages/SyncStatus.jsx
git commit -m "feat: route /tasks, add sidebar item, and add task sync health rows"
```

---

### Task 11: Setup doc + live deploy

**Files:**
- Create: `docs/phase-tasks-setup.md`

- [ ] **Step 1: Write the doc**

````markdown
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
- **Done status:** `zohoTaskIsCompleted` treats `Status === 'Completed'`
  (case-insensitive) as done. Confirm your org's picklist uses that value.
- **`Due_Date` format:** stored straight into a `timestamptz`. If Zoho returns
  a bare `YYYY-MM-DD`, Postgres reads it as local midnight — which is exactly
  what the screen's day-granularity bucketing expects.
- **`Who_Id` / `What_Id`:** contact and deal resolution. `What_Id` is
  polymorphic; the mapper trusts `$se_module === 'Deals'` when present.

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
- Until `ZOHO_CLIENT_ID` / `ZOHO_CLIENT_SECRET` / `ZOHO_REFRESH_TOKEN` are set,
  `zoho-task-sync` logs a "credentials not set" error row every run — expected,
  and visible on Sync Status exactly like `zoho-sync`. MPG tasks appear the
  moment Zoho is switched on.
- Both jobs run every 15 minutes (`fub-task-sync-15min`,
  `zoho-task-sync-15min`).
````

- [ ] **Step 2: Commit**

```bash
git add docs/phase-tasks-setup.md
git commit -m "docs: add task sync setup and first-run verification guide"
```

- [ ] **Step 3: Deploy and apply for real (requires the operator)**

Run the deploy commands and migrations from the doc above, then trigger the two
manual runs. Report back:
- the `fub-tasks` row on Sync Status (ok / error, count, message);
- the `zoho-tasks` row (expected: error, "Zoho credentials not set…" until the
  secrets land);
- whether `/tasks` renders live FUB rows.

If the FUB run errors, read `sync_log.message` and apply the §4 checklist above
before changing anything else — the mapper field names are the likely culprit,
not the plumbing.

---

### Task 12: Final verification and PR

- [ ] **Step 1: Full suite + build**

Run: `npm test && npm run build`
Expected: every test file passes; `vite build` writes `dist/` with no errors.

- [ ] **Step 2: Confirm nothing live was disturbed**

Run: `git diff main --stat`
Expected: the only modified (as opposed to added) files are `src/App.jsx`,
`src/components/Sidebar.jsx`, `src/pages/SyncStatus.jsx`, and
`supabase/functions/_shared/zoho.ts` (two `export` keywords). If `fub-sync`,
`fub-activity-sync`, `zoho-sync`, or any migration `0001`–`0016` shows up,
stop and revert that file.

- [ ] **Step 3: Open the PR**

```bash
git push -u origin HEAD
gh pr create --title "feat: unified Tasks screen (FollowUpBoss + Zoho)" --body "Adds a global /tasks screen listing every open follow-up across both books.

- \`tasks\` table + \`v_tasks\` view (open tasks only, security_invoker)
- \`fub-task-sync\` and \`zoho-task-sync\` edge functions, 15-min pg_cron each
- Pure, unit-tested bucketing in \`src/lib/tasks.js\` (Overdue / Today / Tomorrow / Upcoming / No due date)
- Sidebar item, route, and two new Sync Status health rows
- Setup + first-run field-verification doc

Read-only: no write-back, no in-app completion. Existing syncs untouched apart from exporting two helpers in \`_shared/zoho.ts\`."
```

Merge normally once green — the old Netlify single-contributor rebase rule no
longer applies (the project is on Vercel).

---

## Out of scope (do not build)

- Write-back to FUB/Zoho, or completing a task from the dashboard.
- Completed-task history (the Activity feed already carries past touches).
- Per-assignee filtering.
- An Overview "tasks due" widget — easy follow-on once `v_tasks` exists.
- Reminders / notifications on due tasks.
- The sidebar's existing "+ New Task" button.
