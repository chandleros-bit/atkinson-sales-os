import { useState } from 'react'
import Field, { Out, copyText } from './Field'
import { parseAmount, money, pct } from '../../lib/calc/parse'
import { loanPayment, DEFAULT_TAX_RATE } from '../../lib/calc/loanPayment'
import { dscr } from '../../lib/calc/dscr'
import { dscrBand, cashFlow, loanFit, INCOME_TYPES } from '../../lib/calc/investor'

export const LOAN_DEFAULTS = { price: '', downMode: 'pct', down: '20', rate: '', years: '30', taxes: '', taxesEdited: false, insurance: '', hoa: '', mi: '0.5', closing: '3', rent: '', minDscr: '1.00', income: 'none' }

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
  const band = d ? dscrBand(d.ratio) : null
  const flow = d ? cashFlow(parseAmount(v.rent), p.total) : null
  const fit = d ? loanFit({ income: v.income || 'none', ratio: d.ratio, ltv: p.ltv }) : null
  const taxesShown = v.taxesEdited ? v.taxes : i.price ? String(Math.round((i.price * DEFAULT_TAX_RATE) / 100)) : ''

  const summary = () => {
    const lines = [
      `Price ${money(p.price)} · Loan ${money(p.loan)} · LTV ${pct(p.ltv)}`,
      `Rate ${v.rate || '-'}% · ${v.years} years`,
      `P&I ${money(p.pi, true)} · Taxes ${money(p.taxes, true)} · Insurance ${money(p.insurance, true)} · HOA ${money(p.hoa, true)}${p.miOn ? ` · MI ${money(p.mi, true)}` : ''}`,
      `Total monthly ${money(p.total, true)} · Cash to close ${money(p.cashToClose)}`,
    ]
    if (d) {
      lines.push(`Rent ${money(parseAmount(v.rent))} · DSCR ${d.ratio === null ? '-' : d.ratio.toFixed(2)} (min ${v.minDscr}) · Largest loan ${money(d.maxLoan)}`)
      if (flow !== null) lines.push(`Cash flow ${money(flow, true)} a month before repairs, vacancy and management`)
      if (fit) lines.push(`Best fit: ${fit.best || 'none at these numbers'}`)
      lines.push('Estimates only until priced in Optimal Blue.')
    }
    return lines.join('\n')
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Field label="Price" value={v.price} onChange={set('price')} />
        <div className="min-w-0">
          <Field label={v.downMode === 'pct' ? 'Down payment %' : 'Down payment $'} value={v.down} onChange={set('down')} />
          <button type="button" className="mt-0.5 text-micro text-link" onClick={() => setV((s) => ({ ...s, downMode: s.downMode === 'pct' ? 'amt' : 'pct', down: '' }))}>
            Use {v.downMode === 'pct' ? '$' : '%'}
          </button>
        </div>
        <Field label="Rate %" value={v.rate} onChange={set('rate')} />
        <label className="block min-w-0">
          <span className="mb-0.5 block text-micro font-medium text-muted">Term</span>
          <select aria-label="Term" value={v.years} onChange={(e) => set('years')(e.target.value)} className="w-full rounded-lg border border-line2 bg-panel2 px-2 py-1.5 text-body">
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
        {mode === 'dscr' && (
          <label className="col-span-2 block min-w-0">
            <span className="mb-0.5 block text-micro font-medium text-muted">Borrower income</span>
            <select aria-label="Borrower income" value={v.income || 'none'} onChange={(e) => set('income')(e.target.value)} className="w-full rounded-lg border border-line2 bg-panel2 px-2 py-1.5 text-body">
              {INCOME_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Out k="loan" label="Loan amount">{money(p.loan)}</Out>
        <Out k="ltv" label="LTV">{pct(p.ltv)}</Out>
        <Out k="pi" label="Principal and interest">{money(p.pi, true)}</Out>
        <Out k="total" label="Total monthly">{money(p.total, true)}</Out>
      </div>
      <div className="text-body text-muted">
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
          <Out k="cashFlow" label="Cash flow per month" tone={flow === null ? undefined : flow >= 0 ? '#067647' : '#b42318'}>
            {flow === null ? '-' : money(flow, true)}
          </Out>
          <Out k="band" label="Pricing band">
            <span className="text-body">{band ? band.label : '-'}</span>
          </Out>
        </div>
      )}
      {fit && (
        <div data-out="fit" className="rounded-lg border border-line2 px-3 py-2 text-body">
          <div className="font-semibold">Best fit: {fit.best || 'none at these numbers'}</div>
          <ul className="mt-1 flex flex-col gap-0.5 text-muted">
            {fit.options.map((o) => (
              <li key={o.type}>
                {o.fits ? 'Fits' : 'No'} · {o.type}
                {o.why ? `: ${o.why}` : ''}
              </li>
            ))}
          </ul>
          <div className="mt-1 text-micro text-muted">Cash flow is before repairs, vacancy and management. Typical guides, not one lender's. Estimates only until priced in Optimal Blue.</div>
        </div>
      )}
      <button type="button" className="self-start text-body font-semibold text-link" onClick={async () => setCopied(await copyText(summary()))}>
        {copied ? 'Copied' : 'Copy summary'}
      </button>
    </div>
  )
}
