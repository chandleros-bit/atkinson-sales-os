// Schedule a call or meeting with a contact ("call with Jane Doe, Thu 2:30 PM")
// and list the contact's upcoming ones. Saved to contact_events (app-owned, per
// user); with "Add note" checked a note also goes on the lead in Zoho / FUB
// through crm-action's add_note. ReminderHost pops the reminder.
// Spec: docs/superpowers/specs/2026-10-29-contact-events-design.md
import { useCallback, useEffect, useRef, useState } from 'react'
import { Sheet, Chip, SubmitButton, inputCls, quickActionTone } from './QuickActions'
import { showToast } from './Toaster'
import { useWritebackFlags, invokeCrmAction } from '../lib/writeback'
import { CRM_LABEL, buildActionRequest, summarizeResult, localDateKey } from '../lib/crmActions'
import {
  KINDS,
  DURATIONS,
  REMIND_OPTIONS,
  DEFAULT_REMIND_MIN,
  buildEventRow,
  defaultStartTime,
  eventWhenLabel,
  crmNoteBody,
  insertContactEvent,
  fetchContactUpcoming,
  setContactEventStatus,
  notifyContactEventsChanged,
  onContactEventsChanged,
} from '../lib/contactEvents'

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'contact'

async function addCrmNote({ businessId, contactId, row }) {
  const res = await invokeCrmAction(buildActionRequest({ action: 'add_note', contactId, body: crmNoteBody(row) }))
  return summarizeResult(res, businessId)
}

