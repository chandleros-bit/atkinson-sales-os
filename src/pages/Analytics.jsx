// Analytics: how consistently you call (a 26-week heatmap of outbound calls,
// shaded against the busiest day, with days at the call goal counted) and
// which lead sources turn into
// applications, funded loans and commission (Bayway) or qualified merchants
// (MPG), against what each source cost. Both follow the business filter.
// Logic lives in lib/analytics.js and lib/roi.js.
import { useEffect, useMemo, useState } from 'react'
import { supabase, isDemoMode } from '../lib/supabase'
import { fetchAllSettled } from '../lib/fetchAll'
import { useBusiness } from '../context/BusinessContext'
import { DEFAULT_TARGETS, resolveTargets } from '../lib/reports'
import { heatmap, countByDay, sourceTable } from '../lib/analytics'
import { fetchLoanBundle } from '../lib/loansData'
import { fetchRoiInputs } from '../lib/roiData'
import { aliasMap, roiTable, kpis, windowKeys, formatUsd } from '../lib/roi'
import SpendSheet from '../components/SpendSheet'
import PageHeader from '../components/PageHeader'

const WEEKS = 26
const WINDOWS = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '12 months' },
]
const DAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', '']
const SHADE = [0, 0.25, 0.45, 0.7, 1]

function heatColor(level, ink) {
  if (level == null) return 'transparent'
  if (level === 0) return 'var(--line)'
  return `color-mix(in srgb, ${ink} ${Math.round(SHADE[level] * 100)}%, var(--panel))`
}

const dayTitle = (key, count) => {
  const [y, m, d] = key.split('-').map(Number)
  const label = new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  return `${label} · ${count} call${count === 1 ? '' : 's'}`
}

function Stat({ label, value }) {
  return (
    <div>
      <div className="text-[12px] font-medium text-muted">{label}</div>
      <div className="num mt-0.5 text-[22px] font-extrabold tracking-tight">{value}</div>
    </div>
  )
}

function Heatmap({ model, goal, ink }) {
  const { weeks, months, stats } = model
  const bestDay = stats.best ? dayTitle(stats.best.key, stats.best.count).split(' · ')[0] : null
  return (
    <section aria-label="Calling heatmap" className="rounded-card border border-line bg-panel p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-bold">Outbound calls, last {WEEKS} weeks</h3>
        <span className="text-[12px] text-muted">Darker is busier, against your best day</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-5">
        <Stat label="Calls" value={stats.total.toLocaleString()} />
        <Stat label="Days with calls" value={stats.active} />
        <Stat label="Average on those days" value={stats.avg} />
        <Stat label={`Days at goal (${goal})`} value={stats.atGoal} />
        <Stat label={bestDay ? `Best day · ${bestDay}` : 'Best day'} value={stats.best ? stats.best.count : '—'} />
      </div>
      <div className="-mx-4 mt-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="inline-grid gap-[3px]" style={{ gridTemplateColumns: `28px repeat(${weeks.length}, 13px)` }}>
          <span />
          {weeks.map((_, w) => (
            <span key={w} className="h-4 whitespace-nowrap text-[10px] text-dim">
              {months.find((m) => m.col === w)?.label || ''}
            </span>
          ))}
          {DAY_LABELS.map((label, d) => (
            <DayRow key={d} label={label} cells={weeks.map((col) => col[d])} ink={ink} />
          ))}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-1.5 text-[11px] text-dim">
        Less
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className="h-[11px] w-[11px] rounded-[3px]" style={{ background: heatColor(l, ink) }} />
        ))}
        More
      </div>
    </section>
  )
}

// One weekday across every week of the grid.
function DayRow({ label, cells, ink }) {
  return (
    <>
      <span className="pr-1 text-right text-[10px] leading-[13px] text-dim">{label}</span>
      {cells.map((c) => (
        <span
          key={c.key}
          data-heat={c.level ?? 'future'}
          title={c.future ? undefined : dayTitle(c.key, c.count)}
          className="h-[13px] w-[13px] rounded-[3px]"
          style={{ background: heatColor(c.level, ink) }}
        />
      ))}
    </>
  )
}

const money = (v) => formatUsd(v)

