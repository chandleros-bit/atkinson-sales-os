import { describe, it, expect } from 'vitest'
import { TIERS, tierMeta, scoreBarPct, sortByScore, groupByTier } from './priorityLeads'

describe('scoreBarPct', () => {
  it('clamps to 0..100 and rounds', () => {
    expect(scoreBarPct(42.6)).toBe(43)
    expect(scoreBarPct(-5)).toBe(0)
    expect(scoreBarPct(150)).toBe(100)
    expect(scoreBarPct(null)).toBe(0)
    expect(scoreBarPct(undefined)).toBe(0)
  })
})

describe('sortByScore', () => {
  it('sorts descending with null scores last', () => {
    const rows = [{ score: 10 }, { score: null }, { score: 90 }, { score: 50 }]
    expect(sortByScore(rows).map((r) => r.score)).toEqual([90, 50, 10, null])
  })
  it('does not mutate the input', () => {
    const rows = [{ score: 1 }, { score: 2 }]
    sortByScore(rows)
    expect(rows.map((r) => r.score)).toEqual([1, 2])
  })
})

describe('groupByTier', () => {
  it('buckets by tier, each sorted by score desc, and always has all four keys', () => {
    const rows = [
      { id: 'a', tier: 'hot', score: 80 },
      { id: 'b', tier: 'hot', score: 95 },
      { id: 'c', tier: 'warm', score: 40 },
      { id: 'd', tier: 'active', score: 55 },
    ]
    const g = groupByTier(rows)
    expect(Object.keys(g).sort()).toEqual(['active', 'hot', 'never_contacted', 'warm'])
    expect(g.hot.map((r) => r.id)).toEqual(['b', 'a'])
    expect(g.never_contacted).toEqual([])
  })
  it('drops unknown tiers and tolerates empty input', () => {
    expect(groupByTier([{ tier: 'bogus' }]).hot).toEqual([])
    expect(groupByTier(null).warm).toEqual([])
  })
})

describe('tierMeta / TIERS', () => {
  it('exposes the four tiers in hot->cold order', () => {
    expect(TIERS.map((t) => t.key)).toEqual(['hot', 'warm', 'active', 'never_contacted'])
  })
  it('looks up by key and falls back for unknowns', () => {
    expect(tierMeta('warm').label).toBe('Warm')
    expect(tierMeta('nope').key).toBe('never_contacted')
  })
})
