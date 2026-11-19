// Database Opportunity Agent: estimate math (spec "Estimation rules").
// Pure and dependency-free so it runs under Deno and under vitest.
// Every number here is an estimate from public data, used only to rank who to
// call. Never show these as a quote, and never tell anyone what they qualify for.

const DAY_MS = 86_400_000

export type PmmsWeek = { week_date: string; rate_30_fixed: number }

function toDate(d: string | Date): Date {
  if (d instanceof Date) return d
  return new Date(d.length === 10 ? `${d}T00:00:00Z` : d)
}

// Whole months from `from` to `to` (payments made), never negative.
export function monthsBetween(from: string | Date, to: string | Date): number {
  const a = toDate(from)
  const b = toDate(to)
  let m = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth())
  if (b.getUTCDate() < a.getUTCDate()) m -= 1
  return Math.max(0, m)
}

export function yearsOwned(recordingDate: string | Date, now: string | Date): number {
  return (toDate(now).getTime() - toDate(recordingDate).getTime()) / (365.25 * DAY_MS)
}

// Rule 1. Average PMMS 30-year rate for the 6 weeks before the recording date,
// since most loans lock 30 to 45 days before closing. Returns null when no
// seeded week falls in that window (for example, a date before the first
// seeded week), so the contact ranks without rate signals instead of failing.
export function rateAtPurchase(recordingDate: string | Date, pmms: PmmsWeek[]): number | null {
  const end = toDate(recordingDate).getTime()
  const start = end - 42 * DAY_MS
  const rates = pmms
    .filter((w) => {
      const t = toDate(w.week_date).getTime()
      return t >= start && t < end
    })
    .map((w) => Number(w.rate_30_fixed))
  if (!rates.length) return null
  return Math.round((rates.reduce((s, r) => s + r, 0) / rates.length) * 1000) / 1000
}

// Rule 2. Standard amortization: balance after k payments on principal P at
// annual rate `ratePct` over n payments. Ignores extra payments, refinances and
// second liens, so it can overstate the balance.
export function currentBalance(P: number, ratePct: number, k: number, n = 360): number {
  if (k >= n) return 0
  const r = ratePct / 100 / 12
  if (r === 0) return P * (1 - k / n)
  const g = (x: number) => Math.pow(1 + r, x)
  return (P * (g(n) - g(k))) / (g(n) - 1)
}

export function latestPmms30(pmms: PmmsWeek[]): number | null {
  if (!pmms.length) return null
  const latest = pmms.reduce((a, b) => (toDate(a.week_date) > toDate(b.week_date) ? a : b))
  return Number(latest.rate_30_fixed)
}

export type PropertyFacts = {
  recording_date?: string | null
  sale_price?: number | null
  orig_loan_amount?: number | null
  rate_actual?: number | null
  term_months?: number | null
  market_value?: number | null
  county?: string | null
}

export type Estimates = {
  est_rate: number | null
  rate_source: 'actual' | 'pmms' | null
  est_balance: number | null
  est_value: number | null
  est_equity: number | null
  est_ltv: number | null
  tappable_80: number | null
  orig_ltv: number | null
  rate_gap: number | null
  years_owned: number | null
}

// Rules 1 to 6 for one contact. When there is no original loan amount, the
// balance, equity and LTV stay null (rank on rate and time owned only).
export function estimate(
  facts: PropertyFacts,
  pmms: PmmsWeek[],
  opts: { now: string | Date; valueGrowthByCounty?: Record<string, number> },
): Estimates {
  const rec = facts.recording_date ?? null
  const actual = facts.rate_actual != null ? Number(facts.rate_actual) : null
  const est_rate = actual ?? (rec ? rateAtPurchase(rec, pmms) : null)
  const rate_source = actual != null ? 'actual' : est_rate != null ? 'pmms' : null

  const growth = facts.county ? opts.valueGrowthByCounty?.[facts.county] ?? 1 : 1
  const est_value = facts.market_value != null ? Math.round(Number(facts.market_value) * growth) : null

  const P = facts.orig_loan_amount != null ? Number(facts.orig_loan_amount) : null
  let est_balance: number | null = null
  if (P != null && est_rate != null && rec) {
    const n = facts.term_months ?? 360
    est_balance = Math.round(currentBalance(P, est_rate, monthsBetween(rec, opts.now), n))
  }

  const est_equity = est_value != null && est_balance != null ? est_value - est_balance : null
  const est_ltv = est_value && est_balance != null ? Math.round((est_balance / est_value) * 10000) / 10000 : null
  const tappable_80 =
    est_value != null && est_balance != null ? Math.max(0, Math.round(0.8 * est_value - est_balance)) : null
  const orig_ltv =
    P != null && facts.sale_price ? Math.round((P / Number(facts.sale_price)) * 10000) / 10000 : null

  const today = latestPmms30(pmms)
  const rate_gap = est_rate != null && today != null ? Math.round((est_rate - today) * 1000) / 1000 : null
  const years_owned = rec ? Math.round(yearsOwned(rec, opts.now) * 100) / 100 : null

  return { est_rate, rate_source, est_balance, est_value, est_equity, est_ltv, tappable_80, orig_ltv, rate_gap, years_owned }
}
