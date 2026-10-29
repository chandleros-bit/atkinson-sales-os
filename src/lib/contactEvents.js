// Calls and meetings scheduled from a contact (contact_events, migration 0045).
// App-owned and per user, like work_items: never sent to a CRM or Outlook as an
// event. The Calendar page and TodayAgenda merge them into the Outlook rows
// (toCalendarEvent); ReminderHost pops a reminder before each (dueReminders).
// Spec: docs/superpowers/specs/2026-10-29-contact-events-design.md
import { supabase, isDemoMode } from './supabase'
import { localDateKey } from './crmActions'

export const KINDS = [
  { key: 'call', label: 'Call' },
  { key: 'meeting', label: 'Meeting' },
]
export const DURATIONS = [15, 30, 45, 60]
// null = no reminder. 10 is the default.
export const REMIND_OPTIONS = [null, 5, 10, 15, 30, 60]
export const DEFAULT_REMIND_MIN = 10
// A reminder still shows this many minutes after the start (you opened the tab
// a little late); after that it is dropped.
export const REMIND_GRACE_MIN = 5

const KIND_LABEL = { call: 'Call', meeting: 'Meeting' }
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const pad = (n) => String(n).padStart(2, '0')
const trimmed = (v) => (typeof v === 'string' ? v.trim() : '')

// form: { businessId, contactId, kind, dayKey 'YYYY-MM-DD', time 'HH:MM' (local),
// durationMin, remindMin (null = none), note } -> contact_events insert row.
export function buildEventRow(form, now = new Date()) {
  if (!form?.contactId) throw new Error('Pick a contact first')
  if (!['bay', 'mpg'].includes(form.businessId)) throw new Error('Unknown book for this contact')
  if (!KIND_LABEL[form.kind]) throw new Error('Pick call or meeting')
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(form.dayKey || '')
  if (!dm) throw new Error('Pick a date')
  const tm = /^(\d{1,2}):(\d{2})$/.exec(form.time || '')
  if (!tm || Number(tm[1]) > 23 || Number(tm[2]) > 59) throw new Error('Pick a time')
  const start = new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]))
  if (start.getTime() <= now.getTime()) throw new Error('That time is in the past')
  const remind = form.remindMin == null || form.remindMin === '' ? null : Number(form.remindMin)
  return {
    business_id: form.businessId,
    contact_id: form.contactId,
    kind: form.kind,
    starts_at: start.toISOString(),
    duration_min: Number(form.durationMin) || 30,
    remind_min: remind,
    note: trimmed(form.note) || null,
  }
}

// The form's starting point: the next half hour, today (or tomorrow after 11:30 PM).
export function defaultStartTime(now = new Date()) {
  const d = new Date(now)
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60)
  return { dayKey: localDateKey(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` }
}

function clock(d) {
  let h = d.getHours()
  const ap = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${pad(d.getMinutes())} ${ap}`
}

// "Fri 10/30 2:30 PM"
export function eventWhenLabel(iso) {
  const d = new Date(iso)
  return `${DAYS[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()} ${clock(d)}`
}

// "in 10 min", "in 1h 30m", "now"
export function startsIn(iso, now = new Date()) {
  const mins = Math.round((new Date(iso).getTime() - new Date(now).getTime()) / 60000)
  if (mins <= 0) return 'now'
  if (mins < 60) return `in ${mins} min`
  return `in ${Math.floor(mins / 60)}h ${mins % 60}m`
}

// The note dropped on the lead in Zoho / FUB when "Add note" is checked.
export function crmNoteBody(row) {
  const base = `Scheduled ${row.kind} ${eventWhenLabel(row.starts_at)} · ${row.duration_min} min`
  return row.note ? `${base} — ${row.note}` : base
}

// A row (selected with contacts(name)) as the calendar views render events.
// source_account 'os-mpg' / 'os-bay' tells sourceToBiz the book; os marks it as
// ours so the views can tag it and open the contact on click.
export function toCalendarEvent(row) {
  const name = row.contacts?.name || 'Contact'
  const start = new Date(row.starts_at)
  return {
    id: `os:${row.id}`,
    source_account: `os-${row.business_id}`,
    title: `${KIND_LABEL[row.kind] || 'Event'} · ${name}`,
    starts_at: row.starts_at,
    ends_at: new Date(start.getTime() + (row.duration_min || 30) * 60000).toISOString(),
    is_all_day: false,
    location: row.note || null,
    os: true,
    kind: row.kind,
    status: row.status,
    contact_id: row.contact_id,
    contact_name: name,
  }
}

// Scheduled events whose reminder window is open at `now`: from remind_min
// before the start until REMIND_GRACE_MIN after it. firedIds: ids this browser
// already showed (the reminded_at write may not have landed yet).
export function dueReminders(rows, now = Date.now(), firedIds = new Set()) {
  const t = new Date(now).getTime()
  return (rows || []).filter((e) => {
    if (e.status !== 'scheduled' || e.remind_min == null || e.reminded_at || firedIds.has(e.id)) return false
    const start = new Date(e.starts_at).getTime()
    return t >= start - e.remind_min * 60000 && t < start + REMIND_GRACE_MIN * 60000
  })
}

// ---- Supabase ---------------------------------------------------------------

const COLUMNS = 'id, business_id, contact_id, kind, starts_at, duration_min, note, remind_min, status, reminded_at, contacts(name)'

// Scheduled and done events starting in [from, to). Canceled ones never show.
export async function fetchContactEvents({ from, to }) {
  if (isDemoMode) return { data: [], error: null }
  return supabase
    .from('contact_events')
    .select(COLUMNS)
    .neq('status', 'canceled')
    .gte('starts_at', from)
    .lt('starts_at', to)
    .order('starts_at', { ascending: true })
}

// One contact's scheduled events from an hour ago on (the person sheet).
export async function fetchContactUpcoming(contactId, now = new Date()) {
  if (isDemoMode) return { data: [], error: null }
  return supabase
    .from('contact_events')
    .select(COLUMNS)
    .eq('contact_id', contactId)
    .eq('status', 'scheduled')
    .gte('starts_at', new Date(now.getTime() - 3600000).toISOString())
    .order('starts_at', { ascending: true })
}

export async function insertContactEvent(row) {
  return supabase.from('contact_events').insert(row).select(COLUMNS).single()
}

export async function setContactEventStatus(id, status) {
  return supabase.from('contact_events').update({ status }).eq('id', id)
}

export async function markReminded(id) {
  return supabase.from('contact_events').update({ reminded_at: new Date().toISOString() }).eq('id', id)
}

// Lets the calendar views and ReminderHost reload after a save or a status change.
const CHANGED = 'contact-events:changed'
export function notifyContactEventsChanged() {
  window.dispatchEvent(new CustomEvent(CHANGED))
}
export function onContactEventsChanged(fn) {
  window.addEventListener(CHANGED, fn)
  return () => window.removeEventListener(CHANGED, fn)
}
