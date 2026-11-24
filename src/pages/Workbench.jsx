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
import { buildWorkGroups, workProgress, assistantOrder } from '../lib/workbench'
import { buildAlerts } from '../lib/alerts'
import AlertsRail from '../components/AlertsRail'
import { useWorkbenchDay } from '../lib/useWorkbenchDay'
import { applyDayOrder, itemName } from '../lib/dayOrder'
import { BUCKET_LABEL } from '../lib/priorityQueue'
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
import { pickNext, nextUpModel, itemKey } from '../lib/workNext'
import { saveWorkItem } from '../lib/workItems'
import { buildWrap, movedToday, wrapDue } from '../lib/dayWrap'
import { Sheet, quickActionTone } from '../components/QuickActions'
import { showToast } from '../components/Toaster'
import { localDateKey } from '../lib/crmActions'
import NextUpCard from '../components/NextUpCard'
import { hardDates, hardDateTask, shortDay } from '../lib/bookFlags'
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

// The assistant reads loans through workbench_hard_dates (migration 0078):
// loans is owner-only, and she needs only the dates.
function useAssistantHardDateLoans(on) {
  const [rows, setRows] = useState([])
  useEffect(() => {
    if (!on || isDemoMode) return
    let live = true
    Promise.resolve(supabase.rpc('workbench_hard_dates'))
      .then((res) => live && setRows(res?.error ? [] : res?.data || []))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [on])
  return rows
}

function HardDates({ items, loansById, assistant = false }) {
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
              <b className="font-semibold">{h.name}</b> · {assistant ? hardDateTask(h) : HARD_TEXT[h.kind](h)}
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

const clock = (iso) => {
  const d = new Date(iso)
  const h = d.getHours() % 12 || 12
  return `${h}:${String(d.getMinutes()).padStart(2, '0')}`
}

// Items that arrived after the day's order was set (§7).
function NewSinceStrip({ items, setAt, onPullIn }) {
  if (!items.length) return null
  const names = items.slice(0, 4).map((n) => itemName(n.item))
  return (
    <section aria-label="New since" data-new-since className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-line2 bg-panel px-4 py-3">
      <span className="text-ui font-semibold">
        New since {clock(setAt)} · {items.length}
      </span>
      {/* Phone: title and Pull in on one line, the names full width below. */}
      <span className="order-last min-w-0 basis-full text-body text-muted sm:order-none sm:basis-0 sm:flex-1">
        {names.join(' · ')}
        {items.length > names.length && ` · +${items.length - names.length} more`}. They wait here until you pull them in.
      </span>
      <button type="button" onClick={onPullIn} className="ml-auto min-h-[38px] rounded-lg border border-line2 bg-panel px-3 text-body font-semibold hover:bg-hoverbg">
        Pull in
      </button>
    </section>
  )
}

// Waiting work and cold leads, by reason (§7). Each returns on its check-back day.
function ParkedStrip({ waiting, cold }) {
  const by = new Map()
  for (const it of waiting) by.set(it.waitingOn || 'others', (by.get(it.waitingOn || 'others') || 0) + 1)
  const total = waiting.length + cold
  if (!total) return null
  const parts = [...[...by].map(([who, n]) => `waiting on ${who.toLowerCase()} ${n}`), cold && `cold leads ${cold}`].filter(Boolean)
  return (
    <section aria-label="Parked" data-parked className="flex flex-wrap items-center gap-2.5 rounded-xl bg-panel2 px-4 py-3">
      <span className="text-ui font-semibold">Parked · {total}</span>
      <span className="text-body text-muted">{parts.join(' · ')} · each returns on its check-back day</span>
    </section>
  )
}

const SLIP_BUCKETS = ['hot_cold', 'no_next_step', 'stuck', 'quiet']

// Decision 3: the alerts rail and Up Next's slipping groups, collapsed into one strip.
function SlippingStrip({ alerts, slipping, showBook, hideIds }) {
  const groups = [...alerts.map((a) => ({ id: a.id, label: a.title, count: a.count })), ...slipping]
  const total = groups.reduce((n, g) => n + g.count, 0)
  if (!total) return null
  return (
    <details aria-label="Slipping" data-slipping className="group cc-card overflow-hidden">
      <summary className="flex min-h-[48px] cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="text-ui font-semibold">Slipping · {total}</span>
        <span className="order-last min-w-0 basis-full text-body text-muted sm:order-none sm:basis-0 sm:flex-1">{groups.filter((g) => g.count).map((g) => `${g.label} ${g.count}`).join(' · ')}</span>
        <span aria-hidden="true" className="ml-auto text-caption text-muted transition-transform group-open:rotate-180">▾</span>
      </summary>
      <div className="flex flex-col gap-3 border-t border-line p-3">
        <AlertsRail alerts={alerts} showBook={showBook} />
        {slipping.some((g) => g.count) && (
          <CallBox>
            <Priority embedded hideIds={hideIds} buckets={SLIP_BUCKETS} />
          </CallBox>
        )}
      </div>
    </details>
  )
}

// The end-of-day wrap (§14): today's counts, what moved, the month's gap
// against this morning, what rolls to tomorrow, and a look at tomorrow.
function WrapSheet({ model, closedAt, canClose, onClose, onCloseDay }) {
  const [busy, setBusy] = useState(false)
  const g = model.gap
  return (
    <Sheet title={`${DAYS[new Date().getDay()]} wrap`} subtitle={closedAt ? `Day closed at ${clock(closedAt)}` : 'Close the day when you are done'} t={quickActionTone('bay')} onClose={onClose}>
      <div data-wrap className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {model.counts.map((c) => (
            <div key={c.key} data-wrap-count={c.key} className="rounded-lg border border-line px-3 py-2">
              <div className="text-caption text-muted">{c.label}</div>
              <div className="num text-lead font-bold">{c.done == null ? c.total : `${c.done} / ${c.total}`}</div>
              <div className="text-caption text-muted">{c.note}</div>
            </div>
          ))}
        </div>

        <section aria-label="Moved a stage today">
          <div className="mb-1.5 text-caption font-semibold text-muted">Moved a stage today · {model.moved.length}</div>
          {model.moved.length === 0 && <div className="text-body text-muted">Nobody changed stage today.</div>}
          {model.moved.map((m) => (
            <div key={m.id} className="flex gap-2 border-b border-hoverbg py-1.5 text-body last:border-b-0">
              <span className="min-w-0 flex-1 truncate">
                <b className="font-semibold">{m.name}</b> · now {m.stage}
              </span>
              {m.value && <span className="num font-semibold">{m.value}</span>}
            </div>
          ))}
        </section>

        {g.now != null && (
          <div data-wrap-gap className="rounded-lg bg-panel2 px-3 py-2 text-body">
            {g.now > 0 ? `Gap to goal ${money(g.now)}` : 'Goal covered'}
            {g.morning != null && g.morning !== g.now && <span className="text-muted"> · was {g.morning > 0 ? money(g.morning) : 'covered'} this morning</span>}
          </div>
        )}

        <section aria-label="Rolled to tomorrow">
          <div className="mb-1.5 text-caption font-semibold text-muted">Rolled to tomorrow · {model.rolled.length} · they go first in their list</div>
          {model.rolled.length === 0 && <div className="text-body text-muted">Everything got done.</div>}
          {model.rolled.slice(0, 8).map((r) => (
            <div key={r.key} className="flex gap-2 border-b border-hoverbg py-1.5 text-body last:border-b-0">
              <span className="min-w-0 flex-1 truncate font-semibold">{r.name}</span>
              <span className="text-muted">{r.list}</span>
            </div>
          ))}
          {model.rolled.length > 8 && <div className="pt-1 text-caption text-muted">+{model.rolled.length - 8} more</div>}
        </section>

        <section aria-label="Tomorrow" className="rounded-lg bg-[#14171F] px-4 py-3 text-white">
          <div className="text-ui font-bold">{model.tomorrow.weekday || 'Tomorrow'}</div>
          <div className="mt-1 text-body text-[#DDE1E8]">
            {model.tomorrow.theme ? `${model.tomorrow.theme} day. ` : ''}
            {model.tomorrow.rolled ? `${model.tomorrow.rolled} rolled over` : 'Nothing rolled over'}
            {model.tomorrow.first.length ? `; first up: ${model.tomorrow.first.join(', then ')}.` : '.'}
          </div>
        </section>

        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="min-h-[44px] flex-1 rounded-lg border border-line2 text-body font-semibold">
            Back to Workbench
          </button>
          <button
            type="button"
            disabled={busy || !canClose}
            onClick={async () => {
              setBusy(true)
              await onCloseDay(model)
              setBusy(false)
            }}
            className="min-h-[44px] flex-1 rounded-lg text-body font-semibold text-white disabled:opacity-50"
            style={{ background: 'var(--text)' }}
          >
            {closedAt ? 'Close the day again' : 'Close the day'}
          </button>
        </div>
        {!canClose && <div className="text-caption text-muted">The day&apos;s order isn&apos;t saved yet, so there&apos;s nothing to close.</div>}
      </div>
    </Sheet>
  )
}

// ---- Page ------------------------------------------------------------------------

export default function Workbench() {
  const { biz } = useBusiness() || { biz: 'all' }
  const { queue, signals, rules, touchedToday, loading: queueLoading } = usePriorityQueue(biz)
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
  const built = workLists({ dial: dialDue, groups, theme: themeToday, queue: queue.filter((r) => !dial.skips.has(r.id)), now })
  // The day's order (decision 1): saved on the first load after 6 AM, held all day.
  const layers = forecastLayers(forecast.lines, monthKeyOf(now))
  const gap = biz === 'mpg' || forecast.loading ? null : target - (layers.funded + layers.closing + layers.leadsLow)
  // Wait for the forecast too, so the morning gap is saved with the order.
  const ready = !dial.loading && !work.loading && !queueLoading && !forecast.loading && !dial.error && !work.error
  const day = useWorkbenchDay({ lists: built, ready, create: !assistant, morning: gap != null ? { gap } : null })
  const { lists, newSince } = applyDayOrder(built, day.saved)
  const [calls, files, partners] = lists
  // The rows each card draws follow the same order: New since items stay out,
  // the rest sort by their place in the day's order.
  const waitingKeys = new Set(newSince.map((n) => n.key))
  const placeOf = new Map(lists.flatMap((l) => l.items.map((it, i) => [itemKey(it), i])))
  const inDay = (items) => items.filter((it) => !waitingKeys.has(itemKey(it))).sort((a, b) => (placeOf.get(itemKey(a)) ?? 1e9) - (placeOf.get(itemKey(b)) ?? 1e9))
  const dialShown = { dueNow: inDay(dialDue.dueNow), laterToday: dialDue.laterToday.filter((it) => !waitingKeys.has(itemKey(it))) }
  const hideInCalls = new Set([...listIds, ...newSince.filter((n) => !n.item.key).map((n) => n.item.id)])
  const groupsShown = groups.map((g) => (g.id === 'waiting' ? g : { ...g, items: inDay(g.items) }))
  // The assistant's Files (§13): one list by deadline then age, and the waiting bar.
  const assistantGroups = [
    { id: 'files', title: 'Files', book: null, items: assistantOrder(groups) },
    groups.find((g) => g.id === 'waiting') || { id: 'waiting', title: 'Waiting on others', book: null, items: [] },
  ]
  const openWork = files.count
  const progress = workProgress(work.workItems.filter((w) => inBook(w.business_id)), openWork, now)
  const alerts = buildAlerts({ queue, signals, pipeline: work.pipeline, tasks: work.tasks, workItems: work.workItems, rules, inBook, now })
  const lead = assistant ? null : freshLead(dialDue, now)
  // Parked leads (Nurture / Credit Repair) and Up Next's slipping groups, for the strips.
  const coldLeads = (dial.rows || []).filter((r) => r.business_id === 'bay' && r.stage === 'Nurture / Credit Repair' && inBook('bay') && !listIds.has(r.id)).length
  const slipping = SLIP_BUCKETS.map((b) => ({ id: b, label: BUCKET_LABEL[b], count: queue.filter((r) => r.bucket === b && !listIds.has(r.id)).length }))

  const assistantLoans = useAssistantHardDateLoans(assistant)
  const loans = assistant ? assistantLoans : forecast.loans || []
  const loansById = useMemo(() => new Map(loans.map((l) => [l.id, l])), [loans])
  const hard = biz === 'mpg' ? [] : hardDates(loans, now)
  const index = useMemo(() => valueIndex(forecast), [forecast])
  const risk = atRisk(lists, index)
  const [wrapping, setWrapping] = useState(false)
  const wrapModel = wrapping
    ? buildWrap({
        saved: day.saved,
        lists,
        filesDone: progress.done,
        callsLogged: touchedToday,
        moved: movedToday([...(dial.rows || []), ...(work.pipeline || [])], { now, valueOf: (id) => itemValue({ id }, index) }),
        hardOpen: hard.length,
        gapNow: gap,
        now,
      })
    : null
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
  // The open file (§11): Next up's Open file, Start first file, or a row's Open.
  const [openFile, setOpenFile] = useState(null)
  const nextDone = () => {
    if (!model) return
    if (model.kind === 'call') return setLogging(true)
    setOpenFile(model.key)
  }
  const fileInfo = (item) => {
    const loan = item.contactId ? loanByContact.get(item.contactId) || null : null
    return { loan, value: itemValue(item, index) }
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

  const themeDrawn = themeDay == null ? { ...themeShown, items: inDay(themeShown.items) } : themeShown
  const dialDrawn = [...dialShown.dueNow, ...dialShown.laterToday]
  const themeBox = (
    <CallBox>
      <ThemeList list={themeDrawn} pickedDay={themeDay} onPickDay={setThemeDay} onDial={(i) => setDialRun({ items: themeDrawn.items, start: i })} agents={loanAgents.byContact} agentsChecked={loanAgents.checked} />
    </CallBox>
  )
  const callsDialable = [...(themeInPartners ? [] : themeDrawn.items), ...dialDrawn]

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <h1 className="text-title font-semibold tracking-[-0.6px]">Workbench</h1>
        <span className="text-body text-muted">
          {DAYS[d.getDay()]}, {MONTHS[d.getMonth()].slice(0, 3)} {d.getDate()}
          {assistant ? <span data-assistant-view> · Assistant view, sorted by deadline, then age</span> : day.saved?.set_at && <span data-order-set> · order set at {clock(day.saved.set_at)}</span>}
        </span>
        <SyncDot />
        <div className="ml-auto flex gap-2">
          {/* Priority Leads (FUB score tiers) left the nav; it opens from here. */}
          {!assistant && biz !== 'mpg' && (
            <Link to="/bayway/priority-leads" className="flex min-h-[38px] items-center rounded-lg border border-line2 px-3.5 text-body font-semibold text-ink2 hover:bg-hoverbg">
              Priority Leads
            </Link>
          )}
          {!assistant && (
            <button
              type="button"
              data-wrap-open
              onClick={() => setWrapping(true)}
              className={`min-h-[38px] rounded-lg px-3.5 text-body font-semibold ${wrapDue(lists, now) && !day.saved?.closed_at ? 'text-white' : 'border border-line2 text-ink2'}`}
              style={wrapDue(lists, now) && !day.saved?.closed_at ? { background: 'var(--chrome)' } : undefined}
            >
              {day.saved?.closed_at ? 'Day closed' : 'Wrap up the day'}
            </button>
          )}
          <VoiceTask defaultBook={biz === 'mpg' ? 'mpg' : 'bay'} onAdded={work.reload} />
          <button type="button" onClick={() => setAdding(true)} className="min-h-[38px] rounded-lg border border-line2 px-3.5 text-body font-semibold text-ink2">
            + Work item
          </button>
        </div>
      </header>

      <NewLeadBanner lead={lead} now={now} onCall={() => setDialRun({ items: [lead], start: 0 })} />
      <HardDates items={hard} loansById={loansById} assistant={assistant} />

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
                  <Priority embedded section hideIds={hideInCalls} buckets={['reached_out']} />
                </CallBox>
                {!themeInPartners && themeBox}
                <CallBox>
                  <Priority embedded section hideIds={hideInCalls} buckets={['overdue']} />
                </CallBox>
                <CallBox>
                  <DialList dueNow={dialShown.dueNow} laterToday={dialShown.laterToday} now={now} onDial={(i) => setDialRun({ items: dialDrawn, start: i })} />
                </CallBox>
              </div>
            </ListCard>
          )}

          <ListCard
            list={files}
            refFn={(el) => (cards.current.files = el)}
            action={files.count > 0 && <StartButton onClick={() => { startList('files'); setOpenFile(files.items[0].key) }}>Start first file</StartButton>}
          >
            {work.error && <div className="m-3 rounded-lg border border-neg-line bg-neg-bg px-3 py-2 text-xs text-neg-ink">{work.error}</div>}
            <WorkLane groups={assistant ? assistantGroups : groupsShown} onChanged={work.reload} info={fileInfo} openKey={openFile} onOpenKey={setOpenFile} order={assistant ? assistantGroups[0].items : files.items} />
          </ListCard>

          {!assistant && (
            <ListCard
              list={partners}
              refFn={(el) => (cards.current.partners = el)}
              action={themeInPartners && themeDrawn.items.length > 0 && <StartButton onClick={() => startList('partners', { items: themeDrawn.items, start: 0 })}>Start dialer</StartButton>}
            >
              {themeInPartners ? <div className="p-3">{themeBox}</div> : <div className="px-4 py-4 text-body text-muted">{partners.sub}</div>}
            </ListCard>
          )}

          {!assistant && day.saved && <NewSinceStrip items={newSince} setAt={day.saved.set_at} onPullIn={() => day.pullIn(newSince.map((n) => n.key))} />}
          {!assistant && <ParkedStrip waiting={groups.find((g) => g.id === 'waiting')?.items || []} cold={coldLeads} />}
          {!assistant && <SlippingStrip alerts={alerts} slipping={slipping} showBook={biz === 'all'} hideIds={listIds} />}
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
      {wrapping && wrapModel && (
        <WrapSheet
          model={wrapModel}
          closedAt={day.saved?.closed_at || null}
          canClose={!!day.saved}
          onClose={() => setWrapping(false)}
          onCloseDay={async (m) => {
            const { error } = await day.closeDay(m)
            if (error) showToast({ tone: 'error', text: `Couldn't close the day: ${error.message}` })
            else {
              showToast({ tone: 'ok', text: 'Day closed. Unfinished items go first tomorrow.' })
              setWrapping(false)
            }
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
