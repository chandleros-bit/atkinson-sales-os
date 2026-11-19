// Database Opportunity Agent: signals, exclusions and daily selection
// (spec "Opportunity scoring and daily selection"). Pure and dependency-free.
// The score only ranks contacts against each other. It is not a probability.

import type { Estimates } from './opportunity-estimates.ts'

const DAY_MS = 86_400_000

export const DEFAULT_WEIGHTS: Record<string, number> = {
  RATE_GAP_HIGH: 30,
  RATE_GAP: 15,
  EQUITY_100K: 30,
  EQUITY_50K: 20,
  PMI_LIKELY_REMOVABLE: 15,
  INVESTOR: 15,
  MOVE_UP_WINDOW: 10,
  ANNIVERSARY: 10,
  RECENT_ENGAGEMENT: 20,
  KNOWN_ARM: 25,
}

export type Candidate = {
  contactId: string
  householdKey: string // shared phone or matched property; one pick per household
  propertyState?: string | null // state of the MATCHED property, never the FUB address
  hasProperty: boolean
  recordingDate?: string | null
  homestead?: boolean | null
  parcelsOwned?: number | null
  keptPriorHome?: boolean
  knownArm?: boolean
  lastEngagementAt?: string | null // email open, click, site visit or inbound message
  lastContactAt?: string | null // any logged call, text or email
  lastPickedAt?: string | null
  salesOsStage?: string | null
  doNotContact?: boolean
  snoozed?: boolean // active dial_skips or lead_snoozes row
  activeLoan?: boolean // loans.stage_group in prospect, processing or closing
  estimates?: Partial<Estimates> | null
}

export type Config = {
  weights?: Record<string, number>
  cooldownDays?: number
  minMonthsOwned?: number
  activeStages?: string[]
  licensedStates?: string[]
}

function days(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null
  return (now.getTime() - new Date(iso).getTime()) / DAY_MS
}

// Days until the next anniversary of `iso` (0 = today).
export function daysToAnniversary(iso: string, now: Date): number {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso)
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  let next = Date.UTC(now.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  if (next < today) next = Date.UTC(now.getUTCFullYear() + 1, d.getUTCMonth(), d.getUTCDate())
  return Math.round((next - today) / DAY_MS)
}

// Signals that fire for one contact. Missing data never drops a contact; it
// only means that signal can't fire.
export function signals(c: Candidate, now: Date, cfg: Config = {}): { score: number; reasons: string[] } {
  const w = { ...DEFAULT_WEIGHTS, ...(cfg.weights ?? {}) }
  const e = c.estimates ?? {}
  const reasons: string[] = []

  if (e.rate_gap != null) {
    if (e.rate_gap >= 1) reasons.push('RATE_GAP_HIGH')
    else if (e.rate_gap >= 0.5) reasons.push('RATE_GAP')
  }
  if (e.tappable_80 != null) {
    if (e.tappable_80 >= 100_000) reasons.push('EQUITY_100K')
    else if (e.tappable_80 >= 50_000) reasons.push('EQUITY_50K')
  }
  if (e.orig_ltv != null && e.est_ltv != null && e.orig_ltv > 0.8 && e.est_ltv <= 0.8) {
    reasons.push('PMI_LIKELY_REMOVABLE')
  }
  if (c.hasProperty && (c.homestead === false || (c.parcelsOwned ?? 0) >= 2 || c.keptPriorHome)) {
    reasons.push('INVESTOR')
  }
  if (e.years_owned != null && e.years_owned >= 4 && e.years_owned <= 10) reasons.push('MOVE_UP_WINDOW')
  if (c.recordingDate && daysToAnniversary(c.recordingDate, now) <= 14) reasons.push('ANNIVERSARY')
  const eng = days(c.lastEngagementAt, now)
  if (eng != null && eng <= 30) reasons.push('RECENT_ENGAGEMENT')
  if (c.knownArm) reasons.push('KNOWN_ARM')

  const score = reasons.reduce((s, r) => s + (w[r] ?? 0), 0)
  return { score, reasons }
}

