// Bank statement income (spec section 2). rows: newest month first,
// { deposits, exclude } numbers or null. Blank months count as $0.
import { money, pct } from './parse'

export const DEFAULT_EXPENSE = { business: 50, personal: 0 }
const LARGE = 1.5

export function monthLabels(count, now = Date.now()) {
  const d = new Date(now)
  const out = []
  for (let i = 1; i <= count; i++) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1))
    out.push(new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', year: 'numeric' }).format(m))
  }
  return out
}

export function bankStatement({ months, ownership, expense, rows }) {
  const counted = Array.from({ length: months }, (_, i) => {
    const r = rows[i]
    if (!r || r.deposits === null || r.deposits === undefined) return null
    return Math.max(0, (r.deposits || 0) - (r.exclude || 0))
  })
  const sumOf = (list) => list.reduce((s, v) => s + (v || 0), 0)
  const average = months ? sumOf(counted) / months : 0
  const income = average * (1 - (expense ?? 0) / 100) * ((ownership ?? 100) / 100)
  let trend = null
  if (months === 24) {
    const recent = sumOf(counted.slice(0, 12))
    const prior = sumOf(counted.slice(12, 24))
    trend = prior > 0 ? ((recent - prior) / prior) * 100 : null
  }
  const large = counted.map((v) => v !== null && average > 0 && v >= average * LARGE)
  return { counted, entered: counted.filter((v) => v !== null).length, average, income, trend, large }
}

export function bankSummary(input, r, labels) {
  const lines = [
    `Bank statement income (${input.months} months, ${input.account}, ${input.expense ?? 0}% expense, ${input.ownership ?? 100}% ownership)`,
    `Average monthly deposits: ${money(r.average)}`,
    `Qualifying monthly income: ${money(r.income)}`,
  ]
  if (r.trend !== null) lines.push(`Trend, last 12 vs prior 12: ${pct(r.trend)}`)
  const big = r.large.map((on, i) => (on ? `${labels[i]} ${money(r.counted[i])}` : null)).filter(Boolean)
  if (big.length) lines.push(`Large months: ${big.join(', ')}`)
  lines.push(`Months entered: ${r.entered} of ${input.months}`)
  return lines.join('\n')
}
