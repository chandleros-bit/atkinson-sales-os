import { describe, it, expect } from 'vitest'
import { docRows, docSummary, cleanDocName } from './docChecklist'

const NOW = Date.parse('2026-11-05T15:00:00Z')
const ago = (d) => new Date(NOW - d * 86400000).toISOString()
const rows = [
  { id: 1, doc_type: 'W2', status: 'needed', first_requested_at: ago(3), received_at: null, received_by_name: null },
  { id: 2, doc_type: 'Bank statements', status: 'needed', first_requested_at: ago(12), received_at: null, received_by_name: null },
  { id: 3, doc_type: 'ID', status: 'received', first_requested_at: ago(12), received_at: '2026-11-02T16:00:00Z', received_by_name: 'Shelby Atkinson' },
  { id: 4, doc_type: 'Tax returns', status: 'received', first_requested_at: ago(12), received_at: '2026-11-03T16:00:00Z', received_by_name: 'Chandler Atkinson' },
]

describe('docRows', () => {
  it('lists Needed oldest first, then Received newest first', () => {
    expect(docRows(rows, NOW).map((r) => r.name)).toEqual(['Bank statements', 'W2', 'Tax returns', 'ID'])
  })
  it('gives needed docs their days and a chase flag at 7+ days', () => {
    const [bank, w2] = docRows(rows, NOW)
    expect(bank).toMatchObject({ status: 'needed', days: 12, chase: true, label: '12d' })
    expect(w2).toMatchObject({ days: 3, chase: false, label: '3d' })
  })
  it('labels received docs with the date and first name', () => {
    expect(docRows(rows, NOW)[3]).toMatchObject({ status: 'received', chase: false, label: 'Nov 2 · Shelby' })
  })
  it('handles a received doc with no name', () => {
    const r = docRows([{ ...rows[2], received_by_name: null }], NOW)[0]
    expect(r.label).toBe('Nov 2')
  })
})

describe('docSummary', () => {
  it('counts needed of total and the oldest wait', () => {
    expect(docSummary(rows, NOW)).toEqual({ needed: 2, total: 4, oldestDays: 12 })
  })
  it('has no oldest when nothing is needed', () => {
    expect(docSummary([rows[2]], NOW)).toEqual({ needed: 0, total: 1, oldestDays: null })
  })
})

describe('cleanDocName', () => {
  it('trims', () => expect(cleanDocName('  Gift letter ')).toBe('Gift letter'))
  it('refuses blank and over 60 characters', () => {
    expect(cleanDocName('   ')).toBe(null)
    expect(cleanDocName('x'.repeat(61))).toBe(null)
    expect(cleanDocName('x'.repeat(60))).toBe('x'.repeat(60))
  })
})
