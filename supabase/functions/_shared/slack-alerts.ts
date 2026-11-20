// Slack push rules (Bayway Bot Engine doc, "What to add to Sales OS", item 7).
// A push goes out only when Chandler needs to act today:
//   new_lead     a new lead arrived and hasn't been called
//   reached_out  someone called, texted or emailed in, and we haven't answered
//   hot_cold     a Hot lead with no touch in hot_cold_days
//   docs_aging   Application Received, docs requested 7+ days ago, still missing
//   quiet_app    Application Received, no touch in 5+ days
//   closing      a Bayway loan closes within 3 days
//   lock         a rate lock expires within 3 days, or expired without funding
//   sync_fail    a sync's latest run failed
// Everything else stays in the 7:30 AM briefing. The daily "drafts waiting"
// message comes with the Drafts inbox.
// Pure: no I/O. Each alert has a dedupe key; the function sends a key once.
// Keys include the timestamp that makes it new (a fresh inbound, a new touch),
// so the same lead can alert again after the situation resets.

export type Book = 'bay' | 'mpg'

export interface SignalRow {
  id: string
  business_id: Book
  name: string | null
  stage: string | null
  is_hot?: boolean | null
  is_partner?: boolean | null
  crm_created_at?: string | null
  crm_last_activity_at?: string | null
  last_outbound_at?: string | null
  last_outbound_call_at?: string | null
  last_inbound_at?: string | null
  temperature?: string | null
}

export interface PipelineRow {
  id: string
  name: string | null
  stage: string | null
  last_touch_at?: string | null
  docs_outstanding_count?: number | null
  docs_oldest_requested_at?: string | null
}

export interface LoanRow {
  id: string
  borrower_name: string | null
  firm_closing_on?: string | null
  lock_expires_on?: string | null
  funded_on?: string | null
  stage_group?: string | null
  scenario?: boolean | null
}

export interface SyncRow {
  source: string
  status: string
  ran_at: string
  message?: string | null
}

export interface Alert {
  key: string
  kind: string
  book: Book
  text: string
}

export const SPEED_STAGES = new Set(['New Lead', 'Not Contacted'])
export const QUIET_APP_DAYS = 5
export const DOC_AGING_DAYS = 7
export const CLOSING_DAYS = 3
export const LOCK_DAYS = 3
export const LOCK_EXPIRED_LOOKBACK = 30
const OPEN_GROUPS = new Set(['prospect', 'processing', 'closing'])
export const NEW_LEAD_HOURS = 24
export const REACHED_OUT_HOURS = 24
const APP_RECEIVED = 'Application Received'
const LOST = ['lost', 'closed', 'dead', 'not qualified', 'non-compatible', 'nurture']

// Syncs that matter enough to push; the others show on Sync Status.
export const SYNC_BOOK: Record<string, Book> = {
  fub: 'bay',
  'fub-activity': 'bay',
  'fub-tasks': 'bay',
  'outlook-bayway': 'bay',
  'opportunity-nightly': 'bay',
  'briefing-owner': 'bay',
  zoho: 'mpg',
  'zoho-activity': 'mpg',
  'zoho-tasks': 'mpg',
  'outlook-mpg': 'mpg',
}

const HOUR = 3_600_000
const DAY = 86_400_000
const ms = (t?: string | null) => (t ? new Date(t).getTime() : NaN)
const valid = (n: number) => Number.isFinite(n)

function later(a?: string | null, b?: string | null): string | null {
  if (!a) return b || null
  if (!b) return a
  return ms(a) >= ms(b) ? a : b
}

const isLost = (stage?: string | null) => LOST.some((k) => String(stage || '').toLowerCase().includes(k))
const isHot = (r: SignalRow) => (r.temperature ? r.temperature === 'hot' : !!r.is_hot)
const nameOf = (n?: string | null) => (n && n.trim()) || '(no name)'

// Chicago calendar date for a timestamp, YYYY-MM-DD.
export function centralDate(t: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(t))
}

// Hour of day in Chicago (0-23).
export function centralHour(t: number): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', hourCycle: 'h23' }).format(new Date(t)))
}

// Pushes only go out 7 AM to 9 PM Central; anything new overnight waits.
export function inSendWindow(now: number, start = 7, end = 21): boolean {
  const h = centralHour(now)
  return h >= start && h < end
}

