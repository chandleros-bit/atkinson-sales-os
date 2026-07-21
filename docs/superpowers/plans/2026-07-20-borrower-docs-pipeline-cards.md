# Borrower Docs on Bayway Pipeline Cards — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each Bayway borrower's outstanding documents, how long they have been outstanding, and the last conversation note, on the pipeline board cards — fed by a Google Sheet an assistant maintains daily.

**Architecture:** A 15-minute cron calls a new `sheets-docs-sync` edge function, which authenticates to the Google Sheets API with a service account (RS256 JWT), reads one wide sheet, pivots it into two long tables (`borrower_doc_tracking`, `borrower_docs`), and diffs against current state to stamp aging timestamps. `v_active_pipeline` gains lateral joins exposing outstanding docs and the last note; `Pipeline.jsx` renders them. Read-only throughout — the app never writes to the sheet.

**Tech Stack:** Supabase Edge Functions (Deno), Postgres + pg_cron, Google Sheets API v4, React 18, Vite, Vitest, Tailwind.

**Spec:** `docs/superpowers/specs/2026-07-20-borrower-docs-pipeline-cards-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/functions/_shared/google-auth.ts` | **New.** Service-account JWT signing and token exchange. Nothing else. Isolated because it is the only asymmetric-signing code in the repo. |
| `supabase/functions/_shared/google-auth.test.js` | **New.** Tests for claim building, base64url, PEM decoding. |
| `supabase/functions/_shared/sheet-docs.ts` | **New.** Pure sheet parsing and diffing. No I/O. |
| `supabase/functions/_shared/sheet-docs.test.js` | **New.** Tests for pivot, skip rules, transitions, mass-removal guard. |
| `supabase/functions/sheets-docs-sync/index.ts` | **New.** Orchestration only: fetch, guard, resolve ids, upsert, log. |
| `supabase/migrations/0021_borrower_docs.sql` | **New.** Two tables, RLS, indexes. |
| `supabase/migrations/0022_pipeline_docs_view.sql` | **New.** `v_active_pipeline` extension. |
| `supabase/migrations/0023_schedule_sheets_docs_sync.sql` | **New.** 15-minute pg_cron job. |
| `src/lib/borrowerDocs.js` | **New.** Pure card helpers: summary string, `+N` overflow, aging threshold, state resolution. |
| `src/lib/borrowerDocs.test.js` | **New.** Tests for all five card states. |
| `src/pages/Pipeline.jsx` | **Modify.** `Card` renders the docs block and note line; `PIPELINE.bay.columns` selects the new fields. |
| `docs/phase-borrower-docs-setup.md` | **New.** Sheet template, validation rule, service-account steps, deploy commands. |

Sync logic lives in `_shared/sheet-docs.ts` rather than in the function body so it is testable under Vitest without Deno — the same split `fub-tasks.ts` / `fub-task-sync` uses today.

---

## Task 1: Google service-account auth

**Files:**
- Create: `supabase/functions/_shared/google-auth.ts`
- Test: `supabase/functions/_shared/google-auth.test.js`

Vitest picks up `*.test.js` under `supabase/functions/_shared/` already (see `fub-tasks.test.js`). Keep the module free of Deno-only imports at the top level so the tests can load it — the function reads `Deno.env` and passes credentials in as an argument.

- [ ] **Step 1: Write the failing test**

```javascript
// supabase/functions/_shared/google-auth.test.js
import { describe, it, expect } from 'vitest'
import { base64url, buildClaims, pemToPkcs8 } from './google-auth.ts'

describe('base64url', () => {
  it('encodes without padding or url-unsafe chars', () => {
    const out = base64url(new TextEncoder().encode('a?b>c~'))
    expect(out).not.toContain('=')
    expect(out).not.toContain('+')
    expect(out).not.toContain('/')
  })

  it('round-trips through atob after padding is restored', () => {
    const out = base64url(new TextEncoder().encode('hello'))
    expect(out).toBe('aGVsbG8')
  })
})

describe('buildClaims', () => {
  const creds = { client_email: 'svc@proj.iam.gserviceaccount.com' }

  it('targets the token endpoint with a read-only sheets scope', () => {
    const c = buildClaims(creds, 1_700_000_000_000)
    expect(c.iss).toBe('svc@proj.iam.gserviceaccount.com')
    expect(c.aud).toBe('https://oauth2.googleapis.com/token')
    expect(c.scope).toBe('https://www.googleapis.com/auth/spreadsheets.readonly')
  })

  it('expires an hour out, in seconds not milliseconds', () => {
    const c = buildClaims(creds, 1_700_000_000_000)
    expect(c.iat).toBe(1_700_000_000)
    expect(c.exp).toBe(1_700_000_000 + 3600)
  })

  it('throws when the key JSON has no client_email', () => {
    expect(() => buildClaims({}, 1_700_000_000_000)).toThrow(/client_email/)
  })
})

describe('pemToPkcs8', () => {
  it('strips header, footer and newlines into raw bytes', () => {
    const body = 'AAECAwQ='
    const pem = `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`
    const buf = pemToPkcs8(pem)
    expect(Array.from(new Uint8Array(buf))).toEqual([0, 1, 2, 3, 4])
  })

  it('handles literal \\n escapes, which is how the key arrives from an env var', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\\nAAECAwQ=\\n-----END PRIVATE KEY-----\\n'
    const buf = pemToPkcs8(pem)
    expect(Array.from(new Uint8Array(buf))).toEqual([0, 1, 2, 3, 4])
  })

  it('throws on a key that is not a PEM block', () => {
    expect(() => pemToPkcs8('not a key')).toThrow(/PRIVATE KEY/)
  })
})
```

The literal-`\n` case is the one that matters in practice: a service-account JSON pasted into a Supabase secret arrives with escaped newlines, and `importKey` fails with an opaque error if they are not restored.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- google-auth`
Expected: FAIL — `Failed to resolve import "./google-auth.ts"`

- [ ] **Step 3: Write the implementation**

```typescript
// supabase/functions/_shared/google-auth.ts
// Google service-account auth for the Sheets API. The ONLY asymmetric-signing
// code in this repo, kept in its own module (with its own tests) so a malformed
// key never has to be debugged through a sync function.
//
// Read-only scope, and the sheet is shared with the service account as Viewer —
// the app must never be able to write to the assistant's sheet.

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly'
const TTL_SECONDS = 3600

export interface ServiceAccountCreds {
  client_email?: string
  private_key?: string
}

export function base64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function buildClaims(creds: ServiceAccountCreds, nowMs: number) {
  if (!creds?.client_email) {
    throw new Error('service account JSON has no client_email')
  }
  const iat = Math.floor(nowMs / 1000)
  return {
    iss: creds.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat,
    exp: iat + TTL_SECONDS,
  }
}

// A service-account private_key is a PKCS#8 PEM. When it arrives via an env var
// the newlines are usually escaped as literal backslash-n, which importKey
// rejects with an unhelpful error — restore them before stripping.
export function pemToPkcs8(pem: string): ArrayBuffer {
  const normalized = String(pem || '').replace(/\\n/g, '\n')
  const match = normalized.match(
    /-----BEGIN PRIVATE KEY-----([\s\S]*?)-----END PRIVATE KEY-----/,
  )
  if (!match) throw new Error('private_key is not a PKCS#8 PRIVATE KEY PEM block')
  const b64 = match[1].replace(/\s+/g, '')
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out.buffer
}

