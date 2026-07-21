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
