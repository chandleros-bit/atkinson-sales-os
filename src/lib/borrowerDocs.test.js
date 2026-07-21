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