async function signJwt(creds: ServiceAccountCreds, nowMs: number): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT' }
  const enc = new TextEncoder()
  const unsigned =
    `${base64url(enc.encode(JSON.stringify(header)))}.` +
    `${base64url(enc.encode(JSON.stringify(buildClaims(creds, nowMs))))}`

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(creds.private_key || ''),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(unsigned))
  return `${unsigned}.${base64url(new Uint8Array(sig))}`
}

// Exchanges a signed JWT for a short-lived access token. Throws on any non-2xx
// so an auth failure aborts BEFORE the sync diffs anything — a partial write on
// a bad token would be far worse than a failed run.
export async function getAccessToken(
  creds: ServiceAccountCreds,
  nowMs: number = Date.now(),
): Promise<string> {
  const jwt = await signJwt(creds, nowMs)
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })
  if (!res.ok) {
    throw new Error(`google token exchange failed: ${res.status} ${await res.text()}`)
  }
  const json = await res.json()
  if (!json.access_token) throw new Error('google token response had no access_token')
  return json.access_token
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- google-auth`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/google-auth.ts supabase/functions/_shared/google-auth.test.js
git commit -m "feat: google service-account auth for the Sheets API"
```

---

## Task 2: Parse the wide sheet into long rows

**Files:**
- Create: `supabase/functions/_shared/sheet-docs.ts`
- Test: `supabase/functions/_shared/sheet-docs.test.js`

The Sheets API returns `{ values: [[header...], [row...], ...] }`. Rows are ragged — trailing empty cells are omitted entirely, so index access must tolerate `undefined`.

- [ ] **Step 1: Write the failing test**

```javascript
// supabase/functions/_shared/sheet-docs.test.js
import { describe, it, expect } from 'vitest'
import { parseSheet } from './sheet-docs.ts'

const HEADER = ['FUB ID', 'Borrower', 'Paystubs', 'W2', 'Bank Statements', 'Notes']

describe('parseSheet', () => {
  it('discovers doc types from the header row, ignoring the reserved columns', () => {
    const out = parseSheet([HEADER, ['2972', 'Sarah', 'Needed', 'Received', '', 'note text']])
    expect(out.docTypes).toEqual(['Paystubs', 'W2', 'Bank Statements'])
  })

  it('pivots a wide row into one entry per doc type, dropping blanks', () => {
    const out = parseSheet([HEADER, ['2972', 'Sarah', 'Needed', 'Received', '', 'note text']])
    expect(out.rows).toEqual([
      {
        fub_person_id: '2972',
        notes: 'note text',
        docs: [
          { doc_type: 'Paystubs', status: 'needed' },
          { doc_type: 'W2', status: 'received' },
        ],
      },
    ])
  })

  it('tolerates ragged rows where trailing cells are omitted', () => {
    const out = parseSheet([HEADER, ['2972', 'Sarah', 'Needed']])
    expect(out.rows[0].docs).toEqual([{ doc_type: 'Paystubs', status: 'needed' }])
    expect(out.rows[0].notes).toBe('')
  })

  it('matches headers and values case-insensitively after trimming', () => {
    const out = parseSheet([
      ['  fub id ', 'borrower', 'Paystubs', 'notes'],
      ['2972', 'Sarah', '  NEEDED  ', 'x'],
    ])
    expect(out.rows[0].docs).toEqual([{ doc_type: 'Paystubs', status: 'needed' }])
    expect(out.rows[0].notes).toBe('x')
  })

  it('skips and counts rows with a missing or non-numeric FUB ID', () => {
    const out = parseSheet([
      HEADER,
      ['', 'No Id', 'Needed', '', '', ''],
      ['abc', 'Bad Id', 'Needed', '', '', ''],
      ['2972', 'Good', 'Needed', '', '', ''],
    ])
    expect(out.rows).toHaveLength(1)
    expect(out.skippedNoId).toBe(2)
  })

  it('skips BOTH rows of a duplicated FUB ID rather than guessing', () => {
    const out = parseSheet([
      HEADER,
      ['2972', 'First', 'Needed', '', '', ''],
      ['2972', 'Second', 'Received', '', '', ''],
      ['3104', 'Unique', 'Needed', '', '', ''],
    ])
    expect(out.rows.map((r) => r.fub_person_id)).toEqual(['3104'])
    expect(out.skippedDuplicate).toBe(2)
  })

  it('counts unrecognized cell values and treats them as blank', () => {
    const out = parseSheet([HEADER, ['2972', 'Sarah', 'Maybe?', 'Needed', '', '']])
    expect(out.rows[0].docs).toEqual([{ doc_type: 'W2', status: 'needed' }])
    expect(out.unrecognizedValues).toBe(1)
  })

  it('throws when the required FUB ID column is absent', () => {
    expect(() => parseSheet([['Borrower', 'Paystubs'], ['Sarah', 'Needed']])).toThrow(/FUB ID/)
  })

  it('returns an empty result for a sheet with only a header', () => {
    const out = parseSheet([HEADER])
    expect(out.rows).toEqual([])
  })

  it('throws on a completely empty response rather than reporting zero rows', () => {
    expect(() => parseSheet([])).toThrow(/no header row/)
  })
})
```

Note the last two are deliberately different. A header with no data rows is a legitimately empty sheet. *No header at all* means the tab was renamed, moved, or the read failed — that must throw, not quietly report zero rows and feed the mass-removal path.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- sheet-docs`
Expected: FAIL — `Failed to resolve import "./sheet-docs.ts"`

- [ ] **Step 3: Write the implementation**

```typescript
// supabase/functions/_shared/sheet-docs.ts
// Pure sheet parsing + diffing for sheets-docs-sync. No I/O, no Deno APIs, so
// this is unit-tested under Vitest exactly like fub-tasks.ts.
//
// The SHEET is wide (one row per borrower, one column per doc type) because
// that is fastest for the assistant maintaining it daily. The TABLES are long.
// This module is where the pivot happens.

export const ID_HEADER = 'fub id'
const RESERVED = new Set([ID_HEADER, 'borrower', 'notes'])

export interface ParsedDoc {
  doc_type: string
  status: 'needed' | 'received'
}
export interface ParsedRow {
  fub_person_id: string
  notes: string
  docs: ParsedDoc[]
}
export interface ParsedSheet {
  docTypes: string[]
  rows: ParsedRow[]
  skippedNoId: number
  skippedDuplicate: number
  unrecognizedValues: number
}

const norm = (v: unknown) => String(v ?? '').trim()

function cellStatus(v: unknown): 'needed' | 'received' | null | 'bad' {
  const s = norm(v).toLowerCase()
  if (s === '') return null
  if (s === 'needed') return 'needed'
  if (s === 'received') return 'received'
  return 'bad'
}

