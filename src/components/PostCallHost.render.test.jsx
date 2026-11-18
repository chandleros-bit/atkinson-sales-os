// @vitest-environment jsdom
// The post-call pop-up: nothing until a tagged tel: link is tapped and the tab
// goes hidden and comes back; then the Log call form + texts. Log call writes a
// log_call (what moves the cadence), Skip drops it. The assistant login, which
// can't log calls, gets the note-only sheet.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import React from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const sent = []
const toasts = []
vi.mock('../lib/writeback', () => ({
  invokeCrmAction: async (req) => {
    sent.push(req)
    return { status: 'ok', results: [{ step: 'push_note', ok: true }] }
  },
}))
vi.mock('./Toaster', () => ({ showToast: (t) => toasts.push(t) }))

// The lead's stage (v_dial_contacts) and the Log call form's v_tasks lookups.
const db = { stage: 'New Lead', book: 'bay' }
function query(table) {
  const q = {}
  for (const m of ['select', 'eq', 'lte', 'gt', 'order', 'limit']) q[m] = () => q
  q.then = (resolve) =>
    resolve({ data: table === 'v_dial_contacts' ? (db.stage ? [{ stage: db.stage }] : []) : [], error: null })
  return q
}
vi.mock('../lib/supabase', () => ({ isDemoMode: false, supabase: { from: (t) => query(t) } }))
const auth = { role: 'owner' }
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }))

const { default: PostCallHost } = await import('./PostCallHost')

let host, root
let visibility = 'visible'
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })

const setVisibility = async (v) => {
  visibility = v
  await act(async () => document.dispatchEvent(new Event('visibilitychange')))
}
const dialog = () => document.querySelector('[role="dialog"]')
const buttonNamed = (name) => [...document.querySelectorAll('button')].find((b) => b.textContent === name)

async function mount() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root.render(<PostCallHost />))
}

function tapCall() {
  const a = document.createElement('a')
  a.href = 'tel:9137135946'
  a.dataset.callId = 'c1'
  a.dataset.callBook = db.book
  a.dataset.callName = 'Sam Lee'
  a.addEventListener('click', (e) => e.preventDefault())
  document.body.appendChild(a)
  a.click()
}

beforeEach(async () => {
  sent.length = 0
  toasts.length = 0
  visibility = 'visible'
  db.stage = 'New Lead'
  db.book = 'bay'
  auth.role = 'owner'
  window.localStorage.clear()
  await mount()
})
afterEach(async () => {
  await act(async () => root.unmount())
  document.body.innerHTML = ''
})

describe('PostCallHost', () => {
  it('stays closed until the tab leaves for the call and comes back', async () => {
    tapCall()
    await setVisibility('visible')
    expect(dialog()).toBe(null)
    await setVisibility('hidden')
    expect(dialog()).toBe(null)
    await setVisibility('visible')
    expect(dialog().textContent).toContain('After the call with Sam Lee')
  })

  it('ignores untagged tel: links', async () => {
    const a = document.createElement('a')
    a.href = 'tel:1'
    a.addEventListener('click', (e) => e.preventDefault())
    document.body.appendChild(a)
    a.click()
    await setVisibility('hidden')
    await setVisibility('visible')
    expect(dialog()).toBe(null)
  })

  it('offers both texts as Messages links with the first name', async () => {
    tapCall()
    await setVisibility('hidden')
    await setVisibility('visible')
    const missed = dialog().querySelector('[data-post-call-text="after_missed"] a')
    expect(missed.getAttribute('href')).toMatch(/^sms:9137135946\?&body=Hi%20Sam%2C%20this%20is%20Chandler/)
    expect(dialog().querySelector('[data-post-call-text="after_talked"] a').getAttribute('href')).toMatch(/Great%20talking%20with%20you%2C%20Sam/)
  })

  const typeNote = async (value) =>
    act(async () => {
      const textarea = dialog().querySelector('textarea')
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, value)
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
  const openSheet = async () => {
    tapCall()
    await setVisibility('hidden')
    await setVisibility('visible')
  }

  it('No Answer on a cadence lead logs a call with the next attempt as the next step', async () => {
    await openSheet()
    expect(buttonNamed('Log call').disabled).toBe(true)
    await act(async () => buttonNamed('No Answer').click())
    expect(dialog().textContent).toContain('Next call attempt')
    // New Lead moves to Attempted with the call.
    expect(dialog().querySelector('[data-stage-advance]').textContent).toContain('Attempted')
    await act(async () => buttonNamed('Log call').click())
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ action: 'log_call', contact_id: 'c1' })
    expect(sent[0].payload).toMatchObject({ outcome: 'No Answer', next_step: 'cadence', set_stage: 'attempted', duration_min: 1 })
    expect(sent[0].payload.follow_up).toBeUndefined()
    expect(toasts[0].tone).toBe('ok')
    expect(dialog()).toBe(null)
    expect(window.localStorage.getItem('os.pendingCall')).toBe(null)
  })

  it('adds the opened text under the note, and survives a trip to Messages', async () => {
    db.stage = 'Attempted'
    await openSheet()
    await act(async () => buttonNamed('Left Message').click())
    await typeNote('Wants a rate quote Friday')
    const link = dialog().querySelector('[data-post-call-text="after_missed"] a')
    link.addEventListener('click', (e) => e.preventDefault())
    await act(async () => link.click())
    expect(link.textContent).toBe('Opened in Messages')

    // Off to Messages and back: same sheet, note kept.
    await setVisibility('hidden')
    await setVisibility('visible')
    expect(dialog().querySelector('textarea').value).toBe('Wants a rate quote Friday')

    await act(async () => buttonNamed('Log call').click())
    expect(sent[0].payload.outcome).toBe('Left Message')
    expect(sent[0].payload.next_step).toBe('cadence')
    expect(sent[0].payload.set_stage).toBeUndefined()
    expect(sent[0].payload.note).toMatch(/^Wants a rate quote Friday\n\nTexted: Hi Sam, this is Chandler/)
  })

  it('off the cadence, No Answer defaults to a follow-up task', async () => {
    db.stage = 'Disclosed'
    await openSheet()
    await act(async () => buttonNamed('No Answer').click())
    expect(dialog().textContent).not.toContain('Next call attempt')
    await act(async () => buttonNamed('Log call').click())
    expect(sent[0].payload.next_step).toBe('follow_up')
    expect(sent[0].payload.follow_up.due_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('the assistant gets the note-only sheet', async () => {
    auth.role = 'assistant'
    await openSheet()
    expect(buttonNamed('Log call')).toBe(undefined)
    await typeNote('Left word with her husband')
    await act(async () => buttonNamed('Save note').click())
    expect(sent[0]).toMatchObject({ action: 'add_note', contact_id: 'c1' })
    expect(sent[0].payload.body).toBe('Left word with her husband')
    expect(dialog()).toBe(null)
  })

  it('Skip drops the call without saving', async () => {
    tapCall()
    await setVisibility('hidden')
    await setVisibility('visible')
    await act(async () => buttonNamed('Skip').click())
    expect(dialog()).toBe(null)
    expect(sent).toHaveLength(0)
    await setVisibility('hidden')
    await setVisibility('visible')
    expect(dialog()).toBe(null)
  })

  it('reopens after a reload while the call was going', async () => {
    tapCall()
    await act(async () => root.unmount())
    await mount()
    expect(dialog().textContent).toContain('Sam Lee')
  })
})
