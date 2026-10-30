// Bayway › Loans: the Arive pipeline, imported from a CSV export
// (docs/superpowers/specs/2026-10-30-arive-loans-import-design.md).
// Panels mirror Arive's dashboard; maths in lib/loans.js.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isDemoMode } from '../lib/supabase'
import { timeAgo } from '../lib/syncHealth'
import { showToast } from '../components/Toaster'
import { fetchLoanBundle, saveLoanPatch, saveRates } from '../lib/loansData'
import {
  DEFAULT_RATES, filterLoans, pipelineStatus, lenderSpread, fundedByMonth, estComp, isScenario, isOpen, notInLatest, hasApplicationDates,
  periodWindow, inPeriod,
} from '../lib/loans'
import { pageSlice } from '../lib/paging'
import { fmtMoney } from '../lib/overviewDash'
import PageHeader from '../components/PageHeader'
import Pager from '../components/Pager'
import PersonLink from '../components/PersonLink'
import LoanImport from '../components/LoanImport'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const ROLES = [['all', 'All'], ['primary', 'Mine'], ['assisted', 'Assisted']]
const LENDER_PERIODS = [['ytd', 'YTD'], ['month', 'This month'], ['year', 'Year']]
const PIPELINE_PERIODS = [['now', 'Now'], ['ytd', 'YTD'], ['month', 'This month']]
// Ring segments in row order (top three lenders, then Others): existing tokens only.
const RING_COLORS = ['var(--bay)', 'var(--bay-deep)', 'var(--bay-gold)', 'var(--dim)']
const money = (n) => (n == null || !Number.isFinite(Number(n)) ? '—' : '$' + Math.round(n).toLocaleString('en-US'))
// "1.25%" -> 1.25; blank, negative or not a number -> null.
const parsePct = (v) => {
  const s = String(v ?? '').replace(/[%\s]/g, '')
  const n = Number(s)
  return s !== '' && Number.isFinite(n) && n >= 0 ? n : null
}

