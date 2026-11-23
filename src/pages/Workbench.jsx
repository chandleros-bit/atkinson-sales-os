// Workbench v2, step 1 (spec docs/superpowers/specs/2026-11-23-workbench-v2-design.md):
// today's work as three untimed lists, Calls, Files and Partners (workLists.js),
// with the new-lead banner and hard dates above them and a side panel with the
// gap to goal, At risk and today's counts. Each list still uses its existing
// rows and actions (Up Next, the weekday theme, the dial cadence, the Work
// lane); Next up, the fixed daily order and the Slipping strip come in later
// steps. The assistant sees hard dates and Files only, with no dollars.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase, isDemoMode } from '../lib/supabase'
import { useBusiness } from '../context/BusinessContext'
import { usePriorityQueue } from '../lib/usePriorityQueue'
import { useWorkLane } from '../lib/useWorkLane'
import { buildWorkGroups, workProgress } from '../lib/workbench'
import { buildAlerts } from '../lib/alerts'
import AlertsRail from '../components/AlertsRail'
import WorkLane from '../components/WorkLane'
import AddWorkItem from '../components/AddWorkItem'
import VoiceTask from '../components/VoiceTask'
import { SyncDot } from '../components/PageHeader'
import Priority from './Priority'
import { useDialList } from '../lib/useDialList'
import { useLoanAgents } from '../lib/loanAgents'
import { buildDialList } from '../lib/dialList'
import { buildThemeList } from '../lib/dialThemes'
import ThemeList from '../components/ThemeList'
import { CallBox } from '../components/CallSection'
import DialList from '../components/DialList'
import Dialer from '../components/Dialer'
import { useLeadRatings } from '../lib/useLeadRatings'
import { withRatings } from '../lib/leadRatings'
import { useAuth } from '../context/AuthContext'
import { workLists, freshLead, isRealtorTheme } from '../lib/workLists'
import { valueIndex, atRisk, itemValue } from '../lib/workValue'
import { pickNext, nextUpModel } from '../lib/workNext'
import { saveWorkItem } from '../lib/workItems'
import { localDateKey } from '../lib/crmActions'
import NextUpCard from '../components/NextUpCard'
import { hardDates, shortDay } from '../lib/bookFlags'
import { useForecast } from '../lib/useForecastInputs'
import { forecastLayers, monthKeyOf } from '../lib/forecast'
import { targetsFor } from '../lib/reports'
import { noteFacts } from '../lib/noteFacts'
import { openPerson } from '../components/PersonSheet'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const money = (n) => `$${Math.round(Number(n || 0)).toLocaleString('en-US')}`

// The Bayway commission target from Reports' saved targets.
function useCommissionTarget() {
  const [target, setTarget] = useState(() => targetsFor(null, 'bay').rev_gross_commission)
  useEffect(() => {
    if (isDemoMode) return
    let live = true
    supabase
      .from('settings')
      .select('value')
      .eq('key', 'metric_targets')
      .maybeSingle()
      .then(({ data }) => live && setTarget(targetsFor(data?.value, 'bay').rev_gross_commission))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])
  return target
}

// ---- Pieces -----------------------------------------------------------------------

function NewLeadBanner({ lead, now, onCall }) {
  if (!lead) return null
  const mins = Math.max(0, Math.round((now - lead.dueAt) / 60_000))
  const row = lead.row || {}
  const facts = noteFacts(row.first_note || '').facts
  const fact = (k) => facts.find((f) => f.k === k)?.v
  const extra = [row.source, fact('Loan type'), fact('State'), fact('Amount')].filter(Boolean).join(' · ')
  return (
    <section
      aria-label="New lead"
      data-new-lead={lead.id}
      className="flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3"
      style={{ borderColor: 'var(--warn-line)', background: 'var(--warn-bg)' }}
    >
      <span className="rounded-md px-2 py-1 text-caption font-bold text-white" style={{ background: 'var(--warn-ink)' }}>
        New lead · {mins} min
      </span>
      <span className="min-w-0 flex-1 text-body" style={{ color: 'var(--warn-ink)' }}>
        <b className="font-semibold">{row.name || 'New lead'}</b>
        {extra && ` · ${extra}`}. Call inside 30 minutes.
      </span>
      <button type="button" onClick={onCall} className="min-h-[44px] rounded-lg px-4 text-body font-semibold text-white" style={{ background: 'var(--warn-ink)' }}>
        Call now
      </button>
    </section>
  )
}

