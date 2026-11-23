import { describe, it, expect } from 'vitest'
import { workLists, freshLead } from './workLists'

const NOW = new Date('2026-11-24T10:00:00').getTime()
const MIN = 60_000
const yesterday = NOW - 24 * 60 * MIN

describe('workLists', () => {
  const dial = {
    dueNow: [{ id: 1, dueAt: NOW - 5 * MIN }, { id: 2, dueAt: yesterday }],
    laterToday: [{ id: 3, dueAt: NOW + 60 * MIN }],
  }
  const groups = [
    { id: 'estimates', items: [{ late: true }, { late: false }] },
    { id: 'statements', items: [{ late: true }] },
    { id: 'waiting', items: [{ late: true }, {}] },
  ]
  const theme = { theme: { label: 'New realtors' }, items: [{ dueAt: yesterday }, { dueAt: NOW }, { dueAt: NOW }] }

  it('counts each list and its flagged items', () => {
    const [calls, files, partners] = workLists({ dial, groups, theme, now: NOW })
    expect(calls).toMatchObject({ key: 'calls', label: 'Calls', count: 3, flagged: 1, sub: '2 due now · 1 later today' })
    expect(files).toMatchObject({ key: 'files', count: 3, flagged: 2 })
    expect(files.sub).toContain('2 parked')
    expect(partners).toMatchObject({ key: 'partners', count: 3, flagged: 1, sub: 'Today: new realtors' })
  })

  it('handles empty inputs and a weekend with no theme', () => {
    const lists = workLists({ dial: null, groups: null, theme: { theme: null, items: [] }, now: NOW })
    expect(lists.map((l) => l.count)).toEqual([0, 0, 0])
    expect(lists[2].sub).toBe('No partner list on weekends')
  })
})

describe('freshLead', () => {
  it('picks the newest first attempt under 30 minutes old', () => {
    const dial = {
      dueNow: [
        { id: 'old', kind: 'attempt', step: 1, dueAt: NOW - 45 * MIN },
        { id: 'a', kind: 'attempt', step: 1, dueAt: NOW - 20 * MIN },
        { id: 'b', kind: 'attempt', step: 1, dueAt: NOW - 4 * MIN },
        { id: 'c', kind: 'attempt', step: 2, dueAt: NOW - 1 * MIN },
      ],
    }
    expect(freshLead(dial, NOW).id).toBe('b')
    expect(freshLead({ dueNow: [dial.dueNow[0]] }, NOW)).toBe(null)
    expect(freshLead(null, NOW)).toBe(null)
  })
})
