// Up Next: one ranked list across both books of who to call next, and why.
// Ranking lives in src/lib/priorityQueue.js; data in usePriorityQueue.
import { useState } from 'react'
import { isDemoMode } from '../lib/supabase'
import { useBusiness } from '../context/BusinessContext'
import { usePriorityQueue } from '../lib/usePriorityQueue'
import { groupForDisplay } from '../lib/priorityQueue'
import UpNextRow from '../components/UpNextRow'

// Stage tracking (contacts.stage_since) began with migration 0029; "Stuck in
// stage" can only fire stuck_days after a lead's first observed stage change.
export const STAGE_TRACKING_STARTED = '2026-10-18'

function stuckNote(rules) {
  const start = new Date(`${STAGE_TRACKING_STARTED}T00:00:00`)
  const ready = new Date(start)
  ready.setDate(ready.getDate() + rules.stuck_days)
  if (Date.now() >= ready.getTime()) return null
  const fmt = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return `Stage tracking started ${fmt(start)}. "Stuck in stage" starts flagging around ${fmt(ready)}.`
}

// embedded: the Workbench's Calls lane (no page header or width of its own;
// the lane is the card, so groups are flat sections of dense rows).
// hideIds: Workbench passes the dial list's leads so no one shows twice.
// buckets: only these Up Next buckets; renders nothing when they're empty
// (the Workbench places Up Next's sections around the dial lists).
export default function Priority({ embedded = false, hideIds = null, buckets = null }) {
  const { biz } = useBusiness()
  const { queue: all, rules, touchedToday, loading, error } = usePriorityQueue(biz)
  const queue = all.filter((r) => (!hideIds || !hideIds.has(r.id)) && (!buckets || buckets.includes(r.bucket)))
  const [showAll, setShowAll] = useState(false)

  const cap = rules.daily_cap || 15
  const { groups, hiddenCount, counts } = groupForDisplay(queue, showAll ? queue.length : cap)
  const toGo = Math.min(queue.length, cap)
  const note = stuckNote(rules)
  const pad = embedded ? 'mx-4' : ''

  if (buckets && (loading || error || isDemoMode || queue.length === 0)) return null

  return (
    <div className={embedded ? '' : 'mx-auto max-w-3xl'}>
      {!embedded && (
      <>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[26px] font-bold tracking-tight">Up Next</h2>
        {!loading && !error && (
          <div className="num text-[13px] font-semibold text-muted">
            {touchedToday} touched today · {toGo} to go
          </div>
        )}
      </div>
      <p className="mt-1 hidden text-sm text-muted sm:block">
        Who to call next, worst first. A lead drops off when you call, log a note, or schedule a
        follow-up.
      </p>
      </>
      )}

      {isDemoMode && (
        <div className={`${pad} mt-6 rounded-card border border-line bg-panel px-6 py-8 text-center text-sm text-muted`}>
          Demo mode — connect Supabase to see your Up Next list.
        </div>
      )}
      {error && (
        <div className={`${pad} mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700`}>{error}</div>
      )}
      {loading && !isDemoMode && <div className={`${pad} mt-6 text-sm text-muted`}>Loading…</div>}

      {!loading && !error && !isDemoMode && queue.length === 0 && (
        <div className={`${pad} mt-6 rounded-card border border-line bg-panel px-6 py-10 text-center`}>
          <div className="text-[16px] font-bold">Nobody slipping. Nice work.</div>
          <div className="mt-1 text-sm text-muted">{touchedToday} touched today</div>
        </div>
      )}

      {!loading && !error && groups.length > 0 && (
        <div className={embedded ? 'flex flex-col' : 'mt-5 flex flex-col gap-5'}>
          {groups.map((g) => (
            <section key={g.id}>
              <div className={`flex items-center gap-2 text-[12px] font-bold uppercase tracking-wide text-muted ${embedded ? 'border-b border-line px-4 pb-1.5 pt-3' : 'mb-1.5 px-1'}`}>
                {g.label}
                <span className="num font-semibold text-dim">{counts[g.id]}</span>
              </div>
              <div className={embedded ? 'border-b border-line px-3 sm:px-0' : 'rounded-card border border-line bg-panel px-3 sm:px-4'}>
                {g.rows.map((r) => (
                  <UpNextRow key={r.id} row={r} dense={embedded} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {!loading && !error && hiddenCount > 0 && (
        <div className={`${embedded ? 'mb-4 ' : ''}mt-4 flex justify-center`}>
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="min-h-[40px] rounded-lg border border-line2 px-4 text-[13px] font-semibold text-muted hover:text-[color:var(--text)]"
          >
            Show all {queue.length}
          </button>
        </div>
      )}
      {!loading && !error && showAll && queue.length > cap && (
        <div className={`${embedded ? 'mb-4 ' : ''}mt-4 flex justify-center`}>
          <button type="button" onClick={() => setShowAll(false)} className="min-h-[40px] text-[12.5px] text-muted">
            Show top {cap} only
          </button>
        </div>
      )}

      {!loading && !error && note && <p className={`${embedded ? 'mb-4 px-4' : 'px-1'} mt-5 text-[11.5px] text-dim`}>{note}</p>}
    </div>
  )
}
