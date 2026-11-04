// Lead temperature (spec 2026-11-03, section 1): Chandler's Hot / Warm / Cold
// read of a lead after a conversation. Pure, no React, no I/O. Ratings come
// from lead_ratings (useLeadRatings) and are merged onto view rows by id.
export const TEMPERATURES = ['hot', 'warm', 'cold']
export const TEMP_LABEL = { hot: 'Hot', warm: 'Warm', cold: 'Cold' }
// Months from now a rated lead is expected to close (settings.forecast can override).
export const DEFAULT_CLOSE_OFFSET = { hot: 1, warm: 2, cold: 3 }
// Score points gained since a Cold rating that make it worth a second look.
export const COLD_ACTIVE_RISE = 20

const pad = (n) => String(n).padStart(2, '0')
const firstOfMonth = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`

// 'YYYY-MM-01', local calendar.
export function defaultCloseMonth(temperature, now = Date.now(), offsets = DEFAULT_CLOSE_OFFSET) {
  const d = new Date(now)
  d.setDate(1)
  d.setMonth(d.getMonth() + (offsets?.[temperature] ?? DEFAULT_CLOSE_OFFSET[temperature] ?? 1))
  return firstOfMonth(d)
}

export function closeMonthOf(rating, now = Date.now(), offsets = DEFAULT_CLOSE_OFFSET) {
  return rating?.close_month ? String(rating.close_month).slice(0, 10) : defaultCloseMonth(rating?.temperature, now, offsets)
}

// ratings: Map contact_id -> rating. Unrated rows come back unchanged.
export function withRatings(rows, ratings) {
  if (!ratings || !ratings.size) return rows
  return rows.map((r) => {
    const x = ratings.get(r.id)
    return x ? { ...r, temperature: x.temperature, est_amount: x.est_amount ?? null, close_month: x.close_month ?? null, rating: x } : r
  })
}

// A rating decides; unrated leads keep the view's is_hot (Engagement tier or tag).
export function effectiveHot(row) {
  return row?.temperature ? row.temperature === 'hot' : !!row?.is_hot
}

const RANK = { hot: 0, warm: 1, cold: 3 }
export function temperatureRank(row) {
  return row?.temperature ? RANK[row.temperature] : 2
}

// rating carries current_score / current_tier from contacts (useLeadRatings).
export function coldButActive(rating) {
  if (!rating || rating.temperature !== 'cold') return false
  if (rating.current_tier === 'hot') return true
  const now = rating.current_score
  const then = rating.score_at_rating
  return now != null && then != null && now - then >= COLD_ACTIVE_RISE
}
