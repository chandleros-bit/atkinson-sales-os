import { describe, it, expect } from 'vitest'
import { formatPhone, telHref } from './phone'

describe('formatPhone', () => {
  it('formats a US number as (832) 555-5555 however it was stored', () => {
    expect(formatPhone('8325555555')).toBe('(832) 555-5555')
    expect(formatPhone('832-555-5555')).toBe('(832) 555-5555')
    expect(formatPhone('(832) 555 5555')).toBe('(832) 555-5555')
    expect(formatPhone('+1 832.555.5555')).toBe('(832) 555-5555')
    expect(formatPhone('18325555555')).toBe('(832) 555-5555')
  })
  it('leaves anything that is not a plain US number as it was', () => {
    expect(formatPhone('832-555-5555 x12')).toBe('832-555-5555 x12')
    expect(formatPhone('+44 20 7946 0958')).toBe('+44 20 7946 0958')
    expect(formatPhone('555-0100')).toBe('555-0100')
  })
  it('gives nothing for a missing number', () => {
    expect(formatPhone(null)).toBe('')
    expect(formatPhone('  ')).toBe('')
  })
})

describe('telHref', () => {
  it('dials the digits (and a leading +)', () => {
    expect(telHref('(832) 555-5555')).toBe('tel:8325555555')
    expect(telHref('+1 832 555 5555')).toBe('tel:+18325555555')
    expect(telHref(null)).toBe(null)
  })
})
