// The top of the redesigned Overview (spec 2026-11-22, A2–A4): Your day,
// November goals and the forecast for both books. Numbers come from
// workLists.js, overviewDash.goalRows and forecast.forecastLayers; these
// components only draw.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import TodayAgenda from './TodayAgenda'
import BizBadge from './BizBadge'

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const monthName = (now = Date.now()) => MONTH_NAMES[new Date(now).getMonth()]

// $13,600 -> "$13.6K"; under $1,000 stays exact.
export function kMoney(n) {
  const v = Math.round(Number(n || 0))
  if (Math.abs(v) < 1000) return `$${v.toLocaleString('en-US')}`
  const k = v / 1000
  return `$${k >= 100 ? Math.round(k) : (Math.round(k * 10) / 10).toFixed(1).replace(/\.0$/, '')}K`
}
const money = (n) => `$${Math.round(Number(n || 0)).toLocaleString('en-US')}`
const range = (lo, hi, f) => (lo === hi ? f(lo) : `${f(lo)}–${f(hi)}`)
const acct = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

function CardHead({ title, sub, link }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-lead font-semibold tracking-[-0.2px]">{title}</h2>
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

const SECTION_LABEL = 'text-caption font-bold uppercase tracking-[0.4px] text-dim'

// ---- A2. Your day -------------------------------------------------------------

export function NewLeadStrip({ lead, now = Date.now() }) {
  if (!lead) return null
  const mins = Math.max(0, Math.round((now - lead.dueAt) / 60_000))
  const name = lead.row?.name || 'New lead'
  const extra = [lead.row?.source, lead.row?.loan_type].filter(Boolean).join(' · ')
  return (
    <Link
      to="/workbench?list=calls"
      data-new-lead={lead.id}
      className="flex flex-wrap items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-body"
      style={{ borderColor: 'var(--warn-line)', background: 'var(--warn-bg)', color: 'var(--warn-ink)' }}
    >
      <span className="rounded-md px-2 py-0.5 text-caption font-bold text-white" style={{ background: 'var(--warn-ink)' }}>
        New lead · {mins} min
      </span>
      <span className="min-w-0 flex-1 text-[color:var(--text)]">
        <b>{name}</b>
        {extra && ` · ${extra}`}
      </span>
      <span className="font-semibold">Call in Workbench →</span>
    </Link>
  )
}

export function YourDay({ lists, lead, now = Date.now(), className = '' }) {
  return (
    <section aria-label="Your day" className={`cc-card flex min-w-0 flex-col overflow-hidden ${className}`}>
      <CardHead title="Your day" sub="Today's work lists and your meetings" link={{ to: '/calendar', label: 'Calendar' }} />
      {lead && (
        <div className="px-5 pt-4">
          <NewLeadStrip lead={lead} now={now} />
        </div>
      )}
      <div className="px-5 pt-4">
        <div className={SECTION_LABEL}>Today&apos;s work · no set times</div>
        <div className="mt-2 grid grid-cols-3 gap-2 sm:gap-2.5">
          {lists.map((l) => (
            <div key={l.key} data-work-list={l.key} className="flex min-w-0 flex-col gap-1 rounded-xl border border-line px-2.5 py-2.5 sm:px-3.5 sm:py-3">
              <div className="flex flex-col-reverse items-start gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-2">
                <span className="text-ui font-bold">{l.label}</span>
                <span className="num text-title font-bold">{l.count}</span>
              </div>
              <div className="hidden text-body text-muted sm:block">{l.sub}</div>
              <div className="text-caption font-semibold sm:text-body" style={{ color: l.flagged ? 'var(--warn-ink)' : 'var(--dim)' }}>
                {l.flagged ? `${l.flagged} flagged` : <><span className="sm:hidden">—</span><span className="hidden sm:inline">Nothing flagged</span></>}
              </div>
              <Link
                to={`/workbench?list=${l.key}`}
                className="mt-1.5 inline-flex min-h-[40px] items-center justify-center rounded-lg border border-line2 text-body font-semibold text-[color:var(--text)] hover:bg-hoverbg"
              >
                Start<span className="hidden sm:inline">&nbsp;{l.label}</span>
              </Link>
            </div>
          ))}
        </div>
      </div>
      <div className="px-5 pb-2 pt-4">
        <div className={SECTION_LABEL}>Meetings</div>
        <TodayAgenda bare />
      </div>
    </section>
  )
}

// ---- A3. November goals ---------------------------------------------------------

const PACE_INK = { hit: 'var(--pos-ink)', pace: 'var(--pos-ink)', behind: 'var(--warn-ink)' }
const DOT = { bay: 'var(--bay)', mpg: 'var(--mpg)' }

export function MonthGoals({ model, now = Date.now(), className = '' }) {
  const { rows, behind, daysLeft } = model
  return (
    <section aria-label={`${monthName(now)} goals`} className={`cc-card flex min-w-0 flex-col overflow-hidden ${className}`}>
      <CardHead
        title={`${monthName(now)} goals`}
        sub={`${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left · today's counts live in Workbench`}
        link={{ to: '/reports', label: 'Reports' }}
      />
      <div className="flex flex-col gap-3 px-5 py-4">
        {rows.map((g) => (
          <div key={g.id} data-goal={g.id} data-status={g.status}>
            <div className="flex items-center gap-2 text-body">
              <span className="h-2 w-2 flex-none rounded-full" style={{ background: DOT[g.book] || 'var(--chrome)' }} />
              <span className="flex-1 font-medium">{g.label}</span>
              <span className="num text-muted">
                {g.value.toLocaleString()} / {g.target.toLocaleString()}
              </span>
              <span className="w-[72px] text-right text-caption font-bold" style={{ color: g.covered ? 'var(--muted)' : PACE_INK[g.status] }}>
                {g.word}
              </span>
            </div>
            <div className="ml-4 mt-1.5 h-1.5 overflow-hidden rounded-full bg-hoverbg">
              <div className="h-full rounded-full" style={{ width: `${g.pct}%`, background: DOT[g.book] || 'var(--chrome)' }} />
            </div>
          </div>
        ))}
      </div>
      {behind && (
        <div data-goal-behind={behind.id} className="mx-5 mb-4 mt-auto rounded-lg bg-panel2 px-3 py-2.5 text-body text-muted">
          Behind on <b className="text-[color:var(--text)]">{behind.label}</b>: {Math.max(0, behind.target - behind.value).toLocaleString()} to go with {daysLeft}{' '}
          {daysLeft === 1 ? 'day' : 'days'} left.
        </div>
      )}
    </section>
  )
}

// ---- A4. Forecast, both books --------------------------------------------------

const BAR = { funded: 'var(--chrome)', closing: 'var(--bay-ink)', low: '#A4C97A', high: '#D9E8C4' }

function BayHalf({ f, goal }) {
  const top = Math.max(goal || 0, f.high, 1)
  const w = (n) => `${(Math.max(0, n) / top) * 100}%`
  const short = goal ? goal - f.high : null
  const pill =
    short == null ? null : short > 0 ? { text: `${kMoney(short)} short at best`, ink: 'var(--warn-ink)', bg: 'var(--warn-bg)' } : { text: f.low >= goal ? 'Goal covered' : 'Goal in range', ink: 'var(--pos-ink)', bg: 'var(--pos-bg)' }
  return (
    <div data-forecast="bay" className="min-w-0 flex-1 px-5 py-4">
      <div className="flex items-center justify-between gap-2">
        <BizBadge biz="bay" />
        <span className="text-body text-muted">{goal ? `goal ${kMoney(goal)}` : 'no goal set'}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="num text-[28px] font-bold tracking-[-0.6px]">{range(f.low, f.high, kMoney)}</span>
        {pill && (
          <span className="rounded-md px-2 py-0.5 text-caption font-semibold" style={{ color: pill.ink, background: pill.bg }}>
            {pill.text}
          </span>
        )}
      </div>
      <div
        role="img"
        aria-label={`Funded ${money(f.funded)}, closing ${money(f.closing)}, leads ${money(f.leadsLow)} to ${money(f.leadsHigh)}${goal ? `, against ${money(goal)}` : ''}`}
        className="relative mt-3 flex h-4 overflow-hidden rounded-md bg-hoverbg"
      >
        <div style={{ width: w(f.funded), background: BAR.funded }} />
        <div style={{ width: w(f.closing), background: BAR.closing }} />
        <div style={{ width: w(f.leadsLow), background: BAR.low }} />
        <div style={{ width: w(f.leadsHigh - f.leadsLow), background: BAR.high }} />
        {goal > 0 && <div className="absolute inset-y-0 w-0.5 bg-[color:var(--text)]" style={{ left: `calc(${w(goal)} - 1px)` }} title="Goal" />}
      </div>
      <div className="mt-3 grid grid-cols-1 gap-1.5 text-body sm:grid-cols-3">
        <Legend color={BAR.funded} label="Funded" value={money(f.funded)} />
        <Legend color={BAR.closing} label="Closing" value={money(f.closing)} note={f.closingNames.slice(0, 3).join(', ')} />
        <Legend color={BAR.low} label="Leads" value={range(f.leadsLow, f.leadsHigh, kMoney)} note={f.leadCount ? `${f.leadCount} rated · Hot only to all` : 'No rated leads'} />
      </div>
    </div>
  )
}

function Legend({ color, label, value, note }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-muted">
        <span className="h-2 w-2 flex-none rounded-sm" style={{ background: color }} />
        {label}
      </div>
      <div className="num font-semibold">{value}</div>
      {note && <div className="truncate text-caption text-dim">{note}</div>}
    </div>
  )
}

