// Pure geometry + view-model helpers for the Overview command center.
// No React, no I/O — unit-testable (overviewCards.test.js). Everything here is
// presentation math over numbers the existing lib/reports.js helpers produce.

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const pad = (n) => String(n).padStart(2, '0')

// Local calendar-day key, matching metrics_daily.date. Same shape as
// lib/calendar dayKey, but built from local parts of a Date we already hold.
export function dateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function todayKey(now = Date.now()) {
  return dateKey(new Date(now))
}

// N days before today, as a YYYY-MM-DD key. daysAgoKey(0) === todayKey().
export function daysAgoKey(days, now = Date.now()) {
  const d = new Date(now)
  d.setDate(d.getDate() - days)
  return dateKey(d)
}

// ---- KPI scoreboard ---------------------------------------------------------

// Percent-of-goal delta between today and yesterday, as a display pill.
// Returns null when yesterday is 0/absent — a jump from nothing is not a
// percentage, and the handoff says omit the pill rather than fake it.
export function deltaPill(today, yesterday) {
  const y = Number(yesterday || 0)
  const t = Number(today || 0)
  if (!y) return null
  const pct = Math.round(((t - y) / y) * 100)
  if (pct === 0) return { text: 'even', up: null }
  return { text: `${pct > 0 ? '+' : '−'}${Math.abs(pct)}% ${pct > 0 ? '↑' : '↓'}`, up: pct > 0 }
}

// value/goal as a clamped bar width. A missing/zero goal renders an empty bar
// rather than dividing by zero.
export function goalPct(value, goal) {
  const g = Number(goal || 0)
  if (!g) return 0
  return Math.max(0, Math.min(100, Math.round((Number(value || 0) / g) * 100)))
}

// ---- Performance chart ------------------------------------------------------

export const CHART = { x0: 42, x1: 560, top: 20, bottom: 200, width: 580, height: 240 }

const NICE_STEPS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500]

// Smallest ceiling above the data that divides into four round gridlines, so
// the axis reads 0/25/50/75/100 whatever the call volume is. Never below 20,
// so an all-zero day still draws a sane axis instead of collapsing.
export function niceMax(values) {
  const peak = Math.max(0, ...values.map((v) => Number(v) || 0))
  const quarter = peak / 4
  const step = NICE_STEPS.find((s) => s >= quarter) ?? Math.ceil(quarter / 1000) * 1000
  return step * 4
}

// Catmull-Rom-ish smoothing: each segment gets control points derived from its
// neighbours, so the line curves without overshooting into negative space.
export function smoothPath(pts) {
  if (!pts || pts.length === 0) return ''
  if (pts.length === 1) return `M ${pts[0][0]} ${pts[0][1]}`
  let d = `M ${pts[0][0]} ${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] || p2
    const c1x = p1[0] + (p2[0] - p0[0]) / 6
    const c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6
    const c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`
  }
  return d
}

// series: { bay: number[], mpg: number[] } — oldest first, equal length, as
// dailySeries() returns. endKey dates the last point. Emits everything the SVG
// needs: gridlines, both line paths, the Bayway area fill, x tick labels and
// the marker on the newest point of `markerKey`'s series.
export function buildChartModel(series, endKey, markerKey = 'bay') {
  const bay = series.bay || []
  const mpg = series.mpg || []
  const n = Math.max(bay.length, mpg.length)
  const { x0, x1, top, bottom } = CHART
  const max = niceMax([...bay, ...mpg])
  const step = n > 1 ? (x1 - x0) / (n - 1) : 0
  const Y = (v) => top + (1 - (Number(v) || 0) / max) * (bottom - top)
  const toPts = (arr) => arr.map((v, i) => [x0 + i * step, Y(v)])

  const bayPts = toPts(bay)
  const mpgPts = toPts(mpg)
  const bayD = smoothPath(bayPts)
  const area = bayPts.length > 1 ? `${bayD} L ${x1} ${bottom} L ${x0} ${bottom} Z` : ''

  const gridY = [1, 0.75, 0.5, 0.25, 0].map((f) => {
    const v = Math.round(max * f)
    return { y: Y(v), ty: Y(v) + 4, label: String(v) }
  })

  // Label every other day, always including the newest ("Today").
  const end = new Date(`${endKey}T00:00:00`)
  const xticks = []
  for (let i = 0; i < n; i++) {
    const isLast = i === n - 1
    if (!isLast && (n - 1 - i) % 2 !== 0) continue
    const d = new Date(end)
    d.setDate(d.getDate() - (n - 1 - i))
    xticks.push({
      x: x0 + i * step,
      label: isLast ? 'Today' : String(d.getDate()),
      last: isLast,
    })
  }

  const markerPts = markerKey === 'mpg' ? mpgPts : bayPts
  const markerVals = markerKey === 'mpg' ? mpg : bay
  const marker = markerPts.length
    ? {
        x: markerPts[markerPts.length - 1][0],
        y: markerPts[markerPts.length - 1][1],
        value: markerVals[markerVals.length - 1],
      }
    : null

  return { max, gridY, xticks, marker, bay: bayD, mpg: smoothPath(mpgPts), area, empty: n === 0 }
}

