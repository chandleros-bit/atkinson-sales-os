// Partner funnel (Bayway Bot Engine doc, Sales OS weeks 5-6): invites, class
// attendees, one-to-ones and referrals, for this month or the last 90 days.
// Each step shows its share of the step before.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { loadFunnel, funnelSteps } from '../lib/classes'
import { chicagoDateKey } from '../lib/briefingTime'

export function funnelRange(period, now = Date.now()) {
  const to = chicagoDateKey(now)
  return period === 'month' ? { from: `${to.slice(0, 8)}01`, to } : { from: chicagoDateKey(now, -89), to }
}

export default function PartnerFunnelCard() {
  const [period, setPeriod] = useState('month')
  const [f, setF] = useState(undefined)

  useEffect(() => {
    let live = true
    const { from, to } = funnelRange(period)
    loadFunnel(from, to).then((x) => live && setF(x)).catch(() => live && setF(null))
    return () => { live = false }
  }, [period])

  const steps = funnelSteps(f)
  return (
    <section aria-label="Partner funnel" className="cc-card mt-4 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h3 className="text-lead font-semibold tracking-[-0.2px]">Partner funnel</h3>
          <div className="mt-0.5 text-body text-muted">Class invites through referrals, Bayway.</div>
        </div>
        <div className="flex items-center gap-2">
          <select aria-label="Funnel period" value={period} onChange={(e) => setPeriod(e.target.value)} className="rounded-lg border border-line2 bg-transparent px-2 py-1 text-body">
            <option value="month">This month</option>
            <option value="90">Last 90 days</option>
          </select>
          <Link to="/bayway/partners" className="inline-flex min-h-[36px] items-center rounded-lg px-2 text-body font-semibold text-[color:var(--chrome)] hover:bg-hoverbg">Partners →</Link>
        </div>
      </div>
      {f === undefined ? (
        <p className="px-5 py-4 text-body text-muted">Loading…</p>
      ) : (
        <ol className="grid grid-cols-2 gap-3 px-5 py-4 sm:grid-cols-5">
          {steps.map((s) => (
            <li key={s.key} data-funnel={s.key} className="flex flex-col">
              <span className="num text-[22px] font-semibold">{s.n}</span>
              <span className="text-body">{s.label}</span>
              {s.pct != null && <span className="text-xs text-dim">{s.pct}% of previous</span>}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
