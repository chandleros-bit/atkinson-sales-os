// Production forecast (spec 2026-11-03, section 2): expected payout per month
// from open Arive loans (stage odds) and rated leads with no loan yet
// (temperature odds). Pure, no React, no I/O; useForecastInputs loads the inputs.
import { estComp, isScenario } from './loans'
import { closeMonthOf } from './leadRatings'

export const DEFAULT_FORECAST = {
  temp_odds: { hot: 60, warm: 30, cold: 10 },
  arive_odds: { prospect: 30, processing: 75, closing: 95 },
  close_offset_months: { hot: 1, warm: 2, cold: 3 },
  mpg_est_residual_per_account: null,
}

const numOr = (v, d) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? d : Number(v))

export function resolveForecast(saved) {
  const s = saved && typeof saved === 'object' ? saved : {}
  const pick = (key) => Object.fromEntries(Object.entries(DEFAULT_FORECAST[key]).map(([k, d]) => [k, numOr(s[key]?.[k], d)]))
  return {
    temp_odds: pick('temp_odds'),
    arive_odds: pick('arive_odds'),
    close_offset_months: pick('close_offset_months'),
    mpg_est_residual_per_account: numOr(s.mpg_est_residual_per_account, null),
  }
}

const pad = (n) => String(n).padStart(2, '0')
// 'YYYY-MM', local calendar, `offset` months after now's month.
export function monthKeyOf(now = Date.now(), offset = 0) {
  const d = new Date(now)
  d.setDate(1)
  d.setMonth(d.getMonth() + offset)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}
const monthOf = (iso) => (iso ? String(iso).slice(0, 7) : null)

// Mean amount of funded primary loans in the last 12 months, else of all
// funded primary loans; null with none. Stands in for a rated lead's amount.
export function avgFundedLoan(loans, now = Date.now()) {
  const funded = (loans || []).filter((l) => l.stage_group === 'funded' && l.role === 'primary' && Number(l.amount) > 0)
  const yearAgo = new Date(now - 365 * 86_400_000).toISOString().slice(0, 10)
  const recent = funded.filter((l) => l.funded_on && l.funded_on >= yearAgo)
  const pool = recent.length ? recent : funded
  if (!pool.length) return null
  return Math.round(pool.reduce((s, l) => s + Number(l.amount), 0) / pool.length)
}

// metrics: { residual, merchants } (latest MPG monthly residual and active merchants).
export function mpgPerAccount(metrics, settings) {
  const residual = Number(metrics?.residual || 0)
  const merchants = Number(metrics?.merchants || 0)
  if (residual > 0 && merchants > 0) return { amount: Math.round(residual / merchants), est: false }
  const est = settings?.mpg_est_residual_per_account
  if (est != null && est > 0) return { amount: est, est: true }
  return null
}

const ARIVE_OPEN = new Set(['prospect', 'processing', 'closing'])

// One line per counted Arive loan and per rated lead with no loan:
// { key, book, source, contactId, name, payout|null, odds (0-100), month 'YYYY-MM'|null,
//   payDate 'YYYY-MM-DD'|null, est, funded, temperature? }
export function forecastLines({ ratings, loans, rates, settings, avgLoan, mpgAccount, now = Date.now() }) {
  const lines = []
  const loanContacts = new Set()
  const offsets = settings.close_offset_months
  for (const l of loans || []) {
    if (isScenario(l)) continue
    if (l.contact_id) loanContacts.add(l.contact_id)
    const funded = l.stage_group === 'funded'
    if (!funded && !ARIVE_OPEN.has(l.stage_group)) continue
    const r = l.contact_id ? ratings.get(l.contact_id) : null
    const ratedMonth = r ? closeMonthOf(r, now, offsets) : null
    const payDate = funded ? l.funded_on : l.firm_closing_on || ratedMonth
    lines.push({
      key: `loan:${l.id}`,
      book: 'bay',
      source: 'arive',
      contactId: l.contact_id || null,
      name: l.borrower_name || null,
      payout: estComp(l, rates),
      odds: funded ? 100 : settings.arive_odds[l.stage_group],
      month: monthOf(payDate),
      payDate: payDate || null,
      est: false,
      funded,
    })
  }
  for (const r of ratings.values()) {
    if (loanContacts.has(r.contact_id)) continue
    const payDate = closeMonthOf(r, now, offsets)
    const common = {
      key: `rating:${r.contact_id}`,
      source: 'rating',
      contactId: r.contact_id,
      name: r.name || null,
      odds: settings.temp_odds[r.temperature],
      month: monthOf(payDate),
      payDate,
      funded: false,
      temperature: r.temperature,
    }
    if (r.business_id === 'bay') {
      const amount = r.est_amount != null ? Number(r.est_amount) : avgLoan
      lines.push({ ...common, book: 'bay', payout: amount == null ? null : Math.round(amount * rates.primary_pct) / 100, est: r.est_amount == null })
    } else {
      lines.push({ ...common, book: 'mpg', payout: mpgAccount ? mpgAccount.amount : null, est: mpgAccount ? mpgAccount.est : false })
    }
  }
  return lines
}

const weighted = (l) => ((l.payout ?? 0) * l.odds) / 100

// Totals for one 'YYYY-MM'. MPG dollars are null until every MPG line has a payout.
export function forecastByMonth(lines, month) {
  const inMonth = lines.filter((l) => l.month === month)
  const bay = inMonth.filter((l) => l.book === 'bay')
  const mpg = inMonth.filter((l) => l.book === 'mpg')
  const funded = Math.round(bay.filter((l) => l.funded).reduce((s, l) => s + (l.payout ?? 0), 0))
  const open = Math.round(bay.filter((l) => !l.funded).reduce((s, l) => s + weighted(l), 0))
  const mpgDollars = mpg.length && mpg.every((l) => l.payout != null) ? Math.round(mpg.reduce((s, l) => s + weighted(l), 0)) : null
  return {
    month,
    bay: { expected: funded + open, funded, weighted: open, est: bay.filter((l) => l.est).length },
    mpg: { expected: mpgDollars, accounts: Math.round(mpg.reduce((s, l) => s + l.odds / 100, 0) * 10) / 10, est: mpg.filter((l) => l.est).length },
    total: funded + open + (mpgDollars ?? 0),
  }
}

// Pipeline "Pays first": earliest expected pay date, then bigger expected
// payout; rows with no forecast line keep their order at the end.
export function sortPaysFirst(rows, lines) {
  const best = new Map()
  for (const l of lines) {
    if (!l.contactId || !l.payDate) continue
    const cur = best.get(l.contactId)
    if (!cur || l.payDate < cur.payDate) best.set(l.contactId, l)
  }
  return [...rows].sort((a, b) => {
    const la = best.get(a.id)
    const lb = best.get(b.id)
    if (!la || !lb) return (la ? 0 : 1) - (lb ? 0 : 1)
    if (la.payDate !== lb.payDate) return la.payDate < lb.payDate ? -1 : 1
    return weighted(lb) - weighted(la)
  })
}
