import { describe, it, expect } from 'vitest'
import { pickNext, nextUpModel, itemKey } from './workNext'

const lists = [
  { key: 'calls', label: 'Calls', items: [{ id: 'c1' }, { id: 'c2' }] },
  { key: 'files', label: 'Files', items: [{ key: 'application:a1', contactId: 'a1' }] },
  { key: 'partners', label: 'Partners', items: [] },
]

describe('pickNext', () => {
  it('takes the first item of the list being worked', () => {
    expect(pickNext(lists, 'calls')).toMatchObject({ listKey: 'calls', item: { id: 'c1' }, index: 0, left: 2 })
    expect(pickNext(lists, 'files')).toMatchObject({ listKey: 'files', item: { key: 'application:a1' } })
  })

  it('skips items passed over, and moves to the next list when one runs out', () => {
    expect(pickNext(lists, 'calls', new Set(['contact:c1']))).toMatchObject({ item: { id: 'c2' }, index: 1, left: 1 })
    expect(pickNext(lists, 'calls', new Set(['contact:c1', 'contact:c2']))).toMatchObject({ listKey: 'files' })
    expect(pickNext(lists, 'partners')).toMatchObject({ listKey: 'calls' })
    expect(pickNext([{ key: 'calls', items: [] }], 'calls')).toBe(null)
  })

  it('keys file items by their key and calls by contact', () => {
    expect(itemKey({ key: 'estimate:e1', contactId: 'e1' })).toBe('estimate:e1')
    expect(itemKey({ id: 'c1' })).toBe('contact:c1')
  })
})

describe('nextUpModel', () => {
  it('reads a dial item, its lead note and the open loan', () => {
    const item = {
      id: 'p1', book: 'bay', kind: 'attempt', label: 'Attempt 2', hint: 'speed to lead',
      row: { id: 'p1', name: 'Priya Shah', phone: '7045550148', stage: 'Attempted', lead_source: 'Zillow', first_note: 'Credit: 700-739 / loan type: Conventional Purchase / state: North Carolina' },
    }
    const loan = { amount: 412000, stage: 'Submitted to UW', lender: 'UWM', buyer_agent_name: 'Jenna Kim', buyer_agent_phone: '7045550190' }
    const m = nextUpModel(item, { loan })
    expect(m).toMatchObject({ kind: 'call', contactId: 'p1', book: 'bay', name: 'Priya Shah', phone: '7045550148', why: 'Attempt 2 · speed to lead', cadence: true, est: '~10 min' })
    expect(m.chips).toEqual(['Source: Zillow', 'Credit 700-739', 'Conventional Purchase', '$412,000', 'North Carolina', 'Submitted to UW · UWM'])
    expect(m.agent).toEqual({ name: 'Jenna Kim', phone: '7045550190', company: null })
  })

  it('reads an Up Next row and a file item', () => {
    const row = { id: 'r1', business_id: 'mpg', name: 'Ana', phone: '555', bucket: 'overdue', oldest_open_due_at: new Date(Date.now() - 3 * 86_400_000).toISOString(), open_task_count: 1 }
    expect(nextUpModel(row)).toMatchObject({ kind: 'call', book: 'mpg', why: 'Follow-up 3 days overdue', tasks: 1 })
    const file = { key: 'application:a1', kind: 'application', book: 'bay', contactId: 'a1', name: 'Ivy', title: 'Review application', why: '2 docs missing', minutes: 20 }
    expect(nextUpModel(file)).toMatchObject({ kind: 'file', contactId: 'a1', name: 'Ivy', why: '2 docs missing', est: '~20 min', phone: null, task: 'Review application' })
    expect(nextUpModel(null)).toBe(null)
  })
})
