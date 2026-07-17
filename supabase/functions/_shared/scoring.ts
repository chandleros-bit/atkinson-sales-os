// Priority-lead scoring — pure, dependency-free so it runs both under Deno
// (imported by score-fub-leads/index.ts) and under vitest (scoring.test.ts).
// NO Deno or URL imports here on purpose; keep this file pure math.
//
// A lead's score blends how MUCH they engaged (weighted by channel + call
// length) with how RECENTLY, plus a flat bonus for the manual FollowUpBoss
// `HOT` tag. Tiers bucket the result. All tunables live at the top so they can
// be adjusted without touching the logic (see priority-leads-spec §2).

// --- Tunable weights -------------------------------------------------------
export const WEIGHTS = {
  // Half-life (days) of the recency multiplier: engagement from `halfLife`
  // days ago counts half as much as engagement today.
  recencyHalfLifeDays: 14,
  // Per-interaction channel weights. Calls are the strongest signal; notes
  // (often logged automatically) the weakest. Emails/texts sit below calls.
  callWeight: 10,
  apptWeight: 8,
  emailWeight: 4,
  noteWeight: 2,
  // Extra points per minute of call time, capped so one marathon call can't
  // dominate. 1 pt/min up to 10 min => at most +10 per call.
  callDurationBonusPerMin: 1,
  callDurationCapMinutes: 10,
  // Flat additive bonus when the contact carries the FUB `HOT` tag. Not
  // recency-scaled — a manual HOT flag stays meaningful even if quiet lately.
  // Sized so a bare HOT lead (no logged activity) still shows a mid score bar,
  // since on this account the HOT tag is the primary intent signal, not calls.
  hotTagBonus: 40,
  // Raw score that maps to a full 100 on the UI bar. Tuning knob for spread.
  scoreMax: 90,
}

// --- Tunable tier thresholds ----------------------------------------------
export const TIER_THRESHOLDS = {
  hotMinScore: 70, // hot needs a high score AND recent activity
  hotMaxRecencyDays: 14,
}

export const TIERS = ['hot', 'warm', 'active', 'never_contacted']

const DAY_MS = 86_400_000

// Days since an ISO timestamp (floored). null timestamp => null.
export function daysSince(iso, now = Date.now()) {
  if (!iso) return null
  return Math.floor((now - new Date(iso).getTime()) / DAY_MS)
}

// Same rule as src/lib/overview.js isHot(): case-insensitive "hot" in a FUB
// tags string array. Duplicated (not imported) to keep this file Deno-pure.
export function isHotTag(tags) {
  return Array.isArray(tags) && tags.some((t) => String(t).trim().toLowerCase() === 'hot')
}

export function channelWeight(type) {
  switch (type) {
    case 'call':
      return WEIGHTS.callWeight
    case 'appointment':
      return WEIGHTS.apptWeight
    case 'email':
      return WEIGHTS.emailWeight
    case 'note':
      return WEIGHTS.noteWeight
    default:
      return 0
  }
}

export function callDurationBonus(durationSeconds) {
  const mins = Math.min((Number(durationSeconds) || 0) / 60, WEIGHTS.callDurationCapMinutes)
  return Math.max(0, mins) * WEIGHTS.callDurationBonusPerMin
}

// activities: [{ type, occurredAt (ISO|null), durationSeconds? }] for ONE
// contact, already limited to the scoring window by the caller.
// Returns { score: 0..100 int, lastActivityAt: ISO|null, activityCount }.
export function scoreContact(activities, { hasHotTag = false, now = Date.now() } = {}) {
  const list = Array.isArray(activities) ? activities : []
  const activityCount = list.length

  let engagement = 0
  let lastMs = null
  for (const a of list) {
    engagement += channelWeight(a.type)
    if (a.type === 'call') engagement += callDurationBonus(a.durationSeconds)
    const t = a.occurredAt ? new Date(a.occurredAt).getTime() : NaN
    if (!Number.isNaN(t) && (lastMs === null || t > lastMs)) lastMs = t
  }

  const lastActivityAt = lastMs === null ? null : new Date(lastMs).toISOString()

  // Recency multiplier on engagement (exponential decay). No dated activity
  // => no recency credit; only the HOT bonus (if any) survives.
  const days = lastMs === null ? null : Math.max(0, (now - lastMs) / DAY_MS)
  const recency = days === null ? 0 : Math.pow(0.5, days / WEIGHTS.recencyHalfLifeDays)

  const raw = engagement * recency + (hasHotTag ? WEIGHTS.hotTagBonus : 0)
  const score = Math.max(0, Math.min(100, Math.round((100 * raw) / WEIGHTS.scoreMax)))

  return { score, lastActivityAt, activityCount }
}

// Precedence: hot -> active -> warm -> never_contacted.
// This account logs almost no FUB activity, so intent signals (the manual HOT
// tag and pipeline stage) rank ABOVE activity volume — otherwise a HOT or
// in-pipeline lead with no logged call would wrongly read as "never contacted".
//  - hot: carries the HOT tag, OR high score AND recent activity.
//  - active: currently in an open pipeline stage.
//  - warm: has any logged activity but isn't hot/active.
//  - never_contacted: no HOT tag, not in pipeline, and zero activity rows.
export function assignTier({
  score,
  lastActivityAt,
  activityCount,
  inOpenPipeline = false,
  hasHotTag = false,
  now = Date.now(),
}) {
  const days = daysSince(lastActivityAt, now)
  const recentEnough = days !== null && days <= TIER_THRESHOLDS.hotMaxRecencyDays
  if (hasHotTag || (score >= TIER_THRESHOLDS.hotMinScore && recentEnough)) return 'hot'
  if (inOpenPipeline) return 'active'
  if (activityCount > 0) return 'warm'
  return 'never_contacted'
}
