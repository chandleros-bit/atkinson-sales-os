// Loan payment math (spec section 3). Inputs are numbers or null.
export const DEFAULT_TAX_RATE = 2.2 // % of price per year (Houston-area estimate)
export const DEFAULT_MI_RATE = 0.5 // % of loan per year, only over 80% LTV
export const DEFAULT_CLOSING_PCT = 3 // % of price

export function monthlyPI(loan, ratePct, years) {
  const n = (years || 0) * 12
  if (!(loan > 0) || !(n > 0) || ratePct === null || ratePct === undefined) return null
  const r = ratePct / 100 / 12
  if (r === 0) return loan / n
  return (loan * r) / (1 - Math.pow(1 + r, -n))
}

export function loanFromPI(pi, ratePct, years) {
  const n = (years || 0) * 12
  if (!(pi > 0) || !(n > 0) || ratePct === null || ratePct === undefined) return null
  const r = ratePct / 100 / 12
  if (r === 0) return pi * n
  return (pi * (1 - Math.pow(1 + r, -n))) / r
}

// i: { price, downMode: 'pct'|'amt', down, rate, years, taxesYear, insuranceYear,
//      hoaMonth, miRate, closingPct }. taxesYear null = DEFAULT_TAX_RATE of price.
export function loanPayment(i) {
  const price = i.price || 0
  const downAmt = i.downMode === 'amt' ? i.down || 0 : (price * (i.down ?? 0)) / 100
  const loan = Math.max(0, price - downAmt)
  const ltv = price > 0 ? (loan / price) * 100 : null
  const pi = monthlyPI(loan, i.rate, i.years)
  const taxes = (i.taxesYear ?? (price * DEFAULT_TAX_RATE) / 100) / 12
  const insurance = (i.insuranceYear || 0) / 12
  const hoa = i.hoaMonth || 0
  const miOn = ltv !== null && ltv > 80
  const mi = miOn ? (loan * (i.miRate ?? DEFAULT_MI_RATE)) / 100 / 12 : 0
  const total = pi === null ? null : pi + taxes + insurance + hoa + mi
  const closing = (price * (i.closingPct ?? DEFAULT_CLOSING_PCT)) / 100
  return { price, downAmt, loan, ltv, pi, taxes, insurance, hoa, mi, miOn, total, closing, cashToClose: downAmt + closing }
}
