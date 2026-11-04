// Shelby's Bayway files briefing (spec 2026-11-03, section 3, "Assistant's
// briefing"). Pure, no I/O; the daily-briefing edge function loads `data` with
// the service role and renders the result. No money: no comp, no forecast, no
// MPG, nothing sensitive from the loan file (income, SSN, credit).
import { isOpen, isScenario } from './loans'
import { daysSince } from './overview'
import { chicagoDateKey, previousBusinessDateKey, longDateLabel, addBusinessDays } from './briefingTime'

const TOP = 15
export const CHASE_DAYS = 7
const WAIT_DAYS = 3
const APP_RECEIVED = 'Application Received'
const APP_SENT = 'Application/Estimate Sent'

const list = (rows, toItem) => ({ count: rows.length, top: rows.slice(0, TOP).map(toItem) })
const agent = (name, phone) => (name ? { name, phone: phone || null } : null)
const dayOf = (ts) => (ts ? chicagoDateKey(new Date(ts).getTime()) : null)

export function buildAssistantBriefing(data, now = Date.now()) {
  const pipeline = data.pipeline || []
  const byId = new Map(pipeline.map((r) => [r.id, r]))
  const today = chicagoDateKey(now)
  const weekOut = chicagoDateKey(now, 6)

  // 1. Closing in the next 7 days (today through +6), open loans only.
  const closingRows = (data.loans || [])
    .filter((l) => !isScenario(l) && isOpen(l) && l.firm_closing_on && l.firm_closing_on >= today && l.firm_closing_on <= weekOut)
    .sort((a, b) => a.firm_closing_on.localeCompare(b.firm_closing_on))
  const closing = list(closingRows, (l) => ({
    name: l.borrower_name || '(no name)',
    date: l.firm_closing_on,
    title: l.title_company || null,
    docs: byId.get(l.contact_id)?.docs_outstanding || [],
    buyerAgent: agent(l.buyer_agent_name, l.buyer_agent_phone),
    sellerAgent: agent(l.seller_agent_name, l.seller_agent_phone),
  }))

  // 2. Disclosures due: Application Received, not yet Disclosed. TRID: the
  // Loan Estimate goes out within 3 business days of the application.
  const disclosureRows = pipeline
    .filter((r) => r.stage === APP_RECEIVED && r.stage_since)
    .map((r) => ({ name: r.name || '(no name)', dueBy: addBusinessDays(dayOf(r.stage_since), 3) }))
    .sort((a, b) => a.dueBy.localeCompare(b.dueBy))
    .map((r) => ({ ...r, due: today >= r.dueBy }))
  const disclosures = list(disclosureRows, (r) => r)

  // 3. Missing docs, oldest request first; 7+ days old means chase today.
  const docRows = pipeline
    .filter((r) => r.docs_tracked && (r.docs_outstanding_count || 0) > 0)
    .sort((a, b) => String(a.docs_oldest_requested_at || '').localeCompare(String(b.docs_oldest_requested_at || '')))
    .map((r) => {
      const days = daysSince(r.docs_oldest_requested_at, now)
      return { name: r.name || '(no name)', docs: r.docs_outstanding || [], days, chase: days !== null && days >= CHASE_DAYS }
    })
  const missingDocs = list(docRows, (r) => r)

  // 4. New applications: entered Application Received on the last business day.
  const prevDay = previousBusinessDateKey(now)
  const newApps = list(
    pipeline.filter((r) => r.stage === APP_RECEIVED && dayOf(r.stage_since) === prevDay),
    (r) => ({ name: r.name || '(no name)' }),
  )

  // 5. Waiting on borrower: sent 3+ days ago with no stage move, then her due check-backs.
  const stuck = pipeline
    .filter((r) => r.stage === APP_SENT && r.stage_since && daysSince(r.stage_since, now) >= WAIT_DAYS)
    .sort((a, b) => String(a.stage_since).localeCompare(String(b.stage_since)))
    .map((r) => ({ name: r.name || '(no name)', detail: `${APP_SENT} ${daysSince(r.stage_since, now)} days ago, no movement` }))
  const checkBacks = (data.workItems || [])
    .filter((w) => w.status !== 'done' && ((w.check_back_on && w.check_back_on <= today) || (w.due_on && w.due_on <= today)))
    .map((w) => ({ name: w.contact_name || w.title || 'Work item', detail: `Check back: ${w.title || w.kind}` }))
  const waiting = list(stuck.concat(checkBacks), (r) => r)

  const chaseCount = docRows.filter((r) => r.chase).length
  return {
    dateLabel: longDateLabel(now),
    closing,
    disclosures,
    missingDocs,
    newApps,
    waiting,
    closingCount: closing.count,
    chaseCount,
    quiet: !closing.count && !disclosures.count && !missingDocs.count && !newApps.count && !waiting.count,
  }
}
