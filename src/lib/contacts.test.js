import { describe, it, expect } from 'vitest'
import { filterContacts, sortContacts, NURTURE } from './contacts'

const rows = [
  { id: 1, name: 'Alice Adams', email: 'alice@x.com', phone: '281-000-0001', stage: 'Pre-Approved', last_touch_at: '2026-07-10T00:00:00Z' },
  { id: 2, name: 'Bob Brown', email: 'bob@y.com', phone: '832-000-0002', stage: 'Nurture', last_touch_at: '2026-07-01T00:00:00Z' },
  { id: 3, name: 'Carol Clark', email: null, phone: '713-555-9999', stage: 'Waiting on Docs', last_touch_at: null },
  { id: 4, name: 'Dave Diaz', email: 'dave@z.com', phone: '469-000-0004', stage: 'Nurture', last_touch_at: '2026-07-05T00:00:00Z' },
]

describe('filterContacts', () => {
  it('empty query keeps all rows', () => {
    expect(filterContacts(rows, { query: '', stageFilter: 'all' })).toHaveLength(4)
  })
  it('matches name case-insensitively', () => {
    const r = filterContacts(rows, { query: 'alice', stageFilter: 'all' })
    expect(r.map((x) => x.id)).toEqual([1])
  })
  it('matches email and phone substrings', () => {
    expect(filterContacts(rows, { query: 'bob@y', stageFilter: 'all' }).map((x) => x.id)).toEqual([2])
    expect(filterContacts(rows, { query: '555-9999', stageFilter: 'all' }).map((x) => x.id)).toEqual([3])
  })
  it('matches company substrings', () => {
    const withCo = [
      { id: 10, name: 'Zed', email: null, phone: '000', stage: 'Open', company: 'Craft Pita Mediterranean', last_touch_at: null },
      { id: 11, name: 'Yan', email: null, phone: '111', stage: 'Open', company: 'Smash City Burgers', last_touch_at: null },
    ]
    expect(filterContacts(withCo, { query: 'craft pita', stageFilter: 'all' }).map((x) => x.id)).toEqual([10])
  })
  it('trims and lowercases the query', () => {
    expect(filterContacts(rows, { query: '  CAROL ', stageFilter: 'all' }).map((x) => x.id)).toEqual([3])
  })
  it('stageFilter active keeps non-Nurture', () => {
    expect(filterContacts(rows, { query: '', stageFilter: 'active' }).map((x) => x.id)).toEqual([1, 3])
  })
  it('stageFilter nurture keeps Nurture only', () => {
    expect(filterContacts(rows, { query: '', stageFilter: 'nurture' }).map((x) => x.id)).toEqual([2, 4])
  })
  it('combines query and stageFilter', () => {
    expect(filterContacts(rows, { query: 'a', stageFilter: 'active' }).map((x) => x.id)).toEqual([1, 3])
  })
  it('does not mutate the input', () => {
    const copy = [...rows]
    filterContacts(rows, { query: 'alice', stageFilter: 'all' })
    expect(rows).toEqual(copy)
  })
})

describe('sortContacts', () => {
  it('sorts by name ascending', () => {
    expect(sortContacts(rows, { key: 'name', dir: 'asc' }).map((x) => x.id)).toEqual([1, 2, 3, 4])
  })
  it('sorts by name descending', () => {
    expect(sortContacts(rows, { key: 'name', dir: 'desc' }).map((x) => x.id)).toEqual([4, 3, 2, 1])
  })
  it('sorts by last_touch_at descending with nulls last', () => {
    expect(sortContacts(rows, { key: 'last_touch_at', dir: 'desc' }).map((x) => x.id)).toEqual([1, 4, 2, 3])
  })
  it('sorts by last_touch_at ascending with nulls still last', () => {
    expect(sortContacts(rows, { key: 'last_touch_at', dir: 'asc' }).map((x) => x.id)).toEqual([2, 4, 1, 3])
  })
  it('sorts by stage ascending', () => {
    expect(sortContacts(rows, { key: 'stage', dir: 'asc' }).map((x) => x.stage)).toEqual([
      'Nurture', 'Nurture', 'Pre-Approved', 'Waiting on Docs',
    ])
  })
  it('does not mutate the input', () => {
    const copy = [...rows]
    sortContacts(rows, { key: 'name', dir: 'asc' })
    expect(rows).toEqual(copy)
  })
})
