import { describe, it, expect } from 'vitest'
import { cardTabs, detailRows, loanView, priorityLine } from './contactCard'

const NOW = new Date('2026-10-26T12:00:00').getTime()
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString()

describe('cardTabs', () => {
  it('Notes first; Loan only for Bayway', () => {
    expect(cardTabs('bay').map((t) => t.id)).toEqual(['notes', 'activity', 'loan', 'details'])
    expect(cardTabs('mpg').map((t) => t.id)).toEqual(['notes', 'activity', 'details'])
  })
})

describe('detailRows', () => {
  const person = { business_id: 'bay', stage: 'Attempted', email: 'a@b.co', company: 'Ignored Co' }
  it('lists what is known, skipping blanks', () => {
    const rows = detailRows(
      {
        person,
        signal: { lead_source: 'LendingFlow', crm_created_at: '2026-10-01T15:00:00Z', last_outbound_call_at: daysAgo(3) },
        contact: { owner: 'Chandler Atkinson', tags: ['DSCR', ' attempted ', ''] },
      },
      NOW,
    )
    expect(rows.map((r) => r.k)).toEqual(['Stage', 'Lead source', 'Owner', 'Created', 'Last call', 'Email', 'Tags'])
    expect(rows.find((r) => r.k === 'Created').v).toBe('Oct 1, 2026')
    expect(rows.find((r) => r.k === 'Last call').v).toMatch(/· 3d ago$/)
    expect(rows.find((r) => r.k === 'Tags').v).toBe('DSCR, attempted')
  })
  it('MPG shows the company; an unknown source and no calls read plainly', () => {
    const rows = detailRows({ person: { ...person, business_id: 'mpg' }, signal: { lead_source: '<unspecified>' }, contact: null }, NOW)
    expect(rows.find((r) => r.k === 'Company').v).toBe('Ignored Co')
    expect(rows.find((r) => r.k === 'Lead source')).toBeUndefined()
    expect(rows.find((r) => r.k === 'Last call').v).toBe('No calls logged')
  })
  it('nothing without a person', () => {
    expect(detailRows({})).toEqual([])
  })
})

describe('loanView', () => {
  const firstNote = 'Credit: 660-699 / loan type: DSCR Purchase / state: North Carolina / loan amount: $200K - $500K'
  it('the lead form scenario as facts', () => {
    expect(loanView({ firstNote }).facts.map((f) => f.k)).toEqual(['Credit', 'Loan type', 'State', 'Amount'])
  })
  it('docs: untracked, missing and aging', () => {
    expect(loanView({ firstNote, board: null }).docs).toBeNull()
    const v = loanView({ firstNote, board: { docs_tracked: true, docs_outstanding: ['W2', 'Bank statements'], docs_oldest_requested_at: daysAgo(9), doc_notes: 'Asked twice' } }, NOW)
    expect(v.docs).toEqual({ missing: ['W2', 'Bank statements'], oldestDays: 9, aging: true, notes: 'Asked twice' })
    expect(loanView({ board: { docs_tracked: true, docs_outstanding: [] } }, NOW).docs).toMatchObject({ missing: [], aging: false })
  })
})

describe('priorityLine', () => {
  it('tier, rounded score and the note', () => {
    expect(priorityLine({ tier: 'hot', score: 91.6, ai_note: 'Pre-approved, shopping' })).toEqual({ tier: 'Hot', score: 92, note: 'Pre-approved, shopping' })
  })
  it('nothing when the lead is not scored', () => {
    expect(priorityLine(null)).toBeNull()
    expect(priorityLine({ tier: 'warm', score: null })).toBeNull()
  })
})
