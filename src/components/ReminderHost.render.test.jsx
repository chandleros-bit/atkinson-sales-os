// @vitest-environment jsdom
// The reminder pop-up: nothing before the window opens, a card (and a desktop
// notification when allowed) once it does, reminded_at stamped once, and
// Dismiss / Snooze / Open contact.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import React from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const DATA = { rows: [] }
const updates = []
const opened = []

function query(table) {
  const q = {}
  for (const m of ['select', 'eq', 'in', 'gte', 'lt', 'order']) q[m] = () => q
  q.update = (patch) => ({
    eq: async (col, id) => {
      updates.push({ table, patch, id })
      return { error: null }
    },
  })
  q.then = (resolve) => resolve({ data: table === 'contact_events' ? DATA.rows : [], error: null })
  return q
}

vi.mock('../lib/supabase', () => ({
  isDemoMode: false,
  supabase: { from: (t) => query(t) },
}))
vi.mock('./PersonSheet', () => ({ openPerson: (id) => opened.push(id) }))

const { default: ReminderHost } = await import('./ReminderHost')

const START = new Date(2026, 9, 29, 9, 30) // 9:30 AM local
const event = (over = {}) => ({
  id: 'e1',
  business_id: 'mpg',
  contact_id: 'c1',
  kind: 'call',
  starts_at: START.toISOString(),
  duration_min: 30,
  note: 'bring rates',
  remind_min: 10,
  status: 'scheduled',
  reminded_at: null,
  contacts: { name: 'Jane Doe' },
  ...over,
})

const notifications = []
class FakeNotification {
  static permission = 'granted'
  static requestPermission = async () => 'granted'
  constructor(title, opts) {
    notifications.push({ title, ...opts })
    this.close = () => {}
  }
}

async function mount() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => createRoot(host).render(React.createElement(ReminderHost)))
  await act(async () => {})
  return host
}
const advance = (ms) => act(async () => vi.advanceTimersByTime(ms))
const card = () => document.querySelector('[data-reminder]')
const button = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(text))

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 29, 9, 18)) // 12 min before the start
  document.body.innerHTML = ''
  window.localStorage.clear()
  DATA.rows = [event()]
  updates.length = 0
  opened.length = 0
  notifications.length = 0
  FakeNotification.permission = 'granted'
  window.Notification = FakeNotification
})
afterEach(() => {
  vi.useRealTimers()
  delete window.Notification
})

describe('ReminderHost', () => {
  it('stays quiet until remind_min before the start, then shows the card once', async () => {
    await mount()
    expect(card()).toBe(null)
    await advance(60_000) // 9:19
    expect(card()).toBe(null)
    await advance(60_000) // 9:20 — the window opens
    expect(card()).not.toBe(null)
    expect(card().textContent).toContain('Call in 10 min')
    expect(card().textContent).toContain('Jane Doe')
    expect(card().textContent).toContain('9:30 AM · 30 min')
    expect(card().textContent).toContain('bring rates')
    expect(notifications).toEqual([{ title: 'Call with Jane Doe in 10 min', body: '9:30 AM · bring rates', tag: 'contact-event-e1' }])
    expect(updates).toEqual([{ table: 'contact_events', patch: { reminded_at: expect.any(String) }, id: 'e1' }])
    await advance(60_000)
    expect(updates).toHaveLength(1)
    expect(notifications).toHaveLength(1)
  })

  it('fires right away when the tab opens inside the window, and Dismiss hides it', async () => {
    vi.setSystemTime(new Date(2026, 9, 29, 9, 25))
    await mount()
    expect(card().textContent).toContain('Call in 5 min')
    await act(async () => button(card(), '✕').click())
    expect(card()).toBe(null)
  })

  it('Open contact opens the person sheet and clears the card', async () => {
    vi.setSystemTime(new Date(2026, 9, 29, 9, 25))
    await mount()
    await act(async () => button(card(), 'Open contact').click())
    expect(opened).toEqual(['c1'])
    expect(card()).toBe(null)
  })

  it('Snooze brings the card back five minutes later', async () => {
    vi.setSystemTime(new Date(2026, 9, 29, 9, 22))
    await mount()
    await act(async () => button(card(), 'Snooze').click())
    expect(card()).toBe(null)
    await advance(4 * 60_000)
    expect(card()).toBe(null)
    await advance(60_000)
    expect(card()).not.toBe(null)
  })

  it('skips events already reminded in another tab or with no reminder', async () => {
    vi.setSystemTime(new Date(2026, 9, 29, 9, 25))
    window.localStorage.setItem('os.reminders.fired', JSON.stringify({ e1: Date.now() }))
    DATA.rows = [event(), event({ id: 'e2', remind_min: null })]
    await mount()
    expect(card()).toBe(null)
    expect(updates).toEqual([])
  })

  it('shows the card without a desktop notification until the browser allows it', async () => {
    FakeNotification.permission = 'default'
    vi.setSystemTime(new Date(2026, 9, 29, 9, 25))
    await mount()
    expect(card()).not.toBe(null)
    expect(notifications).toEqual([])
    expect(button(card(), 'Turn on desktop alerts')).toBeTruthy()
  })
})
