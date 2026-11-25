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
          <div className="text-caption leading-tight text-muted" title={c.label}>{c.label}</div>
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
            <div className="text-caption leading-tight text-muted">{t.label}</div>
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

// ---- A8. Rate watch ---------------------------------------------------------------

// model: rateWatch() output.
export function RateWatch({ model }) {
  const top = model.rows.slice(0, 4)
  return (
    <section aria-label="Rate watch" className="cc-card flex min-w-0 flex-col overflow-hidden">
      <Head title="Rate watch" book="bay" sub="Today's Opportunities picks above the market" link={{ to: '/bayway/opportunities', label: 'Opportunities' }} />
      <div className="flex items-baseline gap-2 border-b border-line px-5 py-3">
        <span className="num text-title font-bold">{model.pmms != null ? `${model.pmms.toFixed(2)}%` : '—'}</span>
        <span className="text-body text-muted">30-year PMMS{model.week ? ` · week of ${model.week.slice(5).replace('-', '/')}` : ''}</span>
      </div>
      {top.length === 0 && (
        <div className="px-5 py-6 text-center text-body text-muted">
          {model.pmms == null ? 'No PMMS rate loaded yet.' : 'No picks above today’s rate.'}
        </div>
      )}
      <div className="flex flex-col">
        {top.map((r) => (
          <div key={r.id} data-rate-pick={r.id} className="flex items-center gap-3 border-b border-hoverbg px-5 py-2.5 last:border-b-0">
            <div className="min-w-0 flex-1">
              <div className="truncate text-ui font-semibold">{r.name}</div>
              <div className="num text-body text-muted">
                {r.rate.toFixed(2)}%{r.balance ? ` on ${kAmount(r.balance)}` : ''}
              </div>
            </div>
            {r.saving != null && (
              <div className="flex-none text-right">
                <div className="num text-ui font-bold" style={{ color: 'var(--pos-ink)' }}>~{money(r.saving)}/mo</div>
                <div className="text-caption text-dim">Estimate</div>
              </div>
            )}
          </div>
        ))}
      </div>
      {model.rows.length > top.length && <div className="mt-auto border-t border-line px-5 py-2.5 text-body text-muted">+{model.rows.length - top.length} more on Opportunities</div>}
    </section>
  )
}

// ---- A9. Source pull-through --------------------------------------------------------

const STEP_COLORS = { bay: ['var(--bay-soft)', '#A4C97A', 'var(--bay-ink)'], mpg: ['var(--mpg-soft)', 'var(--mpg-line)', 'var(--mpg-ink)'] }

