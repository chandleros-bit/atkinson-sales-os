// The Workbench alerts rail: what is at risk across both books, counted, with
// the first few people (each with a one-line why) and the rest behind Show
// more. Pure, no React, no I/O. Up Next says who to call next; these say what
// is slipping.
//
//   new_leads        New leads past speed-to-lead, not called (any book)
//   quiet_apps       Application Received, no human touch in QUIET_APP_DAYS
//   docs_aging       Application Received with docs requested DOC_AGING_DAYS+ ago
//   statements_late  Open MPG statement / proposal tasks past due
//   check_backs      Work items waiting on someone, check-back day reached
import { speedToLead } from './cardHealth'
import { calendarDaysSince, humanTouchAt, overdueDays } from './priorityQueue'
import { isDocAging, DOC_AGING_DAYS } from './borrowerDocs'
import { isStatementTask } from './workbench'

export const QUIET_APP_DAYS = 5
const APP_RECEIVED = 'Application Received'
const SHOW = 3

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

// people: { id, name, book, detail }; the first SHOW preview, rest = the others.
function alert(id, tone, title, hint, people, book) {
  return {
    id, tone, title, hint, book,
    count: people.length,
    people: people.slice(0, SHOW),
    rest: people.slice(SHOW),
    more: Math.max(0, people.length - SHOW),
  }
}
const late = (n) => (n === 0 ? 'due today' : `${n}d overdue`)

// queue: Up Next rows (v_lead_signals, bucketed). signals: every v_lead_signals
// row in view. pipeline: Bayway work-stage rows with docs. tasks: open MPG
// Zoho tasks. workItems: this user's work_items. inBook(book) applies the
// business filter. Returns only alerts with a count, worst first.
export function buildAlerts({ queue = [], signals = [], pipeline = [], tasks = [], workItems = [], rules, inBook = () => true, now = Date.now() }) {
  const person = (r, detail) => ({ id: r.id, name: r.name || '(no name)', book: r.business_id, detail })
  const quietFor = (r) => {
    const days = calendarDaysSince(humanTouchAt(r, rules), now)
    return days == null ? 'No touch yet' : `${plural(days, 'day')} since a touch`
  }

  const fresh = queue.filter((r) => inBook(r.business_id) && speedToLead(r, rules, now)?.late)
  const quiet = signals.filter((r) => {
    if (r.business_id !== 'bay' || r.stage !== APP_RECEIVED) return false
    const days = calendarDaysSince(humanTouchAt(r, rules), now)
    return days == null || days >= QUIET_APP_DAYS
  })
  const docs = pipeline.filter(
    (r) => r.stage === APP_RECEIVED && r.docs_outstanding_count > 0 && isDocAging(r.docs_oldest_requested_at, now),
  )
  const statements = tasks.filter((t) => isStatementTask(t.title) && t.due_at && overdueDays(t.due_at, now) >= 1)
  const backs = workItems.filter((w) => w.status === 'waiting' && w.check_back_on && overdueDays(w.check_back_on, now) >= 0)

  const list = [
    alert('new_leads', 'neg', 'New leads waiting', `Past ${rules.speed_to_lead_minutes}m, not called`, fresh.map((r) => person(r, speedToLead(r, rules, now).text)), null),
    inBook('bay') && alert('quiet_apps', 'neg', 'Applications gone quiet', `Application Received, no touch in ${QUIET_APP_DAYS}+ days`, quiet.map((r) => person(r, quietFor(r))), 'bay'),
    inBook('bay') &&
      alert(
        'docs_aging',
        'warn',
        'Docs aging',
        `Requested ${plural(DOC_AGING_DAYS, 'day')}+ ago, still missing`,
        docs.map((r) => person({ ...r, business_id: 'bay' }, `${r.docs_outstanding_count} missing · ${calendarDaysSince(r.docs_oldest_requested_at, now)}d`)),
        'bay',
      ),
    inBook('mpg') &&
      alert(
        'statements_late',
        'warn',
        'Statement tasks overdue',
        'Statement or proposal follow-ups past due',
        statements.map((t) => ({ id: t.contact_id, name: t.company || t.contact_name || t.title, book: 'mpg', detail: `${t.title} · ${late(overdueDays(t.due_at, now))}` })),
        'mpg',
      ),
    alert(
      'check_backs',
      'warn',
      'Check-backs due',
      'Waiting on someone, check-back day is here',
      backs
        .filter((w) => inBook(w.business_id))
        .map((w) => ({
          id: w.contact_id,
          name: w.contact_name || w.title,
          book: w.business_id,
          detail: [w.waiting_on && `Waiting on ${w.waiting_on}`, late(overdueDays(w.check_back_on, now))].filter(Boolean).join(' · '),
        })),
      null,
    ),
  ]
  const rank = { neg: 0, warn: 1 }
  return list.filter((a) => a && a.count > 0).sort((a, b) => rank[a.tone] - rank[b.tone])
}
