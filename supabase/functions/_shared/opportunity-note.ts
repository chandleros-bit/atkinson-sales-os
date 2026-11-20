// Database Opportunity Agent: AI call-prep note (spec "AI note and compliance
// guardrails"). Pure helpers: the minimal model input, the prompt, parsing,
// the code post-check, and the template fallback. The network call lives in
// opportunity-nightly so this stays testable.

import type { Pick } from './opportunity-scoring.ts'
import type { Estimates } from './opportunity-estimates.ts'

export type AiNote = {
  headline: string
  why_now: string[]
  known: string[]
  unknown: string[]
  opener: string
  channel: string
  do_not_say: string[]
  fub_task: string
  fallback?: boolean
}

export type NoteFacts = {
  firstName: string
  city: string | null
  estimates: Partial<Estimates> | null
  recentActivity: { type: string; date: string }[] // last 3, newest first, no text
  hasProperty: boolean
  hasLoanAmount: boolean
  hasMarketValue: boolean
}

export const SYSTEM_PROMPT = `You are a call-prep assistant for a licensed mortgage loan officer. Explain why this past client may benefit from a mortgage review now, using only the data provided. Never state or imply a rate, APR, payment, savings amount or that anyone qualifies. Never state an exact equity, balance or value figure; describe them in general terms. Never mention where the property data came from. Never infer or mention age, race, religion, national origin, sex, familial status, disability or any other protected trait. If the data is thin, say so and suggest a simple check-in. Write plainly, like a seasoned loan officer: no em dashes, no exclamation points, no hype.

Openers should sound like an annual check-in, not a pitch. A good default: "Hey Maria, it's Chandler. It's been about four years since we closed on your place, and I do a quick yearly review for past clients to see if anything makes sense to look at. Got five minutes this week?"

Reply with strict JSON only, with these keys:
headline: one line under 12 words, why this person, why now
why_now: array, one plain-English bullet per reason code
known: array, what the data and history show
unknown: array, what to find out on the call
opener: 2 to 3 sentences in Chandler's voice
channel: "call", "text" or "email", then a dash and one line on why
do_not_say: array of claims to avoid with this contact
fub_task: task title to create if no one answers`

const REASON_TEXT: Record<string, string> = {
  RATE_GAP_HIGH: 'Their rate looks well above where rates are today.',
  RATE_GAP: 'Their rate looks somewhat above where rates are today.',
  EQUITY_100K: 'They likely have a lot of equity built up.',
  EQUITY_50K: 'They likely have a good amount of equity built up.',
  PMI_LIKELY_REMOVABLE: 'They may be able to drop mortgage insurance.',
  INVESTOR: 'They look like an investor or may own more than one property.',
  MOVE_UP_WINDOW: 'They have owned long enough that a move-up is common.',
  ANNIVERSARY: 'Their purchase anniversary is coming up.',
  RECENT_ENGAGEMENT: 'They reached out or engaged recently.',
  KNOWN_ARM: 'They may have an adjustable rate.',
}

const round = (n: number, step: number) => Math.round(n / step) * step
// Rounded ranges only; the model never sees exact dollars or rates.
export function rangeText(e: Partial<Estimates> | null) {
  const out: Record<string, string> = {}
  if (!e) return out
  if (e.rate_gap != null) {
    out.rate_gap = e.rate_gap >= 1.5 ? 'about 1.5 points or more' : e.rate_gap >= 1 ? 'about 1 point'
      : e.rate_gap >= 0.5 ? 'about half a point' : e.rate_gap > -0.25 ? 'close to today' : 'below today'
  }
  if (e.tappable_80 != null) {
    const lo = Math.max(0, round(e.tappable_80, 50_000) - 25_000)
    out.tappable_equity = e.tappable_80 < 25_000 ? 'little or none'
      : `roughly $${Math.round(lo / 1000)}k to $${Math.round((lo + 50_000) / 1000)}k`
  }
  if (e.years_owned != null) out.years_owned = `about ${Math.max(1, Math.round(e.years_owned))} years`
  return out
}

