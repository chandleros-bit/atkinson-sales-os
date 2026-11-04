# Chandler's Daily Briefing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Email Chandler a briefing at 7:30 AM Central, Monday to Friday, from `chandler.dashboard@gmail.com` to `chandler@baywayhtx.com`. It covers both books: numbers, today, who to call first, and what is slipping.

**Architecture:**
- All briefing logic is pure JS in `src/lib/` and is unit-tested with Vitest. It reuses the app's own builders (`buildQueue`, `buildDialList`, `buildAlerts`, `monthlyGoals`, `forecastLines`, `syncHealth`), so the email and the app agree.
- Those modules use extensionless imports, which Deno rejects. So a small esbuild script bundles them into one ESM file, `supabase/functions/daily-briefing/briefing.bundle.js`. That file is committed, and a test fails if it goes stale.
- A Deno edge function `daily-briefing` does three things: it loads data with the service role, calls the bundle, and sends through Gmail SMTP on port 465.
- pg_cron fires the function at 12:30 and 13:30 UTC on weekdays. The function sends only when it is 7:xx in Chicago, and only once per day.

**Tech Stack:** React 18 / Vite app code (pure modules only), esbuild 0.21.5 (already in `node_modules`), Supabase Edge Functions (Deno) with `denomailer`, pg_cron + pg_net, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-03-temperature-forecast-briefings-design.md`, section 3, "Chandler's briefing". The assistant briefing and login are step 3 and **not** in this plan.

**Known limits, accepted:**
1. **Time zone.**
   - The edge runtime's local time zone is UTC. The reused builders read local dates and hours, but at 12:30–13:30 UTC the UTC date equals the Chicago date, so day counts and "today" agree.
   - Hour-based details can differ by the UTC offset: a call-cadence "later today" time, and the day of an activity logged after about 6–7 PM Central.
   - The email only shows counts and the top five, so this is accepted. All tests use timestamps well away from midnight, so they pass in any `TZ`.
2. **Port 465 may be blocked.**
   - Supabase blocks outbound SMTP on ports 25 and 587. Port 465 is not documented either way. Task 11 probes it before anything is scheduled.
   - If 465 is blocked, Task 10 swaps the sender for Gmail's HTTPS API. The briefing logic doesn't change.

**Production:** Tasks 1–10 change no production system. Task 11 needs Chandler: a Gmail app password, setting secrets, and an OK to deploy, apply migration 0055 and merge.

---

## Setup

Use the worktree `C:\Users\Chandler\.claude\projects\atkinson-sales-os-phase1\.claude\worktrees\sync-health-poll`, branch `feat/daily-briefing`, cut from `main` at `61bb110`. `node_modules` is linked. The baseline must be green:

```bash
npx vitest run
```

Expected: 96 files pass, with 2 unhandled errors that were there before (the `useSyncHealth` `.limit` mock gap).

## File map

| File | Status | Responsibility |
|---|---|---|
| `supabase/migrations/0055_daily_briefing.sql` | create | `briefings` settings row; two pg_cron jobs |
| `src/lib/forecast.js` (+ test) | modify | Move the pure `latestMpgMetrics` here from `useForecastInputs.js` |
| `src/lib/useForecastInputs.js` | modify | Import `latestMpgMetrics` from `forecast.js` |
| `src/lib/briefingTime.js` (+ test) | create | Chicago date and hour, send window, day windows, business days left |
| `src/lib/briefingScorecard.js` (+ test) | create | `callConnected`, yesterday's scorecard, "need N per business day" |
| `src/lib/briefing.js` (+ test) | create | `buildOwnerBriefing(data, now)`, the email's content model |
| `src/lib/briefingEmail.js` (+ test) | create | `renderOwnerBriefing(model, opts)` returning `{ subject, text, html }` |
| `src/lib/briefingEntry.js` | create | What the bundle exports |
| `scripts/build-briefing.mjs`, `package.json` | create/modify | esbuild bundle; `npm run build:briefing` |
| `src/lib/briefingBundle.test.js` | create | Fails if the committed bundle is stale |
| `supabase/functions/daily-briefing/briefing.bundle.js` | generated | Committed bundle |
| `supabase/functions/_shared/gmail-smtp.ts` | create | `sendGmail({ to, subject, text, html })` over SMTP 465 |
| `supabase/functions/daily-briefing/index.ts` | create | Load data, check window and dedupe, build, render, send, log |
| `src/pages/SyncStatus.jsx` (+ render test) | modify | Show the `briefing-owner` source |

---

### Task 1: Migration 0055 (settings row + schedule)

**Files:**
- Create: `supabase/migrations/0055_daily_briefing.sql`

- [ ] **Step 1: Write the migration**

The cron jobs use the same anon bearer and `net.http_post` pattern as `0038_fub_sync_every_2min.sql`. Copy the bearer string exactly from that file. It is the public anon key, already committed.

```sql
-- Daily briefing (spec 2026-11-03, section 3). Chandler's 7:30 AM email.
-- pg_cron runs in UTC, so two jobs cover both sides of DST (12:30 UTC in
-- CDT, 13:30 UTC in CST); the function sends only when it is 7:xx in
-- America/Chicago and only once per day (sync_log 'briefing-owner').
-- Bearer is the public ANON key (as 0002 / 0038); the function runs with
-- --no-verify-jwt.

insert into public.settings (key, value)
values (
  'briefings',
  '{
    "enabled": true,
    "owner_email": "chandler@baywayhtx.com",
    "assistant_email": "shelby@baywayhtx.com",
    "app_url": "https://atkinson-sales-os.vercel.app"
  }'::jsonb
)
on conflict (key) do nothing;

select cron.unschedule(jobname)
from cron.job
where jobname in ('daily-briefing-1230utc', 'daily-briefing-1330utc');

select cron.schedule(
  'daily-briefing-1230utc',
  '30 12 * * 1-5',
  $job$
  select net.http_post(
    url := 'https://cnmipfxwqnbtkohfixkf.supabase.co/functions/v1/daily-briefing',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubWlwZnh3cW5idGtvaGZpeGtmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2Mzc5NjYsImV4cCI6MjA5OTIxMzk2Nn0.tcOKs7O5gGAT2HsfiKKwI90TQ-CYVXSMB4yL9RvuxJU',
      'Content-Type', 'application/json'
    )
  );
  $job$
);