const HARD_TEXT = {
  cd: (h) => `closing disclosure due ${h.days < 0 ? `(was ${shortDay(h.on)})` : shortDay(h.on)}, 3 business days before closing`,
  lock: (h) => (h.days < 0 ? `rate lock expired ${shortDay(h.on)}` : `rate lock ends ${shortDay(h.on)}`),
}

function HardDates({ items, loansById }) {
  if (!items.length) return null
  return (
    <section aria-label="Hard dates" className="cc-card overflow-hidden">
      <div className="flex flex-wrap items-baseline gap-2 border-b border-line px-4 py-3">
        <h2 className="text-ui font-bold">Hard dates</h2>
        <span className="text-body text-muted">Pinned above everything, whatever the dollars</span>
      </div>
      {items.map((h) => {
        const contactId = loansById.get(h.loanId)?.contact_id
        const label = h.days < 0 ? 'Overdue' : h.days === 0 ? 'Today' : h.days < 7 ? `Due ${shortDay(h.on)}` : shortDay(h.on)
        return (
          <div key={`${h.kind}:${h.loanId}`} data-hard-date={h.kind} className="flex items-center gap-3 border-b border-hoverbg px-4 py-2.5 last:border-b-0">
            <span className="w-[76px] flex-none text-caption font-bold" style={{ color: h.days <= 3 ? 'var(--neg-ink)' : 'var(--muted)' }}>
              {label}
            </span>
            <span className="min-w-0 flex-1 text-body">
              <b className="font-semibold">{h.name}</b> · {HARD_TEXT[h.kind](h)}
            </span>
            {contactId && (
              <button type="button" onClick={() => openPerson(contactId)} className="min-h-[36px] flex-none rounded-lg border border-line2 px-3 text-body font-semibold">
                Open
              </button>
            )}
          </div>
        )
      })}
    </section>
  )
}

// One work list as a card: name, count, one line, the start button, then the rows.
function ListCard({ list, action, children, refFn, empty }) {
  return (
    <section ref={refFn} id={`list-${list.key}`} aria-label={list.label} data-list={list.key} className="cc-card flex min-w-0 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-panel2 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lead font-semibold">
            {list.label} <span className="num font-medium text-muted">· {list.count}</span>
            {list.flagged > 0 && <span className="ml-2 text-body font-semibold" style={{ color: 'var(--warn-ink)' }}>{list.flagged} flagged</span>}
          </h2>
          <div className="text-body text-muted">{list.sub}</div>
        </div>
        {action}
      </div>
      {list.count === 0 && empty ? <div className="px-4 py-6 text-center text-body text-muted">{empty}</div> : children}
    </section>
  )
}

function StartButton({ onClick, children }) {
  return (
    <button type="button" data-list-start onClick={onClick} className="min-h-[38px] flex-none rounded-lg px-3.5 text-body font-semibold text-white" style={{ background: 'var(--chrome)' }}>
      {children}
    </button>
  )
}

