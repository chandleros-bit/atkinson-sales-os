import { describe, it, expect } from 'vitest'
import { monthlyPI, loanFromPI, loanPayment } from './loanPayment'

const base = { price: 500000, downMode: 'pct', down: 20, rate: 7, years: 30, taxesYear: null, insuranceYear: 2400, hoaMonth: 50, miRate: null, closingPct: null }

describe('monthlyPI', () => {
  it('$400,000 at 7% for 30 years', () => {
    expect(monthlyPI(400000, 7, 30).toFixed(2)).toBe('2661.21')
  })
  it('zero rate divides evenly; missing rate gives null', () => {
    expect(monthlyPI(360000, 0, 30)).toBe(1000)
    expect(monthlyPI(400000, null, 30)).toBe(null)
  })
  it('loanFromPI inverts monthlyPI', () => {
    expect(loanFromPI(monthlyPI(400000, 7, 30), 7, 30)).toBeCloseTo(400000, 6)
    expect(loanFromPI(1000, 0, 30)).toBe(360000)
  })
})

describe('loanPayment', () => {
  it('breaks out the payment at 80% LTV with default taxes and no MI', () => {
    const p = loanPayment(base)
    expect(p.loan).toBe(400000)
    expect(p.ltv).toBe(80)
    expect(p.pi.toFixed(2)).toBe('2661.21')
    expect(p.taxes).toBeCloseTo((500000 * 0.022) / 12, 6)
    expect(p.insurance).toBe(200)
    expect(p.hoa).toBe(50)
    expect(p.miOn).toBe(false)
    expect(p.mi).toBe(0)
    expect(p.total).toBeCloseTo(p.pi + p.taxes + 200 + 50, 6)
    expect(p.closing).toBe(15000)
    expect(p.cashToClose).toBe(115000)
  })
  it('adds MI over 80% LTV and takes a dollar down payment', () => {
    const p = loanPayment({ ...base, downMode: 'amt', down: 25000 })
    expect(p.loan).toBe(475000)
    expect(p.ltv).toBe(95)
    expect(p.miOn).toBe(true)
    expect(p.mi).toBeCloseTo((475000 * 0.005) / 12, 6)
  })
  it('uses typed taxes over the default', () => {
    expect(loanPayment({ ...base, taxesYear: 6000 }).taxes).toBe(500)
  })
  it('has no total until there is a rate', () => {
    expect(loanPayment({ ...base, rate: null }).total).toBe(null)
  })
})
