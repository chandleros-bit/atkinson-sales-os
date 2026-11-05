import { useMemo, useState } from 'react'
import Field, { Out, copyText } from './Field'
import { parseAmount, money, pct } from '../../lib/calc/parse'
import { bankStatement, bankSummary, monthLabels, DEFAULT_EXPENSE } from '../../lib/calc/bankStatement'

const blankRows = (n) => Array.from({ length: n }, () => ({ deposits: '', exclude: '' }))
const SELECT = 'w-full rounded-[8px] border border-line2 bg-panel2 px-2 py-1.5 text-[13px]'

export default function BankStatementCalc() {
  const [months, setMonths] = useState(12)
  const [account, setAccount] = useState('business')
  const [ownership, setOwnership] = useState('100')
  const [expense, setExpense] = useState(String(DEFAULT_EXPENSE.business))
  const [rows, setRows] = useState(blankRows(24))
  const [copied, setCopied] = useState(false)

  const labels = useMemo(() => monthLabels(months), [months])
  const input = {
    months,
    account,
    ownership: parseAmount(ownership) ?? 100,
    expense: parseAmount(expense) ?? 0,
    rows: rows.map((r) => ({ deposits: parseAmount(r.deposits), exclude: parseAmount(r.exclude) })),
  }
  const r = bankStatement(input)
  const setRow = (i, k, v) => setRows((rs) => rs.map((row, j) => (j === i ? { ...row, [k]: v } : row)))
  const pickAccount = (a) => {
    setAccount(a)
    setExpense(String(DEFAULT_EXPENSE[a]))
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="block">
          <span className="mb-0.5 block text-[11px] font-medium text-muted">Months</span>
          <select aria-label="Months" value={months} onChange={(e) => setMonths(Number(e.target.value))} className={SELECT}>
            <option value={12}>12</option>
            <option value={24}>24</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[11px] font-medium text-muted">Account</span>
          <select aria-label="Account" value={account} onChange={(e) => pickAccount(e.target.value)} className={SELECT}>
            <option value="business">Business</option>
            <option value="personal">Personal</option>
          </select>
        </label>
        <Field label="Ownership %" value={ownership} onChange={setOwnership} suffix="%" />
        <Field label="Expense factor %" value={expense} onChange={setExpense} suffix="%" />
      </div>

      <table className="w-full table-fixed text-[12.5px]">
        <thead>
          <tr className="text-left text-[11px] text-muted">
            <th className="w-[24%] py-1 font-medium">Month</th>
            <th className="py-1 font-medium">Deposits</th>
            <th className="py-1 font-medium">Exclude</th>
            <th className="w-[28%] py-1 text-right font-medium">Counted</th>
          </tr>
        </thead>
        <tbody>
          {labels.map((label, i) => (
            <tr key={label} className="border-t border-line" data-large={r.large[i] || undefined}>
              <td className="py-1">{label}</td>
              <td className="py-1 pr-2">
                <input aria-label={`Deposits month ${i + 1}`} inputMode="decimal" value={rows[i].deposits} onChange={(e) => setRow(i, 'deposits', e.target.value)} className="w-full min-w-0 rounded-[6px] border border-line2 bg-panel2 px-2 py-1" />
              </td>
              <td className="py-1 pr-2">
                <input aria-label={`Exclude month ${i + 1}`} inputMode="decimal" value={rows[i].exclude} onChange={(e) => setRow(i, 'exclude', e.target.value)} className="w-full min-w-0 rounded-[6px] border border-line2 bg-panel2 px-2 py-1" />
              </td>
              <td className="num py-1 text-right" style={r.large[i] ? { color: '#b54708' } : undefined}>
                {r.counted[i] === null ? '' : money(r.counted[i])}
                {r.large[i] ? ' · large' : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Out k="average" label="Average monthly deposits">{money(r.average)}</Out>
        <Out k="income" label="Qualifying monthly income">{money(r.income)}</Out>
        {months === 24 && (
          <Out k="trend" label="Last 12 vs prior 12" tone={r.trend !== null && r.trend < 0 ? '#b54708' : undefined}>
            {pct(r.trend)}
          </Out>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[12.5px]">
        <span className="text-muted">
          {r.entered} of {months} months entered
        </span>
        <button type="button" className="font-semibold text-[#1d4ed8]" onClick={async () => setCopied(await copyText(bankSummary(input, r, labels)))}>
          {copied ? 'Copied' : 'Copy summary'}
        </button>
        <button type="button" className="text-muted" onClick={() => setRows(blankRows(24))}>
          Clear
        </button>
      </div>
    </div>
  )
}
