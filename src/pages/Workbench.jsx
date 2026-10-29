// Workbench: the day's calls and file work, side by side (one at a time on a
// phone). Calls = the Up Next queue (Priority, embedded); Work = estimates,
// applications and MPG tasks from CRM state plus your own work items, with
// the app's status and notes on top (workbench.js, work_items).
// Spec: docs/superpowers/specs/2026-10-22-workbench-design.md
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useBusiness } from '../context/BusinessContext'
import { usePriorityQueue } from '../lib/usePriorityQueue'
import { useWorkLane } from '../lib/useWorkLane'
import { buildWorkGroups, workProgress } from '../lib/workbench'
import { buildAlerts } from '../lib/alerts'
import AlertsRail from '../components/AlertsRail'
import { useIsMobile } from '../components/UpNextRow'
import WorkLane from '../components/WorkLane'
import AddWorkItem from '../components/AddWorkItem'
import VoiceTask from '../components/VoiceTask'
import { SyncDot } from '../components/PageHeader'
import Priority from './Priority'
import { useDialList } from '../lib/useDialList'
import { buildDialList } from '../lib/dialList'
import { buildThemeList } from '../lib/dialThemes'
import ThemeList from '../components/ThemeList'
import DialList from '../components/DialList'
import Dialer from '../components/Dialer'

