// Vitest picks this up like scoring.test.ts: the module is pure.
import { describe, it, expect } from 'vitest'
import { retagTemperature, TEMPERATURE_TAGS } from './temperature-tags.ts'

describe('retagTemperature', () => {
  it('adds the one temperature tag and keeps every other tag', () => {
    expect(retagTemperature(['Attempted', 'Zillow'], 'hot')).toEqual(['Attempted', 'Zillow', 'Hot'])
  })
  it('replaces any earlier temperature tag, any case', () => {
    expect(retagTemperature(['hot', 'Attempted', ' Cold '], 'warm')).toEqual(['Attempted', 'Warm'])
  })
  it('handles no tags', () => {
    expect(retagTemperature(null, 'cold')).toEqual(['Cold'])
  })
  it('refuses an unknown temperature', () => {
    expect(() => retagTemperature([], 'lukewarm')).toThrow('Unknown temperature: lukewarm')
  })
  it('refuses names inherited from Object.prototype', () => {
    expect(() => retagTemperature([], 'constructor')).toThrow('Unknown temperature: constructor')
  })
  it('names the tags', () => {
    expect(TEMPERATURE_TAGS).toEqual({ hot: 'Hot', warm: 'Warm', cold: 'Cold' })
  })
})