export function parseSheet(values: unknown[][]): ParsedSheet {
  const header = values?.[0]
  // An absent header means the tab was renamed or the read failed. Reporting
  // "0 rows" here would hand a false empty to the mass-removal guard.
  if (!Array.isArray(header) || header.length === 0) {
    throw new Error('sheet has no header row — check the tab name')
  }

  const headers = header.map((h) => norm(h))
  const lower = headers.map((h) => h.toLowerCase())
  const idIdx = lower.indexOf(ID_HEADER)
  if (idIdx === -1) throw new Error(`sheet is missing the required "FUB ID" column`)
  const notesIdx = lower.indexOf('notes')

  const docCols: { idx: number; name: string }[] = []
  headers.forEach((name, idx) => {
    if (name && !RESERVED.has(lower[idx])) docCols.push({ idx, name })
  })

  let skippedNoId = 0
  let unrecognizedValues = 0
  const byId = new Map<string, ParsedRow>()
  const duplicated = new Set<string>()

  for (const raw of values.slice(1)) {
    const row = Array.isArray(raw) ? raw : []
    const id = norm(row[idIdx])
    // Never fall back to name matching: across 826 contacts a confidently wrong
    // doc list is worse than no doc list at all.
    if (!/^\d+$/.test(id)) {
      // A wholly blank row is spreadsheet padding, not a data error.
      if (row.some((c) => norm(c) !== '')) skippedNoId++
      continue
    }
    if (byId.has(id)) {
      duplicated.add(id)
      continue
    }

    const docs: ParsedDoc[] = []
    for (const col of docCols) {
      const st = cellStatus(row[col.idx])
      if (st === 'bad') {
        unrecognizedValues++
        continue
      }
      if (st) docs.push({ doc_type: col.name, status: st })
    }
    byId.set(id, {
      fub_person_id: id,
      notes: notesIdx === -1 ? '' : norm(row[notesIdx]),
      docs,
    })
  }

  // Ambiguous duplicates: drop every copy rather than picking one.
  let skippedDuplicate = 0
  for (const id of duplicated) {
    byId.delete(id)
    skippedDuplicate += 2
  }

  return {
    docTypes: docCols.map((c) => c.name),
    rows: [...byId.values()],
    skippedNoId,
    skippedDuplicate,
    unrecognizedValues,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- sheet-docs`
Expected: PASS, 10 tests

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/sheet-docs.ts supabase/functions/_shared/sheet-docs.test.js
git commit -m "feat: parse the wide borrower-docs sheet into long rows"
```

---

## Task 3: Diff incoming rows against stored state

**Files:**
- Modify: `supabase/functions/_shared/sheet-docs.ts`
- Test: `supabase/functions/_shared/sheet-docs.test.js`

Two functions, because doc rows need a `tracking_id` that new borrowers do not have until their tracking row is inserted. The sync upserts tracking first, resolves ids, then upserts docs.

- [ ] **Step 1: Write the failing test**

Append to `supabase/functions/_shared/sheet-docs.test.js`:

```javascript
import { diffTracking, diffDocs } from './sheet-docs.ts'

const NOW = '2026-07-20T12:00:00.000Z'

describe('diffTracking', () => {
  it('inserts a borrower who is new to the sheet', () => {
    const out = diffTracking([{ fub_person_id: '2972', notes: 'hi', docs: [] }], [], NOW)
    expect(out).toEqual([
      { fub_person_id: '2972', notes: 'hi', last_seen_at: NOW, removed_at: null },
    ])
  })

  it('clears removed_at when a borrower returns to the sheet', () => {
    const existing = [{ fub_person_id: '2972', notes: '', removed_at: '2026-07-01T00:00:00.000Z' }]
    const out = diffTracking([{ fub_person_id: '2972', notes: 'back', docs: [] }], existing, NOW)
    expect(out[0].removed_at).toBeNull()
  })

  it('stamps removed_at for a borrower who dropped out', () => {
    const existing = [{ fub_person_id: '3104', notes: '', removed_at: null }]
    const out = diffTracking([], existing, NOW)
    expect(out).toEqual([
      { fub_person_id: '3104', notes: '', last_seen_at: undefined, removed_at: NOW },
    ])
  })

  it('does not re-stamp a borrower who was already removed', () => {
    const existing = [{ fub_person_id: '3104', notes: '', removed_at: '2026-07-01T00:00:00.000Z' }]
    expect(diffTracking([], existing, NOW)).toEqual([])
  })
})

describe('diffDocs', () => {
  const person = (docs) => [{ fub_person_id: '2972', notes: '', docs }]

  it('stamps first_requested_at when a doc first becomes needed', () => {
    const out = diffDocs(person([{ doc_type: 'W2', status: 'needed' }]), new Map(), NOW)
    expect(out).toEqual([
      {
        fub_person_id: '2972',
        doc_type: 'W2',
        status: 'needed',
        first_requested_at: NOW,
        received_at: null,
        removed_at: null,
      },
    ])
  })

  it('preserves the original first_requested_at while a doc stays needed', () => {
    const existing = new Map([
      ['2972', [{ doc_type: 'W2', status: 'needed', first_requested_at: '2026-07-08T00:00:00.000Z', received_at: null, removed_at: null }]],
    ])
    const out = diffDocs(person([{ doc_type: 'W2', status: 'needed' }]), existing, NOW)
    expect(out[0].first_requested_at).toBe('2026-07-08T00:00:00.000Z')
  })

  it('stamps received_at on needed -> received', () => {
    const existing = new Map([
      ['2972', [{ doc_type: 'W2', status: 'needed', first_requested_at: '2026-07-08T00:00:00.000Z', received_at: null, removed_at: null }]],
    ])
    const out = diffDocs(person([{ doc_type: 'W2', status: 'received' }]), existing, NOW)
    expect(out[0].status).toBe('received')
    expect(out[0].received_at).toBe(NOW)
    expect(out[0].first_requested_at).toBe('2026-07-08T00:00:00.000Z')
  })

  it('re-opens a doc on received -> needed, clearing received_at', () => {
    const existing = new Map([
      ['2972', [{ doc_type: 'W2', status: 'received', first_requested_at: '2026-07-01T00:00:00.000Z', received_at: '2026-07-10T00:00:00.000Z', removed_at: null }]],
    ])
    const out = diffDocs(person([{ doc_type: 'W2', status: 'needed' }]), existing, NOW)
    expect(out[0].received_at).toBeNull()
    expect(out[0].first_requested_at).toBe(NOW)
  })

  it('stamps removed_at when a doc disappears from the sheet', () => {
    const existing = new Map([
      ['2972', [{ doc_type: 'W2', status: 'needed', first_requested_at: NOW, received_at: null, removed_at: null }]],
    ])
    const out = diffDocs(person([]), existing, NOW)
    expect(out[0].removed_at).toBe(NOW)
  })

  it('emits nothing when nothing changed', () => {
    const existing = new Map([
      ['2972', [{ doc_type: 'W2', status: 'needed', first_requested_at: '2026-07-08T00:00:00.000Z', received_at: null, removed_at: null }]],
    ])
    expect(diffDocs(person([{ doc_type: 'W2', status: 'needed' }]), existing, NOW)).toEqual([])
  })
})
```

The "emits nothing when nothing changed" case matters: most runs of a 15-minute cron see no change at all, and re-upserting every row every cycle would churn `updated_at` on hundreds of rows for nothing.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- sheet-docs`
Expected: FAIL — `diffTracking is not a function`

- [ ] **Step 3: Write the implementation**

Append to `supabase/functions/_shared/sheet-docs.ts`:

```typescript
export interface TrackingRow {
  fub_person_id: string
  notes: string
  removed_at: string | null
}
export interface DocRow {
  doc_type: string
  status: 'needed' | 'received'
  first_requested_at: string | null
  received_at: string | null
  removed_at: string | null
}

// Tracking rows to upsert: everyone in the sheet (refreshing notes + last_seen),
// plus anyone who dropped out (stamped removed_at once, not on every run).
export function diffTracking(
  incoming: ParsedRow[],
  existing: TrackingRow[],
  nowIso: string,
) {
  const seen = new Set(incoming.map((r) => r.fub_person_id))
  const out: Record<string, unknown>[] = incoming.map((r) => ({
    fub_person_id: r.fub_person_id,
    notes: r.notes,
    last_seen_at: nowIso,
    removed_at: null,
  }))

  for (const e of existing) {
    if (seen.has(e.fub_person_id)) continue
    if (e.removed_at) continue // already gone; don't re-stamp
    out.push({
      fub_person_id: e.fub_person_id,
      notes: e.notes,
      last_seen_at: undefined,
      removed_at: nowIso,
    })
  }
  return out
}

// Doc rows to upsert, keyed by fub_person_id — the caller resolves tracking_id
// after the tracking upsert, since new borrowers have no id yet.
// Only CHANGED rows are emitted: a 15-minute cron mostly sees no change, and
// re-upserting everything every cycle would churn updated_at for nothing.
export function diffDocs(
  incoming: ParsedRow[],
  existingByPerson: Map<string, DocRow[]>,
  nowIso: string,
) {
  const out: Record<string, unknown>[] = []

  for (const person of incoming) {
    const prior = new Map((existingByPerson.get(person.fub_person_id) || []).map((d) => [d.doc_type, d]))
    const incomingTypes = new Set(person.docs.map((d) => d.doc_type))

    for (const doc of person.docs) {
      const was = prior.get(doc.doc_type)
      let first_requested_at = was?.first_requested_at ?? null
      let received_at = was?.received_at ?? null

      if (doc.status === 'needed') {
        // New, or re-opened after having been received: start a fresh clock.
        if (!was || was.status === 'received' || !first_requested_at) first_requested_at = nowIso
        received_at = null
      } else {
        if (!was || was.status === 'needed') received_at = nowIso
      }

      const unchanged =
        was &&
        was.status === doc.status &&
        was.first_requested_at === first_requested_at &&
        was.received_at === received_at &&
        was.removed_at === null
      if (unchanged) continue

      out.push({
        fub_person_id: person.fub_person_id,
        doc_type: doc.doc_type,
        status: doc.status,
        first_requested_at,
        received_at,
        removed_at: null,
      })
    }

    // Doc column disappeared from the sheet: soft-delete, never hard-delete.
    for (const [type, was] of prior) {
      if (incomingTypes.has(type) || was.removed_at) continue
      out.push({
        fub_person_id: person.fub_person_id,
        doc_type: type,
        status: was.status,
        first_requested_at: was.first_requested_at,
        received_at: was.received_at,
        removed_at: nowIso,
      })
    }
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- sheet-docs`
Expected: PASS, 20 tests

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/sheet-docs.ts supabase/functions/_shared/sheet-docs.test.js
git commit -m "feat: diff sheet rows against stored doc state, stamping aging"
```

---

## Task 4: Mass-removal guard

**Files:**
- Modify: `supabase/functions/_shared/sheet-docs.ts`
- Test: `supabase/functions/_shared/sheet-docs.test.js`

The single most important safety property in this sync. Arive has no API, so the sheet is the only source of truth — nothing exists to reconcile a bad wipe against.

- [ ] **Step 1: Write the failing test**

Append to `supabase/functions/_shared/sheet-docs.test.js`:

```javascript
import { assertNotMassRemoval } from './sheet-docs.ts'

describe('assertNotMassRemoval', () => {
  it('throws when the sheet reads empty but we previously had borrowers', () => {
    expect(() => assertNotMassRemoval(0, 42)).toThrow(/refusing/i)
  })

  it('names the prior count so the sync_log line is actionable', () => {
    expect(() => assertNotMassRemoval(0, 42)).toThrow(/42/)
  })

  it('allows an empty sheet on the very first run', () => {
    expect(() => assertNotMassRemoval(0, 0)).not.toThrow()
  })

  it('allows a normal run', () => {
    expect(() => assertNotMassRemoval(42, 42)).not.toThrow()
  })

  it('allows a large but non-total drop — only a TOTAL wipe is suspect', () => {
    expect(() => assertNotMassRemoval(1, 500)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- sheet-docs`
Expected: FAIL — `assertNotMassRemoval is not a function`

- [ ] **Step 3: Write the implementation**

Append to `supabase/functions/_shared/sheet-docs.ts`:

```typescript
// THE critical safety property of this sync.
//
// A sheet legitimately emptying overnight is not a real scenario. An auth
// failure, a renamed tab, or a revoked share IS. Without this guard, any of
// those stamps removed_at across every borrower and flips every card to "not
// tracked" — while the run logs ok. Arive has no API, so there is no second
// source that would ever correct it.
//
// Deliberately narrow: only a TOTAL wipe aborts. A drop from 500 to 1 is
// unusual but could be real, and blocking legitimate edits would train whoever
// maintains the sheet to ignore the alarm.
export function assertNotMassRemoval(incomingCount: number, previousCount: number) {
  if (incomingCount === 0 && previousCount > 0) {
    throw new Error(
      `refusing to apply an empty sheet: ${previousCount} borrowers are currently tracked. ` +
        `Check that the "Doc Status" tab exists and is still shared with the service account.`,
    )
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- sheet-docs`
Expected: PASS, 25 tests

- [ ] **Step 5: Mutation-test the guard**

Temporarily change the condition to `if (false)`:

Run: `npm test -- sheet-docs`
Expected: FAIL — the two throwing tests fail. If they still pass, the guard is not actually covered; fix the test before continuing.

Restore the real condition and re-run:

Run: `npm test -- sheet-docs`
Expected: PASS, 25 tests

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/sheet-docs.ts supabase/functions/_shared/sheet-docs.test.js
git commit -m "feat: guard against an empty sheet read wiping every borrower"
```

---

## Task 5: Migration 0021 — tables, RLS, indexes

**Files:**
- Create: `supabase/migrations/0021_borrower_docs.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Borrower document tracking, fed by sheets-docs-sync from a Google Sheet the
-- Bayway assistant maintains daily. Arive (the LOS) exposes no API and no
-- webhooks, so the sheet is the permanent source of truth for doc status.
--
-- Two tables on purpose: the presence of a borrower_doc_tracking row is what
-- lets a card distinguish "not tracked" from "tracked, owes nothing". One
-- table could not tell those apart.
--
-- Written by the service role; the app only SELECTs (read-only RLS, same shape
-- as tasks in 0017).

create table if not exists borrower_doc_tracking (
  id             bigserial primary key,
  fub_person_id  text not null unique,          -- contacts.external_id for source_crm='fub'
  contact_id     uuid references contacts(id),  -- null until that contact syncs
  notes          text,
  last_seen_at   timestamptz,
  removed_at     timestamptz,                   -- borrower dropped out of the sheet
  updated_at     timestamptz not null default now()
);

create table if not exists borrower_docs (
  id                  bigserial primary key,
  tracking_id         bigint not null references borrower_doc_tracking(id) on delete cascade,
  doc_type            text not null,            -- discovered from the sheet header row
  status              text not null check (status in ('needed', 'received')),
  first_requested_at  timestamptz,              -- stamped blank -> needed
  received_at         timestamptz,              -- stamped needed -> received
  removed_at          timestamptz,              -- doc column disappeared from the sheet
  updated_at          timestamptz not null default now(),
  unique (tracking_id, doc_type)
);

alter table borrower_doc_tracking enable row level security;
alter table borrower_docs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'borrower_doc_tracking'
      and policyname = 'authenticated read borrower_doc_tracking'
  ) then
    execute 'create policy "authenticated read borrower_doc_tracking" on borrower_doc_tracking for select to authenticated using (true)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'borrower_docs'
      and policyname = 'authenticated read borrower_docs'
  ) then
    execute 'create policy "authenticated read borrower_docs" on borrower_docs for select to authenticated using (true)';
  end if;
end $$;

-- The view's join key, and its outstanding-docs lateral.
create index if not exists idx_bdt_person  on borrower_doc_tracking (fub_person_id);
create index if not exists idx_bd_tracking on borrower_docs (tracking_id, status);
```

Nothing is ever hard-deleted. With the sheet as the only source of truth, the database is the sole backstop against a mistaken edit.

- [ ] **Step 2: Verify the SQL parses**

Run: `npx supabase db lint --file supabase/migrations/0021_borrower_docs.sql 2>/dev/null || echo "lint unavailable — review by eye"`
Expected: no syntax errors reported (the linter may be unavailable offline; a clean read-through is acceptable)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0021_borrower_docs.sql
git commit -m "feat: borrower_doc_tracking + borrower_docs tables"
```

---

## Task 6: Migration 0022 — extend `v_active_pipeline`

**Files:**
- Create: `supabase/migrations/0022_pipeline_docs_view.sql`

Columns are appended at the end so `create or replace view` keeps dependents valid — `v_bayway_contacts` joins this view. Same technique as 0016.

- [ ] **Step 1: Write the migration**

```sql
-- Surface borrower doc status and the last conversation note on the pipeline
-- board. Appended to v_active_pipeline (not a new view) so the Pipeline page
-- keeps one query. New columns go at the END so `create or replace view` keeps
-- dependents (v_bayway_contacts joins this view) valid — same rule as 0016.
-- Both laterals are null/empty for MPG: there is no Arive and no sheet there.

create or replace view public.v_active_pipeline
with (security_invoker = on) as
select id, business_id, name, email, phone, last_touch_at, stage, crm_profile_url,
       docs_tracked, docs_outstanding, docs_outstanding_count,
       docs_oldest_requested_at, doc_notes,
       last_note_snippet, last_note_at
from (
  select
    c.id,
    c.business_id,
    c.name,
    c.email,
    c.phone,
    c.last_touch_at,
    coalesce(
      (
        select regexp_replace(t.tag, '^Imported Stage: ', '')
        from jsonb_array_elements_text(
          case when jsonb_typeof(c.raw->'tags') = 'array'
               then c.raw->'tags' else '[]'::jsonb end
        ) with ordinality as t(tag, ord)
        where t.tag like 'Imported Stage: %'
        order by t.ord desc
        limit 1
      ),
      case when c.person_stage = 'Lead' then 'New Lead' end
    ) as stage,
    case c.business_id
      when 'bay' then 'https://baywayhtx.followupboss.com/2/people/view/' || c.external_id
      when 'mpg' then 'https://crm.zoho.com/crm/tab/Leads/' || c.external_id
    end as crm_profile_url,
    -- Presence of a tracking row IS the "tracked" signal: it distinguishes
    -- "not in the sheet" from "in the sheet, owes nothing".
    (bdt.id is not null) as docs_tracked,
    coalesce(d.names, '{}')::text[] as docs_outstanding,
    coalesce(d.cnt, 0) as docs_outstanding_count,
    d.oldest as docs_oldest_requested_at,
    bdt.notes as doc_notes,
    n.snippet as last_note_snippet,
    n.occurred_at as last_note_at
  from contacts c
  left join borrower_doc_tracking bdt
    on c.business_id = 'bay'
   and bdt.removed_at is null
   and bdt.fub_person_id = c.external_id
  -- Oldest-requested first, so the two names the card shows are always the two
  -- that have been outstanding longest.
  left join lateral (
    select array_agg(bd.doc_type order by bd.first_requested_at asc nulls last) as names,
           count(*)::int as cnt,
           min(bd.first_requested_at) as oldest
    from borrower_docs bd
    where bd.tracking_id = bdt.id
      and bd.status = 'needed'
      and bd.removed_at is null
  ) d on true
  left join lateral (
    select a.notes as snippet, a.occurred_at
    from activities a
    where a.contact_id = c.id
      and a.type = 'note'
    order by a.occurred_at desc nulls last, a.id desc
    limit 1
  ) n on c.business_id = 'bay'
) s
where stage is not null;
```

- [ ] **Step 2: Verify the SQL parses**

Run: `npx supabase db lint --file supabase/migrations/0022_pipeline_docs_view.sql 2>/dev/null || echo "lint unavailable — review by eye"`
Expected: no syntax errors

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0022_pipeline_docs_view.sql
git commit -m "feat: expose borrower docs and last note on v_active_pipeline"
```

---

## Task 7: The sync function

**Files:**
- Create: `supabase/functions/sheets-docs-sync/index.ts`

Orchestration only — every decision worth testing already lives in `sheet-docs.ts`.

- [ ] **Step 1: Write the function**

```typescript
// Scheduled Google Sheets -> borrower docs sync. Read-only against the sheet:
// only GETs, and the service account is shared as Viewer. Logs to sync_log
// under source 'sheets-docs'. See docs/phase-borrower-docs-setup.md.
//
// Full snapshot every run (no cursor), so Phase 14's cursor race cannot occur.
// The hazard here is the opposite one — an empty read looking like success —
// which assertNotMassRemoval handles before anything is written.

import { serviceClient, logSync } from '../_shared/db.ts'
import { getAccessToken } from '../_shared/google-auth.ts'
import {
  parseSheet,
  diffTracking,
  diffDocs,
  assertNotMassRemoval,
} from '../_shared/sheet-docs.ts'

const TAB = 'Doc Status'
const BATCH = 500

Deno.serve(async () => {
  const db = serviceClient()
  let upserted = 0

  try {
    const rawCreds = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')
    const sheetId = Deno.env.get('DOCS_SHEET_ID')
    if (!rawCreds || !sheetId) {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON / DOCS_SHEET_ID not set as function secrets')
    }

    // Auth first: a bad key must abort before we diff anything.
    const token = await getAccessToken(JSON.parse(rawCreds))
    const url =
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}` +
      `/values/${encodeURIComponent(TAB)}`
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } })
    if (!res.ok) throw new Error(`sheets read failed: ${res.status} ${await res.text()}`)
    const parsed = parseSheet(((await res.json())?.values as unknown[][]) || [])

    // Existing state. Fail loud on query errors: an empty map here would look
    // like "every borrower is new" and re-stamp every aging clock.
    const { data: trackRows, error: trackErr } = await db
      .from('borrower_doc_tracking')
      .select('id, fub_person_id, notes, removed_at')
    if (trackErr) throw new Error(`tracking read: ${trackErr.message}`)
    const existingTracking = trackRows || []

    const activeCount = existingTracking.filter((t) => !t.removed_at).length
    assertNotMassRemoval(parsed.rows.length, activeCount)

    const { data: docRows, error: docErr } = await db
      .from('borrower_docs')
      .select('tracking_id, doc_type, status, first_requested_at, received_at, removed_at')
    if (docErr) throw new Error(`docs read: ${docErr.message}`)

    const personByTrackingId = new Map(existingTracking.map((t) => [t.id, t.fub_person_id]))
    const existingDocsByPerson = new Map<string, unknown[]>()
    for (const d of docRows || []) {
      const person = personByTrackingId.get(d.tracking_id)
      if (!person) continue
      if (!existingDocsByPerson.has(person)) existingDocsByPerson.set(person, [])
      existingDocsByPerson.get(person)!.push(d)
    }

    const nowIso = new Date().toISOString()

    // Contact resolution. Same fail-loud rule as fub-task-sync: an empty map
    // would upsert every borrower with contact_id null while logging ok.
    const { data: contactRows, error: contactErr } = await db
      .from('contacts')
      .select('id, external_id')
      .eq('source_crm', 'fub')
    if (contactErr) throw new Error(`contact map: ${contactErr.message}`)
    const contactIdByExternal = new Map((contactRows || []).map((c) => [c.external_id, c.id]))

    // 1. Tracking rows first — doc rows need their ids.
    const tracking = diffTracking(parsed.rows, existingTracking, nowIso).map((t) => ({
      ...t,
      contact_id: contactIdByExternal.get(t.fub_person_id) ?? null,
      updated_at: nowIso,
    }))
    for (let i = 0; i < tracking.length; i += BATCH) {
      const { error } = await db
        .from('borrower_doc_tracking')
        .upsert(tracking.slice(i, i + BATCH), { onConflict: 'fub_person_id' })
      if (error) throw new Error(`tracking upsert: ${error.message}`)
    }

    // 2. Re-read ids so newly inserted borrowers resolve.
    const { data: afterRows, error: afterErr } = await db
      .from('borrower_doc_tracking')
      .select('id, fub_person_id')
    if (afterErr) throw new Error(`tracking id re-read: ${afterErr.message}`)
    const trackingIdByPerson = new Map((afterRows || []).map((t) => [t.fub_person_id, t.id]))

    // 3. Doc rows.
    const docs = diffDocs(parsed.rows, existingDocsByPerson as never, nowIso)
      .map((d) => {
        const { fub_person_id, ...rest } = d as Record<string, unknown>
        const tracking_id = trackingIdByPerson.get(fub_person_id as string)
        return tracking_id ? { ...rest, tracking_id, updated_at: nowIso } : null
      })
      .filter(Boolean) as Record<string, unknown>[]

    for (let i = 0; i < docs.length; i += BATCH) {
      const { error } = await db
        .from('borrower_docs')
        .upsert(docs.slice(i, i + BATCH), { onConflict: 'tracking_id,doc_type' })
      if (error) throw new Error(`docs upsert: ${error.message}`)
      upserted += Math.min(BATCH, docs.length - i)
    }

    const unresolved = parsed.rows.filter((r) => !contactIdByExternal.has(r.fub_person_id)).length
    const summary = [
      `borrowers:${parsed.rows.length} docChanges:${docs.length} trackingChanges:${tracking.length}`,
      parsed.skippedNoId ? `skipped ${parsed.skippedNoId} with a bad FUB ID` : '',
      parsed.skippedDuplicate ? `skipped ${parsed.skippedDuplicate} duplicate-ID rows` : '',
      parsed.unrecognizedValues ? `${parsed.unrecognizedValues} unrecognized cell values` : '',
      unresolved ? `${unresolved} not yet matched to a contact` : '',
    ]
      .filter(Boolean)
      .join(' | ')

    await logSync(db, 'sheets-docs', 'ok', upserted, summary)
    return new Response(JSON.stringify({ ok: true, upserted, borrowers: parsed.rows.length }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  } catch (err) {
    await logSync(db, 'sheets-docs', 'error', upserted, String(err?.message || err))
    return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
})
```

- [ ] **Step 2: Verify the whole suite still passes**

Run: `npm test`
Expected: PASS — 180 tests (155 existing + 25 new)

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/sheets-docs-sync/index.ts
git commit -m "feat: sheets-docs-sync edge function"
```

---

## Task 8: Migration 0023 — schedule the sync

**Files:**
- Create: `supabase/migrations/0023_schedule_sheets_docs_sync.sql`

- [ ] **Step 1: Write the migration**

Mirrors 0019 exactly, including the public anon bearer (safe to commit; the function is deployed `--no-verify-jwt`).

```sql
-- Schedule sheets-docs-sync every 15 minutes via pg_cron.
-- Mirrors 0002/0005/0008/0010/0019. pg_cron/pg_net already enabled. Bearer is
-- the public ANON key (safe to commit); the function is deployed --no-verify-jwt.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'sheets-docs-sync-15min',
  '*/15 * * * *',
  $job$
  select net.http_post(
    url := 'https://cnmipfxwqnbtkohfixkf.supabase.co/functions/v1/sheets-docs-sync',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubWlwZnh3cW5idGtvaGZpeGtmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2Mzc5NjYsImV4cCI6MjA5OTIxMzk2Nn0.tcOKs7O5gGAT2HsfiKKwI90TQ-CYVXSMB4yL9RvuxJU',
      'Content-Type', 'application/json'
    )
  );
  $job$
);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0023_schedule_sheets_docs_sync.sql
git commit -m "feat: schedule sheets-docs-sync every 15 minutes"
```

---

## Task 9: Card helpers

**Files:**
- Create: `src/lib/borrowerDocs.js`
- Test: `src/lib/borrowerDocs.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// src/lib/borrowerDocs.test.js
import { describe, it, expect } from 'vitest'
import { docsState, docSummary, isDocAging, DOC_AGING_DAYS } from './borrowerDocs'

const NOW = new Date('2026-07-20T12:00:00.000Z').getTime()

describe('docsState', () => {
  it('reports untracked for a borrower absent from the sheet', () => {
    expect(docsState({ docs_tracked: false, docs_outstanding_count: 0 })).toBe('untracked')
  })

  it('reports clear for a tracked borrower who owes nothing', () => {
    expect(docsState({ docs_tracked: true, docs_outstanding_count: 0 })).toBe('clear')
  })

  it('reports outstanding when docs are owed', () => {
    expect(docsState({ docs_tracked: true, docs_outstanding_count: 3 })).toBe('outstanding')
  })

  it('treats a missing docs_tracked field as untracked, not clear', () => {
    expect(docsState({})).toBe('untracked')
  })
})

describe('docSummary', () => {
  it('lists both names when exactly two are outstanding', () => {
    expect(docSummary(['Paystubs', 'W2'])).toBe('Paystubs, W2')
  })

  it('shows the first two and a +N overflow beyond that', () => {
    expect(docSummary(['Paystubs', 'W2', 'ID', 'Tax Returns'])).toBe('Paystubs, W2 +2')
  })

  it('shows a single name alone', () => {
    expect(docSummary(['Paystubs'])).toBe('Paystubs')
  })

  it('returns an empty string for no docs', () => {
    expect(docSummary([])).toBe('')
    expect(docSummary(null)).toBe('')
  })
})

describe('isDocAging', () => {
  it('is false below the threshold', () => {
    expect(isDocAging('2026-07-16T12:00:00.000Z', NOW)).toBe(false)
  })

  it('is true at exactly the threshold, matching STALE_TOUCH_DAYS', () => {
    expect(DOC_AGING_DAYS).toBe(7)
    expect(isDocAging('2026-07-13T12:00:00.000Z', NOW)).toBe(true)
  })

  it('is false when nothing has been requested', () => {
    expect(isDocAging(null, NOW)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- borrowerDocs`
Expected: FAIL — `Failed to resolve import "./borrowerDocs"`

- [ ] **Step 3: Write the implementation**

```javascript
// src/lib/borrowerDocs.js
// Pure helpers for the borrower-docs block on Bayway pipeline cards.
// No React, no I/O. Doc data arrives on v_active_pipeline rows (migration 0022)
// and is null/empty for MPG.
import { daysSince, STALE_TOUCH_DAYS } from './overview'

// The board keeps ONE notion of "too long": the docs badge goes amber on the
// same threshold the stale-touch pill already uses.
export const DOC_AGING_DAYS = STALE_TOUCH_DAYS

// How many doc names fit on a card before overflowing to "+N".
const NAMES_SHOWN = 2

// 'untracked' (absent from the sheet) is deliberately distinct from 'clear'
// (in the sheet, owes nothing). Collapsing them would let a borrower nobody has
// entered read as "all docs received", which is confidently wrong.
export function docsState(row) {
  if (!row?.docs_tracked) return 'untracked'
  return (row.docs_outstanding_count || 0) > 0 ? 'outstanding' : 'clear'
}

export function docSummary(names) {
  const list = Array.isArray(names) ? names : []
  if (list.length === 0) return ''
  const head = list.slice(0, NAMES_SHOWN).join(', ')
  const rest = list.length - NAMES_SHOWN
  return rest > 0 ? `${head} +${rest}` : head
}

export function isDocAging(oldestRequestedAt, now = Date.now()) {
  const d = daysSince(oldestRequestedAt, now)
  return d !== null && d >= DOC_AGING_DAYS
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- borrowerDocs`
Expected: PASS, 11 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/borrowerDocs.js src/lib/borrowerDocs.test.js
git commit -m "feat: pure helpers for the borrower-docs card block"
```

---

## Task 10: Render the card

**Files:**
- Modify: `src/pages/Pipeline.jsx` (imports at 1-5, `Card` at 28-55, `demoRows` at 85-89, `PIPELINE.bay.columns` at 97)

- [ ] **Step 1: Extend the Bayway column selection**

Replace line 97:

```javascript
    columns: 'id, business_id, name, email, phone, last_touch_at, stage, crm_profile_url',
```

with:

```javascript
    columns:
      'id, business_id, name, email, phone, last_touch_at, stage, crm_profile_url, ' +
      'docs_tracked, docs_outstanding, docs_outstanding_count, docs_oldest_requested_at, ' +
      'last_note_snippet, last_note_at',
```

MPG's config is untouched — `v_mpg_contacts` has no such columns.

- [ ] **Step 2: Add the imports**

Replace lines 1-5:

```javascript
import { useEffect, useState, useCallback } from 'react'
import { supabase, isDemoMode } from '../lib/supabase'
import { lastTouchLabel, daysSince, STALE_TOUCH_DAYS } from '../lib/overview'
import { buildColumns, MPG_LEAD_FLOW } from '../lib/pipeline'
import CrmLink from '../components/CrmLink'
```

with:

```javascript
import { useEffect, useState, useCallback } from 'react'
import { supabase, isDemoMode } from '../lib/supabase'
import { lastTouchLabel, daysSince, STALE_TOUCH_DAYS } from '../lib/overview'
import { buildColumns, MPG_LEAD_FLOW } from '../lib/pipeline'
import { docsState, docSummary, isDocAging } from '../lib/borrowerDocs'
import CrmLink from '../components/CrmLink'
```

- [ ] **Step 3: Add the docs block and note line to `Card`**

Replace the whole `Card` function (lines 28-55) with:

```javascript
// Docs live on Bayway cards only — there is no Arive and no sheet for MPG.
function DocsBlock({ r }) {
  const state = docsState(r)
  if (state === 'untracked') {
    return <div className="mt-1.5 text-[11px] text-dim">Docs not tracked</div>
  }
  if (state === 'clear') {
    return (
      <div className="mt-1.5 text-[11px]" style={{ color: 'var(--bay)' }}>
        ✓ All docs received
      </div>
    )
  }
  const aging = isDocAging(r.docs_oldest_requested_at)
  const days = daysSince(r.docs_oldest_requested_at)
  return (
    <div className="mt-1.5">
      <div
        className={`text-[11px] ${aging ? 'font-semibold' : 'text-muted'}`}
        style={aging ? { color: 'var(--bay-gold)' } : undefined}
      >
        {aging ? '⚠ ' : ''}
        {r.docs_outstanding_count} doc{r.docs_outstanding_count === 1 ? '' : 's'}
        {days !== null ? ` · oldest ${days}d` : ''}
      </div>
      <div className="truncate text-[11px] text-muted">{docSummary(r.docs_outstanding)}</div>
    </div>
  )
}

// One line, truncated. Omitted entirely when there is no note — an empty quote
// reads as "they said nothing" rather than "we have nothing on record".
function LastNote({ r }) {
  if (!r.last_note_snippet) return null
  const d = daysSince(r.last_note_at)
  return (
    <div className="mt-1.5 truncate text-[11px] text-muted">
      💬 “{r.last_note_snippet}”
      {d !== null ? <span className="text-dim"> · {d}d</span> : null}
    </div>
  )
}

function Card({ r, lost, biz }) {
  const d = daysSince(r.last_touch_at)
  const stale = d === null || d >= STALE_TOUCH_DAYS
  const accent = biz === 'mpg' ? 'var(--mpg)' : 'var(--bay)'
  // MPG cards are merchant-first (the company is the deal); Bayway is person-first.
  const headline = biz === 'mpg' ? r.company || r.name : r.name
  const sub = biz === 'mpg' ? r.name || r.phone || r.email : r.phone || r.email
  return (
    <div className="relative rounded-lg border border-line bg-panel2 px-3 py-2.5 pl-3.5">
      <span
        className="absolute bottom-2 left-0 top-2 w-[3px] rounded-sm"
        style={{ background: lost ? 'var(--dim)' : accent }}
      />
      <CrmLink url={r.crm_profile_url} className="block truncate text-[13px] font-semibold">
        {headline || '(no name)'}
      </CrmLink>
      <div className="mt-0.5 truncate text-[11.5px] text-muted">
        {sub || 'no contact info'}
      </div>
      <div
        className={`mt-1 text-[11px] ${stale ? 'font-semibold' : 'text-dim'}`}
        style={stale ? { color: 'var(--bay-gold)' } : undefined}
      >
        {lastTouchLabel(r.last_touch_at)}
      </div>
      {biz !== 'mpg' && !lost && (
        <>
          <DocsBlock r={r} />
          <LastNote r={r} />
        </>
      )}
    </div>
  )
}
```

Lost cards skip both blocks: a dead loan's outstanding paperwork is noise, and the lost column is the densest on the board.

- [ ] **Step 4: Extend the demo rows**

Replace lines 85-89:

```javascript
const demoRows = [
  { id: 'd1', stage: 'Waiting on Docs', name: 'Ramirez · Purchase', phone: '(713) 555-0142', last_touch_at: null, crm_profile_url: '#' },
  { id: 'd2', stage: 'Pre-Approved', name: 'Nguyen · Refi', phone: '(281) 555-0195', last_touch_at: null, crm_profile_url: '#' },
  { id: 'd3', stage: 'Pre-Approved', name: 'Okafor · Purchase', phone: '(832) 555-0110', last_touch_at: null, crm_profile_url: '#' },
]
```

with (covers all three docs states plus the missing-note case, so demo mode exercises every branch):

```javascript
const demoAge = (days) => new Date(Date.now() - days * 86_400_000).toISOString()

const demoRows = [
  {
    id: 'd1', stage: 'Waiting on Docs', name: 'Ramirez · Purchase', phone: '(713) 555-0142',
    last_touch_at: null, crm_profile_url: '#',
    docs_tracked: true, docs_outstanding: ['Paystubs', 'W2', 'Bank Statements'],
    docs_outstanding_count: 3, docs_oldest_requested_at: demoAge(12),
    last_note_snippet: 'Sending W2 tomorrow, has to dig up the 2024 one',
    last_note_at: demoAge(2),
  },
  {
    id: 'd2', stage: 'Pre-Approved', name: 'Nguyen · Refi', phone: '(281) 555-0195',
    last_touch_at: null, crm_profile_url: '#',
    docs_tracked: true, docs_outstanding: [], docs_outstanding_count: 0,
    docs_oldest_requested_at: null,
    last_note_snippet: 'Locked rate, clear to close', last_note_at: demoAge(1),
  },
  {
    id: 'd3', stage: 'Pre-Approved', name: 'Okafor · Purchase', phone: '(832) 555-0110',
    last_touch_at: null, crm_profile_url: '#',
    docs_tracked: false, docs_outstanding: [], docs_outstanding_count: 0,
    docs_oldest_requested_at: null, last_note_snippet: null, last_note_at: null,
  },
]
```

- [ ] **Step 5: Verify the build and suite**

Run: `npm test && npm run build`
Expected: PASS, 191 tests; build succeeds

- [ ] **Step 6: Verify in demo mode**

```bash
printf 'VITE_SUPABASE_URL=\nVITE_SUPABASE_ANON_KEY=\n' > .env.local
npm run dev
```

Open `http://localhost:5199/bayway/pipeline`. Use `get_page_text` — screenshots time out in this environment.

Expected on the board:
- Ramirez: `⚠ 3 docs · oldest 12d`, `Paystubs, W2 +1`, and the note line
- Nguyen: `✓ All docs received` and its note
- Okafor: `Docs not tracked`, no note line at all
- MPG pipeline (`/mpg/pipeline`): no docs block on any card
- Console clean

Then remove the override: `rm .env.local`

- [ ] **Step 7: Commit**

```bash
git add src/pages/Pipeline.jsx
git commit -m "feat: show outstanding docs and last note on Bayway pipeline cards"
```

---

## Task 11: Setup documentation

**Files:**
- Create: `docs/phase-borrower-docs-setup.md`

- [ ] **Step 1: Write the doc**

````markdown
# Borrower Docs — setup

Bayway pipeline cards show each borrower's outstanding documents, sourced from a
Google Sheet the assistant maintains daily. Arive exposes no API and no webhooks,
so the sheet is the permanent source of truth.

## 1. Build the sheet

One tab named exactly `Doc Status`. Row 1:

```
FUB ID | Borrower | Paystubs | W2 | Bank Statements | ID | Tax Returns | Notes
```

- `FUB ID` is **required** — the number from the FollowUpBoss profile URL
  (`https://baywayhtx.followupboss.com/2/people/view/2972` → `2972`). Rows without
  a numeric FUB ID are skipped and counted. Names are never matched.
- `Borrower` and `Notes` are optional. Everything else is a document type.
- Add or rename a document column and it appears on the cards next sync. No deploy.

Cell values: `Needed`, `Received`, or blank. Blank means the document is not
required for that loan.

**Add validation so typos cannot reach the sync:** select the document columns →
Data → Data validation → Dropdown → values `Needed` and `Received` → "Reject input".

## 2. Create the service account

1. Google Cloud console → create or pick a project.
2. Enable the **Google Sheets API**.
3. Create a **service account**, then create a **JSON key** for it.
4. Share the sheet with the service account's email address — **Viewer only**.
   The app must never be able to write to the assistant's sheet.

Do **not** use File → Share → Publish to web. A published sheet is readable by
anyone with the URL and has been search-indexed in the past; this sheet is
entirely borrower PII.

## 3. Set the secrets

```bash
supabase secrets set GOOGLE_SERVICE_ACCOUNT_JSON="$(cat path/to/key.json)"
supabase secrets set DOCS_SHEET_ID="<the long id in the sheet URL>"
```

PowerShell:

```powershell
supabase secrets set GOOGLE_SERVICE_ACCOUNT_JSON=(Get-Content path\to\key.json -Raw)
supabase secrets set DOCS_SHEET_ID="<the long id in the sheet URL>"
```

## 4. Deploy

```bash
supabase functions deploy sheets-docs-sync --no-verify-jwt
supabase db push
```

## 5. Verify

```bash
curl -X POST https://cnmipfxwqnbtkohfixkf.supabase.co/functions/v1/sheets-docs-sync
```

On Windows use `curl.exe` — PowerShell aliases `curl` to `Invoke-WebRequest`.

Expected: `{"ok":true,"upserted":N,"borrowers":N}`. The function returns its counts
in the HTTP response because `borrower_docs` and `sync_log` are `authenticated`-read,
so the anon REST API cannot read them back.

The 15-minute cron starts automatically once migration 0023 is applied.

## Reading sync_log

The `sheets-docs` line reports skipped rows and unmatched contacts:

```
borrowers:34 docChanges:2 trackingChanges:34 | skipped 1 with a bad FUB ID | 3 not yet matched to a contact
```

"not yet matched to a contact" is usually benign — the borrower is in the sheet but
their FUB contact has not synced yet. If it stays high, the FUB IDs in the sheet are
wrong.

## The empty-sheet guard

If the sheet reads as zero rows while borrowers are currently tracked, the sync
**aborts and writes nothing**, logging:

```
refusing to apply an empty sheet: 34 borrowers are currently tracked...
```

That means the read failed, not that the sheet emptied — check that the `Doc Status`
tab still exists and is still shared with the service account. Without this guard
every card would silently flip to "Docs not tracked", and with no API on the Arive
side nothing would ever correct it.
````

- [ ] **Step 2: Commit**

```bash
git add docs/phase-borrower-docs-setup.md
git commit -m "docs: borrower docs sheet + service account setup"
```

---

## Self-Review

**Spec coverage:** Sheet contract → Task 2 + Task 11. Service-account auth → Task 1. Schema → Task 5. View → Task 6. Sync + transitions → Tasks 3, 7. Mass-removal guard → Task 4 (mutation-tested per spec). Card UI and all five states → Tasks 9, 10. Testing section → covered per task. Out-of-scope items are absent by construction: no write path to the sheet exists anywhere in the plan.

**Placeholder scan:** No TBD/TODO. Every code step carries complete code.

**Type consistency:** `fub_person_id` (never `fubPersonId`) across sheet-docs, migrations, and the sync. `docs_outstanding` / `docs_outstanding_count` / `docs_oldest_requested_at` / `docs_tracked` / `last_note_snippet` / `last_note_at` identical in 0022, the `PIPELINE.bay.columns` string, `borrowerDocs.js`, and the demo rows. `parseSheet` returns `skippedNoId` / `skippedDuplicate` / `unrecognizedValues`, all three consumed in Task 7's summary. `assertNotMassRemoval(incoming, previous)` argument order matches its call site.

**Gap found and closed during review:** Task 10 originally rendered the docs block on lost-column cards too. Added the `!lost` guard — outstanding paperwork on a dead loan is noise in the densest column on the board.

---

## Deploy order

Migrations before the function, or the first cron tick fails against missing tables:

1. `supabase db push` (0021, 0022, 0023)
2. `supabase functions deploy sheets-docs-sync --no-verify-jwt`
3. Secrets must be set **before** the first tick, or it logs an error and retries in 15 minutes

Frontend ships whenever — `Pipeline.jsx` degrades to "Docs not tracked" on every card until the sync populates rows, which is the correct empty state rather than a broken one.
