// DSCR (spec section 4): rent / full payment, and the largest loan whose
// payment (P&I, taxes, insurance, HOA; MI left out) meets the minimum.
import { loanPayment, loanFromPI } from './loanPayment'

export function dscr(inputs, rent, minDscr = 1) {
  const payment = loanPayment(inputs)
  const ratio = payment.total && rent > 0 ? rent / payment.total : null
  const budget = rent > 0 && minDscr > 0 ? rent / minDscr - payment.taxes - payment.insurance - payment.hoa : null
  const maxLoan = budget !== null && budget > 0 ? loanFromPI(budget, inputs.rate, inputs.years) : null
  return {
    payment,
    ratio,
    pass: ratio === null ? null : ratio >= minDscr,
    budget,
    maxLoan,
    maxLtv: maxLoan !== null && payment.price > 0 ? (maxLoan / payment.price) * 100 : null,
    uncovered: budget !== null && budget <= 0,
  }
}