function MpgHalf({ f, goal }) {
  const m = f.mpg
  const dollars = m.dollarsLow != null
  return (
    <div data-forecast="mpg" className="min-w-0 flex-1 px-5 py-4">
      <div className="flex items-center justify-between gap-2">
        <BizBadge biz="mpg" />
        <span className="text-body text-muted">{goal ? `goal ${goal} accounts` : 'no goal set'}</span>
      </div>
      <div className="mt-2 num text-[28px] font-bold tracking-[-0.6px]">
        {dollars ? `${range(m.dollarsLow, m.dollarsHigh, kMoney)} / mo` : `${range(m.low, m.high, acct)} ${m.high === 1 ? 'account' : 'accounts'}`}
      </div>
      <div role="img" aria-label={`${m.activated} activated, ${m.approved} approved, ${acct(m.low)} to ${acct(m.high)} expected`} className="mt-3 flex h-4 gap-1">
        {Array.from({ length: Math.max(goal || 0, Math.ceil(m.high), 1) }, (_, i) => {
          const fill = i < m.activated ? 'var(--mpg-ink)' : i < m.activated + m.approved ? 'var(--mpg)' : i < Math.ceil(m.high) ? 'var(--mpg-line)' : 'var(--hoverbg, #F2F4F7)'
          return <div key={i} className="flex-1 rounded" style={{ background: fill }} />
        })}
      </div>
      <div className="mt-3 text-body text-muted">
        {m.activated} activated · {m.approved} approved this month · {acct(Math.max(0, m.high - m.activated - m.approved))} from rated leads
      </div>
      {!dollars && <div className="mt-1 text-caption text-dim">Counted in accounts until residuals are entered in Reports.</div>}
    </div>
  )
}

