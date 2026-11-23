import { describe, it, expect } from 'vitest'
import { workLists, freshLead } from './workLists'

const NOW = new Date('2026-11-24T10:00:00').getTime()
const MIN = 60_000
const yesterday = NOW - 24 * 60 * MIN

const dial = {
  dueNow: [{ id: 'd1', dueAt: NOW - 5 * MIN }, { id: 'd2', dueAt: yesterday }],
  laterToday: [{ id: 'd3', dueAt: NOW + 60 * MIN }],
}
const groups = [
  { id: 'estimates', items: [{ late: true }, { late: false }] },
  { id: 'statements', items: [{ late: true }] },
  { id: 'waiting', items: [{ late: true }, {}] },
]
const queue = [
  { id: 'r1', bucket: 'reached_out' },
  { id: 'o1', bucket: 'overdue' },
  { id: 'd1', bucket: 'overdue' }, // already on the cadence: not twice
  { id: 'q1', bucket: 'quiet' }, // not a list item
]
const theme = (key, label) => ({ theme: { key, label }, items: [{ id: 't1', dueAt: yesterday }, { id: 't2', dueAt: NOW }] })

describe('workLists', () => {
  it('puts a realtor theme in Partners (Monday)', () => {
    const [calls, files, partners] = workLists({ dial, groups, queue, theme: theme('new_realtor', 'New realtors'), now: NOW })
    expect(calls.items.map((i) => i.id)).toEqual(['r1', 'o1', 'd1', 'd2', 'd3'])
    expect(calls).toMatchObject({ count: 5, flagged: 2 })
    expect(calls.flaggedItems.map((i) => i.id)).toEqual(['o1', 'd2'])
    expect(calls.sub).toBe('1 reached out · 1 later today')
    expect(files).toMatchObject({ key: 'files', count: 3, flagged: 2 })
    expect(files.sub).toContain('2 parked')
    expect(partners).toMatchObject({ count: 2, flagged: 1, sub: 'Today: new realtors' })
  })

  it('puts a borrower theme at the top of Calls after reached out (Tuesday)', () => {
    const [calls, , partners] = workLists({ dial, groups, queue, theme: theme('loan_status', 'Loan status'), now: NOW })
    expect(calls.items.map((i) => i.id)).toEqual(['r1', 't1', 't2', 'o1', 'd1', 'd2', 'd3'])
    expect(calls.flagged).toBe(3)
    expect(calls.sub).toContain('loan status first')
    expect(partners).toMatchObject({ count: 0, sub: 'No partner list today · loan status is in Calls' })
  })

  it('handles empty inputs and a weekend with no theme', () => {
    const lists = workLists({ dial: null, groups: null, theme: { theme: null, items: [] }, now: NOW })
    expect(lists.map((l) => l.count)).toEqual([0, 0, 0])
    expect(lists[2].sub).toBe('No partner list on weekends')
  })
})

describe('freshLead', () => {
  it('picks the newest first attempt under 30 minutes old', () => {
    const d = {
      dueNow: [
        { id: 'old', kind: 'attempt', step: 1, dueAt: NOW - 45 * MIN },
        { id: 'a', kind: 'attempt', step: 1, dueAt: NOW - 20 * MIN },
        { id: 'b', kind: 'attempt', step: 1, dueAt: NOW - 4 * MIN },
        { id: 'c', kind: 'attempt', step: 2, dueAt: NOW - 1 * MIN },
      ],
    }
    expect(freshLead(d, NOW).id).toBe('b')
    expect(freshLead({ dueNow: [d.dueNow[0]] }, NOW)).toBe(null)
    expect(freshLead(null, NOW)).toBe(null)
  })
})