// Why a contact can never be picked today, or null when eligible.
export function exclusionReason(c: Candidate, now: Date, cfg: Config = {}): string | null {
  const cooldown = cfg.cooldownDays ?? 90
  const contacted = days(c.lastContactAt, now)
  if (contacted != null && contacted < cooldown) return 'recent_contact'
  const picked = days(c.lastPickedAt, now)
  if (picked != null && picked < cooldown) return 'recently_picked'
  if (c.salesOsStage && (cfg.activeStages ?? []).includes(c.salesOsStage)) return 'active_stage'
  if (c.doNotContact) return 'do_not_contact'
  if (c.snoozed) return 'snoozed'
  if (c.activeLoan) return 'active_loan'
  const owned = days(c.recordingDate, now)
  if (owned != null && owned < ((cfg.minMonthsOwned ?? 12) * 365.25) / 12) return 'owned_under_12_months'
  return null
}

// A mortgage review only for a matched property in a licensed state. Everyone
// else eligible (out of state, or no property found) is check-in only.
export function reviewEligible(c: Candidate, cfg: Config = {}): boolean {
  const licensed = cfg.licensedStates ?? ['TX', 'FL']
  return c.hasProperty && !!c.propertyState && licensed.includes(c.propertyState.toUpperCase())
}

export type Pick = {
  contactId: string
  householdKey: string
  rank: number
  kind: 'review' | 'check_in'
  score: number
  reasons: string[]
}

// Never contacted sorts first (longest time since contact).
function sinceContact(c: Candidate, now: Date): number {
  const d = days(c.lastContactAt, now)
  return d == null ? Number.POSITIVE_INFINITY : d
}

export function picksForDate(date: Date, perDay = 5, byWeekday: Record<string, number> = {}): number {
  const iso = date.getUTCDay() === 0 ? 7 : date.getUTCDay() // ISO weekday, Monday = 1
  return byWeekday[String(iso)] ?? perDay
}

// Daily selection. Every `checkInEvery`th slot is a relationship check-in;
// the rest go to the highest scorers. Households are picked once.
export function selectPicks(
  candidates: Candidate[],
  opts: { now: Date; count: number; checkInEvery?: number; config?: Config },
): Pick[] {
  const { now, count } = opts
  const every = opts.checkInEvery ?? 5
  const cfg = opts.config ?? {}

  const eligible = candidates.filter((c) => exclusionReason(c, now, cfg) == null)

  // One entry per household: keep its best-scoring member.
  const households = new Map<string, { c: Candidate; score: number; reasons: string[]; review: boolean }>()
  for (const c of eligible) {
    const review = reviewEligible(c, cfg)
    const s = review ? signals(c, now, cfg) : { score: 0, reasons: [] }
    const prev = households.get(c.householdKey)
    if (!prev || s.score > prev.score) households.set(c.householdKey, { c, ...s, review })
  }
  const all = [...households.values()]

  const byLongestSilence = (a: { c: Candidate }, b: { c: Candidate }) =>
    sinceContact(b.c, now) - sinceContact(a.c, now)
  const scored = all
    .filter((h) => h.review && h.score > 0)
    .sort((a, b) => b.score - a.score || byLongestSilence(a, b))
  const checkIns = all.filter((h) => !(h.review && h.score > 0)).sort(byLongestSilence)

  const used = new Set<string>()
  const take = (pool: typeof all) => {
    const h = pool.find((x) => !used.has(x.c.householdKey))
    if (h) used.add(h.c.householdKey)
    return h
  }

  const picks: Pick[] = []
  for (let rank = 1; rank <= count; rank++) {
    const wantCheckIn = rank % every === 0
    let h = wantCheckIn ? take(checkIns) : take(scored)
    let kind: Pick['kind'] = wantCheckIn ? 'check_in' : 'review'
    if (!h) {
      // Few scorers: fill with check-ins (and the reverse if check-ins run out).
      h = wantCheckIn ? take(scored) : take(checkIns)
      if (h) kind = h.review && h.score > 0 ? 'review' : 'check_in'
    }
    if (!h) break
    picks.push({
      contactId: h.c.contactId,
      householdKey: h.c.householdKey,
      rank,
      kind,
      score: kind === 'review' ? h.score : 0,
      reasons: kind === 'review' ? h.reasons : [],
    })
  }
  return picks
}
