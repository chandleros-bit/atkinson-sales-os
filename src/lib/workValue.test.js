import { describe, it, expect } from 'vitest'
import { band, valueIndex, itemValue, atRisk } from './workValue'

const rates = { primary_pct: 1.25, assisted_pct: 0.75 }
const loan = (o) => ({ id: o.id, role: 'primary', amount: 400000, stage_group: 'processing', scenario_auto: false, scenario_override: null, comp_override: null, ...o })

describe('band', () => {
  it('maps amounts to $, $$ and $$$', () => {
    expect(band(600)).toBe('$')
    expect(band(1000)).toBe('$$')
    expect(band(3000)).toBe('$$')
    expect(band(3001)).toBe('$$$')
    expect(band(0)).toBe(null)
    expect(band(null)).toBe(null)
  })
})

describe('valueIndex and itemValue', () => {
  const index = valueIndex({
    rates,
    loans: [
      loan({ id: 1, contact_id: 'c1' }),
      loan({ id: 2, contact_id: 'c2', stage_group: 'funded' }),
      loan({ id: 3, contact_id: 'c3', scenario_auto: true }),
    ],
    lines: [
      { contactId: 'c1', source: 'rating', funded: false, payout: 9999, odds: 60 },
      { contactId: 'c4', source: 'rating', funded: false, payout: 5000, odds: 30 },
      { contactId: 'c5', source: 'rating', funded: false, payout: null, odds: 60 },
    ],
  })

  it('uses exact comp for open Arive loans and the weighted line otherwise', () => {
    expect(index.get('c1')).toEqual({ amount: 5000, exact: true })
    expect(index.has('c2')).toBe(false)
    expect(index.has('c3')).toBe(false)
    expect(index.get('c4')).toEqual({ amount: 1500, exact: false })
    expect(index.has('c5')).toBe(false)
  })

  it('reads the contact from dial rows and from file items', () => {
    expect(itemValue({ id: 'c1' }, index)).toEqual({ amount: 5000, exact: true, text: '$5,000' })
    expect(itemValue({ key: 'application:c4', contactId: 'c4' }, index).text).toBe('$$')
    expect(itemValue({ key: 'custom:9', contactId: null }, index)).toBe(null)
  })

  it('sums the flagged items', () => {
    const lists = [{ flaggedItems: [{ id: 'c1' }, { id: 'nobody' }] }, { flaggedItems: [{ key: 'x', contactId: 'c4' }] }]
    expect(atRisk(lists, index)).toEqual({ count: 3, amount: 6500 })
  })
})
