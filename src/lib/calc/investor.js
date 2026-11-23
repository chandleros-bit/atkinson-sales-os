// Investor read on a DSCR run: pricing band, cash flow, and which loan type
// fits. Thresholds are typical guides, not any one lender's; every number is
// an estimate until priced in Optimal Blue.

export const DSCR_BANDS = [
  { id: 'none', min: 0, label: 'Below 0.75: most DSCR lenders will not do it' },
  { id: 'low', min: 0.75, label: '0.75 to 0.99: a few lenders, higher rate, more down' },
  { id: 'standard', min: 1, label: '1.00 to 1.24: standard DSCR pricing' },
  { id: 'best', min: 1.25, label: '1.25 or higher: best DSCR pricing' },
]

export function dscrBand(ratio) {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return null
  return [...DSCR_BANDS].reverse().find((b) => ratio >= b.min)
}

export function cashFlow(rent, total) {
  if (!(rent > 0) || !(total > 0)) return null
  return Math.round((rent - total) * 100) / 100
}

export const INCOME_TYPES = [
  { id: 'full', label: 'W-2 or tax returns show the income' },
  { id: 'self', label: 'Self-employed, tax returns show less' },
  { id: 'none', label: 'Does not want to use income' },
]

const MAX_LTV = { Conventional: 85, DSCR: 80, 'Bank statement': 80 }
const MIN_DSCR = 0.75

// income: 'full' | 'self' | 'none'; ratio: DSCR or null; ltv: percent.
// Returns { best, options: [{ type, fits, why }] } in the order to try them.
export function loanFit({ income, ratio, ltv }) {
  const check = (type, docsOk, docsWhy, extra) => {
    if (!docsOk) return { type, fits: false, why: docsWhy }
    if (ltv > MAX_LTV[type]) return { type, fits: false, why: `Usually ${MAX_LTV[type]}% LTV or less on a purchase` }
    if (extra) return { type, fits: false, why: extra }
    return { type, fits: true, why: null }
  }
  const conv = check('Conventional', income === 'full', 'Needs income shown on W-2s or tax returns')
  const dscrLow = ratio === null || ratio < MIN_DSCR ? `Needs a DSCR of at least ${MIN_DSCR.toFixed(2)}` : null
  const dscrOpt = check('DSCR', true, null, dscrLow)
  const bank = check('Bank statement', income === 'self', 'For self-employed borrowers')
  const strong = ratio !== null && ratio >= 1

  let options
  if (income === 'full') options = [conv, dscrOpt, bank]
  else if (income === 'self') options = strong ? [dscrOpt, bank, conv] : [bank, dscrOpt, conv]
  else options = [dscrOpt, bank, conv]
  return { best: options.find((o) => o.fits)?.type ?? null, options }
}
