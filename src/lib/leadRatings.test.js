import { describe, it, expect } from 'vitest'
import {
  TEMPERATURES, TEMP_LABEL, defaultCloseMonth, closeMonthOf, withRatings, effectiveHot, temperatureRank, coldButActive,
} from './leadRatings'

const NOW = new Date('2026-11-03T09:00:00').getTime()

describe('temperature basics', () => {
  it('has three temperatures with labels', () => {
    expect(TEMPERATURES).toEqual(['hot', 'warm', 'cold'])
    expect(TEMP_LABEL).toEqual({ hot: 'Hot', warm: 'Warm', cold: 'Cold' })
  })
})

describe('close month', () => {
  it('defaults by temperature: Hot next month, Warm +2, Cold +3', () => {
    expect(defaultCloseMonth('hot', NOW)).toBe('2026-12-01')
    expect(defaultCloseMonth('warm', NOW)).toBe('2027-01-01')
    expect(defaultCloseMonth('cold', NOW)).toBe('2027-02-01')
  })
  it('takes custom offsets', () => {
    expect(defaultCloseMonth('hot', NOW, { hot: 0 })).toBe('2026-11-01')
  })
  it('coerces a string offset and ignores a non-numeric one', () => {
    expect(defaultCloseMonth('hot', NOW, { hot: '2' })).toBe('2027-01-01')
    expect(defaultCloseMonth('hot', NOW, { hot: 'soon' })).toBe('2026-12-01')
  })
  it('ignores inherited keys on a bogus temperature', () => {
    expect(defaultCloseMonth('constructor', NOW)).toBe('2026-12-01')
  })
  it('does not overflow at the end of a long month', () => {
    expect(defaultCloseMonth('hot', new Date('2027-01-31T10:00:00').getTime())).toBe('2027-02-01')
    expect(defaultCloseMonth('cold', new Date('2026-12-31T23:30:00').getTime())).toBe('2027-03-01')
  })
  it('keeps a saved close month', () => {
    expect(closeMonthOf({ temperature: 'cold', close_month: '2026-11-01' }, NOW)).toBe('2026-11-01')
    expect(closeMonthOf({ temperature: 'hot', close_month: null }, NOW)).toBe('2026-12-01')
    expect(closeMonthOf({ temperature: 'hot', close_month: '2026-11-01T00:00:00' }, NOW)).toBe('2026-11-01')
  })
})

describe('withRatings', () => {
  it('adds temperature, amount, close month and the rating to matching rows only', () => {
    const ratings = new Map([['a', { contact_id: 'a', temperature: 'hot', est_amount: 300000, close_month: null }]])
    const [a, b] = withRatings([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], ratings)
    expect(a).toMatchObject({ id: 'a', temperature: 'hot', est_amount: 300000, close_month: null })
    expect(a.rating.contact_id).toBe('a')
    expect(b).toEqual({ id: 'b', name: 'B' })
  })
  it('returns the same rows when there are no ratings', () => {
    const rows = [{ id: 'a' }]
    expect(withRatings(rows, new Map())).toBe(rows)
    expect(withRatings(rows, null)).toBe(rows)
  })
})

describe('effectiveHot and rank', () => {
  it('a rating wins over the view flag', () => {
    expect(effectiveHot({ is_hot: true, temperature: 'warm' })).toBe(false)
    expect(effectiveHot({ is_hot: false, temperature: 'hot' })).toBe(true)
    expect(effectiveHot({ is_hot: true })).toBe(true)
  })
  it('ranks Hot, Warm, unrated, Cold', () => {
    expect([{ temperature: 'cold' }, {}, { temperature: 'warm' }, { temperature: 'hot' }].map(temperatureRank)).toEqual([3, 2, 1, 0])
  })
  it('treats an unknown temperature as unrated', () => {
    expect(temperatureRank({ temperature: 'constructor' })).toBe(2)
    expect(temperatureRank({ temperature: 'lukewarm' })).toBe(2)
  })
})

describe('coldButActive', () => {
  it('fires for a Cold lead whose score rose 20+ since the rating', () => {
    expect(coldButActive({ temperature: 'cold', score_at_rating: 10, current_score: 30 })).toBe(true)
    expect(coldButActive({ temperature: 'cold', score_at_rating: 10, current_score: 29 })).toBe(false)
  })
  it('only the score rise counts: a hot tier alone does not fire, missing scores do not fire', () => {
    expect(coldButActive({ temperature: 'cold', score_at_rating: null, current_score: 90, current_tier: 'hot' })).toBe(false)
    expect(coldButActive({ temperature: 'cold', score_at_rating: 10, current_score: null })).toBe(false)
  })
  it('never for other temperatures or no rating', () => {
    expect(coldButActive({ temperature: 'warm', score_at_rating: 0, current_score: 90 })).toBe(false)
    expect(coldButActive(null)).toBe(false)
  })
})
