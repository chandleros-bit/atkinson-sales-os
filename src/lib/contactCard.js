// The contact card's tabs: what each one shows, as plain rows. Pure, no React,
// no I/O (useContactCard fetches). Notes stays the first tab, as the card
// opened before tabs; Loan is Bayway only (MPG has no loan scenario).
import { noteFacts } from './noteFacts'
import { isDocAging } from './borrowerDocs'
import { daysSince } from './overview'

export function cardTabs(biz) {
  return [
    { id: 'notes', label: 'Notes' },
    { id: 'activity', label: 'Activity' },
    ...(biz === 'bay' ? [{ id: 'loan', label: 'Loan' }] : []),
    { id: 'details', label: 'Details' },
  ]
}

const dateLabel = (iso) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null
const agoLabel = (iso, now) => {
  const d = daysSince(iso, now)
  if (d == null) return null
  return d === 0 ? 'today' : `${d}d ago`
}
const tagList = (tags) => (Array.isArray(tags) ? tags.map((t) => String(t).trim()).filter(Boolean) : [])

// Details: who the lead is and where it came from. Rows with no value are
// left out rather than shown as dashes.
// person: v_people row. signal: v_lead_signals row (source, created, calls).
// contact: { owner, tags } from contacts.
export function detailRows({ person, signal, contact }, now = Date.now()) {
  if (!person) return []
  const source = signal?.lead_source && signal.lead_source !== '<unspecified>' ? signal.lead_source : null
  const lastCall = signal?.last_outbound_call_at
  const rows = [
    ['Company', person.business_id === 'mpg' ? person.company : null],
    ['Stage', person.stage],
    ['Lead source', source],
    ['Owner', contact?.owner],
    ['Created', dateLabel(signal?.crm_created_at)],
    ['Last call', lastCall ? `${dateLabel(lastCall)} · ${agoLabel(lastCall, now)}` : signal ? 'No calls logged' : null],
    ['Email', person.email],
    ['Tags', tagList(contact?.tags).join(', ') || null],
  ]
  return rows.filter(([, v]) => v).map(([k, v]) => ({ k, v }))
}

// Loan: the lead form's scenario (credit, loan type, state, amount) and the
// borrower docs from the board row.
export function loanView({ firstNote, board }, now = Date.now()) {
  const { facts, snippet } = noteFacts(firstNote)
  const tracked = !!board?.docs_tracked
  const names = board?.docs_outstanding || []
  return {
    facts,
    snippet,
    docs: !tracked
      ? null
      : {
          missing: names,
          oldestDays: names.length ? daysSince(board.docs_oldest_requested_at, now) : null,
          aging: names.length > 0 && isDocAging(board.docs_oldest_requested_at, now),
          notes: board.doc_notes || null,
        },
  }
}

const TIER = { hot: 'Hot', warm: 'Warm', active: 'Active', never_contacted: 'Never contacted' }

// The Priority Leads score (Bayway, scored daily), shown above the tabs.
export function priorityLine(priority) {
  if (!priority || priority.score == null) return null
  return { tier: TIER[priority.tier] || null, score: Math.round(priority.score), note: priority.ai_note || null }
}
