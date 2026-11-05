import { describe, it, expect } from 'vitest'
import { monthLabels, bankStatement, bankSummary, DEFAULT_EXPENSE } from './bankStatement'

const NOW = Date.parse('2026-11-05T15:00:00Z')
const rows = (vals) => vals.map((v) => ({ deposits: v, exclude: null }))

describe('monthLabels', () => {
  it('starts at last month, newest first', () => {
    const l = monthLabels(12, NOW)
    expect(l[0]).toBe('Oct 2026')
    expect(l[11]).toBe('Nov 2025')
    expect(monthLabels(24, NOW)[23]).toBe('Nov 2024')
  })
})

describe('bankStatement', () => {
  it('12 months averaging $40,000 at 50% and 100% ownership qualify $20,000', () => {
    const r = bankStatement({ months: 12, ownership: 100, expense: 50, rows: rows(Array(12).fill(40000)) })
    expect(r.average).toBe(40000)
    expect(r.income).toBe(20000)
    expect(r.entered).toBe(12)
    expect(r.trend).toBe(null)
  })
  it('subtracts exclusions, counts blank months as 0, applies ownership', () => {
    const rs = rows(Array(12).fill(null))
    rs[0] = { deposits: 50000, exclude: 2000 }
    rs[1] = { deposits: 1000, exclude: 5000 }
    const r = bankStatement({ months: 12, ownership: 50, expense: 0, rows: rs })
    expect(r.counted[0]).toBe(48000)
    expect(r.counted[1]).toBe(0)
    expect(r.counted[2]).toBe(null)
    expect(r.entered).toBe(2)
    expect(r.average).toBe(4000)
    expect(r.income).toBe(2000)
  })
  it('24-month trend compares the last 12 to the prior 12', () => {
    const r = bankStatement({ months: 24, ownership: 100, expense: 50, rows: rows([...Array(12).fill(36000), ...Array(12).fill(40000)]) })
    expect(r.trend).toBeCloseTo(-10, 6)
  })
  it('flags months 50% or more above the average', () => {
    const vals = Array(12).fill(40000)
    vals[2] = 70000
    const r = bankStatement({ months: 12, ownership: 100, expense: 50, rows: rows(vals) })
    expect(r.large[2]).toBe(true)
    expect(r.large[0]).toBe(false)
  })
  it('defaults: business 50%, personal 0%', () => {
    expect(DEFAULT_EXPENSE).toEqual({ business: 50, personal: 0 })
  })
})

describe('bankSummary', () => {
  it('writes a plain-text summary', () => {
    const input = { months: 12, account: 'business', ownership: 100, expense: 50, rows: rows(Array(12).fill(40000)) }
    const s = bankSummary(input, bankStatement(input), monthLabels(12, NOW))
    expect(s).toContain('Bank statement income (12 months, business, 50% expense, 100% ownership)')
    expect(s).toContain('Average monthly deposits: $40,000')
    expect(s).toContain('Qualifying monthly income: $20,000')
  })
})