// books: [{ book, rows }] from pullThrough.
export function PullThrough({ books }) {
  return (
    <section aria-label="Source pull-through" className="cc-card flex min-w-0 flex-col overflow-hidden">
      <Head title="Source pull-through" sub="Last 90 days · leads to the last step" link={{ to: '/analytics', label: 'Analytics' }} />
      <div className="flex flex-col gap-4 px-5 py-4">
        {books.map(({ book, rows }) => (
          <div key={book} data-pull-book={book} className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-caption text-muted">
              <BizBadge biz={book} />
              {book === 'bay' ? 'Lead → app → funded' : 'Lead → submitted → approved'}
            </div>
            {rows.length === 0 && <div className="text-body text-muted">No leads in the last 90 days.</div>}
            {rows.map((r) => {
              const [c0, c1, c2] = STEP_COLORS[book]
              const w = (n) => `${r.leads ? (n / r.leads) * 100 : 0}%`
              return (
                <div key={r.source} data-pull={r.source}>
                  <div className="flex items-center gap-2 text-body">
                    <span className="min-w-0 flex-1 truncate font-medium">{r.source}</span>
                    <span className="num text-muted">
                      {r.leads} → {r.mid} → {r.last}
                    </span>
                    <span className="num w-10 text-right font-semibold">{r.pct}%</span>
                  </div>
                  <div className="relative mt-1.5 h-2 overflow-hidden rounded-full" style={{ background: c0 }}>
                    <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: w(r.mid), background: c1 }} />
                    <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: w(r.last), background: c2 }} />
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </section>
  )
}

// ---- A10. Trends strip ----------------------------------------------------------------

function Spark({ values }) {
  const max = Math.max(1, ...values)
  const n = values.length
  const pts = values.map((v, i) => `${n > 1 ? (i / (n - 1)) * 260 : 0},${44 - (v / max) * 40}`).join(' ')
  return (
    <svg viewBox="0 0 260 48" preserveAspectRatio="none" className="mt-2 block h-12 w-full" role="img" aria-label="Touchpoints by day, last 30 days">
      <polyline points={pts} fill="none" stroke="var(--chrome)" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

// series: activitySeries(); sprint: sprintPace(); income: incomeMix(); biz: the book switch.
export function Trends({ series, sprint, income, biz }) {
  const now = series.totals.touch
  const before = series.prev.touch
  const pct = before ? Math.round(((now - before) / before) * 100) : null
  const change = pct == null ? { text: now ? 'new' : '—', ink: 'var(--dim)' } : { text: `${pct >= 0 ? '↑' : '↓'} ${Math.abs(pct)}%`, ink: pct >= 0 ? 'var(--pos-ink)' : 'var(--neg-ink)' }
  const items = sprint.items.filter((s) => biz === 'all' || s.book === biz)
  const incomeRows = [biz !== 'mpg' && { key: 'bay', label: 'Bayway commission', value: income.commission }, biz !== 'bay' && { key: 'mpg', label: 'MPG residual', value: income.residual }].filter(Boolean)
  const incomeMax = Math.max(1, ...incomeRows.map((r) => r.value))
  return (
    <section aria-label="Trends" className="cc-card grid min-w-0 grid-cols-1 divide-y divide-line overflow-hidden xl:grid-cols-3 xl:divide-x xl:divide-y-0">
      <div data-trend="touch" className="px-5 py-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-ui font-semibold">Touchpoints · 30 days</h2>
          <Link to="/activity" className="text-body font-semibold text-[color:var(--chrome)]">Activity →</Link>
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="num text-title font-bold">{now.toLocaleString()}</span>
          <span className="text-body font-semibold" style={{ color: change.ink }} title="vs the 30 days before">{change.text}</span>
        </div>
        <Spark values={series.points.map((p) => p.touch)} />
      </div>
      <div data-trend="sprint" className="px-5 py-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-ui font-semibold">{sprint.ended ? 'Last 90-day sprint' : '90-day sprint'}</h2>
          <span className="text-caption text-muted">{sprint.ended ? 'ended' : `${sprint.weeksLeft} wk left`}</span>
        </div>
        <div className="mt-2 flex flex-col gap-2">
          {items.map((s) => {
            const good = sprint.ended ? s.hit : s.onPace
            return (
              <div key={s.key} data-sprint={s.key}>
                <div className="flex items-center gap-2 text-caption">
                  <span className="min-w-0 flex-1 truncate" title={s.label}>{s.label}</span>
                  <span className="num text-muted">{s.value} / {s.target}</span>
                  <span className="font-semibold" style={{ color: good ? 'var(--pos-ink)' : 'var(--dim)' }}>
                    {sprint.ended ? (s.hit ? 'Hit' : 'Missed') : s.onPace ? 'On pace' : 'Behind'}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-hoverbg">
                  <div className="h-full rounded-full" style={{ width: `${s.pct}%`, background: s.book === 'mpg' ? 'var(--mpg)' : 'var(--bay)' }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <div data-trend="income" className="px-5 py-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-ui font-semibold">Income this month</h2>
          <Link to="/reports" className="text-body font-semibold text-[color:var(--chrome)]">Reports →</Link>
        </div>
        <div className="num mt-1 text-title font-bold">{money(incomeRows.reduce((s, r) => s + r.value, 0))}</div>
        <div className="mt-2 flex flex-col gap-2">
          {incomeRows.map((r) => (
            <div key={r.key}>
              <div className="flex items-center justify-between text-caption">
                <span>{r.label}</span>
                <span className="num font-semibold">{money(r.value)}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-hoverbg">
                <div className="h-full rounded-full" style={{ width: `${(r.value / incomeMax) * 100}%`, background: r.key === 'mpg' ? 'var(--mpg)' : 'var(--bay)' }} />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-2 text-caption text-dim">{biz !== 'mpg' && income.fromArive ? 'Commission estimated from Arive' : 'Entered in Reports'}</div>
      </div>
    </section>
  )
}
