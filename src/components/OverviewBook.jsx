// The redesigned Overview's whole-book cards (spec 2026-11-22, A5–A7): loans
// in flight, merchants in flight and book health. Numbers come from
// bookFlags.js; these components only draw.
import { Link } from 'react-router-dom'
import BizBadge from './BizBadge'
import { LOAN_STEPS, shortDay } from '../lib/bookFlags'

const TONE = { neg: 'var(--neg-ink)', warn: 'var(--warn-ink)', ok: 'var(--dim)' }
const money = (n) => `$${Math.round(Number(n || 0)).toLocaleString('en-US')}`
const kAmount = (n) => (n >= 1000 ? `$${Math.round(n / 1000)}K` : money(n))

function Head({ title, sub, link, book }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-lead font-semibold tracking-[-0.2px]">
          {title}
          {book && <BizBadge biz={book} />}
        </h2>
        {sub && <div className="mt-0.5 text-body text-muted">{sub}</div>}
      </div>
      {link && (
        <Link to={link.to} className="-my-2 -mr-2 inline-flex min-h-[36px] flex-none items-center rounded-lg px-2 text-body font-semibold text-[color:var(--chrome)] hover:bg-hoverbg">
          {link.label} →
        </Link>
      )}
    </div>
  )
}

function Counts({ items }) {
  return (
    <div className="grid border-b border-line" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((c) => (
        <div key={c.label} data-count={c.key} className="min-w-0 border-r border-hoverbg px-3 py-3 text-center last:border-r-0 sm:px-4">
          <div className="num text-title font-bold">{c.value}</div>
          <div className="truncate text-caption text-muted" title={c.label}>{c.label}</div>
        </div>
      ))}
    </div>
  )
}

function Steps({ step, color }) {
  return (
    <div role="img" aria-label={`${LOAN_STEPS[step - 1]}, step ${step} of 5`} className="flex gap-1">
      {LOAN_STEPS.map((s, i) => (
        <span key={s} className="h-1.5 w-5 rounded-full" style={{ background: i < step ? color : 'var(--hoverbg, #F2F4F7)' }} />
      ))}
    </div>
  )
}

// ---- A5 -------------------------------------------------------------------------

export function LoansInFlight({ model, now = Date.now() }) {
  const c = model.counts
  return (
    <section aria-label="Loans in flight" className="cc-card flex min-w-0 flex-col overflow-hidden">
      <Head title="Loans in flight" book="bay" sub={`${model.open} open in Arive · closing soonest first`} link={{ to: '/bayway/loans', label: 'Loans' }} />
      <Counts
        items={[
          { key: 'application', label: 'Application', value: c.application },
          { key: 'processing', label: 'Processing', value: c.processing },
          { key: 'underwriting', label: 'Underwriting', value: c.underwriting },
          { key: 'ctc', label: 'Clear to close', value: c.ctc },
          { key: 'funded', label: 'Funded this month', value: c.funded },
        ]}
      />
      {model.rows.length === 0 && <div className="px-5 py-8 text-center text-body text-muted">No loans in flight.</div>}
      <div className="flex flex-col">
        {model.rows.map((l) => (
          <div key={l.id} data-loan={l.id} className="flex items-center gap-3 border-b border-hoverbg px-5 py-2.5 last:border-b-0">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="truncate text-ui font-semibold">{l.name}</span>
                <span className="num flex-none text-body text-muted">{kAmount(l.amount)}</span>
              </div>
              <div className="mt-0.5 truncate text-body font-medium" style={{ color: TONE[l.flag.tone] }}>{l.flag.text}</div>
            </div>
            <div className="flex flex-none flex-col items-end gap-1.5">
              <span className="text-body text-muted">{l.closing ? `Closes ${shortDay(l.closing, now)}` : 'No closing date'}</span>
              <Steps step={l.step} color="var(--bay)" />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

// ---- A6 -------------------------------------------------------------------------

export function MerchantsInFlight({ model, tiles }) {
  const c = model.counts
  return (
    <section aria-label="Merchants in flight" className="cc-card flex min-w-0 flex-col overflow-hidden">
      <Head title="Merchants in flight" book="mpg" sub="Zoho stages · most urgent first" link={{ to: '/mpg/pipeline', label: 'MPG pipeline' }} />
      <Counts
        items={[
          { key: 'open', label: 'Open', value: c.Open },
          { key: 'submitted', label: 'Submitted', value: c.Submitted },
          { key: 'approved', label: 'Approved', value: c.Approved },
          { key: 'approved_month', label: 'Approved MTD', value: c.approvedThisMonth },
        ]}
      />
      {model.rows.length === 0 && <div className="px-5 py-8 text-center text-body text-muted">No merchants in flight.</div>}
      <div className="flex flex-col">
        {model.rows.map((m) => (
          <div key={m.id} data-merchant={m.id} className="flex items-center gap-3 border-b border-hoverbg px-5 py-2.5 last:border-b-0">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="truncate text-ui font-semibold">{m.name}</span>
                {m.contact && <span className="truncate text-body text-muted">{m.contact}</span>}
              </div>
              <div className="mt-0.5 truncate text-body font-medium" style={{ color: TONE[m.flag.tone] }}>{m.flag.text}</div>
            </div>
            <span className="flex-none rounded-md px-2 py-0.5 text-caption font-semibold" style={{ background: 'var(--mpg-soft)', color: 'var(--mpg-ink)' }}>
              {m.stage}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-auto grid grid-cols-3 gap-2 border-t border-line px-5 py-3">
        {tiles.map((t) => (
          <div key={t.label} data-mpg-tile={t.key} className="min-w-0">
            <div className="num text-lead font-bold">{t.value}</div>
            <div className="truncate text-caption text-muted">{t.label}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

// ---- A7 -------------------------------------------------------------------------

export function BookHealth({ rows, biz }) {
  return (
    <section aria-label="Book health" className="cc-card flex min-w-0 flex-col overflow-hidden">
      <Head title="Book health" sub="Whole book · today's share is flagged in Workbench" />
      <div className="flex flex-col gap-2 px-5 py-4">
        {rows.length === 0 && <div className="py-4 text-center text-body text-muted">Nothing slipping.</div>}
        {rows.map((r) => (
          <Link
            key={r.id}
            to={r.to}
            data-health={r.id}
            className="flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-1.5 hover:opacity-90"
            style={{ background: r.id === 'overdue' || r.id === 'docs_aging' || r.id === 'apps_quiet' ? 'var(--neg-bg)' : 'var(--warn-bg)' }}
          >
            <span className="num min-w-[28px] text-lead font-bold" style={{ color: r.id === 'overdue' || r.id === 'docs_aging' || r.id === 'apps_quiet' ? 'var(--neg-ink)' : 'var(--warn-ink)' }}>
              {r.count}
            </span>
            <span className="min-w-0 flex-1 text-body font-medium text-[color:var(--text)]">{r.label}</span>
            {biz === 'all' && r.book && <BizBadge biz={r.book} />}
            <span aria-hidden="true" className="text-dim">›</span>
          </Link>
        ))}
      </div>
    </section>
  )
}