export function buildModelInput(pick: Pick, f: NoteFacts) {
  const missing: string[] = []
  if (!f.hasProperty) missing.push('property not matched')
  if (f.hasProperty && !f.hasLoanAmount) missing.push('original loan amount')
  if (f.hasProperty && !f.hasMarketValue) missing.push('current value')
  return {
    first_name: f.firstName,
    city: f.city,
    pick_type: pick.kind === 'check_in' ? 'relationship check-in' : 'mortgage review',
    reason_codes: pick.reasons,
    estimates: rangeText(f.estimates),
    last_activities: f.recentActivity.slice(0, 3).map((a) => ({ type: a.type, date: a.date.slice(0, 10) })),
    missing,
  }
}

const BANNED = /%|\$|\bqualif|\bguarantee|\bapproved\b|\bsave\b|\bsavings\b|\bapr\b|\bpayment/i

// Code post-check on the two lines Chandler would say or read first.
export function postCheck(note: Partial<AiNote> | null): { ok: boolean; problems: string[] } {
  const problems: string[] = []
  if (!note || typeof note.headline !== 'string' || typeof note.opener !== 'string') {
    return { ok: false, problems: ['missing headline or opener'] }
  }
  for (const k of ['headline', 'opener'] as const) {
    const m = note[k]!.match(BANNED)
    if (m) problems.push(`${k} contains "${m[0]}"`)
    if (/—/.test(note[k]!)) problems.push(`${k} contains an em dash`)
  }
  if (note.headline.split(/\s+/).filter(Boolean).length >= 12) problems.push('headline is 12 words or more')
  return { ok: problems.length === 0, problems }
}

export function parseNote(text: string): Partial<AiNote> | null {
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const j = JSON.parse(m[0])
    const arr = (v: unknown) => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : [])
    return {
      headline: String(j.headline ?? ''), why_now: arr(j.why_now), known: arr(j.known),
      unknown: arr(j.unknown), opener: String(j.opener ?? ''), channel: String(j.channel ?? ''),
      do_not_say: arr(j.do_not_say), fub_task: String(j.fub_task ?? ''),
    }
  } catch { return null }
}

export function templateNote(pick: Pick, f: NoteFacts): AiNote {
  const years = f.estimates?.years_owned != null ? Math.max(1, Math.round(f.estimates.years_owned)) : null
  const since = years ? `It's been about ${years} year${years === 1 ? '' : 's'} since we closed on your place` : `It's been a while since we last talked`
  const review = pick.kind === 'review' && pick.reasons.length > 0
  return {
    headline: review ? 'Past client worth a yearly mortgage review' : 'Past client due for a check-in',
    why_now: review ? pick.reasons.map((r) => REASON_TEXT[r] ?? r) : ['No contact in a while; keep the relationship warm.'],
    known: [
      ...(years ? [`Owned about ${years} years`] : []),
      ...(f.city ? [`Last known city: ${f.city}`] : []),
      ...f.recentActivity.slice(0, 3).map((a) => `${a.type} on ${a.date.slice(0, 10)}`),
    ],
    unknown: [
      'Current rate and loan type',
      'Plans to move, buy again or tap equity',
      ...(f.hasProperty ? [] : ['Which home they own now']),
    ],
    opener: `Hey ${f.firstName}, it's Chandler. ${since}, and I do a quick yearly review for past clients to see if anything makes sense to look at. Got five minutes this week?`,
    channel: 'call - a quick personal call fits an annual check-in',
    do_not_say: ['Any rate, payment or savings figure', 'That they qualify for anything'],
    fub_task: `CA: Mortgage review follow-up with ${f.firstName}`,
    fallback: true,
  }
}

// One call to the model, a regenerate on a failed check, then the template.
export async function makeNote(
  pick: Pick,
  f: NoteFacts,
  ask: ((system: string, user: string) => Promise<string>) | null,
  onReject: (problems: string[]) => void = () => {},
): Promise<AiNote> {
  if (!ask) return templateNote(pick, f)
  const user = JSON.stringify(buildModelInput(pick, f))
  for (let attempt = 0; attempt < 2; attempt++) {
    let text = ''
    try { text = await ask(SYSTEM_PROMPT, user) } catch (e) { onReject([`model error: ${(e as Error).message}`]); continue }
    const note = parseNote(text)
    // Keep the start of an unreadable reply so a bad run can be diagnosed.
    if (!note) { onReject([`unreadable reply: ${text.slice(0, 200) || '(empty)'}`]); continue }
    const check = postCheck(note)
    if (check.ok) return { ...(note as AiNote), fallback: false }
    onReject(check.problems)
  }
  return templateNote(pick, f)
}
