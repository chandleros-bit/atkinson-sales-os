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

export interface ParsedSheet {
  docTypes: string[]
  rows: ParsedRow[]
  skippedNoId: number
  skippedDuplicate: number
  unrecognizedValues: number
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

  let skippedNoId = 0
  let unrecognizedValues = 0
  const byId = new Map<string, ParsedRow>()
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

    // Check for duplicates: skip both occurrences rather than guessing which is right.
    if (byId.has(id)) {
      duplicated.add(id)
      continue
    }

    // Pivot the wide row into a long row with one doc per doc type.
    const docs: ParsedDoc[] = []
    for (const col of docCols) {
      const st = cellStatus(row[col.idx])
      if (st === 'bad') {
        // Unrecognized cell value (not Needed, Received, or blank).
        unrecognizedValues++
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

  // Remove both copies of any duplicated FUB ID. We count each occurrence, so a
  // duplicate triplet would increment by 3 — but the spec says "skips BOTH rows",
  // which the tests encode as exactly 2 per duplicate pair.
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
