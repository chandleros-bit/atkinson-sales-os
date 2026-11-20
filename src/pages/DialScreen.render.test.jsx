// @vitest-environment jsdom
// Power Dialer phase 3: one lead at a time, Call is a tel: link, outcomes set
// the lead's status and side effects, Skip and Back, session numbers.
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const db = {}
vi.mock('../lib/dialerData', () => ({
  fetchDialData: async () => ({ data: structuredClone(db.data), error: null }),
  startSession: async () => ({ id: 's1', error: null }),
  endSession: async () => {},
  logDial: async ({ lead }) => { db.dials.push(lead.id); return { call: { id: `c${db.dials.length}`, dialed_at: '2026-11-20T16:00:00Z' }, error: null } },
  logOutcome: async (args) => { db.outcomes.push(args); return { error: null } },
}))

const { default: DialScreen } = await import('./DialScreen')

const lead = (i, extra = {}) => ({
  id: `l${i}`, list_id: 'L', business_id: 'mpg', first_name: `First${i}`, last_name: 'Smith', company: `Co ${i}`,
  phone_e164: `+1713555010${i}`, city: 'Houston', state: 'TX', extra: {}, status: 'queued', attempt_count: 0, position: i, ...extra,
})

beforeEach(() => {
  document.body.innerHTML = ''
  db.dials = []
  db.outcomes = []
  db.data = {
    list: { id: 'L', name: 'Houston cafes', business_id: 'mpg' },
    leads: [lead(1, { extra: { 'Year Built': '1999' } }), lead(2), lead(3)],
    calls: [],
    script: { body: '# MPG script\n- Ask for the owner', max_attempts: 3, min_retry_hours: 4 },
    today: { calls: 10, live_conversations: 2 },
    targetsValue: null,
  }
})

async function mount() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  // tel: links would try to navigate in jsdom.
  host.addEventListener('click', (e) => { if (e.target.closest('a[href^="tel:"]')) e.preventDefault() })
  await act(async () =>
    createRoot(host).render(
      <MemoryRouter initialEntries={['/dialer/L']}>
        <Routes><Route path="/dialer/:listId" element={<DialScreen />} /></Routes>
      </MemoryRouter>,
    ),
  )
  await act(async () => {})
  return host
}
const button = (host, text) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim() === text)
const current = (host) => host.querySelector('[data-lead-id]')?.dataset.leadId
const stat = (host, label) => [...host.querySelectorAll('[aria-label="Numbers"] > div')].find((d) => d.textContent.startsWith(label))?.querySelector('.num').textContent
async function click(el) { await act(async () => el.click()) }
async function callNow(host) { await click(host.querySelector('a[href^="tel:"]')) }

