// One Up Next row, shared by the Priority page and the Overview card.
// Mobile first: under 640px the whole row is a tel: link (tap = dial) and the
// actions live in a bottom sheet behind the ⋯ button. On wider screens the row
// is not a link and the actions sit inline.
// dense (the Workbench's Calls lane, 640px+): two lines (who and why; phone,
// stage and state) with the actions stacked beside them. Clicking the row opens
// a quick look: Details (the whole lead form, recent notes) and Tasks (the
// lead's open tasks, each completable or pushable), plus CRM link and Snooze.
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { refreshPriorityQueue } from '../lib/usePriorityQueue'
import { BUCKET_LABEL, reasonText, lastCallLabel } from '../lib/priorityQueue'
import { followUpDate } from '../lib/crmActions'
import { formatPhone, telHref } from '../lib/phone'
import { noteFacts } from '../lib/noteFacts'
import { useRecentNotes } from '../lib/contactNotes'
import { useContactTasks } from '../lib/useContactTasks'
import { stageProgress } from '../lib/pipeline'
import BizBadge from './BizBadge'
import { Pill } from './HealthPills'
import StageProgress from './StageProgress'
import ContactTasks, { PopupTabs, taskCount } from './ContactTasks'
import CrmLink from './CrmLink'
import Icon from './Icon'
import PersonLink from './PersonLink'
import { openPerson } from './PersonSheet'
import QuickActions from './QuickActions'
import { showToast } from './Toaster'

