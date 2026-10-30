import { describe, it, expect } from 'vitest'
import { relationshipKind, mapRelationship, relationshipsOf } from './fub-relationships.ts'

describe('relationshipKind', () => {
  it('reads buyer agent types loosely', () => {
    for (const t of ["Buyer's Agent", 'Buyer Agent', 'Buyers Agent', 'buyer’s agent', 'Buying Agent', "Buyer's Realtor"]) {
      expect(relationshipKind(t)).toBe('buyer_agent')
    }
  })
  it('reads seller and listing agent types loosely', () => {
    for (const t of ["Seller's Agent", 'Seller Agent', 'Listing Agent', 'Sellers agent', 'Selling Agent']) {
      expect(relationshipKind(t)).toBe('seller_agent')
    }
  })
  it('ignores every other relationship', () => {
    for (const t of ['Spouse', 'Agent', 'Buyer', 'Co-borrower', '', null, undefined]) {
      expect(relationshipKind(t)).toBe(null)
    }
  })
})

describe('mapRelationship', () => {
  const rec = {
    id: 77,
    personId: 12,
    type: "Buyer's Agent",
    firstName: 'Jane',
    lastName: 'Smith',
    phones: [{ value: '(281) 555-0100', isPrimary: false }, { value: '713-555-0199', isPrimary: true }],
    emails: [{ value: 'jane@realty.com' }],
  }
  it('maps an agent onto our row, primary phone first', () => {
    expect(mapRelationship(rec, 'c-1')).toEqual({
      contact_id: 'c-1',
      external_id: '77',
      kind: 'buyer_agent',
      type: "Buyer's Agent",
      name: 'Jane Smith',
      phone: '713-555-0199',
      email: 'jane@realty.com',
    })
  })
  it('falls back to the first phone, a plain name, and nulls', () => {
    const row = mapRelationship({ id: 8, type: 'Listing Agent', name: 'Bob Lee', phones: [{ value: '2815550111' }] }, 'c-2')
    expect(row).toMatchObject({ kind: 'seller_agent', name: 'Bob Lee', phone: '2815550111', email: null })
  })
  it('returns null for a relationship that is not an agent', () => {
    expect(mapRelationship({ ...rec, type: 'Spouse' }, 'c-1')).toBe(null)
  })
  it('returns null without an id', () => {
    expect(mapRelationship({ ...rec, id: undefined }, 'c-1')).toBe(null)
  })
})

describe('relationshipsOf', () => {
  it('finds the list under either key', () => {
    expect(relationshipsOf({ peopleRelationships: [1] })).toEqual([1])
    expect(relationshipsOf({ relationships: [2] })).toEqual([2])
    expect(relationshipsOf({ _embedded: { peopleRelationships: [3] } })).toEqual([3])
    expect(relationshipsOf({})).toEqual([])
  })
})
