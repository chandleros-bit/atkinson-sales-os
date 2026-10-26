// One Up Next row, shared by the Priority page and the Overview card.
// Mobile first: under 640px the whole row is a tel: link (tap = dial) and the
// actions live in a bottom sheet behind the ⋯ button. On wider screens the row
// is not a link and the actions sit inline.
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { refreshPriorityQueue } from '../lib/usePriorityQueue'
import { BUCKET_LABEL, reasonText, lastCallLabel } from '../lib/priorityQueue'
import { followUpDate } from '../lib/crmActions'
import { formatPhone, telHref } from '../lib/phone'
import { noteFacts } from '../lib/noteFacts'
import BizBadge from './BizBadge'
import CrmLink from './CrmLink'
import PersonLink from './PersonLink'
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

export default function UpNextRow({ row, compact = false }) {
  const mobile = useIsMobile()
  const [sheet, setSheet] = useState(false)
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
          {row.stage && <span className="rounded-full border border-line px-2 py-0.5 text-muted">{row.stage}</span>}
          <span className="text-dim">{lastCallLabel(row)}</span>
          {others.map((r) => (
            <span key={r} className="rounded-full bg-panel2 px-2 py-0.5 font-semibold text-muted" title={BUCKET_LABEL[r]}>
              {SHORT[r]}
            </span>
          ))}
          {row.decide && (
            <span
              className="rounded-full px-2 py-0.5 font-bold"
              style={{ background: 'rgba(232,180,95,.18)', color: 'var(--bay-gold)' }}
              title="Snoozed 3+ times in 60 days: move to Nurture or let it go"
            >
              Decide
            </span>
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
