// Lead Sources & ROI card (spec 2026-11-05-lead-sources-roi-design.md). Pure.
// Builds on sourceTable (analytics.js) and the Arive loan helpers (loans.js).
// Days are local calendar days on YYYY-MM-DD keys, so DST never skews spend.
import { SOURCE_COLUMNS, cleanSource } from './analytics'
import { estComp, isScenario } from './loans'
import { dayKey, keyDaysBetween } from './calendar'

export const NOT_LINKED = 'Not linked to a lead'

// source_aliases rows -> { bay: Map(raw -> { label, is_free }), mpg: Map }.
export function aliasMap(rows) {
  const out = { bay: new Map(), mpg: new Map() }
  for (const r of rows || []) {
    if (!out[r.book]) continue
    const label = String(r.label || '').trim() || r.raw
    out[r.book].set(r.raw, { label, is_free: !!r.is_free })
  }
  return out
}

export const labelFor = (raw, book, map) => map?.[book]?.get(raw)?.label || raw

export function isFree(label, book, map) {
  for (const v of map?.[book]?.values() || []) if (v.label === label && v.is_free) return true
  return false
}

// 'YYYY-MM-DD' + n days, on UTC midnights (date keys have no time zone).
export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

// The last `days` local calendar days, today included.
export function windowKeys(days, now = Date.now()) {
  const toKey = dayKey(now)
  return { fromKey: addDays(toKey, -(days - 1)), toKey }
}

const monthDays = (monthKey) => {
  const [y, m] = monthKey.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}
const nextMonth = (monthKey) => {
  const [y, m] = monthKey.split('-').map(Number)
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)
}

// Spend on `label` in [fromKey, toKey], each month prorated by its days in the
// window. null when no spend row overlaps (shown as "—", never $0).
export function spendInWindow(rows, book, label, fromKey, toKey) {
  const endExcl = addDays(toKey, 1)
  let sum = 0
  let any = false
  for (const r of rows || []) {
    if (r.book !== book || r.source !== label) continue
    const start = String(r.month).slice(0, 10)
    const lo = start > fromKey ? start : fromKey
    const monthEnd = nextMonth(start)
    const hi = monthEnd < endExcl ? monthEnd : endExcl
    const days = keyDaysBetween(lo, hi)
    if (days <= 0) continue
    any = true
    sum += (Number(r.amount) || 0) * (days / monthDays(start))
  }
  return any ? round2(sum) : null
}

const round2 = (n) => Math.round(n * 100) / 100

// Bayway loans that funded in the window. Scenario files are left out.
export function fundedInWindow(loans, fromKey, toKey) {
  return (loans || []).filter(
    (l) => l.business_id === 'bay' && l.stage_group === 'funded' && !isScenario(l) && l.funded_on && l.funded_on >= fromKey && l.funded_on <= toKey,
  )
}

const divide = (spend, n) => (typeof spend === 'number' && n > 0 ? round2(spend / n) : null)

// sourceTable output -> the ROI table: rows merged by alias label, each with
// funded, commission (Bayway; null on MPG), spend (number, null or 'free')
// and costs. Labels with only spend, and funded loans with no lead in this
// book ("Not linked to a lead"), get rows too, so no money is hidden.
export function roiTable(table, { book, contactsById, loans, rates, spendRows, aliases, fromKey, toKey }) {
  const bay = book === 'bay'
  const rateId = SOURCE_COLUMNS[book].rate
  const groups = new Map()
  const group = (label) => {
    if (!groups.has(label)) groups.set(label, { source: label, raws: [], leads: 0, counts: {}, funded: 0, commission: 0 })
    return groups.get(label)
  }
  for (const r of table.rows) {
    const g = group(labelFor(r.source, book, aliases))
    g.raws.push(r.source)
    g.leads += r.leads
    for (const [k, v] of Object.entries(r.counts)) g.counts[k] = (g.counts[k] || 0) + v
  }
  const notLinked = { source: NOT_LINKED, raws: [], leads: 0, counts: {}, funded: 0, commission: 0, notLinked: true }
  if (bay) {
    for (const l of fundedInWindow(loans, fromKey, toKey)) {
      const c = l.contact_id ? contactsById.get(l.contact_id) : null
      const g = c && c.business_id === book ? group(labelFor(cleanSource(c.source), book, aliases)) : notLinked
      g.funded += 1
      g.commission += estComp(l, rates) || 0
    }
  }
  for (const s of spendRows || []) {
    if (s.book === book && spendInWindow([s], book, s.source, fromKey, toKey) != null) group(s.source)
  }

  const finish = (g) => {
    const spend = g.notLinked ? null : isFree(g.source, book, aliases) ? 'free' : spendInWindow(spendRows, book, g.source, fromKey, toKey)
    return {
      ...g,
      raws: [...g.raws].sort(),
      rate: g.leads ? Math.round(((g.counts[rateId] || 0) / g.leads) * 100) : 0,
      funded: bay ? g.funded : null,
      commission: bay ? round2(g.commission) : null,
      spend,
      costPerLead: divide(spend, g.leads),
      costPerFunded: bay ? divide(spend, g.funded) : null,
    }
  }
  const rows = [...groups.values()]
    .map(finish)
    .sort((a, b) => (b.leads > 0) - (a.leads > 0) || b.leads - a.leads || a.source.localeCompare(b.source))
  if (notLinked.funded) rows.push(finish(notLinked))

  const spends = rows.map((r) => r.spend).filter((s) => typeof s === 'number')
  const totalSpend = spends.length ? round2(spends.reduce((a, b) => a + b, 0)) : null
  const funded = bay ? rows.reduce((a, r) => a + r.funded, 0) : null
  const total = {
    source: 'Total',
    raws: [],
    leads: table.total.leads,
    counts: table.total.counts,
    rate: table.total.rate,
    funded,
    commission: bay ? round2(rows.reduce((a, r) => a + r.commission, 0)) : null,
    spend: totalSpend,
    costPerLead: divide(totalSpend, table.total.leads),
    costPerFunded: bay ? divide(totalSpend, funded) : null,
  }
  return { cols: table.cols, rows, total }
}

export function kpis(roi) {
  const t = roi.total
  return { leads: t.leads, spend: t.spend, costPerLead: t.costPerLead, costPerFunded: t.costPerFunded }
}

// Whole dollars; null -> "—"; 'free' stays 'free'.
export function formatUsd(v) {
  if (v === 'free') return 'free'
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 })
}
