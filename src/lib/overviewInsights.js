// Overview redesign, part 3 (spec 2026-11-22, A8–A9): the rate watch summary
// of Opportunities and source pull-through from the Analytics ROI table.
// Pure: Overview.jsx fetches and draws.

// Monthly principal and interest on `balance` at `ratePct` (e.g. 6.875), 30 years.
export function monthlyPayment(balance, ratePct, years = 30) {
  const b = Number(balance)
  const r = Number(ratePct) / 100 / 12
  const n = years * 12
  if (!(b > 0) || !Number.isFinite(r)) return null
  if (r === 0) return b / n
  return (b * r) / (1 - Math.pow(1 + r, -n))
}

export const RATE_GAP = 0.75

// picks: today's pending opportunity_picks { id, contact_id, contacts: { name } }.
// estimates: Map contact_id -> opportunity_estimates row { est_rate, est_balance }.
// pmms: the newest pmms_weekly row { week_date, rate_30_fixed } or null.
// -> { pmms, week, rows: [{ id, contactId, name, rate, balance, saving }], pending }
// rows: picks whose estimated rate is at least PMMS + 0.75, biggest saving first.
export function rateWatch({ picks = [], estimates = new Map(), pmms = null }) {
  const market = pmms?.rate_30_fixed != null ? Number(pmms.rate_30_fixed) : null
  const rows = []
  if (market != null) {
    for (const p of picks) {
      const e = estimates.get(p.contact_id)
      const rate = e?.est_rate != null ? Number(e.est_rate) : null
      const balance = e?.est_balance != null ? Number(e.est_balance) : null
      if (rate == null || rate < market + RATE_GAP) continue
      const now = monthlyPayment(balance, rate)
      const then = monthlyPayment(balance, market)
      rows.push({
        id: p.id,
        contactId: p.contact_id,
        name: p.contacts?.name || 'Past client',
        rate,
        balance,
        saving: now != null && then != null ? Math.round(now - then) : null,
      })
    }
  }
  rows.sort((a, b) => (b.saving ?? -1) - (a.saving ?? -1))
  return { pmms: market, week: pmms?.week_date || null, rows, pending: picks.length }
}

// roi: roiTable output for one book. Bayway: lead -> app -> funded; MPG:
// lead -> submitted -> approved. Top `n` sources by the last step, then
// leads; the "Not linked to a lead" row is left out.
// -> [{ source, leads, mid, last, pct }], pct = last / leads.
export function pullThrough(roi, book, n = 5) {
  const bay = book === 'bay'
  return (roi?.rows || [])
    .filter((r) => !r.notLinked && r.leads > 0)
    .map((r) => {
      const mid = bay ? r.counts.apps || 0 : r.counts.submitted || 0
      const last = bay ? r.funded || 0 : r.counts.approved || 0
      return { source: r.source, leads: r.leads, mid, last, pct: Math.round((last / r.leads) * 100) }
    })
    .sort((a, b) => b.last - a.last || b.leads - a.leads || a.source.localeCompare(b.source))
    .slice(0, n)
}
