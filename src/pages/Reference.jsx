import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import BankStatementCalc from '../components/reference/BankStatementCalc'
import LoanCalc, { LOAN_DEFAULTS } from '../components/reference/LoanCalc'
import TridCalc from '../components/reference/TridCalc'
import LendersTab from '../components/reference/LendersTab'
import LinksTab from '../components/reference/LinksTab'

// Reference (spec 2026-11-05): calculators, lender AEs and quick links for
// Chandler and Shelby alike. ?tab=calculators|lenders|links, ?calc=bank|payment|dscr|trid.
const TABS = [
  { id: 'calculators', label: 'Calculators' },
  { id: 'lenders', label: 'Lenders' },
  { id: 'links', label: 'Links' },
]
const CALCS = [
  { id: 'bank', label: 'Bank statement' },
  { id: 'payment', label: 'Loan payment' },
  { id: 'dscr', label: 'DSCR' },
  { id: 'trid', label: 'TRID dates' },
]

export default function Reference() {
  const [params, setParams] = useSearchParams()
  const calc = CALCS.some((c) => c.id === params.get('calc')) ? params.get('calc') : 'bank'
  const tab = TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'calculators'
  const [loan, setLoan] = useState(LOAN_DEFAULTS)
  const go = (next) =>
    setParams(Object.fromEntries(Object.entries({ tab, calc, ...next }).filter(([k, val]) => val && !(k === 'tab' && val === 'calculators'))), { replace: true })

  return (
    <div className="flex flex-col gap-4 pt-4">
      <PageHeader title="Reference" note="Calculators, lender contacts and quick links." />
      <div role="tablist" aria-label="Reference" className="flex gap-5 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => go({ tab: t.id, calc: t.id === 'calculators' ? calc : undefined })}
            className={`-mb-px border-b-2 pb-2 text-body ${tab === t.id ? 'border-[color:var(--text)] font-semibold' : 'border-transparent text-muted'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'calculators' && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {CALCS.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={calc === c.id}
                onClick={() => go({ tab: 'calculators', calc: c.id })}
                className={`rounded-lg border px-3 py-1 text-body ${calc === c.id ? 'border-[color:var(--text)] font-semibold' : 'border-line2 text-muted'}`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="cc-card p-4">
            {calc === 'bank' && <BankStatementCalc />}
            {calc === 'payment' && <LoanCalc mode="payment" v={loan} setV={setLoan} />}
            {calc === 'dscr' && <LoanCalc mode="dscr" v={loan} setV={setLoan} />}
            {calc === 'trid' && <TridCalc />}
          </div>
        </>
      )}
      {tab === 'lenders' && <LendersTab />}
      {tab === 'links' && <LinksTab initialAddress={params.get('address') || ''} />}
    </div>
  )
}