function SidePanel({ gap, monthLabel, risk, counts }) {
  return (
    <aside aria-label="Today" className="flex min-w-0 flex-col gap-3">
      {gap != null && (
        <Link to="/#forecast" data-gap className="cc-card flex items-center gap-3 px-4 py-3.5 hover:bg-hoverbg">
          <div className="min-w-0 flex-1">
            <div className="text-body text-muted">{monthLabel} · Bayway</div>
            <div className="text-lead font-bold">{gap > 0 ? `Gap to goal ${money(gap)}` : 'Goal covered'}</div>
          </div>
          <span className="flex-none text-body font-semibold text-[color:var(--chrome)]">Forecast on Overview →</span>
        </Link>
      )}
      {risk.count > 0 && (
        <div data-at-risk className="cc-card flex items-center gap-3 px-4 py-3">
          <span className="rounded-md px-2 py-0.5 text-caption font-semibold" style={{ background: 'var(--warn-bg)', color: 'var(--warn-ink)' }}>
            At risk
          </span>
          <span className="min-w-0 flex-1 text-body text-muted">
            {risk.count} {risk.count === 1 ? 'item' : 'items'} flagged in today&apos;s lists
          </span>
          {risk.amount > 0 && <span className="num text-ui font-bold">~{money(risk.amount)}</span>}
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        {counts.map((c) => (
          <div key={c.label} data-today-count={c.key} className="cc-card px-3 py-2.5">
            <div className="text-caption text-muted">{c.label}</div>
            <div className="num text-lead font-bold">{c.value}</div>
          </div>
        ))}
      </div>
      <p className="text-caption text-muted">No set times: work the lists in whatever order the day allows.</p>
    </aside>
  )
}

// ---- Page ------------------------------------------------------------------------

export default function Workbench() {
  const { biz } = useBusiness() || { biz: 'all' }
  const { queue, signals, rules, touchedToday } = usePriorityQueue(biz)
  const work = useWorkLane()
  const { role } = useAuth() || {}
  const assistant = role === 'assistant'
  const [adding, setAdding] = useState(false)
  const dial = useDialList()
  const [dialRun, setDialRun] = useState(null)
  const [themeDay, setThemeDay] = useState(null)
  const forecast = useForecast()
  const target = useCommissionTarget()
  const [params] = useSearchParams()
  const cards = useRef({})

  const cap = rules.daily_cap || 15
  const inBook = (book) => biz === 'all' || book === biz
  const now = dial.now || Date.now()
  const ratings = useLeadRatings()
  const dialRows = useMemo(() => withRatings(dial.rows, ratings), [dial.rows, ratings])
  const dialDue = buildDialList(dialRows, { now, skips: dial.skips, inBook })
  const dialItems = [...dialDue.dueNow, ...dialDue.laterToday]
  // Today's theme feeds the lists; the picker previews another weekday in place.
  const themeToday = buildThemeList(dial.rows, { now, skips: dial.skips, inBook })
  const themeShown = themeDay == null ? themeToday : buildThemeList(dial.rows, { now, day: themeDay, skips: dial.skips, inBook })
  const themeInPartners = isRealtorTheme(themeShown.theme)
  const listIds = new Set([...dialItems, ...themeToday.items].map((i) => i.id))
  const loanAgents = useLoanAgents((dialRun ? dialRun.items : themeShown.items).filter((i) => i.kind === 'loan_status').map((i) => i.id))
  const groups = buildWorkGroups({ pipeline: work.pipeline, mpgTasks: work.tasks, workItems: work.workItems, rules, now })
    .filter((g) => g.book == null || inBook(g.book))
    .map((g) => ({ ...g, items: g.items.filter((it) => inBook(it.book)) }))
  // A call snoozed with Not today leaves the Up Next rows too.
  const lists = workLists({ dial: dialDue, groups, theme: themeToday, queue: queue.filter((r) => !dial.skips.has(r.id)), now })
  const [calls, files, partners] = lists
  const openWork = files.count
  const progress = workProgress(work.workItems.filter((w) => inBook(w.business_id)), openWork, now)
  const alerts = buildAlerts({ queue, signals, pipeline: work.pipeline, tasks: work.tasks, workItems: work.workItems, rules, inBook, now })
  const lead = assistant ? null : freshLead(dialDue, now)

  const loans = forecast.loans || []
  const loansById = useMemo(() => new Map(loans.map((l) => [l.id, l])), [loans])
  const hard = biz === 'mpg' ? [] : hardDates(loans, now)
  const index = useMemo(() => valueIndex(forecast), [forecast])
  const risk = atRisk(lists, index)
  const layers = forecastLayers(forecast.lines, monthKeyOf(now))
  const gap = biz === 'mpg' || forecast.loading ? null : target - (layers.funded + layers.closing + layers.leadsLow)
  const d = new Date(now)

  // ---- Next up: the first open item of the list being worked (workNext.js).
  const [activeList, setActiveList] = useState('calls')
  const [passed, setPassed] = useState(() => new Set())
  const [undo, setUndo] = useState([])
  const [logging, setLogging] = useState(false)
  const pick = assistant ? null : pickNext(lists, activeList, passed)
  const loanByContact = useMemo(() => {
    const m = new Map()
    for (const l of loans) if (l.contact_id && ['prospect', 'processing', 'closing'].includes(l.stage_group)) m.set(l.contact_id, l)
    return m
  }, [loans])
  const nextItem = pick?.item
  const model = nextItem ? nextUpModel(nextItem, { loan: loanByContact.get(nextItem.contactId ?? nextItem.id) || null }) : null
  const value = nextItem ? itemValue(nextItem, index) : null
  const pass = (key) => setPassed((s) => new Set([...s, key]))
  const nextDone = () => {
    if (!model) return
    if (model.kind === 'call') return setLogging(true)
    const row = document.querySelector(`[data-work-item="${CSS.escape(model.key)}"]`)
    row?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    row?.querySelector('button')?.focus()
  }
  const nextSnooze = async () => {
    if (!model) return
    if (model.kind === 'call') {
      setUndo((u) => [...u, { type: 'skip', contactId: model.contactId }])
      await dial.skipToday(model.contactId)
    } else {
      setUndo((u) => [...u, { type: 'file', item: nextItem }])
      await saveWorkItem(nextItem, { status: 'waiting', check_back_on: localDateKey(new Date(Date.now() + 86_400_000)) })
      work.reload()
    }
  }
  const nextPass = () => {
    if (!model) return
    setUndo((u) => [...u, { type: 'pass', key: model.key }])
    pass(model.key)
  }
  const undoLast = async () => {
    const last = undo.at(-1)
    if (!last) return
    setUndo((u) => u.slice(0, -1))
    if (last.type === 'pass') setPassed((s) => new Set([...s].filter((k) => k !== last.key)))
    if (last.type === 'skip') await dial.unskip(last.contactId)
    if (last.type === 'file') {
      await saveWorkItem(last.item, { status: 'open' })
      work.reload()
    }
  }
  // Shift+D done, Shift+S snooze, J next, Z undo; never while typing or with a sheet open.
  const keys = useRef({})
  keys.current = { nextDone, nextSnooze, nextPass, undoLast }
  useEffect(() => {
    if (assistant) return
    const onKey = (e) => {
      const t = e.target
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (t?.closest?.('input, textarea, select, [contenteditable="true"]') || document.querySelector('[role="dialog"]')) return
      const k = e.key.toLowerCase()
      if (e.shiftKey && k === 'd') keys.current.nextDone()
      else if (e.shiftKey && k === 's') keys.current.nextSnooze()
      else if (!e.shiftKey && k === 'j') keys.current.nextPass()
      else if (!e.shiftKey && k === 'z') keys.current.undoLast()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [assistant])

  // ?list=calls|files|partners (Overview's Start buttons) scrolls to that list.
  const wanted = params.get('list')
  useEffect(() => {
    if (['calls', 'files', 'partners'].includes(wanted)) setActiveList(wanted)
    const el = wanted && cards.current[wanted]
    if (el?.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [wanted])
  // Starting a list makes it the one Next up works through.
  const startList = (key, run) => {
    setActiveList(key)
    if (run) setDialRun(run)
  }

  const themeBox = (
    <CallBox>
      <ThemeList list={themeShown} pickedDay={themeDay} onPickDay={setThemeDay} onDial={(i) => setDialRun({ items: themeShown.items, start: i })} agents={loanAgents.byContact} agentsChecked={loanAgents.checked} />
    </CallBox>
  )
  const callsDialable = [...(themeInPartners ? [] : themeShown.items), ...dialItems]

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <h1 className="text-title font-semibold tracking-[-0.6px]">Workbench</h1>
        <span className="text-body text-muted">
          {DAYS[d.getDay()]}, {MONTHS[d.getMonth()].slice(0, 3)} {d.getDate()}
        </span>
        <SyncDot />
        <div className="ml-auto flex gap-2">
          {/* Priority Leads (FUB score tiers) left the nav; it opens from here. */}
          {!assistant && biz !== 'mpg' && (
            <Link to="/bayway/priority-leads" className="flex min-h-[38px] items-center rounded-lg border border-line2 px-3.5 text-body font-semibold text-ink2 hover:bg-hoverbg">
              Priority Leads
            </Link>
          )}
          <VoiceTask defaultBook={biz === 'mpg' ? 'mpg' : 'bay'} onAdded={work.reload} />
          <button type="button" onClick={() => setAdding(true)} className="min-h-[38px] rounded-lg border border-line2 px-3.5 text-body font-semibold text-ink2">
            + Work item
          </button>
        </div>
      </header>

      <NewLeadBanner lead={lead} now={now} onCall={() => setDialRun({ items: [lead], start: 0 })} />
      <HardDates items={hard} loansById={loansById} />
      <AlertsRail alerts={alerts} showBook={biz === 'all'} />

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          {!assistant && (
            <NextUpCard
              pick={pick}
              model={model}
              value={value}
              logging={logging}
              onDone={nextDone}
              onLogged={() => model && pass(model.key)}
              onLogClose={() => setLogging(false)}
              onSnooze={nextSnooze}
              onNext={nextPass}
              onUndo={undoLast}
              canUndo={undo.length > 0}
            />
          )}
          {!assistant && (
            <ListCard
              list={calls}
              refFn={(el) => (cards.current.calls = el)}
              action={callsDialable.length > 0 && <StartButton onClick={() => startList('calls', { items: callsDialable, start: 0 })}>Start dialer</StartButton>}
            >
              {dial.error && <div className="m-3 rounded-lg border border-neg-line bg-neg-bg px-3 py-2 text-xs text-neg-ink">{dial.error}</div>}
              <div className="flex flex-col gap-3 p-3">
                <CallBox>
                  <Priority embedded section hideIds={listIds} buckets={['reached_out']} />
                </CallBox>
                {!themeInPartners && themeBox}
                <CallBox>
                  <Priority embedded section hideIds={listIds} buckets={['overdue']} />
                </CallBox>
                <CallBox>
                  <DialList dueNow={dialDue.dueNow} laterToday={dialDue.laterToday} now={now} onDial={(i) => setDialRun({ items: dialItems, start: i })} />
                </CallBox>
              </div>
            </ListCard>
          )}

          <ListCard
            list={files}
            refFn={(el) => (cards.current.files = el)}
            action={!assistant && files.count > 0 && activeList !== 'files' && <StartButton onClick={() => startList('files')}>Work files next</StartButton>}
          >
            {work.error && <div className="m-3 rounded-lg border border-neg-line bg-neg-bg px-3 py-2 text-xs text-neg-ink">{work.error}</div>}
            <WorkLane groups={groups} onChanged={work.reload} />
          </ListCard>

          {!assistant && (
            <ListCard
              list={partners}
              refFn={(el) => (cards.current.partners = el)}
              action={themeInPartners && themeShown.items.length > 0 && <StartButton onClick={() => startList('partners', { items: themeShown.items, start: 0 })}>Start dialer</StartButton>}
            >
              {themeInPartners ? <div className="p-3">{themeBox}</div> : <div className="px-4 py-4 text-body text-muted">{partners.sub}</div>}
            </ListCard>
          )}
        </div>

        {!assistant && (
          <SidePanel
            gap={gap}
            monthLabel={MONTHS[d.getMonth()]}
            risk={risk}
            counts={[
              { key: 'calls', label: 'Calls', value: `${touchedToday} / ${cap}` },
              { key: 'files', label: 'Files', value: `${progress.done} / ${progress.total}` },
              { key: 'partners', label: 'Partners', value: themeInPartners || partners.count ? `${partners.count} left` : '—' },
            ]}
          />
        )}
      </div>

      {dialRun && (
        <Dialer
          items={dialRun.items}
          start={dialRun.start}
          skipToday={dial.skipToday}
          agents={loanAgents.byContact}
          agentsChecked={loanAgents.checked}
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
