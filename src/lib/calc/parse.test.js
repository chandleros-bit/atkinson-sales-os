import { describe, it, expect } from 'vitest'
import { parseAmount, money, pct } from './parse'

describe('parseAmount', () => {
  it('reads plain, dollar, comma and percent text', () => {
    expect(parseAmount('1200')).toBe(1200)
    expect(parseAmount('$1,200.50')).toBe(1200.5)
    expect(parseAmount('20%')).toBe(20)
    expect(parseAmount(' 7.125 ')).toBe(7.125)
  })
  it('returns null for blank or junk', () => {
    for (const s of ['', '  ', '$', 'abc', null, undefined, '-']) expect(parseAmount(s)).toBe(null)
  })
})

describe('formatting', () => {
  it('money rounds to dollars or cents', () => {
    expect(money(2661.214)).toBe('$2,661')
    expect(money(2661.214, true)).toBe('$2,661.21')
    expect(money(null)).toBe('-')
  })
  it('pct', () => {
    expect(pct(80)).toBe('80.0%')
    expect(pct(null)).toBe('-')
  })
})
