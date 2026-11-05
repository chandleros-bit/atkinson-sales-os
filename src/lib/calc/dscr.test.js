import { describe, it, expect } from 'vitest'
import { dscr } from './dscr'
import { loanPayment } from './loanPayment'

const base = { price: 300000, downMode: 'pct', down: 25, rate: 7.5, years: 30, taxesYear: 6000, insuranceYear: 1800, hoaMonth: 0, miRate: null, closingPct: null }

describe('dscr', () => {
  it('rent over the full payment, against the minimum', () => {
    const r = dscr(base, 2500, 1)
    const total = loanPayment(base).total
    expect(r.ratio).toBeCloseTo(2500 / total, 6)
    expect(r.pass).toBe(r.ratio >= 1)
  })
  it('largest loan round-trips to the minimum ratio', () => {
    const r = dscr(base, 2500, 1.1)
    const at = loanPayment({ ...base, downMode: 'amt', down: base.price - r.maxLoan })
    expect(at.pi + at.taxes + at.insurance + at.hoa).toBeCloseTo(2500 / 1.1, 2)
    expect(r.maxLtv).toBeCloseTo((r.maxLoan / 300000) * 100, 6)
  })
  it('says when rent does not cover taxes, insurance and HOA', () => {
    const r = dscr({ ...base, hoaMonth: 3000 }, 2500, 1)
    expect(r.uncovered).toBe(true)
    expect(r.maxLoan).toBe(null)
  })
  it('waits for rent', () => {
    expect(dscr(base, null, 1).ratio).toBe(null)
  })
})
