import { describe, it, expect } from 'vitest'
import { monthlyPayment, rateWatch, pullThrough } from './overviewInsights'

describe('monthlyPayment', () => {
  it('matches a standard 30-year payment', () => {
    // $300,000 at 6% for 30 years: $1,798.65.
    expect(monthlyPayment(300000, 6)).toBeCloseTo(1798.65, 1)
    expect(monthlyPayment(360000, 0)).toBe(1000)
    expect(monthlyPayment(0, 6)).toBe(null)
  })
})

describe('rateWatch', () => {
  const picks = [
    { id: 'p1', contact_id: 'a', contacts: { name: 'Gina Park' } },
    { id: 'p2', contact_id: 'b', contacts: { name: 'Low Rate' } },
    { id: 'p3', contact_id: 'c', contacts: { name: 'No Estimate' } },
    { id: 'p4', contact_id: 'd', contacts: { name: 'Big Loan' } },
  ]
  const estimates = new Map([
    ['a', { est_rate: 7.25, est_balance: 300000 }],
    ['b', { est_rate: 6.5, est_balance: 300000 }],
    ['d', { est_rate: 7.0, est_balance: 600000 }],
  ])

  it('keeps picks at PMMS + 0.75 or more, biggest saving first', () => {
    const r = rateWatch({ picks, estimates, pmms: { week_date: '2026-11-19', rate_30_fixed: 6.2 } })
    expect(r.pmms).toBe(6.2)
    expect(r.pending).toBe(4)
    expect(r.rows.map((x) => x.name)).toEqual(['Big Loan', 'Gina Park'])
    const gina = r.rows[1]
    expect(gina.saving).toBe(Math.round(monthlyPayment(300000, 7.25) - monthlyPayment(300000, 6.2)))
    expect(gina.saving).toBeGreaterThan(150)
  })

  it('shows nothing without a PMMS rate', () => {
    expect(rateWatch({ picks, estimates, pmms: null }).rows).toEqual([])
  })
})

describe('pullThrough', () => {
  const roi = {
    rows: [
      { source: 'Zillow', leads: 40, counts: { apps: 8 }, funded: 2 },
      { source: 'Referral', leads: 10, counts: { apps: 6 }, funded: 3 },
      { source: 'Lendgo', leads: 25, counts: { apps: 3 }, funded: 0 },
      { source: 'Not linked to a lead', leads: 0, counts: {}, funded: 1, notLinked: true },
    ],
  }
  it('ranks Bayway sources by funded, with the funded rate', () => {
    expect(pullThrough(roi, 'bay')).toEqual([
      { source: 'Referral', leads: 10, mid: 6, last: 3, pct: 30 },
      { source: 'Zillow', leads: 40, mid: 8, last: 2, pct: 5 },
      { source: 'Lendgo', leads: 25, mid: 3, last: 0, pct: 0 },
    ])
  })
  it('uses submitted and approved for MPG', () => {
    const mpg = { rows: [{ source: 'Website', leads: 20, counts: { submitted: 5, approved: 2 }, funded: null }] }
    expect(pullThrough(mpg, 'mpg')).toEqual([{ source: 'Website', leads: 20, mid: 5, last: 2, pct: 10 }])
  })
})