// ---- Revenue gauge ----------------------------------------------------------

export const GAUGE = { cx: 110, cy: 88, r: 74, startDeg: 225, sweepDeg: 270 }

// A 270° dial: track arc plus a value arc covering pct of the sweep.
export function gaugeArcs(pct) {
  const { cx, cy, r, startDeg, sweepDeg } = GAUGE
  const p = Math.max(0, Math.min(100, Number(pct) || 0))
  const at = (deg) => {
    const a = ((deg - 90) * Math.PI) / 180
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
  }
  const s = at(startDeg)
  const e = at(startDeg + sweepDeg)
  const v = at(startDeg + (sweepDeg * p) / 100)
  const large = (sweepDeg * p) / 100 > 180 ? 1 : 0
  const f = (n) => n.toFixed(1)
  return {
    trackD: `M ${f(s[0])} ${f(s[1])} A ${r} ${r} 0 1 1 ${f(e[0])} ${f(e[1])}`,
    // Zero percent would otherwise emit a degenerate arc that some renderers
    // draw as a full circle; an empty path is the honest "nothing yet".
    valD: p === 0 ? '' : `M ${f(s[0])} ${f(s[1])} A ${r} ${r} 0 ${large} 1 ${f(v[0])} ${f(v[1])}`,
    pct: p,
  }
}

// Compact currency for the gauge sub-stats: $4.2M / $28.4K / $940.
export function compactCurrency(n) {
  const v = Number(n || 0)
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(1)}K`
  return `$${Math.round(v)}`
}

// ---- Month calendar ---------------------------------------------------------

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function monthLabel(year, month) {
  return `${MONTHS[month]} ${year}`
}

// A Monday-first month grid. dotsByKey maps 'YYYY-MM-DD' -> business color, so
// a day carrying events shows the dot of the book it belongs to.
// Leading blanks keep the first row aligned; trailing cells are not padded.
export function monthCells(year, month, dotsByKey = {}) {
  const first = new Date(year, month, 1)
  const lead = (first.getDay() + 6) % 7 // Mon=0
  const days = new Date(year, month + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < lead; i++) cells.push({ key: `blank-${i}`, blank: true })
  for (let d = 1; d <= days; d++) {
    const key = `${year}-${pad(month + 1)}-${pad(d)}`
    cells.push({ key, day: d, blank: false, dot: dotsByKey[key] || null })
  }
  return cells
}

// events -> { 'YYYY-MM-DD': color }. Mixed-business days take the dual marker.
// keyOf/bizOf are injected so this stays free of calendar.js import cycles.
export function eventDots(events, keyOf, bizOf) {
  const seen = {}
  for (const e of events || []) {
    const key = keyOf(e)
    if (!key) continue
    const biz = bizOf(e)
    const color = biz === 'mpg' ? 'var(--mpg)' : 'var(--bay)'
    if (!seen[key]) seen[key] = color
    else if (seen[key] !== color) seen[key] = 'var(--bay-gold)'
  }
  return seen
}

// ---- Misc -------------------------------------------------------------------

// "Michael Reynolds" -> "MR"; "Riverside Deli" -> "RD"; falls back to "?".
export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = parts[0][0]
  const last = parts.length > 1 ? parts[parts.length - 1][0] : ''
  return (first + last).toUpperCase()
}
