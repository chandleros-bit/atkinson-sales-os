import { describe, it, expect } from 'vitest'
import { parseSheet, diffTracking, diffDocs } from './sheet-docs.ts'

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

  // Issue 1: skippedDuplicate should count actual occurrences, not assume 2
  it('counts the actual number of occurrences for a duplicated FUB ID', () => {
    const out = parseSheet([
      HEADER,
      ['2972', 'First', 'Needed', '', '', ''],
      ['2972', 'Second', 'Received', '', '', ''],
      ['2972', 'Third', 'Needed', '', '', ''],
      ['3104', 'Unique', 'Needed', '', '', ''],
    ])
    expect(out.rows.map((r) => r.fub_person_id)).toEqual(['3104'])
    expect(out.skippedDuplicate).toBe(3)
  })

  // Issue 2: Duplicate doc-type headers should be excluded
  it('excludes duplicate doc-type headers (same name, case-insensitive)', () => {
    const out = parseSheet([
      ['FUB ID', 'Borrower', 'W2', 'w2', 'Paystubs', 'Notes'],
      ['2972', 'Sarah', 'Needed', 'Received', 'Needed', ''],
    ])
    // Both W2 columns are excluded; only Paystubs remains
    expect(out.docTypes).toEqual(['Paystubs'])
    expect(out.rows[0].docs).toEqual([{ doc_type: 'Paystubs', status: 'needed' }])
    expect(out.skippedDuplicateHeaders).toBe(2)
  })

  it('still parses other doc columns when one header is duplicated', () => {
    const out = parseSheet([
      ['FUB ID', 'Borrower', 'W2', 'W2', 'Paystubs', 'Bank Statements', 'Notes'],
      ['2972', 'Sarah', 'Needed', 'Received', 'Received', 'Needed', ''],
    ])
    expect(out.docTypes).toEqual(['Paystubs', 'Bank Statements'])
    expect(out.skippedDuplicateHeaders).toBe(2)
    expect(out.rows[0].docs).toEqual([
      { doc_type: 'Paystubs', status: 'received' },
      { doc_type: 'Bank Statements', status: 'needed' },
    ])
  })

  // Issue 3: unrecognizedSamples should capture values with a cap at 10
  it('captures unrecognized value samples up to a cap of 10', () => {
    const rows = [HEADER]
    for (let i = 0; i < 15; i++) {
      rows.push([String(3000 + i), `Person${i}`, `BadValue${i}`, 'Needed', '', ''])
    }
    const out = parseSheet(rows)
    expect(out.unrecognizedValues).toBe(15)
    expect(out.unrecognizedSamples).toHaveLength(10)
    expect(out.unrecognizedSamples[0]).toEqual({
      fub_person_id: '3000',
      doc_type: 'Paystubs',
      value: 'BadValue0',
    })
    expect(out.unrecognizedSamples[9]).toEqual({
      fub_person_id: '3009',
      doc_type: 'Paystubs',
      value: 'BadValue9',
    })
  })

  it('includes unrecognized samples in results even when count is low', () => {
    const out = parseSheet([
      HEADER,
      ['2972', 'Sarah', 'InvalidStatus', 'Needed', '', ''],
    ])
    expect(out.unrecognizedValues).toBe(1)
    expect(out.unrecognizedSamples).toEqual([
      {
        fub_person_id: '2972',
        doc_type: 'Paystubs',
        value: 'InvalidStatus',
      },
    ])
  })
})

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
    expect(out).toEqual([])
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
