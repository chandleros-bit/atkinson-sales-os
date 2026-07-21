// Pure sheet parsing for sheets-docs-sync. No I/O, no Deno APIs, so this is
// unit-tested under Vitest exactly like fub-tasks.ts.
//
// The SHEET is wide (one row per borrower, one column per doc type) because
// that is fastest for the assistant maintaining it daily. The TABLES are long.
// This module is where the pivot happens.
//
// Sheet shape example:
// | FUB ID | Borrower | Paystubs | W2 | Bank Statements | Notes |
// |--------|----------|----------|----|--------------------|-------|
// | 2972   | Sarah    | Needed   | Received | | note text |
//
// - FUB ID is the join key (matches contacts.external_id). Required, must be numeric.
// - Borrower and Notes are reserved columns (not document types).
// - Every other column is a document type, discovered at runtime from the header.
// - Cell values: "Needed", "Received", or blank (anything else is unrecognized).

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

export interface UnrecognizedSample {
  fub_person_id: string
  doc_type: string
  value: string
}

export interface ParsedSheet {
  docTypes: string[]
  rows: ParsedRow[]
  skippedNoId: number
  skippedDuplicate: number
  skippedDuplicateHeaders: number
  unrecognizedValues: number
  unrecognizedSamples: UnrecognizedSample[]
}

// Normalize a cell value: convert to string, trim whitespace.
const norm = (v: unknown) => String(v ?? '').trim()

// Parse a cell status value: Needed -> 'needed', Received -> 'received', blank -> null,
// anything else -> 'bad' (unrecognized but will be counted).
function cellStatus(v: unknown): 'needed' | 'received' | null | 'bad' {
  const s = norm(v).toLowerCase()
  if (s === '') return null
  if (s === 'needed') return 'needed'
  if (s === 'received') return 'received'
  return 'bad'
}

export function parseSheet(values: unknown[][]): ParsedSheet {
  const header = values?.[0]
  // An absent header means the tab was renamed, moved, or the read failed. Reporting
  // "0 rows" here would hand a false empty to the mass-removal guard — that's worse
  // than forcing the sync to throw and stay visible in logs.
  if (!Array.isArray(header) || header.length === 0) {
    throw new Error('sheet has no header row — check the tab name')
  }

  // Normalize headers: trim and match case-insensitively.
  const headers = header.map((h) => norm(h))
  const lower = headers.map((h) => h.toLowerCase())

  // Find the required FUB ID column.
  const idIdx = lower.indexOf(ID_HEADER)
  if (idIdx === -1) throw new Error(`sheet is missing the required "FUB ID" column`)

  // Find the optional Notes column.
  const notesIdx = lower.indexOf('notes')

  // Discover document columns: everything that's not FUB ID, Borrower, or Notes.
  const docCols: { idx: number; name: string }[] = []
  headers.forEach((name, idx) => {
    if (name && !RESERVED.has(lower[idx])) {
      docCols.push({ idx, name })
    }
  })

  // Detect and exclude duplicate doc-type headers (same normalized name).
  // Treat ambiguous headers like ambiguous FUB IDs: drop them entirely.
  const docColsByLower = new Map<string, { idx: number; name: string }[]>()
  for (const col of docCols) {
    const colLower = col.name.toLowerCase()
    if (!docColsByLower.has(colLower)) {
      docColsByLower.set(colLower, [])
    }
    docColsByLower.get(colLower)!.push(col)
  }

  let skippedDuplicateHeaders = 0
  const validDocCols = docCols.filter((col) => {
    const colLower = col.name.toLowerCase()
    const duplicates = docColsByLower.get(colLower)!
    if (duplicates.length > 1) {
      skippedDuplicateHeaders++
      return false
    }
    return true
  })

  let skippedNoId = 0
  let unrecognizedValues = 0
  const unrecognizedSamples: UnrecognizedSample[] = []
  const byId = new Map<string, ParsedRow>()
  const idOccurrences = new Map<string, number>() // Track count of each ID
  const duplicated = new Set<string>()

  // Parse data rows (skip the header at index 0).
  for (const raw of values.slice(1)) {
    const row = Array.isArray(raw) ? raw : []
    const id = norm(row[idIdx])

    // Validate FUB ID: must be numeric. Empty rows (spreadsheet padding) don't count
    // as errors, but rows with data in other columns must have a valid ID.
    if (!/^\d+$/.test(id)) {
      // Only count as a skip if the row has actual content (non-empty cells).
      // A wholly blank row is just spreadsheet padding, not a data error.
      if (row.some((c) => norm(c) !== '')) skippedNoId++
      continue
    }

    // Track occurrence count for this ID (increment before checking duplicates).
    const currentCount = (idOccurrences.get(id) || 0) + 1
    idOccurrences.set(id, currentCount)

    // Check for duplicates: skip all occurrences rather than guessing which is right.
    if (currentCount > 1) {
      duplicated.add(id)
      continue
    }

    // Pivot the wide row into a long row with one doc per doc type.
    const docs: ParsedDoc[] = []
    for (const col of validDocCols) {
      const st = cellStatus(row[col.idx])
      if (st === 'bad') {
        // Unrecognized cell value (not Needed, Received, or blank).
        unrecognizedValues++
        // Capture sample for debugging (cap at 10).
        if (unrecognizedSamples.length < 10) {
          unrecognizedSamples.push({
            fub_person_id: id,
            doc_type: col.name,
            value: norm(row[col.idx]),
          })
        }
        continue
      }
      if (st) {
        // Recognized status (needed or received): add to docs array.
        // Skip blanks (st === null).
        docs.push({ doc_type: col.name, status: st })
      }
    }

    byId.set(id, {
      fub_person_id: id,
      notes: notesIdx === -1 ? '' : norm(row[notesIdx]),
      docs,
    })
  }

  // Remove all copies of any duplicated FUB ID. Sum the actual occurrence count
  // for each duplicated ID (so 3 copies = skipped 3, not 2).
  let skippedDuplicate = 0
  for (const id of duplicated) {
    byId.delete(id)
    skippedDuplicate += idOccurrences.get(id) || 0
  }

  return {
    docTypes: validDocCols.map((c) => c.name),
    rows: [...byId.values()],
    skippedNoId,
    skippedDuplicate,
    skippedDuplicateHeaders,
    unrecognizedValues,
    unrecognizedSamples,
  }
}

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