function Progress({ label, value, pct }) {
  return (
    <div className="flex w-[180px] flex-col gap-1.5">
      <div className="flex justify-between text-[13px] font-semibold">
        <span>{label}</span>
        <span className="num">{value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.round(pct * 100))}%`, background: 'var(--chrome)' }} />
      </div>
    </div>
  )
}

// One lane as a card: a gray header with its count (the phone's tabs carry the
// counts there), then the body, which scrolls on its own once the lanes sit
// side by side (xl+).
function Lane({ label, count, mobile, children }) {
  return (
    <section aria-label={label} className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-card border border-line bg-panel shadow-[0_1px_2px_rgba(16,24,40,.05)]">
      {!mobile && (
        <div className="flex flex-none items-center border-b border-line bg-panel2 px-4 py-3">
          <h2 className="text-[16px] font-semibold">
            {label} <span className="num font-medium text-muted">· {count}</span>
          </h2>
        </div>
      )}
      <div className="min-h-0 flex-1 xl:overflow-y-auto">{children}</div>
    </section>
  )
}

export default function Workbench() {
  const { biz } = useBusiness() || { biz: 'all' }
  const { queue, signals, rules, touchedToday } = usePriorityQueue(biz)
  const work = useWorkLane()
  const mobile = useIsMobile()
  const [lane, setLane] = useState('calls')
  const [adding, setAdding] = useState(false)
  // The Calls lane (spec: The daily list): Up Next's "They reached out", the
  // lead cadence (dialList.js), Up Next's overdue follow-ups, the weekday
  // theme (dialThemes.js), then the rest of Up Next under More. dialRun is the
  // list the dialer is walking, null while closed; themeDay previews another
  // weekday's theme (null = today).
  const dial = useDialList()
  const [dialRun, setDialRun] = useState(null)
  const [themeDay, setThemeDay] = useState(null)

  const cap = rules.daily_cap || 15
  const toGo = Math.min(queue.length, cap)
  const inBook = (book) => biz === 'all' || book === biz
  const now = Date.now()
  const dialDue = buildDialList(dial.rows, { now: dial.now, skips: dial.skips, inBook })
  const dialItems = [...dialDue.dueNow, ...dialDue.laterToday]
  const themeList = buildThemeList(dial.rows, { now: dial.now, day: themeDay, skips: dial.skips, inBook })
  const dialIds = new Set([...dialItems, ...themeList.items].map((i) => i.id))
  const callsToGo = toGo + dialDue.dueNow.length + (themeDay == null ? themeList.items.length : 0)
  const groups = buildWorkGroups({ pipeline: work.pipeline, mpgTasks: work.tasks, workItems: work.workItems, rules, now })
    .filter((g) => g.book == null || inBook(g.book))
    .map((g) => ({ ...g, items: g.items.filter((it) => inBook(it.book)) }))
  // Open = what's in front of you; waiting items are parked, not counted.
  const openWork = groups.reduce((n, g) => n + (g.id === 'waiting' ? 0 : g.items.length), 0)
  const progress = workProgress(work.workItems.filter((w) => inBook(w.business_id)), openWork, now)
  const alerts = buildAlerts({ queue, signals, pipeline: work.pipeline, tasks: work.tasks, workItems: work.workItems, rules, inBook, now })
  const showCalls = !mobile || lane === 'calls'
  const showWork = !mobile || lane === 'work'

  return (
    // xl+: the page fits the window (top bar 100px + bottom padding 48px) and
    // each lane scrolls by itself. Narrower, the lanes stack and the page scrolls.
    <div className="flex flex-col gap-4 xl:h-[calc(100dvh-148px)] xl:min-h-[600px]">
      {/* One compact row: the top bar already names the page. */}
      <header className="flex flex-none flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <h2 className="sr-only">Workbench</h2>
        <div className="flex flex-wrap items-center gap-x-7 gap-y-3">
          <Progress label="Calls" value={`${touchedToday} / ${cap}`} pct={touchedToday / cap} />
          <Progress label="Work" value={`${progress.done} / ${progress.total}`} pct={progress.total ? progress.done / progress.total : 0} />
          <SyncDot />
        </div>
        <div className="flex gap-2">
          {/* Priority Leads (FUB score tiers) left the nav; it opens from here. */}
          {biz !== 'mpg' && (
            <Link to="/bayway/priority-leads" className="flex min-h-[38px] items-center rounded-[10px] px-2.5 text-[13.5px] font-semibold text-muted hover:text-[color:var(--text)]">
              Priority Leads
            </Link>
          )}
          <VoiceTask defaultBook={biz === 'mpg' ? 'mpg' : 'bay'} onAdded={work.reload} />
          <button type="button" onClick={() => setAdding(true)} className="min-h-[38px] rounded-[10px] border border-line2 px-3.5 text-[13.5px] font-semibold text-[#344054]">
            + Work item
          </button>
        </div>
      </header>

      <AlertsRail alerts={alerts} showBook={biz === 'all'} />

      {mobile && (
        <div role="tablist" aria-label="Lane" className="grid grid-cols-2 rounded-xl bg-panel2 p-1">
          {[
            ['calls', `Calls · ${callsToGo}`],
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

      <div className="flex min-h-0 flex-1 flex-col gap-5 xl:grid xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {showCalls && (
          <Lane label="Calls" count={`${callsToGo} to go`} mobile={mobile}>
            {dial.error && <div className="m-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{dial.error}</div>}
            <Priority embedded hideIds={dialIds} buckets={['reached_out']} />
            <DialList dueNow={dialDue.dueNow} laterToday={dialDue.laterToday} now={dial.now} onDial={(i) => setDialRun({ items: dialItems, start: i })} />
            <Priority embedded hideIds={dialIds} buckets={['overdue']} />
            <ThemeList list={themeList} pickedDay={themeDay} onPickDay={setThemeDay} onDial={(i) => setDialRun({ items: themeList.items, start: i })} />
            <details>
              <summary className="cursor-pointer border-b border-line px-4 py-2.5 text-[12px] font-bold uppercase tracking-wide text-muted">More from Up Next</summary>
              <Priority embedded hideIds={dialIds} buckets={['new_lead', 'hot_cold', 'no_next_step', 'stuck', 'quiet']} />
            </details>
          </Lane>
        )}
        {showWork && (
          <Lane label="Work" count={`${openWork} open`} mobile={mobile}>
            {work.error && <div className="m-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{work.error}</div>}
            <WorkLane groups={groups} onChanged={work.reload} />
          </Lane>
        )}
      </div>
      {dialRun && (
        <Dialer
          items={dialRun.items}
          start={dialRun.start}
          skipToday={dial.skipToday}
          onClose={() => {
            setDialRun(null)
            dial.reload()
          }}
        />
      )}
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