function ago(t: string | null | undefined, now: number): string {
  const d = ms(t)
  if (!valid(d)) return 'never'
  const mins = Math.max(0, Math.floor((now - d) / 60000))
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 48) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)} days ago`
}

export interface Inputs {
  signals: SignalRow[]
  pipeline: PipelineRow[]
  loans: LoanRow[]
  syncs: SyncRow[] // latest run per source
  hotColdDays: number
  useCrmActivity: boolean
  link: (path: string) => string
  now: number
}

const person = (link: Inputs['link'], id: string, name?: string | null) => `<${link(`/workbench?person=${id}`)}|${nameOf(name)}>`

export function buildAlerts(i: Inputs): Alert[] {
  const out: Alert[] = []
  const { now, link } = i
  const touchAt = (r: SignalRow) => {
    const logged = later(r.last_outbound_at, r.last_inbound_at)
    return i.useCrmActivity ? later(logged, r.crm_last_activity_at) : logged
  }

  for (const r of i.signals) {
    if (isLost(r.stage)) continue
    const book = r.business_id
    const who = person(link, r.id, r.name)

    // Reached out: an inbound newer than our last outbound, in the last day.
    const inbound = ms(r.last_inbound_at)
    if (valid(inbound) && now - inbound <= REACHED_OUT_HOURS * HOUR && (!r.last_outbound_at || inbound > ms(r.last_outbound_at))) {
      const partner = r.is_partner ? ' (partner)' : ''
      out.push({ key: `reached_out:${r.id}:${r.last_inbound_at}`, kind: 'reached_out', book, text: `:telephone_receiver: ${who}${partner} reached out ${ago(r.last_inbound_at, now)}. No reply yet.` })
    }
    if (r.is_partner) continue

    // New lead: just arrived and not called.
    const created = ms(r.crm_created_at)
    if (SPEED_STAGES.has(r.stage || '') && !r.last_outbound_call_at && valid(created) && now - created <= NEW_LEAD_HOURS * HOUR) {
      out.push({ key: `new_lead:${r.id}`, kind: 'new_lead', book, text: `:new: New lead: ${who}, came in ${ago(r.crm_created_at, now)}. Not called yet.` })
    }

    // Hot, going cold. Alerts again only after a new touch resets it.
    if (isHot(r)) {
      const t = touchAt(r)
      const days = t ? Math.floor((now - ms(t)) / DAY) : null
      if (days == null || days >= i.hotColdDays) {
        out.push({ key: `hot_cold:${r.id}:${t || 'never'}`, kind: 'hot_cold', book, text: `:fire: Hot lead going cold: ${who}, last touch ${ago(t, now)}.` })
      }
    }
  }

  for (const p of i.pipeline) {
    if (p.stage !== APP_RECEIVED) continue
    const who = person(link, p.id, p.name)
    const docsAt = ms(p.docs_oldest_requested_at)
    if ((p.docs_outstanding_count || 0) > 0 && valid(docsAt) && now - docsAt >= DOC_AGING_DAYS * DAY) {
      out.push({
        key: `docs_aging:${p.id}:${p.docs_oldest_requested_at}`, kind: 'docs_aging', book: 'bay',
        text: `:page_facing_up: File at risk: ${who} still missing ${p.docs_outstanding_count} doc${p.docs_outstanding_count === 1 ? '' : 's'}, first requested ${ago(p.docs_oldest_requested_at, now)}.`,
      })
    }
    const touched = ms(p.last_touch_at)
    if (!valid(touched) || now - touched >= QUIET_APP_DAYS * DAY) {
      out.push({ key: `quiet_app:${p.id}:${p.last_touch_at || 'never'}`, kind: 'quiet_app', book: 'bay', text: `:hourglass: Application gone quiet: ${who}, last touch ${ago(p.last_touch_at, now)}.` })
    }
  }

  const today = centralDate(now)
  const until = centralDate(now + CLOSING_DAYS * DAY)
  const lockUntil = centralDate(now + LOCK_DAYS * DAY)
  const lockFrom = centralDate(now - LOCK_EXPIRED_LOOKBACK * DAY)
  for (const l of i.loans) {
    if (l.funded_on || l.scenario) continue
    if (l.stage_group && !OPEN_GROUPS.has(l.stage_group)) continue
    const loan = `<${link('/bayway/loans')}|${nameOf(l.borrower_name)}>`
    const d = l.firm_closing_on
    if (d && d >= today && d <= until) {
      const when = d === today ? 'today' : `on ${d}`
      out.push({ key: `closing:${l.id}:${d}`, kind: 'closing', book: 'bay', text: `:house: Closing ${when}: ${loan}. Check that everything's clear.` })
    }
    const x = l.lock_expires_on
    if (x && x <= lockUntil && x >= lockFrom) {
      const when = x < today ? `expired ${x}` : x === today ? 'expires today' : `expires ${x}`
      const clash = d && d > x ? ` Closing (${d}) is after the lock.` : ''
      out.push({ key: `lock:${l.id}:${x}`, kind: 'lock', book: 'bay', text: `:lock: Rate lock ${when}: ${loan}.${clash} Extend or relock.` })
    }
  }

  for (const s of i.syncs) {
    const book = SYNC_BOOK[s.source]
    if (!book || s.status !== 'error') continue
    const hour = new Date(ms(s.ran_at)).toISOString().slice(0, 13)
    const why = s.message ? `: ${String(s.message).slice(0, 140)}` : ''
    out.push({ key: `sync_fail:${s.source}:${hour}`, kind: 'sync_fail', book, text: `:warning: <${link('/sync')}|${s.source} sync failed>${why}` })
  }

  return out
}

// Order inside a message: what to do first, first.
const RANK: Record<string, number> = { reached_out: 0, new_lead: 1, lock: 2, closing: 3, hot_cold: 4, docs_aging: 5, quiet_app: 6, sync_fail: 7 }

// Unsent alerts grouped into one Slack message per book, at most `cap` lines
// each, with a pointer to the Workbench for the rest. Returns the keys that
// went into each message so only those get marked sent.
export function planMessages(alerts: Alert[], sent: Set<string>, link: Inputs['link'], cap = 8) {
  const fresh = alerts.filter((a) => !sent.has(a.key))
  const byBook = new Map<Book, Alert[]>()
  for (const a of fresh) {
    if (!byBook.has(a.book)) byBook.set(a.book, [])
    byBook.get(a.book)!.push(a)
  }
  const out: { book: Book; text: string; keys: string[] }[] = []
  for (const [book, list] of byBook) {
    list.sort((a, b) => (RANK[a.kind] ?? 9) - (RANK[b.kind] ?? 9))
    const shown = list.slice(0, cap)
    const more = list.length - shown.length
    const lines = shown.map((a) => a.text)
    if (more > 0) lines.push(`…and ${more} more on the <${link('/workbench')}|Workbench>.`)
    out.push({ book, text: lines.join('\n'), keys: list.map((a) => a.key) })
  }
  return out
}
