// Overview redesign, part 2 (spec 2026-11-22, A5–A7 and B3): what's in flight
// in each book, the one flag that matters most on each item, and the problem
// counts across the whole book. Pure: Overview.jsx fetches and draws.
import { addBizDays, isGeneralBusinessDay } from './calc/trid'
import { isScenario } from './loans'
import { stuckFor } from './cardHealth'
import { touchStatus } from './partners'

const DAY = 86_400_000
const pad = (n) => String(n).padStart(2, '0')
// Local calendar 'YYYY-MM-DD'.
export const localKey = (ms) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const keyMs = (key) => Date.parse(`${String(key).slice(0, 10)}T00:00:00Z`)
// Whole calendar days from key a to key b (b later = positive).
export const daysBetween = (a, b) => Math.round((keyMs(b) - keyMs(a)) / DAY)
// Whole days since an ISO timestamp, by local calendar day; null when missing.
const daysSinceIso = (iso, now) => (iso ? daysBetween(localKey(Date.parse(iso)), localKey(now)) : null)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
// 'Wed' within the coming week, else 'Dec 4'.
export function shortDay(key, now = Date.now()) {
  const n = daysBetween(localKey(now), key)
  const d = new Date(keyMs(key))
  if (n === 0) return 'today'
  if (n === 1) return 'tomorrow'
  if (n > 1 && n < 7) return WEEKDAYS[d.getUTCDay()]
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`

// ---- Hard dates (B3) ---------------------------------------------------------

// The closing disclosure must be out 3 business days before closing. Business
// days skip Saturdays, Sundays and federal holidays (the stricter count).
export const cdDueOn = (closingKey) => (closingKey ? addBizDays(String(closingKey).slice(0, 10), -3, isGeneralBusinessDay) : null)

const CD_SENT_STAGES = new Set(['docs out', 'docs signed'])
const openLoan = (l) => (l.business_id ?? 'bay') === 'bay' && !isScenario(l) && !l.funded_on && ['prospect', 'processing', 'closing'].includes(l.stage_group)
const stageKey = (l) => String(l.stage || '').trim().toLowerCase()

// Open loans' closing-disclosure due dates and lock expiries within `withinDays`
// (past due included), soonest first: [{ loanId, name, kind: 'cd' | 'lock', on, days }].
export function hardDates(loans, now = Date.now(), withinDays = 14) {
  const today = localKey(now)
  const out = []
  for (const l of loans || []) {
    if (!openLoan(l)) continue
    const name = l.borrower_name || 'Loan'
    const cd = !CD_SENT_STAGES.has(stageKey(l)) ? cdDueOn(l.firm_closing_on) : null
    if (cd) out.push({ loanId: l.id, name, kind: 'cd', on: cd, days: daysBetween(today, cd) })
    if (l.lock_expires_on) out.push({ loanId: l.id, name, kind: 'lock', on: String(l.lock_expires_on).slice(0, 10), days: daysBetween(today, l.lock_expires_on) })
  }
  return out.filter((h) => h.days <= withinDays).sort((a, b) => a.days - b.days)
}

// ---- A5. Loans in flight ------------------------------------------------------

const UW_STAGES = new Set(['submitted to uw', 'approved w/ conditions', 're-submittal'])
export const LOAN_STEPS = ['Application', 'Processing', 'Underwriting', 'Clear to close', 'Funded']
// 1..5 along LOAN_STEPS; Underwriting is the UW stages inside processing.
export function loanStep(l) {
  if (l.stage_group === 'funded' || l.funded_on) return 5
  if (l.stage_group === 'closing') return 4
  if (l.stage_group === 'processing') return UW_STAGES.has(stageKey(l)) ? 3 : 2
  return 1
}

const lower = (s) => String(s || '').trim().toLowerCase()

// The one flag a loan shows, most urgent first: { text, tone: 'neg'|'warn'|'ok' }.
// pipeById: v_active_pipeline rows by contact id (docs columns).
// partners: v_partners rows (buyer's agent last touch).
export function loanFlag(l, { pipeById = new Map(), partners = [], now = Date.now() } = {}) {
  const today = localKey(now)
  const closing = l.firm_closing_on ? String(l.firm_closing_on).slice(0, 10) : null
  const cd = closing && !CD_SENT_STAGES.has(stageKey(l)) ? cdDueOn(closing) : null
  if (cd) {
    // Due within 3 business days: today is on or after 3 business days before it.
    const warnFrom = addBizDays(cd, -3, isGeneralBusinessDay)
    if (today > cd) return { text: `Closing disclosure overdue (was due ${shortDay(cd, now)})`, tone: 'neg' }
    if (today >= warnFrom) return { text: `Closing disclosure due ${shortDay(cd, now)}`, tone: 'neg' }
  }
  if (l.lock_expires_on) {
    const lock = String(l.lock_expires_on).slice(0, 10)
    const left = daysBetween(today, lock)
    if (left < 0) return { text: `Lock expired ${shortDay(lock, now)}`, tone: 'neg' }
    if (closing && lock < closing) return { text: `Lock ends ${shortDay(lock, now)}, before closing`, tone: 'neg' }
    if (left <= 5) return { text: `Lock ends ${shortDay(lock, now)}`, tone: 'warn' }
  }
  const p = l.contact_id ? pipeById.get(l.contact_id) : null
  const docAge = p && p.docs_outstanding_count > 0 ? daysSinceIso(p.docs_oldest_requested_at, now) : null
  if (docAge != null && docAge >= 7) return { text: `${plural(p.docs_outstanding_count, 'doc')} requested ${docAge} days ago`, tone: 'warn' }
  const agentEmail = lower(l.buyer_agent_email)
  const agentName = lower(l.buyer_agent_name)
  const agent = (agentEmail || agentName) && partners.find((x) => (agentEmail && lower(x.email) === agentEmail) || (agentName && lower(x.name) === agentName))
  const quiet = agent ? daysSinceIso(agent.last_touch_at, now) : null
  if (agent && (quiet == null || quiet >= 7)) return { text: `Agent ${agent.name || l.buyer_agent_name} not updated${quiet == null ? '' : ` in ${quiet} days`}`, tone: 'warn' }
  return { text: 'On track', tone: 'ok' }
}

// -> { counts: { application, processing, underwriting, ctc, funded }, rows, open }
export function loansInFlight({ loans, pipeline = [], partners = [], now = Date.now(), limit = 5 }) {
  const monthStart = localKey(now).slice(0, 8) + '01'
  const counts = { application: 0, processing: 0, underwriting: 0, ctc: 0, funded: 0 }
  const KEYS = ['application', 'processing', 'underwriting', 'ctc', 'funded']
  const real = (loans || []).filter((l) => (l.business_id ?? 'bay') === 'bay' && !isScenario(l) && l.role !== 'assisted')
  for (const l of real) {
    const step = loanStep(l)
    if (step === 5) {
      if (l.funded_on && String(l.funded_on).slice(0, 10) >= monthStart) counts.funded += 1
    } else if (openLoan(l)) counts[KEYS[step - 1]] += 1
  }
  const pipeById = new Map((pipeline || []).map((r) => [r.id, r]))
  const open = real.filter(openLoan)
  const rows = open
    .slice()
    .sort((a, b) => String(a.firm_closing_on || '9999').localeCompare(String(b.firm_closing_on || '9999')) || Number(b.amount || 0) - Number(a.amount || 0))
    .slice(0, limit)
    .map((l) => ({
      id: l.id,
      name: l.borrower_name || 'Loan',
      amount: Number(l.amount || 0),
      step: loanStep(l),
      closing: l.firm_closing_on ? String(l.firm_closing_on).slice(0, 10) : null,
      flag: loanFlag(l, { pipeById, partners, now }),
    }))
  return { counts, rows, open: open.length }
}

// ---- A6. Merchants in flight ----------------------------------------------------

export const MPG_OPEN_STAGES = ['Open', 'Submitted', 'Approved']

// mpgRows: v_mpg_contacts rows; tasks: open v_tasks rows { contact_id, business_id, due_at };
// rules: the priority rules (stuck days). -> { counts, rows }
export function merchantsInFlight({ mpgRows = [], tasks = [], rules = {}, approvedThisMonth = 0, now = Date.now(), limit = 4 }) {
  const today = localKey(now)
  const counts = { Open: 0, Submitted: 0, Approved: 0, approvedThisMonth }
  const dueToday = new Set(tasks.filter((t) => t.business_id === 'mpg' && t.contact_id && t.due_at && localKey(Date.parse(t.due_at)) <= today).map((t) => t.contact_id))
  const scored = []
  for (const r of mpgRows) {
    if (!MPG_OPEN_STAGES.includes(r.stage)) continue
    counts[r.stage] += 1
    const row = { ...r, business_id: 'mpg' }
    const stuck = stuckFor(row, rules, now)
    const quiet = daysSinceIso(r.last_touch_at, now)
    const due = dueToday.has(r.id)
    const flag = due
      ? { text: 'Follow-up due today', tone: 'warn' }
      : stuck
        ? { text: `${stuck.days} days in ${r.stage}`, tone: 'neg' }
        : quiet == null || quiet >= 7
          ? { text: quiet == null ? 'Never touched' : `No touch in ${quiet} days`, tone: 'warn' }
          : { text: 'On track', tone: 'ok' }
    const score = (due ? 4 : 0) + (stuck ? 2 : 0) + (quiet == null || quiet >= 7 ? 1 : 0)
    const inStage = daysSinceIso(r.stage_since, now)
    scored.push({ id: r.id, name: r.company || r.name || 'Merchant', contact: r.company && r.name ? r.name : null, stage: r.stage, inStage, flag, score })
  }
  const rows = scored.sort((a, b) => b.score - a.score || (b.inStage ?? 0) - (a.inStage ?? 0)).slice(0, limit)
  return { counts, rows }
}

// ---- A7. Book health ------------------------------------------------------------

const APP_STAGES = new Set(['Application/Estimate Sent', 'Application Received'])

// -> [{ id, label, count, to, book }] with zero rows dropped.
export function bookHealth({ biz = 'all', pipeline = [], mpgRows = [], tasks = [], partners = [], rules = {}, now = Date.now() }) {
  const bay = biz !== 'mpg'
  const mpg = biz !== 'bay'
  const today = localKey(now)
  const rows = [
    bay && {
      id: 'apps_quiet',
      label: 'Applications quiet 5+ days',
      book: 'bay',
      to: '/bayway/pipeline',
      count: pipeline.filter((r) => APP_STAGES.has(r.stage) && (daysSinceIso(r.last_touch_at, now) ?? Infinity) >= 5).length,
    },
    bay && {
      id: 'docs_aging',
      label: 'Docs requested 7+ days ago',
      book: 'bay',
      to: '/bayway/loans',
      count: pipeline.filter((r) => r.docs_outstanding_count > 0 && (daysSinceIso(r.docs_oldest_requested_at, now) ?? -1) >= 7).length,
    },
    mpg && {
      id: 'mpg_stuck',
      label: 'MPG stuck in stage',
      book: 'mpg',
      to: '/mpg/pipeline',
      count: mpgRows.filter((r) => stuckFor({ ...r, business_id: 'mpg' }, rules, now)).length,
    },
    {
      id: 'overdue',
      label: 'Overdue follow-ups',
      book: null,
      to: '/tasks',
      count: tasks.filter((t) => (biz === 'all' || t.business_id === biz) && t.due_at && localKey(Date.parse(t.due_at)) < today).length,
    },
    bay && {
      id: 'partners_quiet',
      label: 'Partners quiet 30+ days',
      book: 'bay',
      to: '/bayway/partners',
      count: partners.filter((p) => touchStatus(p, new Date(now)) === 'quiet').length,
    },
  ]
  return rows.filter((r) => r && r.count > 0)
}