export function useIsMobile() {
  const query = '(max-width: 639px)'
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(query).matches)
  useEffect(() => {
    const mq = window.matchMedia?.(query)
    if (!mq) return undefined
    const on = () => setMobile(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return !!mobile
}

const SHORT = {
  reached_out: 'Reached out',
  new_lead: 'New lead',
  overdue: 'Overdue',
  hot_cold: 'Hot',
  no_next_step: 'No next step',
  stuck: 'Stuck',
  quiet: 'Quiet',
}
// The other reasons a lead is on the list, tinted like the board's health pills.
const TONE = {
  reached_out: 'neg',
  new_lead: 'neg',
  overdue: 'neg',
  stuck: 'neg',
  hot_cold: 'warn',
  no_next_step: 'warn',
  quiet: 'neutral',
}

function fmtDay(key) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

// Snooze is dashboard-only (lead_snoozes); it never touches the CRM.
function SnoozeForm({ row, onDone }) {
  const [preset, setPreset] = useState('tomorrow')
  const [picked, setPicked] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  let until = null
  try {
    until = followUpDate(preset, new Date(), picked)
  } catch {
    until = null
  }
  const save = async () => {
    if (!until || busy) return
    setBusy(true)
    setError(null)
    const { error: err } = await supabase
      .from('lead_snoozes')
      .insert({ contact_id: row.id, until_date: until, reason: reason.trim() || null })
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    showToast({ tone: 'ok', text: `Snoozed until ${fmtDay(until)}` })
    await refreshPriorityQueue()
    onDone?.()
  }
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {[
          ['tomorrow', 'Tomorrow'],
          ['nextMonday', 'Next Monday'],
          ['pick', 'Pick a date'],
        ].map(([k, label]) => (
          <button
            key={k}
            type="button"
            aria-pressed={preset === k}
            onClick={() => setPreset(k)}
            className="min-h-[40px] rounded-[10px] border px-3 text-[12.5px] font-semibold"
            style={preset === k ? { borderColor: 'var(--text)', color: 'var(--text)' } : { borderColor: 'var(--line2)', color: 'var(--muted)' }}
          >
            {label}
          </button>
        ))}
      </div>
      {preset === 'pick' && (
        <input
          type="date"
          aria-label="Snooze until"
          value={picked}
          onChange={(e) => setPicked(e.target.value)}
          className="mt-2 w-full rounded-[10px] border border-line2 bg-panel px-3 py-2 text-[13px]"
        />
      )}
      <input
        aria-label="Snooze reason"
        placeholder="Reason (optional), e.g. traveling until the 1st"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="mt-2 w-full rounded-[10px] border border-line2 bg-panel px-3 py-2 text-[13px]"
      />
      {error && <div className="mt-2 text-[12px] text-[color:var(--neg-ink)]">{error}</div>}
      <button
        type="button"
        disabled={!until || busy}
        onClick={save}
        className="mt-3 min-h-[42px] w-full rounded-[10px] bg-[color:var(--text)] text-[13.5px] font-bold text-white disabled:opacity-50"
      >
        {busy ? 'Saving…' : until ? `Snooze until ${fmtDay(until)}` : 'Snooze'}
      </button>
    </div>
  )
}

function ActionsSheet({ row, onClose }) {
  const [snoozing, setSnoozing] = useState(false)
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const tel = telHref(row.phone)
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={`Actions for ${row.name || 'lead'}`}
        className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl border border-line bg-panel p-5 sm:max-w-md sm:rounded-card"
        style={{ borderTop: `3px solid ${row.business_id === 'mpg' ? 'var(--mpg)' : 'var(--bay)'}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="break-words text-[15px] font-bold">{row.name || '(no name)'}</div>
            <div className="truncate text-[12px] text-muted">{reasonText(row)}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-10 w-10 place-items-center rounded-[10px] text-muted hover:bg-hoverbg">
            ✕
          </button>
        </div>
        {!snoozing ? (
          <div className="flex flex-col gap-2">
            {tel && (
              <a href={tel} className="flex min-h-[44px] items-center justify-center rounded-[10px] bg-[color:var(--text)] text-[14px] font-bold text-white">
                Call {formatPhone(row.phone)}
              </a>
            )}
            <div className="flex items-center justify-between rounded-[10px] border border-line px-2">
              <QuickActions
                businessId={row.business_id}
                contactId={row.id}
                contactName={row.name}
                hasPhone={!!row.phone}
                stage={row.business_id === 'bay' ? row.stage : null}
                onDone={() => {
                  refreshPriorityQueue()
                  onClose()
                }}
              />
              <CrmLink url={row.crm_profile_url} className="px-2 text-[12.5px] font-semibold text-muted">
                Open in CRM ↗
              </CrmLink>
            </div>
            <button type="button" onClick={() => setSnoozing(true)} className="min-h-[44px] rounded-[10px] border border-line2 text-[13.5px] font-semibold text-muted">
              Snooze…
            </button>
          </div>
        ) : (
          <SnoozeForm row={row} onDone={onClose} />
        )}
      </div>
    </div>
  )
}

const stop = (e) => e.stopPropagation()
const sourceOf = (row) => (row.lead_source && row.lead_source !== '<unspecified>' ? row.lead_source : null)
const urgentColor = (row) => (row.bucket === 'reached_out' || row.bucket === 'new_lead' ? 'var(--neg-ink)' : 'var(--text)')
const PEEK_W = 460

// Below the row when there's room, else above it; never off screen.
function peekStyle(rect) {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const left = Math.max(12, Math.min(rect.left + 24, vw - PEEK_W - 12))
  const below = vh - rect.bottom
  return below >= 380 || below >= rect.top
    ? { left, top: rect.bottom + 6, maxHeight: below - 18 }
    : { left, bottom: vh - rect.top + 6, maxHeight: rect.top - 18 }
}

function PeekHeading({ children }) {
  return <div className="mt-4 text-[11.5px] font-semibold uppercase tracking-[.4px] text-dim">{children}</div>
}

function LeadPeek({ row, rect, anchor, onClose }) {
  const ref = useRef(null)
  const [snoozing, setSnoozing] = useState(false)
  const [tab, setTab] = useState('details')
  const { notes, loading } = useRecentNotes(row.id, row.first_note)
  const tasks = useContactTasks(row.id)
  const { facts } = noteFacts(row.first_note)
  const tel = telHref(row.phone)
  const phone = formatPhone(row.phone)
  const others = row.reasons.filter((r) => r !== row.bucket)

  useEffect(() => {
    const inside = (e) => ref.current?.contains(e.target) || anchor.current?.contains(e.target)
    const onKey = (e) => e.key === 'Escape' && onClose()
    const onDown = (e) => !inside(e) && onClose()
    const onScroll = (e) => !ref.current?.contains(e.target) && onClose()
    window.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onClose)
    }
  }, [anchor, onClose])

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`${row.name || 'Lead'} details`}
      data-lead-peek
      onClick={stop}
      className="fixed z-40 w-[460px] max-w-[calc(100vw-24px)] cursor-default overflow-y-auto rounded-[14px] border border-line2 bg-panel p-4 shadow-[0_12px_32px_rgba(16,24,40,.16),0_2px_6px_rgba(16,24,40,.08)]"
      style={peekStyle(rect)}
    >
      <div className="flex items-center gap-2">
        <BizBadge biz={row.business_id} />
        <PersonLink id={row.id} url={row.crm_profile_url} className="min-w-0 truncate text-[16px] font-semibold">
          {row.name || '(no name)'}
        </PersonLink>
        <button type="button" onClick={onClose} aria-label="Close" className="ml-auto grid h-8 w-8 flex-none place-items-center rounded-[8px] text-muted hover:bg-hoverbg">
          ✕
        </button>
      </div>
      <div className="mt-1 text-[13px] text-muted">
        {[phone, row.business_id === 'mpg' && row.company, sourceOf(row), row.stage].filter(Boolean).join(' · ')}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Pill tone={TONE[row.bucket] || 'neutral'}>{reasonText(row)}</Pill>
        {others.map((r) => (
          <Pill key={r} tone={TONE[r]} title={BUCKET_LABEL[r]}>
            {SHORT[r]}
          </Pill>
        ))}
        {row.decide && <Pill tone="warn" className="font-bold">Decide</Pill>}
        <span className="text-[12px] text-dim">{lastCallLabel(row)}</span>
      </div>

      <PopupTabs
        label="Quick look"
        tabs={[
          ['details', 'Details', null],
          ['tasks', 'Tasks', taskCount(tasks)],
        ]}
        tab={tab}
        onTab={setTab}
      />

      {tab === 'tasks' && <ContactTasks businessId={row.business_id} contactId={row.id} contactName={row.name} tasks={tasks} />}

      {tab === 'details' && (facts.length > 0 || row.first_note) && <PeekHeading>Lead form</PeekHeading>}
      {tab !== 'details' ? null : facts.length > 0 ? (
        <dl aria-label={`Lead form for ${row.name || 'lead'}`} className="mt-1.5 grid grid-cols-[120px_minmax(0,1fr)] gap-y-1 text-[13.5px]">
          {facts.map((f) => (
            <Fragment key={f.k}>
              <dt className="text-dim">{f.k}</dt>
              <dd className="break-words">{f.v}</dd>
            </Fragment>
          ))}
        </dl>
      ) : (
        row.first_note && <p className="mt-1.5 whitespace-pre-line break-words text-[13.5px]">{row.first_note}</p>
      )}

      {tab === 'details' && (
      <>
      <PeekHeading>Notes</PeekHeading>
      <div className="mt-1.5 flex flex-col gap-2">
        {loading && <div className="text-[13px] text-muted">Loading…</div>}
        {!loading && notes.length === 0 && <div className="text-[13px] text-muted">No notes yet.</div>}
        {notes.map((n) => (
          <div key={n.id} className="rounded-[9px] bg-panel2 px-2.5 py-2 text-[13px] leading-[1.45]">
            <div className="text-[11.5px] text-dim">
              {[new Date(n.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), n.author].filter(Boolean).join(' · ')}
            </div>
            <div className="whitespace-pre-line break-words">{n.text}</div>
          </div>
        ))}
      </div>
      </>
      )}

      {snoozing ? (
        <div className="mt-4">
          <SnoozeForm row={row} onDone={onClose} />
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {tel && (
            <a href={tel} className="flex min-h-[36px] items-center rounded-[9px] bg-[color:var(--chrome)] px-3.5 text-[13.5px] font-semibold text-white hover:opacity-90">
              Call
            </a>
          )}
          <button
            type="button"
            onClick={() => {
              openPerson(row.id)
              onClose()
            }}
            className="min-h-[36px] rounded-[9px] border border-line2 px-3.5 text-[13.5px] font-semibold"
          >
            Open contact card
          </button>
          <button type="button" onClick={() => setSnoozing(true)} className="min-h-[36px] rounded-[9px] border border-line2 px-3.5 text-[13.5px] font-semibold text-muted">
            Snooze…
          </button>
          <CrmLink url={row.crm_profile_url} className="ml-auto px-1 text-[12.5px] font-semibold text-muted">
            CRM ↗
          </CrmLink>
        </div>
      )}
    </div>
  )
}

function DenseRow({ row }) {
  const ref = useRef(null)
  const [rect, setRect] = useState(null)
  const toggle = () => setRect((r) => (r ? null : ref.current.getBoundingClientRect()))
  const close = useCallback(() => setRect(null), [])
  const tel = telHref(row.phone)
  const phone = formatPhone(row.phone)
  const source = sourceOf(row)
  const state = noteFacts(row.first_note).facts.find((f) => f.k === 'State')?.v
  const others = row.reasons.filter((r) => r !== row.bucket)

  return (
    <div
      ref={ref}
      data-dense-row
      onClick={toggle}
      className={`flex cursor-pointer items-center gap-3 border-b border-line py-2 pl-4 pr-3 last:border-b-0 hover:bg-panel2 ${rect ? 'bg-panel2 shadow-[inset_3px_0_0_var(--chrome)]' : ''}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2 leading-5">
          <BizBadge biz={row.business_id} />
          {/* The name keeps its room; company and source give way first. */}
          <PersonLink data-lead-name id={row.id} url={row.crm_profile_url} className="max-w-[55%] flex-none truncate text-[14.5px] font-semibold">
            {row.name || '(no name)'}
          </PersonLink>
          {row.business_id === 'mpg' && row.company && <span className="min-w-0 truncate text-[12px] text-muted">· {row.company}</span>}
          {source && (
            <span title="Lead source" className="min-w-[48px] max-w-[150px] truncate rounded-full border border-line2 px-2 text-[11px] font-semibold leading-[18px] text-muted">
              {source}
            </span>
          )}
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={!!rect}
            onClick={(e) => {
              e.stopPropagation()
              toggle()
            }}
            className="ml-auto flex-none whitespace-nowrap pl-2 text-[13px] font-semibold hover:underline"
            style={{ color: urgentColor(row) }}
          >
            {reasonText(row)}
          </button>
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-2.5 overflow-hidden whitespace-nowrap text-[12.5px] leading-[18px] text-muted">
          {phone && (
            <a href={tel} onClick={stop} aria-label={`Call ${row.name || 'lead'} at ${phone}`} className="num flex-none font-semibold text-[color:var(--text)] hover:underline">
              {phone}
            </a>
          )}
          {row.stage &&
            (row.business_id === 'bay' && stageProgress(row.stage) ? (
              <StageProgress stage={row.stage} label className="flex-none" />
            ) : (
              <span className="flex-none">{row.stage}</span>
            ))}
          {state && (
            <span title="State" className="flex-none">
              {state}
            </span>
          )}
          {others.map((r) => (
            <Pill key={r} tone={TONE[r]} data-health={r} title={BUCKET_LABEL[r]} className="flex-none">
              {SHORT[r]}
            </Pill>
          ))}
          {row.decide && (
            <Pill tone="warn" className="flex-none font-bold" title="Snoozed 3+ times in 60 days: move to Nurture or let it go">
              Decide
            </Pill>
          )}
        </div>
      </div>
      {/* Actions stacked: a tall Call (dial) beside Log call, note, follow-up and stage, two to a row. */}
      <div className="flex flex-none items-stretch gap-[3px]" onClick={stop}>
        {tel ? (
          <a href={tel} title={`Call ${phone}`} aria-label={`Call ${row.name || 'lead'}`} className="grid min-h-[47px] w-10 place-items-center rounded-[9px] bg-[color:var(--chrome)] text-white hover:opacity-90">
            <Icon name="phone" size={17} strokeWidth={1.9} />
          </a>
        ) : (
          <span aria-hidden="true" className="w-10" />
        )}
        <QuickActions
          size="sm"
          businessId={row.business_id}
          contactId={row.id}
          contactName={row.name}
          hasPhone={!!row.phone}
          stage={row.business_id === 'bay' ? row.stage : null}
          only={['call', 'note', 'followup', 'stage']}
          onDone={() => refreshPriorityQueue()}
        />
      </div>
      {rect && <LeadPeek row={row} rect={rect} anchor={ref} onClose={close} />}
    </div>
  )
}

export default function UpNextRow({ row, compact = false, dense = false }) {
  const mobile = useIsMobile()
  const [sheet, setSheet] = useState(false)
  if (dense && !mobile) return <DenseRow row={row} />
  const tel = telHref(row.phone)
  const phone = formatPhone(row.phone)
  // Quick read before the call: where the lead came from and what it said.
  const source = row.lead_source && row.lead_source !== '<unspecified>' ? row.lead_source : null
  const { facts, snippet } = noteFacts(row.first_note)
  const others = row.reasons.filter((r) => r !== row.bucket)

  const body = (
    <div className="min-w-0 flex-1">
      {/* The whole name, always: it wraps in a narrow lane (Workbench) rather than cutting off. */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
        <BizBadge biz={row.business_id} />
        <PersonLink data-lead-name id={row.id} url={row.crm_profile_url} className="min-w-0 break-words text-[14px] font-semibold">
          {row.name || '(no name)'}
        </PersonLink>
        {row.business_id === 'mpg' && row.company && <span className="min-w-0 break-words text-[12px] text-muted">· {row.company}</span>}
        {source && (
          <span title="Lead source" className="flex-none rounded-full border border-line2 px-2 py-px text-[11px] font-semibold text-muted">
            {source}
          </span>
        )}
      </div>
      <div className="mt-1 text-[13px] font-semibold" style={{ color: row.bucket === 'reached_out' || row.bucket === 'new_lead' ? 'var(--neg-ink)' : 'var(--text)' }}>
        {reasonText(row)}
      </div>
      {(facts.length > 0 || snippet) && (
        <div aria-label={`First note for ${row.name || 'lead'}`} className="mt-1 flex flex-wrap gap-1">
          {facts.length > 0
            ? facts.map((f) => (
                <span key={f.k} data-fact className="rounded-md bg-panel2 px-1.5 py-0.5 text-[11.5px]">
                  <span className="text-muted">{f.k}</span> {f.v}
                </span>
              ))
            : <span className="truncate text-[12px] text-muted">“{snippet}”</span>}
        </div>
      )}
      {/* The number to call through. On a phone the whole row already dials,
          so it's plain text there (no link inside a link). */}
      {phone &&
        (mobile ? (
          <div className="num mt-0.5 text-[13px] font-semibold text-muted">{phone}</div>
        ) : (
          <a
            href={tel}
            aria-label={`Call ${row.name || 'lead'} at ${phone}`}
            className="num mt-0.5 inline-block text-[13px] font-semibold text-muted hover:text-[color:var(--text)] hover:underline"
          >
            {phone}
          </a>
        ))}
      {!compact && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
          {row.stage &&
            (row.business_id === 'bay' && stageProgress(row.stage) ? (
              <StageProgress stage={row.stage} label className="rounded-full border border-line px-2 py-0.5" />
            ) : (
              <span className="rounded-full border border-line px-2 py-0.5 text-muted">{row.stage}</span>
            ))}
          <span className="text-dim">{lastCallLabel(row)}</span>
          {others.map((r) => (
            <Pill key={r} tone={TONE[r]} data-health={r} title={BUCKET_LABEL[r]}>
              {SHORT[r]}
            </Pill>
          ))}
          {row.decide && (
            <Pill tone="warn" className="font-bold" title="Snoozed 3+ times in 60 days: move to Nurture or let it go">
              Decide
            </Pill>
          )}
        </div>
      )}
    </div>
  )

  return (
    <div className="flex items-center gap-2 border-b border-line py-3 last:border-b-0">
      {mobile && tel ? (
        <a href={tel} className="flex min-w-0 flex-1 items-center" aria-label={`Call ${row.name}`}>
          {body}
        </a>
      ) : (
        body
      )}
      {/* Inline actions only with room for them (lg+); below that, the ⋯ sheet. */}
      {!mobile && !compact && (
        <div className="hidden flex-none items-center gap-1 lg:flex">
          {tel && (
            <a href={tel} className="grid h-10 place-items-center rounded-[10px] px-2.5 text-[12.5px] font-semibold text-muted hover:bg-hoverbg" title={`Call ${phone}`}>
              Call
            </a>
          )}
          <QuickActions
            businessId={row.business_id}
            contactId={row.id}
            contactName={row.name}
            hasPhone={!!row.phone}
                stage={row.business_id === 'bay' ? row.stage : null}
            only={['call', 'note', 'followup', 'stage']}
            onDone={() => refreshPriorityQueue()}
          />
          <CrmLink url={row.crm_profile_url} className="grid h-10 place-items-center px-2 text-[12.5px] font-semibold text-muted">
            CRM ↗
          </CrmLink>
        </div>
      )}
      <button
        type="button"
        aria-label={`More actions for ${row.name}`}
        onClick={() => setSheet(true)}
        className="grid h-10 w-10 flex-none place-items-center rounded-[10px] text-[18px] text-muted hover:bg-hoverbg"
      >
        ⋯
      </button>
      {sheet && <ActionsSheet row={row} onClose={() => setSheet(false)} />}
    </div>
  )
}
