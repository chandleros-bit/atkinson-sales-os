import { useState } from 'react'
import Field, { Out, copyText } from './Field'
import { parseAmount, money, pct } from '../../lib/calc/parse'
import { loanPayment, DEFAULT_TAX_RATE } from '../../lib/calc/loanPayment'
import { dscr } from '../../lib/calc/dscr'

export const LOAN_DEFAULTS = { price: '', downMode: 'pct', down: '20', rate: '', years: '30', taxes: '', taxesEdited: false, insurance: '', hoa: '', mi: '0.5', closing: '3', rent: '', minDscr: '1.00' }

export function loanInputs(v) {
  return {
    price: parseAmount(v.price) ?? 0,
    downMode: v.downMode,
    down: parseAmount(v.down) ?? 0,
    rate: parseAmount(v.rate),
    years: parseAmount(v.years) ?? 30,
    taxesYear: v.taxesEdited ? parseAmount(v.taxes) ?? 0 : null,
    insuranceYear: parseAmount(v.insurance) ?? 0,
    hoaMonth: parseAmount(v.hoa) ?? 0,
    miRate: parseAmount(v.mi),
    closingPct: parseAmount(v.closing),
  }
}

// v / setV: the shared input state (LOAN_DEFAULTS shape), kept by the page so
// switching between payment and DSCR keeps the numbers. mode: 'payment' | 'dscr'.
export default function LoanCalc({ mode, v, setV }) {
  const [copied, setCopied] = useState(false)
  const set = (k) => (val) => setV((s) => ({ ...s, [k]: val, ...(k === 'taxes' ? { taxesEdited: true } : {}) }))
  const i = loanInputs(v)
  const p = loanPayment(i)
  const d = mode === 'dscr' ? dscr(i, parseAmount(v.rent), parseAmount(v.minDscr) ?? 1) : null
  const taxesShown = v.taxesEdited ? v.taxes : i.price ? String(Math.round((i.price * DEFAULT_TAX_RATE) / 100)) : ''

  const summary = () => {
    const lines = [
      `Price ${money(p.price)} · Loan ${money(p.loan)} · LTV ${pct(p.ltv)}`,
      `Rate ${v.rate || '-'}% · ${v.years} years`,
      `P&I ${money(p.pi, true)} · Taxes ${money(p.taxes, true)} · Insurance ${money(p.insurance, true)} · HOA ${money(p.hoa, true)}${p.miOn ? ` · MI ${money(p.mi, true)}` : ''}`,
      `Total monthly ${money(p.total, true)} · Cash to close ${money(p.cashToClose)}`,
    ]
    if (d) lines.push(`Rent ${money(parseAmount(v.rent))} · DSCR ${d.ratio === null ? '-' : d.ratio.toFixed(2)} (min ${v.minDscr}) · Largest loan ${money(d.maxLoan)}`)
    return lines.join('\n')
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Field label="Price" value={v.price} onChange={set('price')} />
        <div className="min-w-0">
          <Field label={v.downMode === 'pct' ? 'Down payment %' : 'Down payment $'} value={v.down} onChange={set('down')} />
          <button type="button" className="mt-0.5 text-[11px] text-[#1d4ed8]" onClick={() => setV((s) => ({ ...s, downMode: s.downMode === 'pct' ? 'amt' : 'pct', down: '' }))}>
            Use {v.downMode === 'pct' ? '$' : '%'}
          </button>
        </div>
        <Field label="Rate %" value={v.rate} onChange={set('rate')} />
        <label className="block min-w-0">
          <span className="mb-0.5 block text-[11px] font-medium text-muted">Term</span>
          <select aria-label="Term" value={v.years} onChange={(e) => set('years')(e.target.value)} className="w-full rounded-[8px] border border-line2 bg-panel2 px-2 py-1.5 text-[13px]">
            {['30', '25', '20', '15', '10'].map((y) => (
              <option key={y} value={y}>
                {y} years
              </option>
            ))}
          </select>
        </label>
        <Field label="Taxes per year" value={taxesShown} onChange={set('taxes')} />
        <Field label="Insurance per year" value={v.insurance} onChange={set('insurance')} />
        <Field label="HOA per month" value={v.hoa} onChange={set('hoa')} />
        {p.miOn && <Field label="Mortgage insurance %" value={v.mi} onChange={set('mi')} />}
        <Field label="Closing costs %" value={v.closing} onChange={set('closing')} />
        {mode === 'dscr' && <Field label="Monthly rent" value={v.rent} onChange={set('rent')} />}
        {mode === 'dscr' && <Field label="Minimum DSCR" value={v.minDscr} onChange={set('minDscr')} />}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Out k="loan" label="Loan amount">{money(p.loan)}</Out>
        <Out k="ltv" label="LTV">{pct(p.ltv)}</Out>
        <Out k="pi" label="Principal and interest">{money(p.pi, true)}</Out>
        <Out k="total" label="Total monthly">{money(p.total, true)}</Out>
      </div>
      <div className="text-[12.5px] text-muted">
        Taxes {money(p.taxes, true)} · Insurance {money(p.insurance, true)} · HOA {money(p.hoa, true)}
        {p.miOn ? ` · MI ${money(p.mi, true)}` : ''} · Cash to close {money(p.cashToClose)}
      </div>

      {d && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Out k="ratio" label={`DSCR (minimum ${v.minDscr || '1.00'})`} tone={d.pass === null ? undefined : d.pass ? '#067647' : '#b42318'}>
            {d.ratio === null ? '-' : d.ratio.toFixed(2)}
          </Out>
          <Out k="maxLoan" label="Largest loan at the minimum">
            {d.uncovered ? 'Rent does not cover taxes, insurance and HOA at this minimum' : `${money(d.maxLoan)}${d.maxLtv !== null ? ` · ${pct(d.maxLtv)} LTV` : ''}`}
          </Out>
        </div>
      )}
      <button type="button" className="self-start text-[12.5px] font-semibold text-[#1d4ed8]" onClick={async () => setCopied(await copyText(summary()))}>
        {copied ? 'Copied' : 'Copy summary'}
      </button>
    </div>
  )
}