select cron.schedule(
  'daily-briefing-1330utc',
  '30 13 * * 1-5',
  $job$
  select net.http_post(
    url := 'https://cnmipfxwqnbtkohfixkf.supabase.co/functions/v1/daily-briefing',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubWlwZnh3cW5idGtvaGZpeGtmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2Mzc5NjYsImV4cCI6MjA5OTIxMzk2Nn0.tcOKs7O5gGAT2HsfiKKwI90TQ-CYVXSMB4yL9RvuxJU',
      'Content-Type', 'application/json'
    )
  );
  $job$
);
```

The bearer is the same public anon key used in `0038_fub_sync_every_2min.sql` (already committed there). Verify they match: `diff <(grep -o "Bearer eyJ[^']*" supabase/migrations/0038_fub_sync_every_2min.sql | head -1) <(grep -o "Bearer eyJ[^']*" supabase/migrations/0055_daily_briefing.sql | head -1)` prints nothing.

- [ ] **Step 2: Commit (not applied; that is Task 11)**

```bash
git add supabase/migrations/0055_daily_briefing.sql
git commit -m "feat: briefings settings row and 7:30 AM schedule (not applied)"
```

---

### Task 2: Move `latestMpgMetrics` into `forecast.js`

The briefing needs the MPG residual-per-account inputs. `useForecastInputs.js` imports the Supabase client, so it can't be bundled. Move the pure helper.

**Files:**
- Modify: `src/lib/forecast.js` (add an export)
- Modify: `src/lib/useForecastInputs.js` (delete the local function and import it)
- Test: `src/lib/forecast.test.js`

- [ ] **Step 1: Write the failing test** (append to `src/lib/forecast.test.js` and add `latestMpgMetrics` to its import)

```js
describe('latestMpgMetrics', () => {
  it('takes the newest date that has both residual and merchants', () => {
    const rows = [
      { date: '2026-11-01', metric_key: 'rev_monthly_residual', value: 900 },
      { date: '2026-10-01', metric_key: 'rev_monthly_residual', value: 800 },
      { date: '2026-10-01', metric_key: 'rev_active_merchants', value: 4 },
    ]
    expect(latestMpgMetrics(rows)).toEqual({ residual: 800, merchants: 4 })
  })
  it('is null/null with no shared date', () => {
    expect(latestMpgMetrics([{ date: '2026-11-01', metric_key: 'rev_monthly_residual', value: 1 }])).toEqual({ residual: null, merchants: null })
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/forecast.test.js`
Expected: FAIL with "latestMpgMetrics is not a function" (or "not exported").

- [ ] **Step 3: Move the function**

Cut `latestMpgMetrics` and its comment out of `src/lib/useForecastInputs.js`, and paste it at the end of `src/lib/forecast.js` as `export function latestMpgMetrics(rows) { … }`, with the body unchanged. In `useForecastInputs.js`, add `latestMpgMetrics` to the existing `import { … } from './forecast'` line.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/forecast.test.js src/lib/useForecastInputs.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/forecast.js src/lib/forecast.test.js src/lib/useForecastInputs.js
git commit -m "refactor: latestMpgMetrics lives in forecast.js (pure)"
```

---

### Task 3: Chicago time helpers

**Files:**
- Create: `src/lib/briefingTime.js`
- Test: `src/lib/briefingTime.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest'
import { chicagoParts, shouldSend, chicagoDayRangeUtc, businessDaysLeft, longDateLabel } from './briefingTime'

// UTC instants; Chicago is UTC-5 in CDT (until Nov 1 2026) and UTC-6 in CST.
const at = (iso) => new Date(iso).getTime()

describe('chicagoParts', () => {
  it('reads date, hour and weekday in America/Chicago', () => {
    expect(chicagoParts(at('2026-11-04T13:30:00Z'))).toEqual({ dateKey: '2026-11-04', hour: 7, minute: 30, weekday: 3 })
    expect(chicagoParts(at('2026-10-28T12:30:00Z'))).toEqual({ dateKey: '2026-10-28', hour: 7, minute: 30, weekday: 3 })
    expect(chicagoParts(at('2026-11-05T03:00:00Z'))).toMatchObject({ dateKey: '2026-11-04', hour: 21 })
  })
})

describe('shouldSend', () => {
  it('only on weekdays at 7:xx Chicago', () => {
    expect(shouldSend(at('2026-11-04T13:30:00Z'))).toBe(true) // Wed 7:30 CST
    expect(shouldSend(at('2026-11-04T12:30:00Z'))).toBe(false) // Wed 6:30 CST
    expect(shouldSend(at('2026-10-28T12:30:00Z'))).toBe(true) // Wed 7:30 CDT
    expect(shouldSend(at('2026-10-28T13:30:00Z'))).toBe(false) // Wed 8:30 CDT
    expect(shouldSend(at('2026-11-07T13:30:00Z'))).toBe(false) // Saturday
  })
})

describe('chicagoDayRangeUtc', () => {
  it('gives the UTC ISO bounds of a Chicago calendar day, with an offset in days', () => {
    expect(chicagoDayRangeUtc(at('2026-11-04T13:30:00Z'))).toEqual({ from: '2026-11-04T06:00:00.000Z', to: '2026-11-05T06:00:00.000Z' })
    expect(chicagoDayRangeUtc(at('2026-11-04T13:30:00Z'), -1)).toEqual({ from: '2026-11-03T06:00:00.000Z', to: '2026-11-04T06:00:00.000Z' })
    // Across the DST change: Sunday Nov 1 2026 is 25 hours long.
    expect(chicagoDayRangeUtc(at('2026-11-02T13:30:00Z'), -1)).toEqual({ from: '2026-11-01T05:00:00.000Z', to: '2026-11-02T06:00:00.000Z' })
  })
})

describe('businessDaysLeft', () => {
  it('counts Mon-Fri from today (inclusive) to month end, Chicago calendar', () => {
    expect(businessDaysLeft(at('2026-11-04T13:30:00Z'))).toBe(19) // Nov 4-30 2026
    expect(businessDaysLeft(at('2026-11-30T13:30:00Z'))).toBe(1)
  })
})

describe('longDateLabel', () => {
  it('formats the subject date', () => {
    expect(longDateLabel(at('2026-11-03T13:30:00Z'))).toBe('Tue Nov 3')
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/briefingTime.test.js`
Expected: FAIL, the module isn't found.

- [ ] **Step 3: Implement**

```js
// America/Chicago calendar math for the daily briefing (spec 2026-11-03,
// section 3). The edge function runs in UTC, so nothing here uses the host's
// local time zone: every answer comes from Intl with timeZone America/Chicago.
const TZ = 'America/Chicago'
const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

const parts = (t) =>
  Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
    })
      .formatToParts(new Date(t))
      .map((p) => [p.type, p.value]),
  )

// { dateKey 'YYYY-MM-DD', hour 0-23, minute, weekday 0=Sun }
export function chicagoParts(now = Date.now()) {
  const p = parts(now)
  return { dateKey: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute), weekday: WEEKDAY[p.weekday] }
}

// Weekdays, 7:00-7:59 Chicago. pg_cron fires at 12:30 and 13:30 UTC; exactly
// one of them lands in this window on any date, DST or not.
export function shouldSend(now = Date.now()) {
  const { hour, weekday } = chicagoParts(now)
  return weekday >= 1 && weekday <= 5 && hour === 7
}

// UTC offset (minutes) of Chicago at instant t.
function offsetMinutes(t) {
  const p = parts(t)
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute))
  return Math.round((asUtc - Math.floor(t / 60000) * 60000) / 60000)
}

// UTC instant of local midnight for a Chicago 'YYYY-MM-DD'.
function midnightUtc(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number)
  const guess = Date.UTC(y, m - 1, d)
  // Two passes settle the offset on DST days.
  let t = guess - offsetMinutes(guess) * 60000
  t = guess - offsetMinutes(t) * 60000
  return t
}

const addDays = (dateKey, n) => {
  const [y, m, d] = dateKey.split('-').map(Number)
  const x = new Date(Date.UTC(y, m - 1, d + n))
  return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`
}
const pad = (n) => String(n).padStart(2, '0')

// { from, to } UTC ISO strings bounding a Chicago calendar day (today + offset).
export function chicagoDayRangeUtc(now = Date.now(), offsetDays = 0) {
  const key = addDays(chicagoParts(now).dateKey, offsetDays)
  return { from: new Date(midnightUtc(key)).toISOString(), to: new Date(midnightUtc(addDays(key, 1))).toISOString() }
}

// Chicago 'YYYY-MM-DD' for today + offset.
export function chicagoDateKey(now = Date.now(), offsetDays = 0) {
  return addDays(chicagoParts(now).dateKey, offsetDays)
}

// Mon-Fri days from today (inclusive) to the end of this Chicago month.
export function businessDaysLeft(now = Date.now()) {
  const today = chicagoParts(now).dateKey
  const [y, m] = today.split('-').map(Number)
  let n = 0
  for (let key = today; Number(key.slice(5, 7)) === m && Number(key.slice(0, 4)) === y; key = addDays(key, 1)) {
    const [yy, mm, dd] = key.split('-').map(Number)
    const wd = new Date(Date.UTC(yy, mm - 1, dd)).getUTCDay()
    if (wd >= 1 && wd <= 5) n += 1
  }
  return n
}

// 'Tue Nov 3' in Chicago.
export function longDateLabel(now = Date.now()) {
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(now)).replace(',', '')
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run src/lib/briefingTime.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/briefingTime.js src/lib/briefingTime.test.js
git commit -m "feat: Chicago time helpers for the daily briefing"
```

---

### Task 4: Scorecard helpers

**Files:**
- Create: `src/lib/briefingScorecard.js`
- Test: `src/lib/briefingScorecard.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest'
import { callConnected, yesterdayScorecard, needPerDay } from './briefingScorecard'

describe('callConnected (mirrors public.call_connected, migration 0049)', () => {
  it('FUB outcome, Zoho result or subject, or 2+ minutes', () => {
    expect(callConnected({ outcome: 'Interested' })).toBe(true)
    expect(callConnected({ outcome: 'Not Interested' })).toBe(true)
    expect(callConnected({ Call_Result: 'Not interested' })).toBe(true)
    expect(callConnected({ Subject: 'Call: Interested' })).toBe(true)
    expect(callConnected({ duration: '120' })).toBe(true)
    expect(callConnected({ duration: 119 })).toBe(false)
    expect(callConnected({ duration: '119' })).toBe(false)
    expect(callConnected({ Call_Duration: '2:00' })).toBe(true)
    expect(callConnected({ Call_Duration: '1:59' })).toBe(false)
    expect(callConnected({ outcome: 'No Answer' })).toBe(false)
    expect(callConnected(null)).toBe(false)
  })
})

describe('yesterdayScorecard', () => {
  it('counts outbound calls, connects, texts and new applications', () => {
    const acts = [
      { type: 'call', direction: 'outbound', raw: { outcome: 'Interested' } },
      { type: 'call', direction: 'outbound', raw: { outcome: 'No Answer' } },
      { type: 'call', direction: 'inbound', raw: { outcome: 'Interested' } },
      { type: 'text', direction: 'outbound', raw: {} },
    ]
    const apps = [{ stage: 'Application Received', stage_since: '2026-11-03T15:00:00Z' }]
    expect(yesterdayScorecard({ activities: acts, newApplications: apps })).toEqual({ calls: 2, connects: 1, texts: 1, applications: 1 })
  })
})

describe('needPerDay', () => {
  it('is null when hit or no target, else ceil(remaining / business days left)', () => {
    expect(needPerDay({ value: 50, target: 0 }, 10)).toBe(null)
    expect(needPerDay({ value: 120, target: 100 }, 10)).toBe(null)
    expect(needPerDay({ value: 40, target: 100 }, 19)).toBe(4)
    expect(needPerDay({ value: 40, target: 100 }, 0)).toBe(60)
  })
})
```

A numeric `duration` is read as text, like SQL's `raw->>'duration'`, so `119` and `'119'` both give `false`.

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/briefingScorecard.test.js`
Expected: FAIL, the module isn't found.

- [ ] **Step 3: Implement**

```js
// Yesterday's numbers for the daily briefing. callConnected mirrors the SQL
// public.call_connected (migration 0049); keep the two in sync.
const CONNECT_OUTCOMES = new Set(['Interested', 'Not Interested'])
const ZOHO_RESULTS = new Set(['Interested', 'Not interested'])
const ZOHO_SUBJECTS = new Set(['Call: Interested', 'Call: Not Interested'])

export function callConnected(raw) {
  if (!raw) return false
  if (CONNECT_OUTCOMES.has(raw.outcome ?? '')) return true
  if (ZOHO_RESULTS.has(raw.Call_Result ?? '')) return true
  if (ZOHO_SUBJECTS.has(raw.Subject ?? '')) return true
  const d = String(raw.duration ?? '')
  if (/^\d+$/.test(d) && Number(d) >= 120) return true
  const m = /^(\d+):(\d{2})$/.exec(String(raw.Call_Duration ?? ''))
  if (m && Number(m[1]) * 60 + Number(m[2]) >= 120) return true
  return false
}

// activities: yesterday's activities ({ type, direction, raw });
// newApplications: board rows that entered Application Received yesterday.
export function yesterdayScorecard({ activities = [], newApplications = [] }) {
  const out = activities.filter((a) => a.direction === 'outbound')
  const calls = out.filter((a) => a.type === 'call')
  return {
    calls: calls.length,
    connects: calls.filter((a) => callConnected(a.raw)).length,
    texts: out.filter((a) => a.type === 'text').length,
    applications: newApplications.length,
  }
}

// "Need N per business day" for a goal that's behind; null when hit or untargeted.
export function needPerDay(goal, daysLeft) {
  const target = Number(goal?.target || 0)
  const value = Number(goal?.value || 0)
  if (!target || value >= target) return null
  return Math.ceil((target - value) / Math.max(1, daysLeft))
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run src/lib/briefingScorecard.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/briefingScorecard.js src/lib/briefingScorecard.test.js
git commit -m "feat: briefing scorecard helpers (connects, need per day)"
```

---

### Task 5: The briefing content model

**Files:**
- Create: `src/lib/briefing.js`
- Test: `src/lib/briefing.test.js`

`buildOwnerBriefing(data, now)` is pure. The input `data` is exactly what the edge function loads (Task 8):

```
{
  rules,            // priority_rules setting, raw (resolved here)
  targets,          // metric_targets setting, raw (resolved here)
  rates,            // arive setting, raw (resolved here)
  forecastSettings, // forecast setting, raw (resolved here)
  metrics,          // metrics_daily rows since last month's 1st: { date, business_id, metric_key, value }
  deals,            // Bayway deals: { status, value, expected_close, business_id }
  activities,       // outbound call/text/email since last month's 1st: { occurred_at, type, business_id }
  yesterdayActivities, // yesterday's (Chicago) activities: { type, direction, raw }
  pipeline,         // v_active_pipeline Bayway rows incl. stage_since, docs_*, open_task_count, oldest_open_due_at, crm_created_at, last_outbound_call_at
  loans,            // loans rows (LOAN_COLUMNS)
  ratings,          // lead_ratings rows with contact:{ name } embedded
  signals,          // v_lead_signals rows
  dialRows,         // v_dial_contacts rows
  dialSkips,        // contact ids skipped today
  mpgTasks,         // open MPG v_tasks rows
  workItems,        // open work_items rows (with contact_name)
  events,           // today's calendar_events rows
  syncLatest,       // { [source]: { ran_at, status } } for CORE_SOURCES
}
```

It returns:

```
{
  dateLabel, // 'Tue Nov 3'
  numbers: {
    goals: [{ id, label, value, target, status, unit, needPerDay }],
    forecast: { expected, funded, weighted, mpgAccounts, mpgExpected },
    scorecard: { calls, connects, texts, applications },
  },
  today: { meetings: [{ time, title, book }], closings: { count, top: [{ name, date }] } },
  callFirst: {
    replied:   { count, top: [{ name, detail }] },
    newLeads:  { count, top },
    cadence:   { bay, mpg },
    overdue:   { count, top },
    hotCold:   { count, top },
  },
  slipping: {
    quietApps, docsAging, statementsLate,  // { count, top: [{ name, detail }] }
    syncProblems: [{ label, text }],
  },
  callFirstCount,  // replied + newLeads + overdue + hotCold (for the subject line)
  nothingSlipping, // true when every slipping list is empty
}
```

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest'
import { buildOwnerBriefing } from './briefing'

// Wed Nov 4 2026, 7:30 AM CST. Data timestamps sit mid-day UTC so the test
// passes in any TZ.
const NOW = new Date('2026-11-04T13:30:00Z').getTime()
const iso = (s) => new Date(s).toISOString()

const base = () => ({
  rules: null,
  targets: { calls: 100, applications: 10 },
  rates: { primary_pct: 1.25, assisted_pct: 0.75 },
  forecastSettings: null,
  metrics: [],
  deals: [],
  activities: [
    { occurred_at: iso('2026-11-03T16:00:00Z'), type: 'call', business_id: 'bay' },
    { occurred_at: iso('2026-11-02T16:00:00Z'), type: 'call', business_id: 'mpg' },
  ],
  yesterdayActivities: [
    { type: 'call', direction: 'outbound', raw: { outcome: 'Interested' } },
    { type: 'call', direction: 'outbound', raw: { outcome: 'No Answer' } },
  ],
  pipeline: [
    { id: 'p1', business_id: 'bay', name: 'Ann App', stage: 'Application Received', stage_since: iso('2026-11-03T15:00:00Z'), open_task_count: 0, docs_outstanding_count: 0 },
  ],
  loans: [
    { id: 1, borrower_name: 'Cal Close', role: 'primary', amount: 400000, stage_group: 'closing', firm_closing_on: '2026-11-06', funded_on: null, contact_id: null, comp_override: null, scenario_auto: false, scenario_override: null },
  ],
  ratings: [],
  signals: [
    { id: 's1', business_id: 'bay', name: 'Rita Reply', stage: 'Contacted/Working', is_active: true, last_inbound_at: iso('2026-11-03T20:00:00Z'), last_outbound_at: iso('2026-11-03T15:00:00Z'), open_task_count: 1, oldest_open_due_at: iso('2026-11-10T15:00:00Z'), crm_created_at: iso('2026-01-01T15:00:00Z') },
    { id: 's2', business_id: 'mpg', name: 'Oscar Overdue', stage: 'Pending', is_active: true, last_outbound_at: iso('2026-11-03T15:00:00Z'), open_task_count: 1, oldest_open_due_at: iso('2026-11-01T15:00:00Z'), crm_created_at: iso('2026-01-01T15:00:00Z') },
  ],
  dialRows: [],
  dialSkips: [],
  mpgTasks: [],
  workItems: [],
  events: [{ id: 'e1', source_account: 'mpg', title: 'Deli review', starts_at: iso('2026-11-04T16:00:00Z'), is_all_day: false }],
  syncLatest: {
    fub: { ran_at: iso('2026-11-04T13:28:00Z'), status: 'ok' },
    zoho: { ran_at: iso('2026-11-04T13:15:00Z'), status: 'ok' },
    'outlook-mpg': { ran_at: iso('2026-11-04T13:15:00Z'), status: 'error' },
    'outlook-bayway': { ran_at: iso('2026-11-04T13:15:00Z'), status: 'ok' },
  },
})

describe('buildOwnerBriefing', () => {
  it('builds every section from the app logic', () => {
    const b = buildOwnerBriefing(base(), NOW)
    expect(b.dateLabel).toBe('Wed Nov 4')
    // Goals: calls and applications are targeted; commission and residual are never listed.
    expect(b.numbers.goals.map((g) => g.id)).toEqual(expect.arrayContaining(['calls', 'applications']))
    expect(b.numbers.goals.map((g) => g.id)).not.toContain('commission')
    expect(b.numbers.goals.map((g) => g.id)).not.toContain('residual')
    expect(b.numbers.goals.find((g) => g.id === 'calls').needPerDay).toBeGreaterThan(0)
    expect(b.numbers.scorecard).toEqual({ calls: 2, connects: 1, texts: 0, applications: 1 })
    // Closing Friday at 95% of 400,000 x 1.25% = 4,750 this month.
    expect(b.today.closings).toEqual({ count: 1, top: [{ name: 'Cal Close', date: '2026-11-06' }] })
    expect(b.numbers.forecast.expected).toBe(4750)
    expect(b.today.meetings).toHaveLength(1)
    expect(b.today.meetings[0]).toMatchObject({ title: 'Deli review', book: 'mpg' })
    expect(b.callFirst.replied.top.map((r) => r.name)).toEqual(['Rita Reply'])
    expect(b.callFirst.overdue.top.map((r) => r.name)).toEqual(['Oscar Overdue'])
    expect(b.slipping.syncProblems.map((s) => s.label)).toEqual(['Outlook MPG'])
    expect(b.callFirstCount).toBe(2)
    expect(b.nothingSlipping).toBe(false)
  })

  it('caps every list at five but keeps the full count', () => {
    const d = base()
    d.signals = Array.from({ length: 8 }, (_, i) => ({
      id: `o${i}`, business_id: 'mpg', name: `Lead ${i}`, stage: 'Pending', is_active: true,
      last_outbound_at: iso('2026-11-03T15:00:00Z'), open_task_count: 1, oldest_open_due_at: iso('2026-10-30T15:00:00Z'), crm_created_at: iso('2026-01-01T15:00:00Z'),
    }))
    const b = buildOwnerBriefing(d, NOW)
    expect(b.callFirst.overdue.count).toBe(8)
    expect(b.callFirst.overdue.top).toHaveLength(5)
  })

  it('reports nothing slipping on a quiet day', () => {
    const d = base()
    d.syncLatest['outlook-mpg'].status = 'ok'
    const b = buildOwnerBriefing(d, NOW)
    expect(b.nothingSlipping).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/briefing.test.js`
Expected: FAIL, the module isn't found.

- [ ] **Step 3: Implement**

```js
// Chandler's daily briefing (spec 2026-11-03, section 3): the email's content,
// built with the same pure logic the app uses so the two always agree. Pure,
// no I/O; the daily-briefing edge function loads `data` and renders the result.
import { buildQueue, resolveRules, reasonText } from './priorityQueue'
import { buildDialList } from './dialList'
import { buildAlerts } from './alerts'
import { monthValues, monthlyGoals, prevMonthWindow } from './overviewDash'
import { DEFAULT_TARGETS, resolveTargets, monthWindow, sprintWindow } from './reports'
import { loanStats, resolveRates, isOpen, isScenario } from './loans'
import { resolveForecast, forecastLines, forecastByMonth, avgFundedLoan, mpgPerAccount, latestMpgMetrics, monthKeyOf } from './forecast'
import { syncHealth } from './syncHealth'
import { yesterdayScorecard, needPerDay } from './briefingScorecard'
import { businessDaysLeft, longDateLabel, chicagoDateKey } from './briefingTime'

const TOP = 5
// Goals shown in the briefing (Overview goals minus commission and residual).
const GOAL_IDS = ['calls', 'applications', 'closings', 'merchants', 'proposals']
const WORK_STAGES = new Set(['Contacted/Working', 'Application Received', 'Disclosed'])

const list = (rows, toItem) => ({ count: rows.length, top: rows.slice(0, TOP).map(toItem) })

function ratingsMap(rows) {
  return new Map((rows || []).map((r) => [r.contact_id, { ...r, name: r.contact?.name ?? null }]))
}

export function buildOwnerBriefing(data, now = Date.now()) {
  const rules = resolveRules(data.rules)
  const targets = resolveTargets(DEFAULT_TARGETS, data.targets)
  const rates = resolveRates(data.rates)
  const fs = resolveForecast(data.forecastSettings)

  // ---- Numbers ------------------------------------------------------------
  const stats = data.loans?.length
    ? loanStats(data.loans, rates, { month: monthWindow(now), prev: prevMonthWindow(now), sprint: sprintWindow() })
    : null
  const values = monthValues({ biz: 'all', metrics: data.metrics || [], deals: data.deals || [], activities: data.activities || [], pipeline: data.pipeline || [], now, loanStats: stats })
  const daysLeft = businessDaysLeft(now)
  const goals = monthlyGoals({ biz: 'all', values, targets, now }).goals
    .filter((g) => GOAL_IDS.includes(g.id))
    .map((g) => ({ id: g.id, label: g.label, value: g.value, target: g.target, status: g.status, unit: g.unit, needPerDay: g.status === 'behind' ? needPerDay(g, daysLeft) : null }))

  const lines = forecastLines({
    ratings: ratingsMap(data.ratings),
    loans: data.loans || [],
    rates,
    settings: fs,
    avgLoan: avgFundedLoan(data.loans || [], now),
    mpgAccount: mpgPerAccount(latestMpgMetrics(data.metrics || []), fs),
    now,
  })
  const f = forecastByMonth(lines, monthKeyOf(now))

  const yesterday = chicagoDateKey(now, -1)
  const newApplications = (data.pipeline || []).filter(
    (r) => r.stage === 'Application Received' && r.stage_since && chicagoDateKey(new Date(r.stage_since).getTime()) === yesterday,
  )
  const scorecard = yesterdayScorecard({ activities: data.yesterdayActivities || [], newApplications })

  // ---- Today --------------------------------------------------------------
  const meetings = (data.events || [])
    .slice()
    .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)))
    .map((e) => ({ time: e.is_all_day ? 'All day' : e.starts_at, title: e.title || '(no title)', book: String(e.source_account || '').includes('mpg') ? 'mpg' : 'bay' }))
  const today = chicagoDateKey(now)
  const weekOut = chicagoDateKey(now, 6)
  const closingRows = (data.loans || [])
    .filter((l) => !isScenario(l) && isOpen(l) && l.firm_closing_on && l.firm_closing_on >= today && l.firm_closing_on <= weekOut)
    .sort((a, b) => a.firm_closing_on.localeCompare(b.firm_closing_on))

  // ---- Call first ---------------------------------------------------------
  const queue = buildQueue(data.signals || [], rules, now)
  const inBucket = (id) => queue.filter((r) => r.bucket === id)
  const person = (r) => ({ name: r.name || '(no name)', detail: reasonText(r, now) })
  const dial = buildDialList(data.dialRows || [], { now, skips: new Set(data.dialSkips || []) })
  const due = dial.dueNow.concat(dial.laterToday)
  const callFirst = {
    replied: list(inBucket('reached_out'), person),
    newLeads: list(inBucket('new_lead'), person),
    cadence: { bay: due.filter((i) => i.book === 'bay').length, mpg: due.filter((i) => i.book === 'mpg').length },
    overdue: list(inBucket('overdue'), person),
    hotCold: list(inBucket('hot_cold'), person),
  }

  // ---- Slipping -----------------------------------------------------------
  const alerts = buildAlerts({
    queue,
    signals: data.signals || [],
    pipeline: (data.pipeline || []).filter((r) => WORK_STAGES.has(r.stage)),
    tasks: data.mpgTasks || [],
    workItems: data.workItems || [],
    rules,
    now,
  })
  const alertList = (id) => {
    const a = alerts.find((x) => x.id === id)
    if (!a) return { count: 0, top: [] }
    const people = a.people.concat(a.rest || [])
    return { count: a.count, top: people.slice(0, TOP).map((p) => ({ name: p.name, detail: p.detail })) }
  }
  const health = syncHealth(data.syncLatest || {}, now)
  const syncProblems = health.detail.filter((d) => d.state === 'error' || d.state === 'stale').map((d) => ({ label: d.label, text: d.text }))
  const slipping = {
    quietApps: alertList('quiet_apps'),
    docsAging: alertList('docs_aging'),
    statementsLate: alertList('statements_late'),
    syncProblems,
  }

  return {
    dateLabel: longDateLabel(now),
    numbers: {
      goals,
      forecast: { expected: f.bay.expected, funded: f.bay.funded, weighted: f.bay.weighted, mpgAccounts: f.mpg.accounts, mpgExpected: f.mpg.expected },
      scorecard,
    },
    today: { meetings, closings: list(closingRows, (l) => ({ name: l.borrower_name || '(no name)', date: l.firm_closing_on })) },
    callFirst,
    slipping,
    callFirstCount: callFirst.replied.count + callFirst.newLeads.count + callFirst.overdue.count + callFirst.hotCold.count,
    nothingSlipping: !slipping.quietApps.count && !slipping.docsAging.count && !slipping.statementsLate.count && !syncProblems.length,
  }
}
```

Before running, check the reused exports actually exist:

```bash
grep -n "export function prevMonthWindow\|export function monthValues\|export function monthlyGoals" src/lib/overviewDash.js
grep -n "export function sprintWindow\|export function monthWindow\|export function resolveTargets\|export const DEFAULT_TARGETS" src/lib/reports.js
grep -n "export const isOpen\|export const isScenario\|export function resolveRates\|export function loanStats" src/lib/loans.js
grep -n "export function buildAlerts" -A3 src/lib/alerts.js
```

Check `buildAlerts`'s returned shape: each alert has `id`, `count`, `people` (the first 3) and `rest`. If it differs, adapt `alertList`. Don't change `alerts.js`.

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run src/lib/briefing.test.js`

Expected: PASS (3 tests). If an exact expectation is off because a reused builder computes differently, check that builder's unit tests and fix the fixture, not the builder:
- the `calls` goal's `needPerDay` relies on `monthValues` counting the two activity rows;
- `closings` relies on `isOpen` including `stage_group 'closing'`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/briefing.js src/lib/briefing.test.js
git commit -m "feat: daily briefing content model built from the app's own logic"
```

---

### Task 6: Render the email

**Files:**
- Create: `src/lib/briefingEmail.js`
- Test: `src/lib/briefingEmail.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest'
import { renderOwnerBriefing } from './briefingEmail'

const model = (o = {}) => ({
  dateLabel: 'Tue Nov 3',
  numbers: {
    goals: [{ id: 'calls', label: 'Calls', value: 40, target: 100, status: 'behind', unit: 'count', needPerDay: 4 }],
    forecast: { expected: 12400, funded: 5000, weighted: 7400, mpgAccounts: 1.5, mpgExpected: null },
    scorecard: { calls: 12, connects: 3, texts: 4, applications: 1 },
  },
  today: { meetings: [{ time: '2026-11-03T16:00:00.000Z', title: 'Deli <review>', book: 'mpg' }], closings: { count: 0, top: [] } },
  callFirst: {
    replied: { count: 7, top: Array.from({ length: 5 }, (_, i) => ({ name: `R${i}`, detail: 'Called back' })) },
    newLeads: { count: 0, top: [] },
    cadence: { bay: 6, mpg: 2 },
    overdue: { count: 0, top: [] },
    hotCold: { count: 0, top: [] },
  },
  slipping: { quietApps: { count: 0, top: [] }, docsAging: { count: 0, top: [] }, statementsLate: { count: 0, top: [] }, syncProblems: [] },
  callFirstCount: 7,
  nothingSlipping: true,
  ...o,
})

describe('renderOwnerBriefing', () => {
  it('subject carries the date, call-first count and forecast', () => {
    expect(renderOwnerBriefing(model(), { appUrl: 'https://x.app' }).subject).toBe('Briefing · Tue Nov 3 · 7 to call first · $12,400 forecast')
  })
  it('shows top five plus the count and a link', () => {
    const { text, html } = renderOwnerBriefing(model(), { appUrl: 'https://x.app' })
    expect(text).toContain('They reached out (7)')
    expect(text).toContain('R4')
    expect(text).toContain('+2 more')
    expect(html).toContain('href="https://x.app/workbench"')
  })
  it('says nothing is slipping on a quiet day and escapes HTML', () => {
    const { text, html } = renderOwnerBriefing(model(), { appUrl: 'https://x.app' })
    expect(text).toContain('Nothing slipping today.')
    expect(html).toContain('Deli &lt;review&gt;')
    expect(html).not.toContain('Deli <review>')
  })
  it('shows a behind goal with its per-day need', () => {
    expect(renderOwnerBriefing(model(), { appUrl: 'https://x.app' }).text).toContain('Calls 40 / 100 · behind · need 4 per business day')
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/briefingEmail.test.js`
Expected: FAIL, the module isn't found.

- [ ] **Step 3: Implement**

```js
// Renders the daily briefing model (briefing.js) as an email: subject, plain
// text and simple inline-styled HTML (email clients ignore <style> blocks).
const money = (n) => `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const timeLabel = (t) =>
  t === 'All day' ? t : new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }).format(new Date(t))
const BOOK = { bay: 'Bayway', mpg: 'MPG' }
const STATUS = { hit: 'hit', pace: 'on pace', behind: 'behind' }

function goalLine(g) {
  const fmt = (v) => (g.unit === 'currency' ? money(v) : Math.round(Number(v) || 0))
  const need = g.needPerDay ? ` · need ${g.needPerDay} per business day` : ''
  return `${g.label} ${fmt(g.value)} / ${fmt(g.target)} · ${STATUS[g.status] || g.status}${need}`
}

// A titled list: "Title (count)", up to five "name — detail" rows, "+N more", link.
function section(title, block, href) {
  if (!block.count) return null
  const rows = block.top.map((p) => (p.detail ? `${p.name} — ${p.detail}` : p.name))
  const more = block.count > block.top.length ? `+${block.count - block.top.length} more` : null
  return { title: `${title} (${block.count})`, rows: more ? rows.concat(more) : rows, href }
}

export function renderOwnerBriefing(m, { appUrl }) {
  const url = (p) => `${String(appUrl).replace(/\/$/, '')}${p}`
  const subject = `Briefing · ${m.dateLabel} · ${m.callFirstCount} to call first · ${money(m.numbers.forecast.expected)} forecast`

  const f = m.numbers.forecast
  const s = m.numbers.scorecard
  const numbers = [
    ...m.numbers.goals.map(goalLine),
    `Forecast this month ${money(f.expected)} (funded ${money(f.funded)} · weighted ${money(f.weighted)})` +
      (f.mpgExpected != null ? ` · MPG ${money(f.mpgExpected)}` : ` · MPG ${f.mpgAccounts} accounts expected`),
    `Yesterday: ${s.calls} calls · ${s.connects} connects · ${s.applications} new applications · ${s.texts} texts`,
  ]
  const today = [
    ...(m.today.meetings.length ? m.today.meetings.map((e) => `${timeLabel(e.time)} · ${e.title} (${BOOK[e.book]})`) : ['No meetings today']),
    ...(m.today.closings.count ? [`Closing this week (${m.today.closings.count}): ${m.today.closings.top.map((c) => `${c.name} ${c.date.slice(5)}`).join(', ')}`] : []),
  ]
  const cf = m.callFirst
  const callFirst = [
    section('They reached out', cf.replied, '/workbench'),
    section('New leads not called', cf.newLeads, '/workbench'),
    cf.cadence.bay + cf.cadence.mpg ? { title: `Call cadence due today: Bayway ${cf.cadence.bay} · MPG ${cf.cadence.mpg}`, rows: [], href: '/workbench' } : null,
    section('Overdue follow-ups', cf.overdue, '/tasks'),
    section('Hot, going cold', cf.hotCold, '/workbench'),
  ].filter(Boolean)
  const sl = m.slipping
  const slipping = m.nothingSlipping
    ? []
    : [
        section('Applications gone quiet', sl.quietApps, '/workbench'),
        section('Docs aging', sl.docsAging, '/workbench'),
        section('MPG statements overdue', sl.statementsLate, '/tasks'),
        sl.syncProblems.length ? { title: 'Sync problems', rows: sl.syncProblems.map((p) => `${p.label}: ${p.text}`), href: '/sync' } : null,
      ].filter(Boolean)

  // ---- Plain text ---------------------------------------------------------
  const textBlocks = [
    `Numbers\n${numbers.map((l) => `- ${l}`).join('\n')}`,
    `Today\n${today.map((l) => `- ${l}`).join('\n')}`,
    `Call first\n${callFirst.length ? callFirst.map((b) => [b.title, ...b.rows.map((r) => `  - ${r}`), `  ${url(b.href)}`].join('\n')).join('\n') : '- Nobody waiting'}`,
    `Slipping\n${slipping.length ? slipping.map((b) => [b.title, ...b.rows.map((r) => `  - ${r}`), `  ${url(b.href)}`].join('\n')).join('\n') : 'Nothing slipping today.'}`,
  ]
  const text = `${subject}\n\n${textBlocks.join('\n\n')}\n\nOpen the dashboard: ${url('/')}\n`

  // ---- HTML ---------------------------------------------------------------
  const h2 = (t) => `<h2 style="font:600 15px Arial,sans-serif;margin:20px 0 6px">${esc(t)}</h2>`
  const ul = (items) => `<ul style="font:14px Arial,sans-serif;margin:0;padding-left:18px">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`
  const blockHtml = (b) =>
    `<p style="font:600 14px Arial,sans-serif;margin:10px 0 4px"><a href="${esc(url(b.href))}" style="color:#1d4ed8">${esc(b.title)}</a></p>${b.rows.length ? ul(b.rows) : ''}`
  const html = [
    `<div style="max-width:600px">`,
    `<p style="font:13px Arial,sans-serif;color:#667085;margin:0">${esc(m.dateLabel)}</p>`,
    h2('Numbers'), ul(numbers),
    h2('Today'), ul(today),
    h2('Call first'), callFirst.length ? callFirst.map(blockHtml).join('') : ul(['Nobody waiting']),
    h2('Slipping'), slipping.length ? slipping.map(blockHtml).join('') : `<p style="font:14px Arial,sans-serif">Nothing slipping today.</p>`,
    `<p style="font:13px Arial,sans-serif;margin-top:24px"><a href="${esc(url('/'))}">Open the dashboard</a></p>`,
    `</div>`,
  ].join('')

  return { subject, text, html }
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run src/lib/briefingEmail.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/briefingEmail.js src/lib/briefingEmail.test.js
git commit -m "feat: render the daily briefing as an email"
```

---

### Task 7: Bundle for the edge function

**Files:**
- Create: `src/lib/briefingEntry.js`
- Create: `scripts/build-briefing.mjs`
- Modify: `package.json` (add a script)
- Create: `src/lib/briefingBundle.test.js`
- Generated: `supabase/functions/daily-briefing/briefing.bundle.js`

- [ ] **Step 1: Write the entry**

```js
// Everything the daily-briefing edge function needs from src/lib, bundled by
// scripts/build-briefing.mjs into supabase/functions/daily-briefing/briefing.bundle.js
// (Deno can't load src/lib's extensionless imports directly).
export { buildOwnerBriefing } from './briefing'
export { renderOwnerBriefing } from './briefingEmail'
export { shouldSend, chicagoParts, chicagoDayRangeUtc, chicagoDateKey } from './briefingTime'
export { CORE_SOURCES } from './syncHealth'
```

- [ ] **Step 2: Write the build script**

```js
// Bundles src/lib/briefingEntry.js (pure modules only) into one ESM file the
// Deno edge function imports. Run `npm run build:briefing` after changing any
// module it reaches; src/lib/briefingBundle.test.js fails when it's stale.
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'

export async function bundleBriefing() {
  const out = await build({
    entryPoints: ['src/lib/briefingEntry.js'],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    write: false,
    legalComments: 'none',
    banner: { js: '// GENERATED by scripts/build-briefing.mjs from src/lib — do not edit. Run `npm run build:briefing`.' },
  })
  return out.outputFiles[0].text
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('build-briefing.mjs')) {
  const code = await bundleBriefing()
  writeFileSync('supabase/functions/daily-briefing/briefing.bundle.js', code)
  console.log(`wrote supabase/functions/daily-briefing/briefing.bundle.js (${code.length} bytes)`)
}
```

In `package.json` `"scripts"`, add: `"build:briefing": "node scripts/build-briefing.mjs"`.

- [ ] **Step 3: Write the staleness test**

```js
// The committed edge-function bundle must match a fresh bundle of src/lib.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { bundleBriefing } from '../../scripts/build-briefing.mjs'

describe('daily-briefing bundle', () => {
  it('is up to date with src/lib (run `npm run build:briefing`)', async () => {
    const fresh = await bundleBriefing()
    const committed = readFileSync('supabase/functions/daily-briefing/briefing.bundle.js', 'utf8').replace(/\r\n/g, '\n')
    expect(committed).toBe(fresh.replace(/\r\n/g, '\n'))
  })
  it('contains no Supabase client or React', async () => {
    const fresh = await bundleBriefing()
    expect(fresh).not.toMatch(/@supabase\/supabase-js|from "react"/)
  })
})
```

Add `supabase/functions/daily-briefing/briefing.bundle.js -text` to `.gitattributes` (create it if missing). This keeps git from converting its line endings, so the comparison stays exact. Check `cat .gitattributes 2>/dev/null` first, and append without replacing existing lines.

- [ ] **Step 4: Run it to see it fail, then build**

Run: `npx vitest run src/lib/briefingBundle.test.js`
Expected: FAIL, because the bundle file doesn't exist.

```bash
mkdir -p supabase/functions/daily-briefing
npm run build:briefing
npx vitest run src/lib/briefingBundle.test.js
```

Expected: "wrote … bytes", then PASS (2 tests). If `platform: 'neutral'` can't resolve the extensionless imports, add `resolveExtensions: ['.js', '.ts']` and `mainFields: ['module', 'main']` to the build options. `src/lib/pipeline.js` imports `../../supabase/functions/_shared/bay-stages.ts`, which esbuild bundles as TS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/briefingEntry.js scripts/build-briefing.mjs package.json src/lib/briefingBundle.test.js supabase/functions/daily-briefing/briefing.bundle.js .gitattributes
git commit -m "build: bundle the briefing logic for the edge function"
```

---

### Task 8: Gmail sender and the edge function

**Files:**
- Create: `supabase/functions/_shared/gmail-smtp.ts`
- Create: `supabase/functions/daily-briefing/index.ts`

These are Deno files with URL imports. Vitest can't run them; their logic is the bundle, which is tested. Task 11 checks them live.

- [ ] **Step 1: Write the sender**

```ts
// Sends one email from the Gmail account in GMAIL_USER with an app password
// (GMAIL_APP_PASSWORD), over implicit TLS on smtp.gmail.com:465. Supabase
// Edge Functions block outbound 25 and 587; 465 is probed in Task 11 of the
// daily-briefing plan. If it's blocked, Task 10 swaps this for the Gmail API.
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

export async function sendGmail({ to, subject, text, html, fromName = 'Atkinson Sales OS' }) {
  const user = Deno.env.get('GMAIL_USER')
  const pass = Deno.env.get('GMAIL_APP_PASSWORD')
  if (!user || !pass) throw new Error('GMAIL_USER / GMAIL_APP_PASSWORD not set as function secrets')
  const client = new SMTPClient({ connection: { hostname: 'smtp.gmail.com', port: 465, tls: true, auth: { username: user, password: pass } } })
  try {
    await client.send({ from: `${fromName} <${user}>`, to, subject, content: text, html })
  } finally {
    await client.close()
  }
}
```

- [ ] **Step 2: Write the edge function**

```ts
// Chandler's 7:30 AM briefing (spec 2026-11-03, section 3; plan
// docs/superpowers/plans/2026-11-04-daily-briefing.md). pg_cron calls this at
// 12:30 and 13:30 UTC on weekdays (migration 0055); it sends only at 7:xx
// Chicago, once per day. A request with header x-briefing-test equal to the
// BRIEFING_TEST_KEY secret skips the window and the once-a-day check and
// prefixes the subject with [TEST]. Deployed --no-verify-jwt like the syncs.
import { serviceClient, logSync, fetchAll } from '../_shared/db.ts'
import { sendGmail } from '../_shared/gmail-smtp.ts'
import {
  buildOwnerBriefing, renderOwnerBriefing, shouldSend, chicagoDayRangeUtc, chicagoDateKey, CORE_SOURCES,
} from './briefing.bundle.js'

const SOURCE = 'briefing-owner'
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const setting = async (db, key) => (await db.from('settings').select('value').eq('key', key).maybeSingle()).data?.value ?? null

Deno.serve(async (req) => {
  const db = serviceClient()
  const now = Date.now()
  const testKey = Deno.env.get('BRIEFING_TEST_KEY')
  const isTest = !!testKey && req.headers.get('x-briefing-test') === testKey
  try {
    const cfg = (await setting(db, 'briefings')) || {}
    if (!cfg.enabled && !isTest) return json(200, { skipped: 'disabled' })
    if (!isTest && !shouldSend(now)) return json(200, { skipped: 'outside the 7:00 Chicago window' })

    const today = chicagoDayRangeUtc(now)
    if (!isTest) {
      const { data: sent } = await db.from('sync_log').select('id').eq('source', SOURCE).eq('status', 'ok').gte('ran_at', today.from).limit(1)
      if (sent?.length) return json(200, { skipped: 'already sent today' })
    }

    const yesterday = chicagoDayRangeUtc(now, -1)
    // First day of last month (Chicago), for this-month vs last-month numbers.
    const [cy, cm] = chicagoDateKey(now).split('-').map(Number)
    const since = new Date(Date.UTC(cy, cm - 2, 1)).toISOString().slice(0, 10)
    const tomorrowKey = chicagoDateKey(now, 1)

    const [rules, targets, rates, forecastSettings] = await Promise.all(
      ['priority_rules', 'metric_targets', 'arive', 'forecast'].map((k) => setting(db, k)),
    )
    const [metrics, deals, activities, yesterdayActivities, pipeline, loans, ratings, signals, dialRows, dialSkips, mpgTasks, workItems, events] = await Promise.all([
      fetchAll(() => db.from('metrics_daily').select('date, business_id, metric_key, value').gte('date', since).order('id')),
      fetchAll(() => db.from('deals').select('status, value, expected_close, business_id').eq('business_id', 'bay').order('id')),
      fetchAll(() => db.from('activities').select('occurred_at, type, business_id').eq('direction', 'outbound').in('type', ['call', 'text', 'email']).gte('occurred_at', `${since}T00:00:00Z`).order('id')),
      fetchAll(() => db.from('activities').select('type, direction, raw').gte('occurred_at', yesterday.from).lt('occurred_at', yesterday.to).order('id')),
      fetchAll(() => db.from('v_active_pipeline').select('id, business_id, name, stage, stage_since, last_touch_at, crm_created_at, last_outbound_call_at, open_task_count, oldest_open_due_at, docs_outstanding_count, docs_oldest_requested_at').eq('business_id', 'bay').order('id')),
      fetchAll(() => db.from('loans').select('id, borrower_name, role, amount, stage_group, funded_on, firm_closing_on, contact_id, comp_override, scenario_auto, scenario_override, application_on').order('id')),
      fetchAll(() => db.from('lead_ratings').select('contact_id, business_id, temperature, est_amount, close_month, rated_at, contact:contacts(name)').order('contact_id')),
      fetchAll(() => db.from('v_lead_signals').select('*').order('id')),
      fetchAll(() => db.from('v_dial_contacts').select('*').order('id')),
      fetchAll(() => db.from('dial_skips').select('contact_id').gte('until_date', tomorrowKey).order('contact_id')),
      fetchAll(() => db.from('v_tasks').select('id, title, due_at, contact_id, contact_name, company, business_id').eq('business_id', 'mpg').order('id')),
      fetchAll(() => db.from('work_items').select('id, business_id, kind, contact_id, title, status, waiting_on, check_back_on, due_on, created_at, done_at, contact:contacts(name)').neq('status', 'done').order('id')),
      fetchAll(() => db.from('calendar_events').select('id, source_account, title, starts_at, is_all_day').gte('starts_at', today.from).lt('starts_at', today.to).order('starts_at')),
    ])
    const syncLatest = {}
    await Promise.all(
      CORE_SOURCES.map(async ({ source }) => {
        const { data } = await db.from('sync_log').select('ran_at, status').eq('source', source).order('ran_at', { ascending: false }).limit(1).maybeSingle()
        if (data) syncLatest[source] = data
      }),
    )

    const model = buildOwnerBriefing({
      rules, targets, rates, forecastSettings, metrics, deals, activities, yesterdayActivities, pipeline, loans, ratings, signals, dialRows,
      dialSkips: dialSkips.map((r) => r.contact_id), mpgTasks,
      workItems: workItems.map(({ contact, ...w }) => ({ ...w, contact_name: contact?.name || null })),
      events, syncLatest,
    }, now)
    const mail = renderOwnerBriefing(model, { appUrl: cfg.app_url || 'https://atkinson-sales-os.vercel.app' })
    const to = cfg.owner_email || 'chandler@baywayhtx.com'
    await sendGmail({ to, subject: isTest ? `[TEST] ${mail.subject}` : mail.subject, text: mail.text, html: mail.html })

    await logSync(db, SOURCE, 'ok', 1, `${isTest ? 'test ' : ''}sent to ${to}: ${mail.subject}`)
    return json(200, { ok: true, to, subject: mail.subject })
  } catch (err) {
    const message = String(err?.message || err).slice(0, 500)
    await logSync(db, SOURCE, 'error', 0, message)
    return json(500, { ok: false, error: message })
  }
})
```

Check `fetchAll` in `supabase/functions/_shared/db.ts`: does it throw on error, return rows, and take a query factory? The `fub-sync` usage `fetchAll(() => db.from(...)...)` suggests yes. Adapt if not. The `loans` select list must use real column names; check against `LOAN_COLUMNS` in `src/lib/loansData.js`.

- [ ] **Step 3: Type-check what can be checked locally**

There is no Docker or Deno locally. Check that the bundle's exports match the import list:

```bash
node -e "import('./supabase/functions/daily-briefing/briefing.bundle.js').then(m => console.log(Object.keys(m).sort().join(',')))"
```

Expected: `CORE_SOURCES,buildOwnerBriefing,chicagoDateKey,chicagoDayRangeUtc,chicagoParts,renderOwnerBriefing,shouldSend`.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/gmail-smtp.ts supabase/functions/daily-briefing/index.ts
git commit -m "feat: daily-briefing edge function (Gmail SMTP 465)"
```

---

### Task 9: Show the briefing on Sync Status

**Files:**
- Modify: `src/pages/SyncStatus.jsx` (`SOURCE_LABELS`)
- Test: `src/pages/SyncStatus.render.test.jsx`

- [ ] **Step 1: Write the failing test**

In `src/pages/SyncStatus.render.test.jsx`, add a `sync_log` row `{ source: 'briefing-owner', ran_at: <now ISO>, status: 'ok', records_upserted: 1, message: 'sent' }` to the fixture the file's fake returns. Use the file's existing pattern; check it with `sed -n 1,40p src/pages/SyncStatus.render.test.jsx`. Then assert:

```js
expect(document.body.textContent).toContain('Daily briefing (you)')
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/pages/SyncStatus.render.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `SOURCE_LABELS`, add after the Outlook rows:

```js
  'briefing-owner': { label: 'Daily briefing (you)', biz: 'bay' },
```

`biz` only picks the badge colour. Bayway is the default book.

- [ ] **Step 4: Run it to see it pass, then commit**

Run: `npx vitest run src/pages/SyncStatus.render.test.jsx`
Expected: PASS.

```bash
git add src/pages/SyncStatus.jsx src/pages/SyncStatus.render.test.jsx
git commit -m "feat: Sync Status lists the daily briefing"
```

---

### Task 10 (only if Task 11's probe shows port 465 is blocked): Gmail API sender

**Files:**
- Modify: `supabase/functions/_shared/gmail-smtp.ts` (replace the body; keep `sendGmail`'s signature)

- [ ] **Step 1: Chandler's one-time setup (he does it; never paste secrets in chat)**

1. Go to console.cloud.google.com. Create a project named "Sales OS mail", then go to **APIs & Services → Enable APIs** and enable the **Gmail API**.
2. In **OAuth consent screen**, choose External, set the app name, add `chandler.dashboard@gmail.com` as a test user, then **Publish app** to Production. A "Testing" app's refresh tokens expire after 7 days.
3. In **Credentials → Create OAuth client ID**, choose type **Web application**, and add the redirect URI `https://developers.google.com/oauthplayground`.
4. At developers.google.com/oauthplayground, open the gear icon, choose "Use your own OAuth credentials", and paste the client ID and secret. Authorize the scope `https://www.googleapis.com/auth/gmail.send` signed in as `chandler.dashboard@gmail.com`, then exchange for tokens and copy the **refresh token**.
5. From the repo folder, set the three secrets:

```bash
supabase secrets set GMAIL_CLIENT_ID=... GMAIL_CLIENT_SECRET=... GMAIL_REFRESH_TOKEN=...
```

- [ ] **Step 2: Replace the sender**

```ts
// Sends one email from GMAIL_USER through the Gmail API over HTTPS (Supabase
// Edge Functions block SMTP). OAuth refresh token from GMAIL_REFRESH_TOKEN.
const b64url = (s: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function accessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('GMAIL_CLIENT_ID') ?? '',
      client_secret: Deno.env.get('GMAIL_CLIENT_SECRET') ?? '',
      refresh_token: Deno.env.get('GMAIL_REFRESH_TOKEN') ?? '',
      grant_type: 'refresh_token',
    }),
  })
  const body = await res.json()
  if (!res.ok || !body.access_token) throw new Error(`Gmail token: ${res.status} ${body.error || ''}`)
  return body.access_token as string
}

export async function sendGmail({ to, subject, text, html, fromName = 'Atkinson Sales OS' }) {
  const user = Deno.env.get('GMAIL_USER')
  if (!user) throw new Error('GMAIL_USER not set as a function secret')
  const boundary = `b${crypto.randomUUID()}`
  const encSubject = `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(subject)))}?=`
  const mime = [
    `From: ${fromName} <${user}>`, `To: ${to}`, `Subject: ${encSubject}`, 'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
    `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', '', text,
    `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', '', html,
    `--${boundary}--`, '',
  ].join('\r\n')
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ raw: b64url(mime) }),
  })
  if (!res.ok) throw new Error(`Gmail send: ${res.status} ${(await res.text()).slice(0, 200)}`)
}
```

For large HTML, `String.fromCharCode(...bytes)` can hit argument limits. If a send fails with "Maximum call stack", build the binary string in a loop over 8 KB chunks.

- [ ] **Step 3: Redeploy and re-run the probe (Task 11, step 3). Commit:**

```bash
git add supabase/functions/_shared/gmail-smtp.ts
git commit -m "feat: send the briefing through the Gmail API (SMTP blocked)"
```

---

### Task 11: Rollout (needs Chandler's OK at each step)

- [ ] **Step 1: Full checks**

Run `npx vitest run`. Expected: all pass, with the 2 known unhandled errors. Run `npx vite build`. Expected: built.

Push the branch and open a PR. Do not merge yet.

- [ ] **Step 2: Chandler's setup.** He does these himself and never pastes passwords in chat.

1. Sign in to `chandler.dashboard@gmail.com`, go to Google Account → Security, and turn on **2-Step Verification**.
2. Go to Google Account → Security → **App passwords**, create one named "Sales OS", and copy the 16 characters.
3. From the repo folder, set the secrets. `BRIEFING_TEST_KEY` is any long random string he chooses.

```bash
supabase secrets set GMAIL_USER=chandler.dashboard@gmail.com GMAIL_APP_PASSWORD=xxxxxxxxxxxxxxxx BRIEFING_TEST_KEY=choose-a-long-random-string
```

4. In Outlook for both `chandler@` and `shelby@baywayhtx.com`, add `chandler.dashboard@gmail.com` to **Safe senders**.

- [ ] **Step 3: Deploy and probe (production; ask first)**

Deploy with `supabase functions deploy daily-briefing --no-verify-jwt --project-ref cnmipfxwqnbtkohfixkf`.

Then Chandler runs the probe himself (it contains the test key):

```bash
curl -s -X POST https://cnmipfxwqnbtkohfixkf.supabase.co/functions/v1/daily-briefing -H "Authorization: Bearer <anon key>" -H "x-briefing-test: <BRIEFING_TEST_KEY>"
```

Expected: `{"ok":true,...}` and a `[TEST] Briefing · …` email at `chandler@baywayhtx.com`. A `sync_log` row `briefing-owner` / `ok` appears.

If it fails with a connection or timeout error on smtp.gmail.com:465, port 465 is blocked. Do Task 10, redeploy and re-probe.

- [ ] **Step 4: Schedule (production; ask first)**

Run `supabase db push` from the main checkout. That holds the link, but it is on another branch. So run it from this worktree after copying `supabase/.temp`, which is gitignored, as was done for 0054. Dry-run first: `supabase db push --dry-run` must list only `0055_daily_briefing.sql`.

Then check the jobs exist:

```sql
select jobname, schedule from cron.job where jobname like 'daily-briefing%';
```

Expected: two rows, `30 12 * * 1-5` and `30 13 * * 1-5`.

- [ ] **Step 5: Merge the PR** (Vercel ships the Sync Status label), then confirm the first scheduled email arrives at 7:30 the next weekday morning.

---

## Self-review notes

- **Spec coverage, section 3:**
  - **When:** 7:30 Mon–Fri, two UTC jobs plus a Chicago window check (Tasks 1, 3, 8).
  - **Sender:** Gmail app password, with the HTTPS fallback (Tasks 8 and 10).
  - **Always sends:** quiet days get "Nothing slipping today." (Tasks 5 and 6).
  - **Health:** `sync_log` `briefing-owner` (Tasks 8 and 9).
  - **Settings:** the `briefings` key (Task 1).
  - **Sections:**
    - Numbers: goals without commission or residual, plus per-day need (Task 5).
    - Forecast and yesterday's scorecard (Tasks 4 and 5).
    - Today: meetings and closings (Task 5).
    - Call first: replied, new leads, cadence counts, overdue, Hot going cold (Task 5).
    - Slipping: quiet apps, docs aging, statements, sync problems (Task 5).
  - **Lists:** top 5 + count + link (Tasks 5 and 6).
- **Assistant briefing and login:** step 3, deliberately excluded.
- **Assumptions the implementer must verify:**
  - the shape of `buildAlerts`'s output;
  - `fetchAll` in `_shared/db.ts`;
  - the `loans` column names.
