// Text-box input and display helpers for the Reference calculators.
// "$1,200" -> 1200, "20%" -> 20, "" -> null.
export function parseAmount(s) {
  if (s === null || s === undefined) return null
  const t = String(s).replace(/[$,%\s]/g, '')
  if (t === '' || t === '-' || t === '.') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

const ok = (n) => typeof n === 'number' && Number.isFinite(n)

export function money(n, cents = false) {
  if (!ok(n)) return '-'
  const d = cents ? 2 : 0
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: d, maximumFractionDigits: d })
}

export const pct = (n, digits = 1) => (ok(n) ? `${n.toFixed(digits)}%` : '-')