describe('dial screen', () => {
  it('shows the first lead with a tel: Call link and today vs target', async () => {
    const host = await mount()
    expect(current(host)).toBe('l1')
    expect(host.querySelector('a[href^="tel:"]').getAttribute('href')).toBe('tel:+17135550101')
    expect(host.textContent).toContain('Year Built')
    expect(host.querySelector('[data-attempt]').textContent).toBe('Attempt 1 of 3')
    expect(stat(host, 'Calls today')).toBe('10 / 40') // MPG default target
    expect(host.querySelector('[aria-label="Outcome"]')).toBeNull()
  })

  it('logs the dial, then a no-answer schedules a retry and loads the next lead', async () => {
    const host = await mount()
    await callNow(host)
    expect(db.dials).toEqual(['l1'])
    expect(stat(host, 'Dials')).toBe('1')
    expect(stat(host, 'Calls today')).toBe('11 / 40')
    expect(button(host, 'Save and next').disabled).toBe(true)
    await click(button(host, 'No answer'))
    await click(button(host, 'Save and next'))
    expect(db.outcomes[0]).toMatchObject({ callId: 'c1', outcomeKey: 'no_answer', pushTarget: null, update: { status: 'retry', attempt_count: 1 } })
    expect(current(host)).toBe('l2')
    expect(host.querySelector('a[href^="tel:"]')).not.toBeNull()
  })

  it('sends a confirmed MPG outcome to the Zoho push queue and counts it', async () => {
    const host = await mount()
    await callNow(host)
    await click(button(host, 'Interested'))
    await click(button(host, 'Save and next'))
    expect(db.outcomes[0]).toMatchObject({ outcomeKey: 'interested', pushTarget: 'zoho', update: { status: 'confirmed' } })
    expect(stat(host, 'Connects')).toBe('1')
    expect(stat(host, 'Confirmed')).toBe('1')
    expect(stat(host, 'Convos today')).toBe('3 / 8')
  })

  it('shows only this business\'s outcomes', async () => {
    const host = await mount()
    await callNow(host)
    expect(button(host, 'Owner not available')).toBeTruthy()
    expect(button(host, 'Application sent')).toBeUndefined()
  })

  it('needs a time for a callback', async () => {
    const host = await mount()
    await callNow(host)
    await click(button(host, 'Callback requested'))
    await click(button(host, 'Save and next'))
    expect(host.querySelector('[role="alert"]').textContent).toMatch(/callback/i)
    expect(db.outcomes).toHaveLength(0)
    const input = host.querySelector('input[aria-label="Callback time"]')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '2026-11-21T10:30')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(button(host, 'Save and next'))
    expect(db.outcomes[0]).toMatchObject({ outcomeKey: 'callback_requested', pushTarget: 'zoho' })
    expect(db.outcomes[0].callbackAt).toBe(new Date('2026-11-21T10:30').toISOString())
  })

  it('blocks every open lead with the same number on Do Not Call', async () => {
    db.data.leads[2].phone_e164 = '+17135550101'
    const host = await mount()
    await callNow(host)
    await click(button(host, 'Do Not Call'))
    await click(button(host, 'Save and next'))
    expect(db.outcomes[0]).toMatchObject({ outcomeKey: 'do_not_call', update: { status: 'dnc' } })
    expect(current(host)).toBe('l2')
    await click(button(host, 'Skip'))
    // l3 shares the blocked number, so the list is done.
    expect(current(host)).toBeUndefined()
    expect(host.textContent).toContain('Nothing left to dial')
  })

  it('skips and goes back', async () => {
    const host = await mount()
    expect(button(host, 'Back').disabled).toBe(true)
    await click(button(host, 'Skip'))
    expect(current(host)).toBe('l2')
    await click(button(host, 'Back'))
    expect(current(host)).toBe('l1')
    await click(button(host, 'Skip'))
    await click(button(host, 'Skip'))
    expect(current(host)).toBe('l3')
  })

  it('opens the script drawer', async () => {
    const host = await mount()
    await click(button(host, 'Script'))
    const dlg = host.querySelector('[role="dialog"][aria-label="Call script"]')
    expect(dlg.textContent).toContain('MPG script')
    expect(dlg.textContent).toContain('Ask for the owner')
  })

  it('shows notes from past attempts on the lead', async () => {
    db.data.leads[0] = lead(1, { status: 'retry', attempt_count: 1, next_attempt_at: '2026-01-01T00:00:00Z' })
    db.data.leads = [db.data.leads[0]]
    db.data.calls = [{ lead_id: 'l1', outcome: 'voicemail', notes: 'Left msg with front desk', dialed_at: '2026-11-19T15:00:00Z' }]
    const host = await mount()
    expect(host.querySelector('[aria-label="Past attempts"]').textContent).toContain('Left msg with front desk')
    expect(host.querySelector('[data-attempt]').textContent).toBe('Attempt 2 of 3')
  })
})

describe('compliance guard', () => {
  afterEach(() => vi.useRealTimers())
  const bayCold = () => {
    db.data.list = { id: 'L', name: 'Katy owners', business_id: 'bay', temperature: 'cold' }
    db.data.leads = db.data.leads.map((l) => ({ ...l, business_id: 'bay', state: 'TX' }))
  }

  it('holds every Cold lead outside calling hours and says so', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-21T03:30:00Z')) // Fri 9:30 PM in Texas
    bayCold()
    const host = await mount()
    expect(current(host)).toBeUndefined()
    expect(host.querySelector('[data-held]').textContent).toMatch(/^3 leads are outside calling hours/)
    expect(host.querySelector('[data-held]').textContent).toMatch(/first opens/)
  })

  it('skips a Cold lead whose local time is closed and serves one that is open', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-20T15:30:00Z')) // 9:30 AM Central, 7:30 AM Pacific
    bayCold()
    db.data.leads[0].state = 'CA'
    const host = await mount()
    expect(current(host)).toBe('l2')
  })

  it('ignores calling hours on a Warm list', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-21T03:30:00Z'))
    bayCold()
    db.data.list.temperature = 'warm'
    const host = await mount()
    expect(current(host)).toBe('l1')
  })

  it('blocks a 4th dial in 24 hours with the reason, on any list', async () => {
    db.data.recent = [
      { phone_e164: '+17135550101', dialed_at: new Date(Date.now() - 3600_000).toISOString() },
      { phone_e164: '+17135550101', dialed_at: new Date(Date.now() - 2 * 3600_000).toISOString() },
    ]
    const host = await mount()
    expect(current(host)).toBe('l1')
    await callNow(host)
    await click(button(host, 'No answer'))
    await click(button(host, 'Save and next'))
    expect(current(host)).toBe('l2')
    await click(button(host, 'Back'))
    expect(current(host)).toBe('l1')
    expect(host.querySelector('a[href^="tel:"]')).toBeNull()
    expect(button(host, 'Call').disabled).toBe(true)
    expect(host.querySelector('[data-blocked]').textContent).toMatch(/3 calls to this number in the last 24 hours/)
  })

  it('passes over a lead already called 3 times today', async () => {
    db.data.recent = [1, 2, 3].map((h) => ({ phone_e164: '+17135550101', dialed_at: new Date(Date.now() - h * 3600_000).toISOString() }))
    const host = await mount()
    expect(current(host)).toBe('l2')
  })
})
