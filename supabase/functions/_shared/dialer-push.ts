// Power Dialer push on approval (spec 2026-11-20, "Push on approval"). Pure
// request builders shared by dialer-crm-push and the browser's Ready to Push
// preview, so the queue shows exactly what will be written. No fetch here.
//
// MPG -> Zoho Lead: Lead_Status Open, Lead_Source / MPG_REP = Chandler (the
//   picklist can't take a new "Power Dialer" value), a "Power Dialer" tag and
//   a Description line, call history as a Note.
// Bayway -> FUB person via POST /v1/people, never /v1/events: per FUB's docs
//   (checked 2026-11-20) /v1/people "will not run any automations", so the
//   shared Lead Flow, arrival text and Action Plans stay off. Source
//   "CA Power Dialer", tags CA + CA Power Dialer + Cold/Warm, plus the Sales
//   OS stage tag (Bayway stages are FUB tags, see bay-stages.ts).
import { BAY_STAGES, STAGE_TARGETS, bayStageFromTags, retagForTarget } from './bay-stages.ts'

export interface DialerFields {
  first_name?: string | null
  last_name?: string | null
  company?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
}

export const FIELD_KEYS = ['first_name', 'last_name', 'company', 'phone', 'email', 'address', 'city', 'state', 'zip'] as const

const t = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

// The fields to write: the lead's, with any edits from the queue on top.
export function pushFields(lead: Record<string, unknown>, edits: Record<string, unknown> = {}): DialerFields {
  const out: Record<string, string | null> = {}
  for (const k of FIELD_KEYS) {
    const base = k === 'phone' ? lead.phone_e164 : lead[k]
    const v = Object.hasOwn(edits || {}, k) ? edits[k] : base
    out[k] = t(v) || null
  }
  return out as DialerFields
}

const fullName = (f: DialerFields) => [t(f.first_name), t(f.last_name)].filter(Boolean).join(' ')

export const ZOHO_TAG = 'Power Dialer'
export const FUB_SOURCE = 'CA Power Dialer'
export const FUB_TAGS = ['CA', 'CA Power Dialer']

export function buildZohoDialerLead(f: DialerFields, { listName = '' } = {}) {
  const company = t(f.company) || fullName(f)
  const last = t(f.last_name) || fullName(f) || company
  if (!company || !last) throw new Error('A Zoho lead needs a company or a name')
  const lead: Record<string, unknown> = {}
  if (t(f.first_name) && t(f.last_name)) lead.First_Name = t(f.first_name)
  lead.Last_Name = last.slice(0, 80)
  lead.Company = company.slice(0, 100)
  if (t(f.phone)) lead.Phone = t(f.phone)
  if (t(f.email)) lead.Email = t(f.email)
  if (t(f.address)) lead.Street = t(f.address)
  if (t(f.city)) lead.City = t(f.city)
  if (t(f.state)) lead.State = t(f.state)
  if (t(f.zip)) lead.Zip_Code = t(f.zip)
  lead.Lead_Status = 'Open'
  lead.Lead_Source = 'Chandler'
  lead.MPG_REP = 'Chandler'
  lead.Description = `Source: Sales OS Power Dialer${listName ? ` – ${listName}` : ''}`
  lead.Tag = [{ name: ZOHO_TAG }]
  return { data: [lead] }
}

// Application sent -> Application/Estimate Sent; every other confirmed
// outcome -> Contacted/Working.
export const stageTargetFor = (outcome: string) => (outcome === 'application_sent' ? 'application_sent' : 'working')
const targetTag = (key: string) => STAGE_TARGETS.find((x) => x.key === key)?.tag as string

const tempTag = (temperature?: string | null) => (temperature === 'cold' ? 'Cold' : temperature === 'warm' ? 'Warm' : null)

export function buildFubDialerPerson(f: DialerFields, { outcome, temperature, assignedUserId }: { outcome: string; temperature?: string | null; assignedUserId?: string | number | null }) {
  if (!t(f.phone)) throw new Error('A FUB person needs a phone')
  if (!fullName(f) && !t(f.company)) throw new Error('A FUB person needs a name')
  const person: Record<string, unknown> = {
    firstName: t(f.first_name) || (fullName(f) ? '' : t(f.company)),
    lastName: t(f.last_name),
    source: FUB_SOURCE,
    phones: [{ value: t(f.phone) }],
    tags: [...FUB_TAGS, tempTag(temperature), targetTag(stageTargetFor(outcome))].filter(Boolean),
  }
  if (t(f.email)) person.emails = [{ value: t(f.email) }]
  if (t(f.address) || t(f.city) || t(f.state) || t(f.zip)) {
    person.addresses = [{ street: t(f.address), city: t(f.city), state: t(f.state), code: t(f.zip) }]
  }
  if (assignedUserId) person.assignedUserId = Number(assignedUserId)
  return person
}

// Full tag list for an existing FUB person (PUT replaces the list): add the
// dialer tags, and move the stage tag forward only, never back (a person
// already at Application Received stays there). personStage: FUB's stage
// (a new person's is "Lead").
export function fubTagsForExisting(tags: string[] | null, personStage: string | null, { outcome, temperature }: { outcome: string; temperature?: string | null }) {
  let list = Array.isArray(tags) ? [...tags] : []
  const has = (x: string) => list.some((y) => y.toLowerCase() === x.toLowerCase())
  for (const tag of [...FUB_TAGS, tempTag(temperature)].filter(Boolean) as string[]) if (!has(tag)) list.push(tag)
  const target = STAGE_TARGETS.find((x) => x.key === stageTargetFor(outcome))!
  const now = bayStageFromTags(list, personStage)
  const at = BAY_STAGES.indexOf(now as string)
  const to = BAY_STAGES.indexOf(target.stage)
  // Parked (Nurture / Credit Repair) is last on the board but not "ahead":
  // a parked lead who is interested again comes back to the target.
  // A person off the board (Past Client, Sphere...) keeps their stage tags.
  if (now == null || now === 'Lost') return list
  const parked = now === 'Nurture / Credit Repair'
  if (parked || to > at) list = retagForTarget(list, target.key)
  return list
}

const OUTCOME_LABEL: Record<string, string> = {
  no_answer: 'No answer', voicemail: 'Left voicemail', owner_unavailable: 'Owner not available', bad_number: 'Bad number',
  not_interested: 'Not interested', do_not_call: 'Do Not Call', callback_requested: 'Callback requested',
  interested: 'Interested', appointment_set: 'Appointment set', application_sent: 'Application sent',
}

// Every logged call on the lead, oldest first, for the CRM note.
export function callHistoryNote(calls: { outcome?: string | null; notes?: string | null; dialed_at: string; callback_at?: string | null }[], { listName = '' } = {}) {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  const lines = (calls || [])
    .filter((c) => c.outcome)
    .sort((a, b) => Date.parse(a.dialed_at) - Date.parse(b.dialed_at))
    .map((c) => {
      let line = `${fmt(c.dialed_at)}: ${OUTCOME_LABEL[c.outcome as string] || c.outcome}`
      if (c.callback_at) line += ` (callback ${fmt(c.callback_at)})`
      if (c.notes) line += `. ${c.notes}`
      return line
    })
  if (!lines.length) throw new Error('No logged calls to note')
  return {
    title: 'Power Dialer call history',
    body: [`Sales OS Power Dialer${listName ? `, list "${listName}"` : ''}:`, ...lines].join('\n'),
  }
}
