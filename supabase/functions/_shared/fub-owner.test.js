import { describe, it, expect } from 'vitest'
import { isMine, partitionByOwner, unresolvedPersonIds, keepActivityRecord, deletedInFub } from './fub-owner.ts'

describe('isMine', () => {
  it('matches FUB assignedUserId against the configured user, as strings', () => {
    expect(isMine({ assignedUserId: 6 }, '6')).toBe(true)
    expect(isMine({ assignedUserId: '6' }, 6)).toBe(true)
    expect(isMine({ assignedUserId: 2 }, '6')).toBe(false)
  })
  it('treats an unassigned record as not mine', () => {
    expect(isMine({}, '6')).toBe(false)
    expect(isMine({ assignedUserId: null }, '6')).toBe(false)
  })
  it('keeps everything when no user is configured (filter off)', () => {
    expect(isMine({ assignedUserId: 2 }, null)).toBe(true)
    expect(isMine({ assignedUserId: 2 }, '')).toBe(true)
  })
})

describe('partitionByOwner', () => {
  it('splits records into mine and others', () => {
    const recs = [{ id: 1, assignedUserId: 6 }, { id: 2, assignedUserId: 2 }, { id: 3 }]
    const { mine, others } = partitionByOwner(recs, '6')
    expect(mine.map((r) => r.id)).toEqual([1])
    expect(others.map((r) => r.id)).toEqual([2, 3])
  })
})

describe('activity filtering', () => {
  const map = new Map([['4821', 'uuid-mine']])

  it('lists person ids that are not in our (mine-only) contact map, once each', () => {
    const recs = [{ personId: 4821 }, { personId: 900 }, { person: { id: 900 } }, { personId: 901 }, {}]
    expect(unresolvedPersonIds(recs, map)).toEqual(['900', '901'])
  })

  it('keeps activity on my contacts and on people looked up as mine', () => {
    const ownerById = new Map([['900', '2'], ['901', '6']])
    expect(keepActivityRecord({ personId: 4821 }, map, ownerById, '6')).toBe(true)
    expect(keepActivityRecord({ personId: 901 }, map, ownerById, '6')).toBe(true)
  })

  it("drops activity on someone else's person", () => {
    const ownerById = new Map([['900', '2']])
    expect(keepActivityRecord({ personId: 900 }, map, ownerById, '6')).toBe(false)
  })

  it('keeps activity with no person, and keeps everything with the filter off', () => {
    expect(keepActivityRecord({}, map, new Map(), '6')).toBe(true)
    expect(keepActivityRecord({ personId: 900 }, map, new Map([['900', '2']]), null)).toBe(true)
  })

  it('keeps a person whose owner lookup failed rather than losing activity', () => {
    expect(keepActivityRecord({ personId: 902 }, map, new Map(), '6')).toBe(true)
  })
})

describe('deletedInFub', () => {
  const mirrored = Array.from({ length: 200 }, (_, i) => String(1000 + i))
  it('lists mirrored people a full FUB read no longer has', () => {
    const fetched = mirrored.filter((id) => id !== '1003' && id !== '1150').map((id) => ({ id: Number(id) }))
    expect(deletedInFub(mirrored, fetched)).toEqual({ ids: ['1003', '1150'], skipped: null })
  })
  it('skips when the read looks incomplete rather than delete a big slice of the book', () => {
    const fetched = mirrored.slice(0, 150).map((id) => ({ id }))
    expect(deletedInFub(mirrored, fetched)).toEqual({ ids: [], skipped: '50 missing of 200, more than the 10 allowed' })
    expect(deletedInFub(mirrored, [])).toEqual({ ids: [], skipped: 'FUB returned no people' })
  })
})
