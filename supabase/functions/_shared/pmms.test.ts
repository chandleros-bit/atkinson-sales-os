import { describe, it, expect } from 'vitest'
import { parseFredPmms } from './pmms.ts'

describe('parseFredPmms', () => {
  const csv = [
    'observation_date,MORTGAGE30US,MORTGAGE15US',
    '2017-12-28,3.99,3.44',
    '2021-05-13,2.94,2.26',
    '2021-05-20,.,2.29',
    '2026-11-12,6.25,',
  ].join('\n')

  it('keeps weeks from the start date, skips missing 30-year values', () => {
    expect(parseFredPmms(csv)).toEqual([
      { week_date: '2021-05-13', rate_30_fixed: 2.94, rate_15_fixed: 2.26 },
      { week_date: '2026-11-12', rate_30_fixed: 6.25, rate_15_fixed: null },
    ])
  })

  it('accepts the older DATE header', () => {
    expect(parseFredPmms('DATE,MORTGAGE30US\n2022-01-06,3.22')).toEqual([
      { week_date: '2022-01-06', rate_30_fixed: 3.22, rate_15_fixed: null },
    ])
  })

  it('throws on an unexpected file', () => {
    expect(() => parseFredPmms('foo,bar\n1,2')).toThrow(/unexpected PMMS header/)
  })
})
