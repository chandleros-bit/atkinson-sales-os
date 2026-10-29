// Pop-up reminders for calls and meetings scheduled from a contact
// (contact_events). Mounted once in Layout, like Toaster: it only runs while an
// OS tab is open (foreground or background); there is no push server.
//
// Loads the next day's scheduled events every 5 minutes and after any save,
// checks every 30 seconds, and for each one whose window is open
// (dueReminders) shows a card until dismissed and, when the browser allows it,
// a desktop notification. reminded_at is stamped so the reminder fires once
// across tabs and devices; localStorage covers the moment before that write
// lands, so two open tabs don't both fire.
// Spec: docs/superpowers/specs/2026-10-29-contact-events-design.md
import { useCallback, useEffect, useRef, useState } from 'react'
import { openPerson } from './PersonSheet'
import { timeLabel } from '../lib/calendar'
import {
  dueReminders,
  fetchContactEvents,
  markReminded,
  onContactEventsChanged,
  startsIn,
} from '../lib/contactEvents'

const LOAD_MS = 5 * 60_000
const CHECK_MS = 30_000
const SNOOZE_MS = 5 * 60_000
const FIRED_KEY = 'os.reminders.fired'
const FIRED_KEEP_MS = 2 * 86_400_000

// Fired ids live in localStorage as { id: firedAtMs }, pruned after two days.
function readFired() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(FIRED_KEY) || '{}')
    const cutoff = Date.now() - FIRED_KEEP_MS
    return Object.fromEntries(Object.entries(raw).filter(([, at]) => at > cutoff))
  } catch {
    return {}
  }
}
function writeFired(ids) {
  try {
    const fired = readFired()
    for (const id of ids) fired[id] = Date.now()
    window.localStorage.setItem(FIRED_KEY, JSON.stringify(fired))
  } catch {
    // Private window or blocked storage: reminded_at still stops repeats.
  }
}

const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window
const kindLabel = (e) => (e.kind === 'meeting' ? 'Meeting' : 'Call')
const nameOf = (e) => e.contacts?.name || 'contact'

function desktopNotify(e) {
  if (!notificationsSupported() || window.Notification.permission !== 'granted') return
  try {
    const n = new window.Notification(`${kindLabel(e)} with ${nameOf(e)} ${startsIn(e.starts_at)}`, {
      body: [timeLabel(e), e.note].filter(Boolean).join(' · '),
      tag: `contact-event-${e.id}`,
    })
    n.onclick = () => {
      window.focus()
      openPerson(e.contact_id)
      n.close()
    }
  } catch {
    // Some browsers only allow notifications from a service worker; the card still shows.
  }
}

export default function ReminderHost() {
  const [rows, setRows] = useState([])
  const [cards, setCards] = useState([])
  const [, setTick] = useState(0)
  const [permission, setPermission] = useState(() => (notificationsSupported() ? window.Notification.permission : 'unsupported'))
  const fired = useRef(new Set())
  const snoozes = useRef(new Set())

  const load = useCallback(async () => {
    const now = Date.now()
    try {
      const { data, error } = await fetchContactEvents({
        from: new Date(now - 10 * 60_000).toISOString(),
        to: new Date(now + 26 * 3_600_000).toISOString(),
      })
      // A failed read keeps the last list; the next load tries again.
      if (!error) setRows((data || []).filter((e) => e.status === 'scheduled'))
    } catch {
      // Same: retried on the next load.
    }
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, LOAD_MS)
    const off = onContactEventsChanged(load)
    return () => {
      clearInterval(id)
      off()
    }
  }, [load])

  const check = useCallback(() => {
    const seen = new Set([...fired.current, ...Object.keys(readFired())])
    const due = dueReminders(rows, Date.now(), seen)
    if (!due.length) return
    for (const e of due) fired.current.add(e.id)
    writeFired(due.map((e) => e.id))
    setCards((cs) => [...cs.filter((c) => !due.some((e) => e.id === c.id)), ...due])
    for (const e of due) {
      desktopNotify(e)
      markReminded(e.id).catch(() => {})
    }
  }, [rows])

  useEffect(() => {
    check()
    const id = setInterval(() => {
      check()
      setTick((n) => n + 1) // keeps "in 4 min" current on open cards
    }, CHECK_MS)
    return () => clearInterval(id)
  }, [check])

  // Snoozed timers die with the host.
  useEffect(() => () => snoozes.current.forEach(clearTimeout), [])

  const remove = (id) => setCards((cs) => cs.filter((c) => c.id !== id))
  const snooze = (e) => {
    remove(e.id)
    const t = setTimeout(() => {
      snoozes.current.delete(t)
      setCards((cs) => (cs.some((c) => c.id === e.id) ? cs : [...cs, e]))
      desktopNotify(e)
    }, SNOOZE_MS)
    snoozes.current.add(t)
  }
  const askPermission = async () => {
    try {
      setPermission(await window.Notification.requestPermission())
    } catch {
      setPermission(window.Notification.permission)
    }
  }

  if (!cards.length) return null
  return (
    <div className="fixed right-3 top-3 z-[70] flex w-[min(340px,calc(100vw-24px))] flex-col gap-2" aria-live="assertive">
      {cards.map((e) => {
        const color = e.business_id === 'mpg' ? 'var(--mpg)' : 'var(--bay)'
        return (
          <div
            key={e.id}
            role="alertdialog"
            aria-label={`Reminder: ${kindLabel(e)} with ${nameOf(e)}`}
            data-reminder={e.id}
            className="rounded-[12px] border border-line bg-panel p-3.5 shadow-lg"
            style={{ borderLeft: `4px solid ${color}` }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-dim">
                  {kindLabel(e)} {startsIn(e.starts_at)}
                </div>
                <div className="truncate text-[14px] font-bold">{nameOf(e)}</div>
                <div className="num text-[12.5px] text-muted">
                  {timeLabel(e)} · {e.duration_min} min
                </div>
                {e.note && <div className="mt-0.5 line-clamp-2 text-[12.5px]">{e.note}</div>}
              </div>
              <button type="button" onClick={() => remove(e.id)} aria-label="Dismiss" className="grid h-8 w-8 flex-none place-items-center rounded-md text-muted hover:bg-hoverbg">
                ✕
              </button>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => {
                  remove(e.id)
                  openPerson(e.contact_id)
                }}
                className="min-h-[34px] rounded-md px-3 text-[12.5px] font-bold text-white"
                style={{ background: color }}
              >
                Open contact
              </button>
              <button type="button" onClick={() => snooze(e)} className="min-h-[34px] rounded-md border border-line2 px-3 text-[12.5px] font-semibold text-muted hover:bg-hoverbg">
                Snooze 5 min
              </button>
            </div>
            {permission === 'default' && (
              <button type="button" onClick={askPermission} className="mt-2 text-[11.5px] font-semibold text-muted underline">
                Turn on desktop alerts
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
