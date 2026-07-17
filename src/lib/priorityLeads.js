// Pure presentation helpers for the Priority Leads panel.
// No React, no I/O — unit-testable (priorityLeads.test.js).

// Tab order + heat styling per tier. Colors read hot -> cold and stay clear of
// the green/blue business system so a tier badge is never mistaken for a
// business badge. Warm/active reuse the Bayway gold/green vars; hot is a
// dedicated red; never-contacted is muted.
export const TIERS = [
  { key: 'hot', label: 'Hot', color: '#ff5c5c', soft: 'rgba(255,92,92,0.14)' },
  { key: 'warm', label: 'Warm', color: 'var(--bay-gold)', soft: 'rgba(124,173,68,0.16)' },
  { key: 'active', label: 'Active', color: 'var(--bay)', soft: 'var(--bay-soft)' },
  { key: 'never_contacted', label: 'Never Contacted', color: 'var(--dim)', soft: 'rgba(148,148,158,0.14)' },
]

const TIER_BY_KEY = new Map(TIERS.map((t) => [t.key, t]))

export function tierMeta(key) {
  return TIER_BY_KEY.get(key) || TIERS[TIERS.length - 1]
}

// Clamp a raw score to a 0-100 integer width for the score bar. Null/garbage
// scores render as an empty bar rather than throwing.
export function scoreBarPct(score) {
  const n = Number(score)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}

// Sort by score descending; null/undefined scores always sink to the bottom.
export function sortByScore(rows) {
  return [...rows].sort((a, b) => {
    const av = Number.isFinite(Number(a.score)) ? Number(a.score) : -Infinity
    const bv = Number.isFinite(Number(b.score)) ? Number(b.score) : -Infinity
    return bv - av
  })
}

// Group rows into the four tier buckets, each pre-sorted by score desc.
// Unknown tiers are dropped (the view only emits the four known tiers).
export function groupByTier(rows) {
  const out = {}
  for (const t of TIERS) out[t.key] = []
  for (const r of rows || []) {
    if (out[r.tier]) out[r.tier].push(r)
  }
  for (const key of Object.keys(out)) out[key] = sortByScore(out[key])
  return out
}
