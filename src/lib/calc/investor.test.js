import { describe, it, expect } from 'vitest'
import { dscrBand, cashFlow, loanFit } from './investor'

describe('dscrBand', () => {
  it('sorts the ratio into pricing bands', () => {
    expect(dscrBand(null)).toBe(null)
    expect(dscrBand(0.7).id).toBe('none')
    expect(dscrBand(0.75).id).toBe('low')
    expect(dscrBand(0.99).id).toBe('low')
    expect(dscrBand(1).id).toBe('standard')
    expect(dscrBand(1.249).id).toBe('standard')
    expect(dscrBand(1.25).id).toBe('best')
  })
})

describe('cashFlow', () => {
  it('rent minus the full payment, rounded to cents', () => {
    expect(cashFlow(2500, 2210.456)).toBe(289.54)
    expect(cashFlow(null, 2000)).toBe(null)
    expect(cashFlow(2000, 0)).toBe(null)
  })
})

describe('loanFit', () => {
  it('full docs at 75% LTV: conventional first, DSCR as backup', () => {
    const r = loanFit({ income: 'full', ratio: 1.1, ltv: 75 })
    expect(r.best).toBe('Conventional')
    expect(r.options.filter((o) => o.fits).map((o) => o.type)).toEqual(['Conventional', 'DSCR'])
  })
  it('self-employed with rent covering the payment: DSCR first, then bank statement', () => {
    const r = loanFit({ income: 'self', ratio: 1.05, ltv: 80 })
    expect(r.best).toBe('DSCR')
    expect(r.options.find((o) => o.type === 'Bank statement').fits).toBe(true)
  })
  it('self-employed with weak rent: bank statement first', () => {
    expect(loanFit({ income: 'self', ratio: 0.8, ltv: 80 }).best).toBe('Bank statement')
  })
  it('no income docs and the ratio too low: nothing fits, says why', () => {
    const r = loanFit({ income: 'none', ratio: 0.6, ltv: 80 })
    expect(r.best).toBe(null)
    expect(r.options.find((o) => o.type === 'DSCR').why).toMatch(/0.75/)
  })
  it('DSCR over 80% LTV does not fit', () => {
    expect(loanFit({ income: 'none', ratio: 1.3, ltv: 85 }).best).toBe(null)
  })
  it('conventional allows 85% LTV with full docs', () => {
    expect(loanFit({ income: 'full', ratio: 0.9, ltv: 85 }).best).toBe('Conventional')
  })
})
