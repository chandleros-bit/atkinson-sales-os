// Workbench: the day's calls and file work, side by side (one at a time on a
// phone). Calls = the Up Next queue (Priority, embedded); Work = estimates,
// applications and MPG tasks from CRM state plus your own work items, with
// the app's status and notes on top (workbench.js, work_items).
// Spec: docs/superpowers/specs/2026-10-22-workbench-design.md
import { useState } from 'react'
import { useBusiness } from '../context/BusinessContext'
import { usePriorityQueue } from '../lib/usePriorityQueue'
import { useWorkLane } from '../lib/useWorkLane'
import { buildWorkGroups, workProgress } from '../lib/workbench'
import { useIsMobile } from '../components/UpNextRow'
import WorkLane from '../components/WorkLane'
import AddWorkItem from '../components/AddWorkItem'
import VoiceTask from '../components/VoiceTask'
import PageHeader from '../components/PageHeader'
import Priority from './Priority'

function Progress({ label, value, pct }) {
  return (
    <div className="flex min-w-[160px] flex-col gap-1.5">
      <div className="flex justify-between text-[13px] font-semibold">
        <span>{label}</span>
        <span className="num">{value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.round(pct * 100))}%`, background: 'var(--text)' }} />
      </div>
    </div>
  )
}

export default function Workbench() {
  const { biz } = useBusiness() || { biz: 'all' }
  const { queue, rules, touchedToday } = usePriorityQueue(biz)
  const work = useWorkLane()
  const mobile = useIsMobile()
  const [lane, setLane] = useState('calls')
  const [adding, setAdding] = useState(false)

  const cap = rules.daily_cap || 15
  const toGo = Math.min(queue.length, cap)
  const inBook = (book) => biz === 'all' || book === biz
  const now = Date.now()
  const groups = buildWorkGroups({ pipeline: work.pipeline, mpgTasks: work.tasks, workItems: work.workItems, rules, now })
    .filter((g) => g.book == null || inBook(g.book))
    .map((g) => ({ ...g, items: g.items.filter((it) => inBook(it.book)) }))
  // Open = what's in front of you; waiting items are parked, not counted.
  const openWork = groups.reduce((n, g) => n + (g.id === 'waiting' ? 0 : g.items.length), 0)
  const progress = workProgress(work.workItems.filter((w) => inBook(w.business_id)), openWork, now)
  const showCalls = !mobile || lane === 'calls'
  const showWork = !mobile || lane === 'work'

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="OVERVIEW"
        title="Workbench"
        subtitle="Calls to make and files to move, both books."
        actions={
          <div className="flex flex-wrap items-center gap-5">
            <Progress label="Calls" value={`${touchedToday} / ${cap}`} pct={touchedToday / cap} />
            <Progress label="Work" value={`${progress.done} / ${progress.total}`} pct={progress.total ? progress.done / progress.total : 0} />
            <div className="flex gap-2">
              <VoiceTask defaultBook={biz === 'mpg' ? 'mpg' : 'bay'} onAdded={work.reload} />
              <button type="button" onClick={() => setAdding(true)} className="min-h-[40px] rounded-[10px] border border-line2 px-3 text-[13px] font-semibold">
                + Work item
              </button>
            </div>
          </div>
        }
      />

      {mobile && (
        <div role="tablist" aria-label="Lane" className="grid grid-cols-2 rounded-xl bg-panel2 p-1">
          {[
            ['calls', `Calls · ${toGo}`],
            ['work', `Work · ${openWork}`],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={lane === id}
              onClick={() => setLane(id)}
              className={`min-h-[40px] rounded-lg text-[14px] font-semibold ${lane === id ? 'bg-panel text-[color:var(--text)]' : 'text-muted'}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-start gap-5">
        {showCalls && (
          <section aria-label="Calls" className="min-w-0 flex-[1_1_380px]">
            {!mobile && <h2 className="mb-2 px-1 text-[16px] font-bold">Calls</h2>}
            <Priority embedded />
          </section>
        )}
        {showWork && (
          <section aria-label="Work" className="min-w-0 flex-[1.2_1_420px]">
            {!mobile && <h2 className="mb-2 px-1 text-[16px] font-bold">Work</h2>}
            {work.error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{work.error}</div>}
            <WorkLane groups={groups} onChanged={work.reload} />
          </section>
        )}
      </div>
      {adding && (
        <AddWorkItem
          defaultBook={biz === 'mpg' ? 'mpg' : 'bay'}
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false)
            work.reload()
          }}
        />
      )}
    </div>
  )
}