// layers: { this, next } from forecastLayers. goals: { bay, mpg }.
// undated: open Arive loans with no closing date (in neither month).
export function ForecastBoth({ layers, goals, biz, loading, error, undated = 0, now = Date.now() }) {
  const [which, setWhich] = useState('this')
  const f = layers[which]
  const label = which === 'this' ? monthName(now) : monthName(new Date(new Date(now).getFullYear(), new Date(now).getMonth() + 1, 1))
  return (
    <section id="forecast" aria-label={`${label} forecast`} className="cc-card flex min-w-0 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-lead font-semibold tracking-[-0.2px]">{label} forecast</h2>
          <div className="mt-0.5 text-body text-muted">Booked in Arive, plus rated leads as a range</div>
        </div>
        <div className="flex items-center gap-3">
          <div role="group" aria-label="Month" className="flex rounded-lg bg-panel2 p-[3px]">
            {[
              ['this', 'This month'],
              ['next', 'Next month'],
            ].map(([k, t]) => (
              <button
                key={k}
                type="button"
                aria-pressed={which === k}
                onClick={() => setWhich(k)}
                className={`min-h-[32px] rounded-md px-3 text-body font-semibold ${which === k ? 'bg-panel text-[color:var(--text)] shadow-sm' : 'text-muted'}`}
              >
                {t}
              </button>
            ))}
          </div>
          <Link to="/settings" className="text-body font-semibold text-[color:var(--chrome)]">
            Odds →
          </Link>
        </div>
      </div>
      {error && <div className="mx-5 mt-3 text-caption text-neg-ink">{error}</div>}
      {loading ? (
        <div className="px-5 py-6 text-body text-muted">Loading forecast…</div>
      ) : (
        <div className="flex flex-col divide-y divide-line md:flex-row md:divide-x md:divide-y-0">
          {biz !== 'mpg' && <BayHalf f={f} goal={goals.bay} />}
          {biz !== 'bay' && <MpgHalf f={f} goal={goals.mpg} />}
        </div>
      )}
      {!loading && biz !== 'mpg' && undated > 0 && (
        <div data-undated className="border-t border-line px-5 py-2.5 text-caption text-muted">
          {undated} open loan{undated === 1 ? '' : 's'} with no closing date, not counted in either month
        </div>
      )}
    </section>
  )
}
