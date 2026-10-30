// Loan maths for the Loans page panels and the Reports / Overview metrics.
// Loans are rows of the `loans` table (see ariveImport.js). Pure.
import { STAGE_GROUPS, norm } from './ariveImport'
import { inWindow, monthWindow } from './reports'

export const DEFAULT_RATES = { lo_name: 'Chandler Dean Atkinson', primary_pct: 1.25, assisted_pct: 0.75 }

// settings 'arive' value -> rates with defaults; unknown keys dropped.
export function resolveRates(saved) {
  const s = saved && typeof saved === 'object' ? saved : {}
  const out = { ...DEFAULT_RATES }
  if (typeof s.lo_name === 'string' && s.lo_name.trim()) out.lo_name = s.lo_name.trim()
  for (const k of ['primary_pct', 'assisted_pct']) if (Number.isFinite(Number(s[k])) && s[k] !== null && s[k] !== '') out[k] = Number(s[k])
  return out
}

export const isScenario = (l) => l.scenario_override ?? !!l.scenario_auto
export const isOpen = (l) => ['prospect', 'processing', 'closing'].includes(l.stage_group)
export const notInLatest = (l, lastImportAt) => !!lastImportAt && !!l.last_seen_at && Date.parse(l.last_seen_at) < Date.parse(lastImportAt)

export function estComp(l, rates) {
  if (l.comp_override != null) return Number(l.comp_override)
  if (l.amount == null) return null
  const pct = l.role === 'assisted' ? rates.assisted_pct : rates.primary_pct
  return Math.round(Number(l.amount) * pct) / 100
}

// role: 'all' | 'primary' | 'assisted'. scenarios: include scenario files.
export function filterLoans(loans, { role = 'all', scenarios = false } = {}) {
  return loans.filter((l) => (scenarios || !isScenario(l)) && (role === 'all' || l.role === role))
}

const sumAmount = (ls) => ls.reduce((s, l) => s + Number(l.amount || 0), 0)

// Every Arive stage in display order (zeros included), plus an "other" group
// for unknown stages when there are any.
export function pipelineStatus(loans) {
  const groups = STAGE_GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    rows: g.stages.map((stage) => {
      const ls = loans.filter((l) => l.stage_group === g.key && norm(l.stage) === norm(stage))
      return { stage, count: ls.length, amount: sumAmount(ls) }
    }),
  }))
  const other = loans.filter((l) => l.stage_group === 'other')
  if (other.length) {
    const names = [...new Set(other.map((l) => l.stage || '(blank)'))].sort()
    groups.push({
      key: 'other',
      label: 'Other',
      rows: names.map((stage) => {
        const ls = other.filter((l) => (l.stage || '(blank)') === stage)
        return { stage, count: ls.length, amount: sumAmount(ls) }
      }),
    })
  }
  return groups
}

const fundedIn = (loans, { from, to }) => loans.filter((l) => inWindow(l.funded_on, from, to))

// Funded loans per lender in [from, to): top three by count (ties by name),
// the rest as "Others".
export function lenderSpread(loans, win) {
  const funded = fundedIn(loans, win)
  const by = new Map()
  for (const l of funded) {
    const k = l.lender || 'Unknown'
    by.set(k, (by.get(k) || 0) + 1)
  }
  const sorted = [...by.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const rows = sorted.slice(0, 3).map(([lender, count]) => ({ lender, count }))
  const rest = sorted.slice(3).reduce((s, [, c]) => s + c, 0)
  if (rest) rows.push({ lender: 'Others', count: rest })
  return { total: funded.length, rows }
}

// Funded loans in a calendar year by funded_on: totals, purchase vs
// refinance, and twelve months (month is 0-based).
export function fundedByMonth(loans, year) {
  const funded = fundedIn(loans, { from: `${year}-01-01`, to: `${year + 1}-01-01` })
  const part = (ls) => ({ count: ls.length, volume: sumAmount(ls) })
  const isRefi = (l) => /refi/i.test(l.purpose || '')
  return {
    ...part(funded),
    purchase: part(funded.filter((l) => !isRefi(l))),
    refinance: part(funded.filter(isRefi)),
    months: Array.from({ length: 12 }, (_, month) => ({
      month,
      ...part(funded.filter((l) => Number(String(l.funded_on).slice(5, 7)) === month + 1)),
    })),
  }
}

export const hasApplicationDates = (loans) => loans.some((l) => l.application_on)

// Panel period -> { from, to } local YYYY-MM-DD window, or null for 'now'
// (no date filter). 'ytd' is Jan 1 to tomorrow; 'month' is monthWindow();
// 'year' is the whole current year.
export function periodWindow(period, now = Date.now()) {
  if (period === 'month') return monthWindow(now)
  const d = new Date(now)
  const pad = (n) => String(n).padStart(2, '0')
  const key = (x) => `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`
  const from = `${d.getFullYear()}-01-01`
  if (period === 'ytd') return { from, to: key(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) }
  if (period === 'year') return { from, to: `${d.getFullYear() + 1}-01-01` }
  return null
}

// Loans whose `field` date falls in win; no window keeps them all.
export const inPeriod = (loans, field, win) => (win ? loans.filter((l) => inWindow(l[field], win.from, win.to)) : loans)

// Metrics for Reports / Overview. win: { month, prev, sprint } as { from, to }
// YYYY-MM-DD windows. Scenario files never count. null when nothing is imported.
export function loanStats(loans, rates, win) {
  if (!loans.length) return null
  const real = loans.filter((l) => !isScenario(l))
  const month = fundedIn(real, win.month)
  const open = real.filter(isOpen)
  return {
    closed: month.length,
    closedPrev: fundedIn(real, win.prev).length,
    volume: sumAmount(month),
    commission: month.reduce((s, l) => s + Number(estComp(l, rates) || 0), 0),
    pipeline: sumAmount(open),
    open: open.length,
    sprintFunded: fundedIn(real, win.sprint).length,
  }
}