export function ScheduleEventForm({ businessId, contactId, contactName, t, onSaved }) {
  const flags = useWritebackFlags()
  const canNote = !!flags[businessId]
  const start = defaultStartTime()
  const [kind, setKind] = useState('call')
  const [dayKey, setDayKey] = useState(start.dayKey)
  const [time, setTime] = useState(start.time)
  const [durationMin, setDurationMin] = useState(30)
  const [remindMin, setRemindMin] = useState(DEFAULT_REMIND_MIN)
  const [note, setNote] = useState('')
  const [crmNote, setCrmNote] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const busyRef = useRef(false)

  const today = localDateKey(new Date())
  const tomorrow = localDateKey(new Date(Date.now() + 86_400_000))
  const crm = CRM_LABEL[businessId]

  const submit = async () => {
    if (busyRef.current) return
    let row
    try {
      row = buildEventRow({ businessId, contactId, kind, dayKey, time, durationMin, remindMin, note })
    } catch (e) {
      setError(e.message)
      return
    }
    busyRef.current = true
    setBusy(true)
    setError(null)
    const { error: err } = await insertContactEvent(row)
    busyRef.current = false
    setBusy(false)
    if (err) {
      setError(err.message || 'Could not save the event')
      return
    }
    notifyContactEventsChanged()
    const label = `${kind === 'call' ? 'Call' : 'Meeting'} with ${firstName(contactName)} · ${eventWhenLabel(row.starts_at)}`
    onSaved?.()
    if (!(canNote && crmNote)) {
      showToast({ tone: 'ok', text: `${label} scheduled` })
      return
    }
    const sendNote = async () => {
      const summary = await addCrmNote({ businessId, contactId, row })
      if (summary.tone === 'ok') showToast({ tone: 'ok', text: `${label} scheduled · note added in ${crm}` })
      else showToast({ tone: 'error', text: `Scheduled — note not added in ${crm}. ${summary.text}`, retry: sendNote })
    }
    await sendNote()
  }

  return (
    <>
      <div className="flex gap-2" role="group" aria-label="Type">
        {KINDS.map((k) => (
          <Chip key={k.key} t={t} active={kind === k.key} onClick={() => setKind(k.key)}>
            {k.label}
          </Chip>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Chip t={t} active={dayKey === today} onClick={() => setDayKey(today)}>
          Today
        </Chip>
        <Chip t={t} active={dayKey === tomorrow} onClick={() => setDayKey(tomorrow)}>
          Tomorrow
        </Chip>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <input type="date" aria-label="Date" value={dayKey} min={today} onChange={(e) => setDayKey(e.target.value)} className={inputCls} />
        <input type="time" aria-label="Time" value={time} step={300} onChange={(e) => setTime(e.target.value)} className={inputCls} />
      </div>

      <div className="mt-3 text-[11.5px] font-semibold text-dim">Duration</div>
      <div className="mt-1 flex flex-wrap gap-2" role="group" aria-label="Duration">
        {DURATIONS.map((d) => (
          <Chip key={d} t={t} active={durationMin === d} onClick={() => setDurationMin(d)}>
            {d} min
          </Chip>
        ))}
      </div>

      <label className="mt-3 block text-[11.5px] font-semibold text-dim">
        Remind me
        <select
          aria-label="Remind me"
          value={remindMin == null ? '' : String(remindMin)}
          onChange={(e) => setRemindMin(e.target.value === '' ? null : Number(e.target.value))}
          className={`${inputCls} mt-1`}
        >
          {REMIND_OPTIONS.map((m) => (
            <option key={m ?? 'none'} value={m == null ? '' : String(m)}>
              {m == null ? 'No reminder' : `${m} min before`}
            </option>
          ))}
        </select>
      </label>

      <textarea
        aria-label="Event note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        className={`${inputCls} mt-3`}
        placeholder="Note (optional)"
      />

      {canNote && (
        <label className="mt-3 flex items-center gap-2 text-[12.5px]">
          <input type="checkbox" checked={crmNote} onChange={(e) => setCrmNote(e.target.checked)} aria-label={`Add note in ${crm}`} />
          Add note in {crm}
        </label>
      )}

      {error && (
        <div role="alert" className="mt-3 rounded-[10px] border px-3 py-2 text-[12.5px]" style={{ borderColor: '#f2b8b4', background: 'var(--neg-bg)', color: 'var(--neg-ink)' }}>
          {error}
        </div>
      )}
      <SubmitButton t={t} busy={busy} disabled={!dayKey || !time} onClick={submit}>
        Schedule {kind === 'call' ? 'call' : 'meeting'}
      </SubmitButton>
    </>
  )
}

// Marks a call or meeting scheduled in the app (contact_events), not Outlook.
export function OsTag({ done }) {
  return (
    <span className="ml-1.5 rounded border border-line2 px-1 py-px align-middle text-[9.5px] font-bold uppercase tracking-wide text-dim">
      {done ? 'Done' : 'OS'}
    </span>
  )
}

const CalendarSvg = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM8 14h2v2H8z" />
  </svg>
)

// variant 'pill': labeled button (person sheet). 'icon': a small icon button (Contacts rows).
export function ScheduleButton({ businessId, contactId, contactName, variant = 'pill', className = '' }) {
  const [open, setOpen] = useState(false)
  const t = quickActionTone(businessId)
  if (!contactId || !['bay', 'mpg'].includes(businessId)) return null
  return (
    <>
      {variant === 'icon' ? (
        <button
          type="button"
          aria-label={`Schedule call or meeting with ${contactName || 'contact'}`}
          title="Schedule call or meeting"
          onClick={(e) => {
            e.stopPropagation()
            setOpen(true)
          }}
          className={`grid h-8 w-8 flex-none place-items-center rounded-[9px] text-muted hover:bg-hoverbg ${className}`}
        >
          <CalendarSvg size={15} />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-[10px] border px-3 text-[12.5px] font-semibold ${className}`}
          style={{ borderColor: t.line, color: t.ink, background: t.soft }}
        >
          <CalendarSvg size={14} />
          Schedule
        </button>
      )}
      {open && (
        <Sheet title="Schedule call or meeting" subtitle={contactName} t={t} onClose={() => setOpen(false)}>
          <ScheduleEventForm businessId={businessId} contactId={contactId} contactName={contactName} t={t} onSaved={() => setOpen(false)} />
        </Sheet>
      )}
    </>
  )
}

// The contact's scheduled calls and meetings, with Done / Cancel.
export function UpcomingEvents({ contactId }) {
  const [rows, setRows] = useState([])
  const load = useCallback(async () => {
    const { data } = await fetchContactUpcoming(contactId)
    setRows(data || [])
  }, [contactId])

  useEffect(() => {
    load()
    return onContactEventsChanged(load)
  }, [load])

  const set = async (id, status) => {
    const { error } = await setContactEventStatus(id, status)
    if (error) {
      showToast({ tone: 'error', text: `Could not update the event: ${error.message}` })
      return
    }
    notifyContactEventsChanged()
  }

  if (!rows.length) return null
  return (
    <div aria-label="Upcoming" className="rounded-[10px] bg-panel2 px-3 py-2">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-dim">Upcoming</div>
      <ul className="flex flex-col gap-1.5">
        {rows.map((r) => (
          <li key={r.id} data-upcoming className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
            <span className="font-semibold">{r.kind === 'call' ? 'Call' : 'Meeting'}</span>
            <span className="num text-muted">
              {eventWhenLabel(r.starts_at)} · {r.duration_min} min
            </span>
            {r.note && <span className="min-w-0 truncate text-dim">{r.note}</span>}
            <span className="ml-auto flex gap-1">
              <button type="button" onClick={() => set(r.id, 'done')} className="min-h-[30px] rounded-md border border-line2 px-2 text-[11.5px] font-semibold text-muted hover:bg-hoverbg">
                Done
              </button>
              <button type="button" onClick={() => set(r.id, 'canceled')} className="min-h-[30px] rounded-md border border-line2 px-2 text-[11.5px] font-semibold text-muted hover:bg-hoverbg">
                Cancel
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