function RoiTable({ title, book, rateLabel, roi, ink }) {
  const bay = book === 'bay'
  const k = kpis(roi)
  const tiles = [
    ['leads', 'New leads', String(k.leads)],
    ['spend', 'Spend', money(k.spend)],
    ['cpl', 'Cost per lead', money(k.costPerLead)],
    ...(bay ? [['cpf', 'Cost per funded', money(k.costPerFunded)]] : []),
  ]
  return (
    <section aria-label={title} className="rounded-card border border-line bg-panel p-4 sm:p-5">
      <h3 className="text-[15px] font-bold">{title}</h3>
      <div className={`mt-3 grid grid-cols-2 gap-2 ${bay ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
        {tiles.map(([id, label, value]) => (
          <div key={id} data-kpi={id} className="rounded-xl bg-panel2 px-3 py-2">
            <div className="text-[11.5px] text-muted">{label}</div>
            <div className="num text-[17px] font-bold">{value}</div>
          </div>
        ))}
      </div>
      {roi.rows.length === 0 ? (
        <div className="mt-3 text-[13px] text-muted">No leads, loans or spend in this window.</div>
      ) : (
        <div className="-mx-4 mt-3 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <table className={`w-full text-[13px] ${bay ? 'min-w-[860px]' : 'min-w-[640px]'}`}>
            <thead>
              <tr className="border-b border-line text-left text-[11.5px] text-muted">
                <th className="py-2 pr-3 font-semibold">Source</th>
                <th className="num py-2 pr-3 text-right font-semibold">Leads</th>
                {roi.cols.map((c) => (
                  <th key={c.id} className="py-2 pr-3 text-right font-semibold">
                    {c.label}
                  </th>
                ))}
                <th className="py-2 pr-3 text-right font-semibold">{rateLabel}</th>
                {bay && <th className="py-2 pr-3 text-right font-semibold">Funded</th>}
                {bay && <th className="py-2 pr-3 text-right font-semibold">Commission</th>}
                <th className="py-2 pr-3 text-right font-semibold">Spend</th>
                <th className="py-2 pr-3 text-right font-semibold">Per lead</th>
                {bay && <th className="py-2 text-right font-semibold">Per funded</th>}
              </tr>
            </thead>
            <tbody>
              {[...roi.rows, roi.total].map((r) => {
                const total = r === roi.total
                const dash = r.notLinked
                return (
                  <tr key={r.source} data-source={r.source} className={`border-b border-line last:border-b-0 ${total ? 'font-bold' : ''} ${dash ? 'text-muted' : ''}`}>
                    <td className="max-w-[240px] truncate py-2 pr-3">
                      {r.source}
                      {r.raws.length > 1 && <span className="ml-1 text-[11.5px] font-normal text-dim">({r.raws.length} merged)</span>}
                    </td>
                    <td className="num py-2 pr-3 text-right">{dash ? '—' : r.leads}</td>
                    {roi.cols.map((c) => (
                      <td key={c.id} className="num py-2 pr-3 text-right text-muted">
                        {dash ? '—' : r.counts[c.id] || 0}
                      </td>
                    ))}
                    <td className="py-2 pr-3">
                      {dash ? (
                        <div className="text-right">—</div>
                      ) : (
                        <div className="flex items-center justify-end gap-2">
                          <div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-line sm:block">
                            <div className="h-full rounded-full" style={{ width: `${r.rate}%`, background: ink }} />
                          </div>
                          <span className="num w-10 text-right" data-rate>
                            {r.rate}%
                          </span>
                        </div>
                      )}
                    </td>
                    {bay && (
                      <td className="num py-2 pr-3 text-right" data-funded>
                        {r.funded}
                      </td>
                    )}
                    {bay && (
                      <td className="num py-2 pr-3 text-right" data-commission>
                        {money(r.commission)}
                      </td>
                    )}
                    <td className={`num py-2 pr-3 text-right ${r.spend === 'free' ? 'text-dim' : ''}`} data-spend>
                      {money(r.spend)}
                    </td>
                    <td className="num py-2 pr-3 text-right" data-cpl>
                      {money(r.costPerLead)}
                    </td>
                    {bay && (
                      <td className="num py-2 text-right" data-cpf>
                        {money(r.costPerFunded)}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

// contacts rows -> { id, business_id, source, created, person_stage, tags }.
const toLead = (c) => ({
  id: c.id,
  business_id: c.business_id,
  person_stage: c.person_stage,
  tags: c.tags,
  source: c.business_id === 'bay' ? c.bay_source : c.mpg_source,
  created: c.business_id === 'bay' ? c.bay_created : c.mpg_created,
})

export default function Analytics() {
  const { biz } = useBusiness() || { biz: 'all' }
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [days, setDays] = useState(90)
  const [spendOpen, setSpendOpen] = useState(false)

  const reloadRoi = async () => {
    const roi = await fetchRoiInputs()
    setData((d) => ({ ...d, aliases: roi.data?.aliases || [], spend: roi.data?.spend || [], roiError: roi.error?.message || d.loanError || null }))
  }

  useEffect(() => {
    if (isDemoMode) return
    let cancelled = false
    ;(async () => {
      const since = new Date()
      since.setHours(0, 0, 0, 0)
      since.setDate(since.getDate() - WEEKS * 7)
      const [calls, contacts, settings, loans, roi] = await Promise.all([
        // Six months of calls across both books passes 1,000 rows: paged.
        fetchAllSettled(() =>
          supabase.from('activities').select('occurred_at, business_id').eq('type', 'call').eq('direction', 'outbound').gte('occurred_at', since.toISOString()).order('id'),
        ),
        fetchAllSettled(() =>
          supabase
            .from('contacts')
            .select('id, business_id, person_stage, bay_source:raw->>source, mpg_source:raw->>Lead_Source, bay_created:raw->>created, mpg_created:raw->>Created_Time, tags:raw->tags')
            .order('id'),
        ),
        supabase.from('settings').select('value').eq('key', 'metric_targets').maybeSingle(),
        fetchLoanBundle(),
        fetchRoiInputs(),
      ])
      if (cancelled) return
      const err = calls.error || contacts.error || settings.error
      if (err) return setError(err.message)
      // Loans and spend never blank the page: lead counts still show.
      const loanError = loans.error?.message || null
      setData({
        calls: calls.data || [],
        leads: (contacts.data || []).map(toLead),
        goal: resolveTargets(DEFAULT_TARGETS, settings.data?.value).calls,
        loans: loans.data?.loans || [],
        rates: loans.data?.rates,
        aliases: roi.data?.aliases || [],
        spend: roi.data?.spend || [],
        loanError,
        roiError: roi.error?.message || loanError,
      })
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const inBook = (b) => biz === 'all' || b === biz
  const ink = biz === 'mpg' ? 'var(--mpg)' : biz === 'bay' ? 'var(--bay)' : 'var(--text)'
  const model = useMemo(() => {
    if (!data) return null
    const calls = data.calls.filter((r) => biz === 'all' || r.business_id === biz)
    return heatmap(countByDay(calls), { weeks: WEEKS, goal: data.goal })
  }, [data, biz])
  const tables = useMemo(() => {
    if (!data) return null
    const now = Date.now()
    const fromMs = now - days * 86400000
    const keys = windowKeys(days, now)
    const contactsById = new Map(data.leads.map((l) => [l.id, l]))
    const aliases = aliasMap(data.aliases)
    const build = (book) =>
      roiTable(sourceTable(data.leads, book, fromMs), { book, contactsById, loans: data.loans, rates: data.rates, spendRows: data.spend, aliases, ...keys })
    return { bay: build('bay'), mpg: build('mpg') }
  }, [data, days])

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Analytics" subtitle="How consistently you call, and which lead sources turn into business." />
      {isDemoMode && (
        <div className="rounded-card border border-line bg-panel px-6 py-8 text-center text-sm text-muted">Demo mode — connect Supabase to see analytics.</div>
      )}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      {!isDemoMode && !error && !data && <div className="text-sm text-muted">Loading analytics…</div>}

      {model && <Heatmap model={model} goal={data.goal} ink={ink} />}

      {data && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-[17px] font-bold">Lead sources and ROI</h3>
              <p className="mt-0.5 text-[12.5px] text-muted">
                Leads created and loans funded in the window. Spend prorated by day. A lead that applied and later went Lost counts as Lost.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div role="tablist" aria-label="Window" className="flex gap-1 rounded-xl bg-panel2 p-1">
                {WINDOWS.map((w) => (
                  <button
                    key={w.days}
                    type="button"
                    role="tab"
                    aria-selected={days === w.days}
                    onClick={() => setDays(w.days)}
                    className={`min-h-[34px] rounded-lg px-3 text-[12.5px] font-semibold ${days === w.days ? 'bg-panel text-[color:var(--text)]' : 'text-muted'}`}
                  >
                    {w.label}
                  </button>
                ))}
              </div>
              <button type="button" aria-label="Spend" onClick={() => setSpendOpen(true)} className="min-h-[34px] rounded-lg border border-line2 px-3 text-[12.5px] font-semibold">
                Spend
              </button>
            </div>
          </div>
          {data.roiError && <div className="text-[12px] text-[#b42318]">Couldn&apos;t load spend or loans: {data.roiError}</div>}
          {inBook('bay') && <RoiTable title="Bayway · FollowUpBoss" book="bay" rateLabel="To app / estimate" roi={tables.bay} ink="var(--bay)" />}
          {inBook('mpg') && <RoiTable title="MPG · Zoho" book="mpg" rateLabel="To qualified" roi={tables.mpg} ink="var(--mpg)" />}
          {spendOpen && (
            <SpendSheet biz={biz} leads={data.leads} aliases={data.aliases} spend={data.spend} onClose={() => setSpendOpen(false)} onSaved={reloadRoi} />
          )}
        </>
      )}
    </div>
  )
}
