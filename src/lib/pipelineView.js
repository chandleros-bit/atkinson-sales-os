// The Pipeline page's views (List / Board / By stage): search, sort and the
// KPI cards over the board rows. Pure, no React, no I/O.
import { cardHealth, sortByHealth, speedToLead, stuckFor } from './cardHealth'
import { calendarDaysSince } from './priorityQueue'
import { isDocAging } from './borrowerDocs'

export const VIEWS = [
  { id: 'list', label: 'List', icon: 'list' },
  { id: 'board', label: 'Board', icon: 'board' },
  { id: 'grouped', label: 'By stage', icon: 'grouped' },
]

export const SORTS = [
  { id: 'urgent', label: 'Most urgent' },
  { id: 'touch', label: 'Oldest touch' },
  { id: 'newest', label: 'Newest lead' },
  { id: 'name', label: 'Name' },
]

const digits = (s) => String(s || '').replace(/\D/g, '')

// Name, company and email as a case-insensitive substring; phone by digits
// once the query has 3 or more of them.
export function filterRows(rows, query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return rows
  const qd = digits(q)
  return rows.filter(
    (r) =>
      [r.name, r.company, r.email].some((v) => String(v || '').toLowerCase().includes(q)) ||
      (qd.length >= 3 && digits(r.phone).includes(qd)),
  )
}

const time = (iso) => {
  const t = iso ? new Date(iso).getTime() : NaN
  return Number.isNaN(t) ? null : t
}

// A new array; ties keep their order.
export function sortRows(rows, sort, rules, now = Date.now()) {
  if (sort === 'urgent') return sortByHealth(rows, rules, now)
  const list = [...rows]
  if (sort === 'touch') {
    // Never touched first, then oldest touch.
    return list.sort((a, b) => (time(a.last_touch_at) ?? -Infinity) - (time(b.last_touch_at) ?? -Infinity))
  }
  if (sort === 'newest') return list.sort((a, b) => (time(b.crm_created_at) ?? -Infinity) - (time(a.crm_created_at) ?? -Infinity))
  if (sort === 'name') return list.sort((a, b) => String(a.company || a.name || '').localeCompare(String(b.company || b.name || '')))
  return list
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const QUALIFIED = new Set(['Pre-Qualified', 'Qualified'])

// Four cards over the rows on the board right now. There is no history to
// compare against, so each footer names a related live count instead of a
// change from last week. Each: { id, label, value, icon, tone, foot }.
export function pipelineKpis(rows, rules, biz, now = Date.now()) {
  let overdue = 0
  let late = 0
  let fresh = 0
  let stuck = 0
  let noNext = 0
  for (const r of rows) {
    const h = cardHealth(r, rules, now)
    if (h.next.state === 'overdue') overdue += 1
    if (h.next.state === 'none') noNext += 1
    if (speedToLead(r, rules, now)?.late) late += 1
    if (stuckFor(r, rules, now)) stuck += 1
    const age = calendarDaysSince(r.crm_created_at, now)
    if (age != null && age < 7) fresh += 1
  }
  const third =
    biz === 'mpg'
      ? (() => {
          const n = rows.filter((r) => QUALIFIED.has(r.stage)).length
          return { id: 'qualified', label: 'Qualified', value: n, icon: 'file', tone: 'book', foot: 'Pre-Qualified or Qualified' }
        })()
      : (() => {
          const apps = rows.filter((r) => r.stage === 'Application Received')
          const aging = apps.filter((r) => r.docs_outstanding_count > 0 && isDocAging(r.docs_oldest_requested_at, now)).length
          return { id: 'received', label: 'Applications received', value: apps.length, icon: 'file', tone: 'book', foot: `${aging} with docs aging` }
        })()
  return [
    { id: 'active', label: 'Active leads', value: rows.length, icon: 'users', tone: 'book', foot: `${plural(overdue, 'follow-up')} overdue` },
    { id: 'new', label: 'New this week', value: fresh, icon: 'userPlus', tone: 'book', foot: `${late} past speed-to-lead` },
    third,
    { id: 'stuck', label: 'Stuck in stage', value: stuck, icon: 'warn', tone: stuck ? 'neg' : 'book', foot: `${noNext} with no next step` },
  ]
}
