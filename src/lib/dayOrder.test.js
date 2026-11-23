import { describe, it, expect } from 'vitest'
import { isOrderTime, isUrgent, initialOrder, applyDayOrder, itemName } from './dayOrder'

const call = (id, o = {}) => ({ id, ...o })
const file = (id, o = {}) => ({ key: `estimate:${id}`, contactId: id, name: id, ...o })
const lists = (calls, files, partners = []) => [
  { key: 'calls', label: 'Calls', items: calls, flaggedItems: calls.filter((i) => i.late) },
  { key: 'files', label: 'Files', items: files, flaggedItems: files.filter((i) => i.late) },
  { key: 'partners', label: 'Partners', items: partners, flaggedItems: [] },
]

describe('order time', () => {
  it('starts at 6 AM Central', () => {
    // 11:30 UTC is 5:30 AM Central in November (CST); 12:30 UTC is 6:30 AM.
    expect(isOrderTime(Date.parse('2026-11-24T11:30:00Z'))).toBe(false)
    expect(isOrderTime(Date.parse('2026-11-24T12:30:00Z'))).toBe(true)
  })

  it('treats people who reached out and new leads as urgent', () => {
    expect(isUrgent({ bucket: 'reached_out' })).toBe(true)
    expect(isUrgent({ kind: 'attempt', step: 1 })).toBe(true)
    expect(isUrgent({ kind: 'attempt', step: 3 })).toBe(false)
    expect(isUrgent({ bucket: 'overdue' })).toBe(false)
  })
})

describe('initialOrder', () => {
  it('saves the lists as built', () => {
    expect(initialOrder(lists([call('a'), call('b')], [file('e')]))).toEqual({ calls: ['contact:a', 'contact:b'], files: ['estimate:e'], partners: [] })
  })

  it("puts the last day's unfinished items first, in their old order", () => {
    const last = { lists: { calls: ['contact:z', 'contact:b', 'contact:gone'], files: [] }, pulled_in: ['estimate:f'] }
    const o = initialOrder(lists([call('a'), call('b'), call('z')], [file('e'), file('f')]), last)
    expect(o.calls).toEqual(['contact:z', 'contact:b', 'contact:a'])
    expect(o.files).toEqual(['estimate:f', 'estimate:e'])
  })
})

describe('applyDayOrder', () => {
  const saved = { lists: { calls: ['contact:b', 'contact:a'], files: ['estimate:e'], partners: [] }, pulled_in: ['estimate:p'] }

  it('leaves the lists alone before the order is set', () => {
    const l = lists([call('a')], [])
    expect(applyDayOrder(l, null)).toEqual({ lists: l, newSince: [] })
  })

  it('keeps the saved order, sends late arrivals to New since, and lets urgent ones in', () => {
    const live = lists(
      [call('a', { late: true }), call('new'), call('b'), call('r', { bucket: 'reached_out' }), call('lead', { kind: 'attempt', step: 1 })],
      [file('e'), file('x'), file('p')],
    )
    const { lists: out, newSince } = applyDayOrder(live, saved)
    expect(out[0].items.map((i) => i.id)).toEqual(['r', 'lead', 'b', 'a'])
    expect(out[0]).toMatchObject({ count: 4, flagged: 1 })
    expect(out[1].items.map((i) => i.key)).toEqual(['estimate:e', 'estimate:p'])
    expect(newSince.map((n) => [n.listKey, n.key])).toEqual([
      ['calls', 'contact:new'],
      ['files', 'estimate:x'],
    ])
  })

  it('drops finished items without a gap', () => {
    const { lists: out } = applyDayOrder(lists([call('a')], []), saved)
    expect(out[0].items.map((i) => i.id)).toEqual(['a'])
    expect(out[0].count).toBe(1)
  })
})

describe('itemName', () => {
  it('reads the name from any item shape', () => {
    expect(itemName({ name: 'Gil' })).toBe('Gil')
    expect(itemName({ row: { name: 'Ana' } })).toBe('Ana')
    expect(itemName({ title: 'Order flyers' })).toBe('Order flyers')
  })
})