// Escape closes a dialog unless it is mid-save.
function useEscape(onEscape, disabled) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !disabled && onEscape()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onEscape, disabled])
}
const shortDate = (k) => (k ? new Date(`${String(k).slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—')

function demoBundle() {
  const y = new Date().getFullYear()
  const L = (o) => ({ role: 'primary', stage_group: 'prospect', purpose: 'Purchase', scenario_auto: false, scenario_override: null, comp_override: null, last_seen_at: null, ...o })
  return {
    rates: DEFAULT_RATES,
    lastImport: null,
    loans: [
      L({ id: 'd1', arive_loan_id: 'd1', borrower_name: 'Sample Borrower', stage: 'Pre-Approved', amount: 420000 }),
      L({ id: 'd2', arive_loan_id: 'd2', borrower_name: 'Demo Refi', stage: 'Clear To Close', stage_group: 'closing', amount: 310000, purpose: 'Refinance', lender: 'UWM', firm_closing_on: `${y}-12-05` }),
      L({ id: 'd3', arive_loan_id: 'd3', borrower_name: 'Example Funded', stage: 'Loan Finalized', stage_group: 'funded', amount: 280000, lender: 'Newfi', funded_on: `${y}-03-14` }),
    ],
  }
}

// Header label for a period, e.g. "YTD 2026", "Oct 2026", "2026".
function periodLabel(period, now = new Date()) {
  const y = now.getFullYear()
  if (period === 'ytd') return `YTD ${y}`
  if (period === 'month') return `${MONTHS[now.getMonth()]} ${y}`
  if (period === 'year') return String(y)
  return 'Now'
}

function Panel({ title, note, right, panel, children }) {
  return (
    <section data-panel={panel} className="rounded-card border border-line bg-panel p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <h3 className="text-[14px] font-semibold">{title}</h3>
          {note && <span className="truncate text-[12px] text-muted">{note}</span>}
        </div>
        {right}
      </div>
      {children}
    </section>
  )
}

function PeriodPills({ label, options, value, onChange }) {
  return (
    <div role="group" aria-label={label} className="flex gap-1">
      {options.map(([k, text]) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}
          className={`min-h-[26px] whitespace-nowrap rounded-full border px-3 text-[12px] ${value === k ? 'border-[color:var(--text)] font-semibold' : 'border-line2 text-muted'}`}>
          {text}
        </button>
      ))}
    </div>
  )
}

// Until any loan has application_on there is only "Now"; then YTD and This
// month count the loans whose application_on falls in that window.
function PipelineStatus({ loans, hasDates }) {
  const [period, setPeriod] = useState('now')
  const active = hasDates ? period : 'now'
  const groups = pipelineStatus(inPeriod(loans, 'application_on', periodWindow(active)))
  const max = Math.max(1, ...groups.flatMap((g) => g.rows.map((r) => r.count)))
  return (
    <Panel
      title="Pipeline Status"
      panel="pipeline-status"
      note={hasDates ? (active === 'now' ? 'Now' : `Applications · ${periodLabel(active)}`) : null}
      right={hasDates
        ? <PeriodPills label="Pipeline Status period" options={PIPELINE_PERIODS} value={active} onChange={setPeriod} />
        : <span className="text-[12px] text-muted">Now · add Application Date for YTD</span>}
    >
      {groups.map((g) => (
        <div key={g.key} className="mb-3">
          <div className="mb-1 text-[12.5px] font-semibold">{g.label}</div>
          {g.rows.map((r) => (
            <div key={r.stage} data-stage={r.stage} className="grid grid-cols-[minmax(0,1.6fr)_28px_56px_minmax(24px,0.8fr)] items-center gap-2 text-[12.5px]">
              <span className="whitespace-normal leading-tight text-muted">{r.stage}</span>
              <span className="num text-right">{r.count}</span>
              <span className="num text-right text-muted">{fmtMoney(r.amount)}</span>
              <span className="h-2 rounded-sm" style={{ width: `${(r.count / max) * 100}%`, background: r.count ? 'var(--bay)' : 'transparent' }} />
            </div>
          ))}
        </div>
      ))}
    </Panel>
  )
}

// Donut with one segment per lenderSpread row, coloured like its swatch.
function LenderRing({ rows, total }) {
  const r = 28
  const c = 2 * Math.PI * r
  let offset = 0
  return (
    <svg role="img" aria-label={`Funded loans by lender: ${rows.map((x) => `${x.lender} ${x.count}`).join(', ')}`}
      viewBox="0 0 72 72" width="72" height="72" className="shrink-0">
      <circle cx="36" cy="36" r={r} fill="none" stroke="var(--line)" strokeWidth="10" />
      {rows.map((x, i) => {
        const len = (x.count / total) * c
        const seg = (
          <circle key={x.lender} cx="36" cy="36" r={r} fill="none" stroke={RING_COLORS[i % RING_COLORS.length]} strokeWidth="10"
            strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} transform="rotate(-90 36 36)" />
        )
        offset += len
        return seg
      })}
    </svg>
  )
}

function LenderSpread({ loans }) {
  const [period, setPeriod] = useState('ytd')
  const s = lenderSpread(loans, periodWindow(period))
  return (
    <Panel
      title="Lender Spread"
      panel="lender-spread"
      note={`Funded · ${periodLabel(period)}`}
      right={<PeriodPills label="Lender Spread period" options={LENDER_PERIODS} value={period} onChange={setPeriod} />}
    >
      {s.total === 0 ? (
        <p className="text-[12.5px] text-muted">No funded loans in this period.</p>
      ) : (
        <div className="flex items-center gap-4">
          <LenderRing rows={s.rows} total={s.total} />
          <div className="flex min-w-0 flex-wrap gap-x-6 gap-y-2">
            {s.rows.map((r, i) => (
              <div key={r.lender} className="min-w-0">
                <div className="flex items-center gap-1.5 text-[11.5px] uppercase tracking-wide text-muted">
                  <span aria-hidden="true" className="inline-block h-2 w-2 shrink-0 rounded-sm" style={{ background: RING_COLORS[i % RING_COLORS.length] }} />
                  <span className="truncate">{r.lender}</span>
                </div>
                <div className="num text-[24px] font-light">{r.count}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  )
}

function LoansFunded({ loans }) {
  const thisYear = new Date().getFullYear()
  const [year, setYear] = useState(thisYear)
  const years = [thisYear, thisYear - 1].map((y) => [String(y), String(y)])
  const f = fundedByMonth(loans, year)
  const max = Math.max(1, ...f.months.map((m) => m.volume))
  return (
    <Panel
      title={`${f.count} ${f.count === 1 ? 'Loan' : 'Loans'} Funded`}
      panel="loans-funded"
      right={<PeriodPills label="Loans Funded year" options={years} value={String(year)} onChange={(k) => setYear(Number(k))} />}
    >
      <div className="num text-[30px] font-light">{fmtMoney(f.volume)}</div>
      <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-[12.5px]">
        <div><b className="num">{f.purchase.count}</b> Purchase <span className="text-muted">{money(f.purchase.volume)}</span></div>
        <div><b className="num">{f.refinance.count}</b> Refinance <span className="text-muted">{money(f.refinance.volume)}</span></div>
      </div>
      <div className="mt-4 flex h-[110px] items-end gap-1">
        {f.months.map((m) => (
          <div key={m.month} className="flex flex-1 flex-col items-center gap-1" title={`${MONTHS[m.month]}: ${m.count} · ${money(m.volume)}`}>
            <div className="w-full rounded-t-sm" style={{ height: `${(m.volume / max) * 90}px`, background: m.volume ? 'var(--bay)' : 'transparent' }} />
            <span className="text-[10px] text-muted">{MONTHS[m.month]}</span>
          </div>
        ))}
      </div>
    </Panel>
  )
}

function CompCell({ loan, rates, onSave }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  // Enter or Escape closes the editor; the blur that follows must not save again.
  const closed = useRef(false)
  const value = estComp(loan, rates)
  if (!editing) {
    return (
      <button type="button" className="num underline decoration-dotted" title="Click to set this loan's commission"
        onClick={() => { closed.current = false; setDraft(loan.comp_override ?? ''); setEditing(true) }}>
        {money(value)}{loan.comp_override != null ? ' *' : ''}
      </button>
    )
  }
  const close = () => { closed.current = true; setEditing(false) }
  // Blank resets to the estimate; anything not a number of 0 or more keeps the old value.
  const commit = () => {
    if (closed.current) return
    close()
    const v = String(draft).trim()
    const next = v === '' ? null : Number(v.replace(/[$,\s]/g, ''))
    if (next !== null && !(Number.isFinite(next) && next >= 0)) return
    const prev = loan.comp_override == null ? null : Number(loan.comp_override)
    if (next === prev) return
    onSave(next)
  }
  return (
    <input
      autoFocus
      aria-label={`Commission for ${loan.borrower_name}`}
      className="num w-[90px] rounded border border-line2 px-1 text-right"
      value={draft}
      placeholder="auto"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') close() }}
    />
  )
}

// onSave(rates) -> Promise<{ error }>; the parent closes the editor on success.
function RatesEditor({ rates, onSave, onClose }) {
  const [d, setD] = useState({ lo_name: rates.lo_name ?? '', primary_pct: String(rates.primary_pct ?? ''), assisted_pct: String(rates.assisted_pct ?? '') })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  useEscape(onClose, busy)

  async function save() {
    const lo_name = String(d.lo_name).trim()
    const primary_pct = parsePct(d.primary_pct)
    const assisted_pct = parsePct(d.assisted_pct)
    if (!lo_name) { setError('Enter your name as it appears in Arive.'); return }
    if (primary_pct == null || assisted_pct == null) { setError('Percentages must be numbers of 0 or more, like 1.25.'); return }
    setError(null)
    setBusy(true)
    const { error: err } = await onSave({ lo_name, primary_pct, assisted_pct })
    if (err) {
      setBusy(false)
      setError(`Couldn't save the rates: ${err.message || err}`)
    }
  }

  const field = (k, label, autoFocus) => (
    <label className="block text-[12px] text-muted">
      {label}
      <input autoFocus={autoFocus} disabled={busy} className="mt-1 block w-full rounded border border-line2 px-2 py-1 text-[13px] text-[color:var(--text)]" value={d[k]} onChange={(e) => setD({ ...d, [k]: e.target.value })} />
    </label>
  )
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div role="dialog" aria-modal="true" aria-label="Commission rates" className="w-full max-w-[360px] space-y-3 rounded-card border border-line bg-panel p-5">
        <div className="text-[15px] font-semibold">Commission rates</div>
        {field('lo_name', 'Your name as loan officer in Arive', true)}
        {field('primary_pct', 'Your loans: % of loan amount')}
        {field('assisted_pct', 'Assisted loans: % of loan amount')}
        {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="min-h-[32px] rounded-[9px] border border-line2 px-3 text-[13px] font-semibold disabled:opacity-40">Cancel</button>
          <button type="button" onClick={save} disabled={busy} className="min-h-[32px] rounded-[9px] bg-[color:var(--text)] px-3 text-[13px] font-semibold text-white disabled:opacity-40">{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}

// Open loans first by firm closing date, then funded newest first, then the rest.
function sortLoans(loans) {
  const rank = (l) => (isOpen(l) ? 0 : l.funded_on ? 1 : 2)
  return [...loans].sort((a, b) =>
    rank(a) - rank(b) ||
    (rank(a) === 0 ? String(a.firm_closing_on || '9999').localeCompare(String(b.firm_closing_on || '9999')) : 0) ||
    (rank(a) === 1 ? String(b.funded_on).localeCompare(String(a.funded_on)) : 0) ||
    String(a.borrower_name || '').localeCompare(String(b.borrower_name || '')))
}

export default function Loans() {
  const [bundle, setBundle] = useState(() => (isDemoMode ? demoBundle() : null))
  const [error, setError] = useState(null)
  const [role, setRole] = useState('all')
  const [scenarios, setScenarios] = useState(false)
  const [page, setPage] = useState(1)
  const [importing, setImporting] = useState(false)
  const [editingRates, setEditingRates] = useState(false)

  const load = useCallback(async () => {
    if (isDemoMode) return
    const { data, error: err } = await fetchLoanBundle()
    if (err) setError(err.message)
    else setBundle(data)
  }, [])
  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => (bundle ? filterLoans(bundle.loans, { role, scenarios }) : []), [bundle, role, scenarios])
  const shown = useMemo(() => sortLoans(filtered), [filtered])
  const slice = pageSlice(shown, page)

  // Optimistic: the row changes at once and goes back if the save fails.
  async function patch(loan, p) {
    const prev = Object.fromEntries(Object.keys(p).map((k) => [k, loan[k] ?? null]))
    const apply = (fields) => setBundle((b) => ({ ...b, loans: b.loans.map((l) => (l.id === loan.id ? { ...l, ...fields } : l)) }))
    apply(p)
    if (isDemoMode) return
    const { error: err } = await saveLoanPatch(loan.id, p)
    if (!err) return
    apply(prev)
    showToast({ tone: 'error', text: `Couldn't save ${loan.borrower_name || 'this loan'}: ${err.message}`, retry: () => patch(loan, p) })
  }

  // Writes first; local state changes only once the save worked.
  async function storeRates(r) {
    if (!isDemoMode) {
      const { error: err } = await saveRates(r)
      if (err) return { error: err }
    }
    setBundle((b) => ({ ...b, rates: r }))
    setEditingRates(false)
    return { error: null }
  }

  const lastImportAt = bundle?.lastImport?.ran_at || null
  const btn = 'min-h-[32px] rounded-[9px] border border-line2 bg-panel px-3 text-[13px] font-semibold'

  return (
    <div>
      <PageHeader
        eyebrow="Bayway"
        eyebrowColor="var(--bay-ink)"
        title="Loans"
        note={bundle && (
          <span className="num text-[12px] text-muted">
            {lastImportAt
              ? <><span title={new Date(lastImportAt).toLocaleString()}>Last import {timeAgo(lastImportAt)}</span> · {bundle.loans.length} loans</>
              : 'No Arive import yet'}
          </span>
        )}
        subtitle="Your Arive pipeline, from the saved Pipeline Report export. Re-import any time; loans update by Arive loan ID and nothing is deleted."
        actions={
          <div className="flex gap-2">
            <button type="button" className={btn} onClick={() => setEditingRates(true)} disabled={!bundle}>Rates</button>
            <button type="button" className={btn} onClick={() => setImporting(true)} disabled={!bundle || isDemoMode}>Import CSV</button>
          </div>
        }
      />

      {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      {isDemoMode && <div className="mt-4 rounded-lg border border-line bg-panel px-3 py-2 text-xs text-muted">Demo mode — sample loans. Connect Supabase to import.</div>}
      {!bundle && !error && <div className="mt-6 text-sm text-muted">Loading loans…</div>}

      {bundle && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-[13px]">
            <div className="flex gap-1">
              {ROLES.map(([k, label]) => (
                <button key={k} type="button" aria-pressed={role === k} onClick={() => { setRole(k); setPage(1) }}
                  className={`min-h-[30px] rounded-full border px-3 ${role === k ? 'border-[color:var(--text)] font-semibold' : 'border-line2 text-muted'}`}>
                  {label}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1.5 text-muted">
              <input type="checkbox" name="scenarios" checked={scenarios} onChange={(e) => { setScenarios(e.target.checked); setPage(1) }} />
              Include scenario files
            </label>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3.5 lg:grid-cols-2">
            <PipelineStatus loans={filtered} hasDates={hasApplicationDates(bundle.loans)} />
            <div className="grid gap-3.5">
              <LenderSpread loans={filtered} />
              <LoansFunded loans={filtered} />
            </div>
          </div>

          <section className="mt-4 overflow-x-auto rounded-card border border-line bg-panel">
            <table className="w-full min-w-[760px] text-left text-[13px]">
              <thead className="text-[11.5px] uppercase tracking-wide text-muted">
                <tr>
                  {['Borrower', 'Stage', 'Amount', 'Lender', 'Role', 'Closing / funded', 'Est. comp', 'Scenario'].map((h) => (
                    <th key={h} className="px-3 py-2 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {slice.rows.map((l) => (
                  <tr key={l.id} data-loan={l.arive_loan_id} className="border-t border-line">
                    <td className="px-3 py-2">
                      {l.contact_id ? <PersonLink id={l.contact_id}>{l.borrower_name}</PersonLink> : l.borrower_name}
                      {notInLatest(l, lastImportAt) && <span className="ml-2 whitespace-nowrap rounded px-1 text-[10px] font-semibold text-dim" style={{ background: 'var(--hover)' }}>NOT IN LATEST EXPORT</span>}
                    </td>
                    <td className="px-3 py-2">{l.stage}</td>
                    <td className="num px-3 py-2">{money(l.amount)}</td>
                    <td className="px-3 py-2">{l.lender || '—'}</td>
                    <td className="px-3 py-2">{l.role === 'assisted' ? (l.loan_officer ? `Assisted (${l.loan_officer})` : 'Assisted') : 'Mine'}</td>
                    <td className="px-3 py-2">{l.funded_on ? `Funded ${shortDate(l.funded_on)}` : shortDate(l.firm_closing_on)}</td>
                    <td className="px-3 py-2"><CompCell loan={l} rates={bundle.rates} onSave={(v) => patch(l, { comp_override: v })} /></td>
                    <td className="px-3 py-2">
                      <input type="checkbox" name="scenario" aria-label={`Scenario file: ${l.borrower_name}`} checked={isScenario(l)} onChange={(e) => patch(l, { scenario_override: e.target.checked })} />
                    </td>
                  </tr>
                ))}
                {slice.rows.length === 0 && (
                  <tr><td colSpan={8} className="px-3 py-6 text-center text-muted">No loans. Import the Arive export to get started.</td></tr>
                )}
              </tbody>
            </table>
          </section>
          <Pager slice={slice} total={shown.length} onPage={setPage} label="Loan pages" className="mt-3" />
        </>
      )}

      {importing && bundle && (
        <LoanImport
          existing={bundle.loans}
          rates={bundle.rates}
          onClose={() => setImporting(false)}
          onImported={async () => { setImporting(false); await load() }}
        />
      )}
      {editingRates && bundle && <RatesEditor rates={bundle.rates} onSave={storeRates} onClose={() => setEditingRates(false)} />}
    </div>
  )
}
