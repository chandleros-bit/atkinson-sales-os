// @vitest-environment jsdom
// Up Next page against a fake Supabase: bucket groups, the daily cap with
// "Show all", the touched-today line, the empty state, and tap-to-dial on a
// phone. Same createRoot + act style as Overview.render.test.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import React from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const iso = (daysAgo, hh = 9) => {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  d.setHours(hh, 0, 0, 0)
  return d.toISOString()
}
const lead = (o) => ({
  business_id: 'bay', company: null, phone: '7135550142', crm_profile_url: '#',
  stage: null, stage_since: null, is_hot: false, is_active: false, is_partner: false, score: null,
  crm_created_at: iso(400), crm_last_activity_at: null,
  last_outbound_at: iso(0, 0), last_outbound_call_at: iso(0, 0), last_inbound_at: null,
  open_task_count: 0, oldest_open_due_at: null, snooze_count_60d: 0, ...o,
})

const DATA = { signals: [], rules: { daily_cap: 2, use_crm_last_activity_fallback: false }, touched: [] }

function query(table) {
  const q = {}
  for (const m of ['select', 'eq', 'gte', 'order', 'range', 'or']) q[m] = () => q
  q.maybeSingle = () => ({ then: (r) => r({ data: table === 'settings' ? { value: DATA.rules } : null, error: null }) })
  q.then = (resolve) =>
    resolve({ data: table === 'v_lead_signals' ? DATA.signals : table === 'activities' ? DATA.touched : [], error: null })
  return q
}

vi.mock('../lib/supabase', () => ({ isDemoMode: false, supabase: { from: (t) => query(t), functions: { invoke: vi.fn() } } }))
vi.mock('../context/BusinessContext', () => ({ useBusiness: () => ({ biz: 'all', matches: () => true }) }))

let mobile = false
beforeEach(() => {
  document.body.innerHTML = ''
  window.matchMedia = (q) => ({ matches: mobile && q.includes('max-width'), addEventListener() {}, removeEventListener() {} })
})

const { default: Priority } = await import('./Priority')
const { refreshPriorityQueue } = await import('../lib/usePriorityQueue')

// The queue cache is module-level; reload it from this test's DATA rather than
// re-importing modules (which would load a second React).
async function render() {
  await refreshPriorityQueue()
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    createRoot(host).render(React.createElement(MemoryRouter, null, React.createElement(Priority)))
  })
  await act(async () => {})
  return host
}

describe('Up Next page', () => {
  it('groups by bucket, caps the list, and shows the rest on demand', async () => {
    mobile = false
    DATA.signals = [
      lead({ id: 'a', name: 'Ana Inbound', last_inbound_at: iso(0, 1) }),
      lead({ id: 'b', name: 'Ben Overdue', open_task_count: 1, oldest_open_due_at: iso(3) }),
      lead({ id: 'c', name: 'Cy Quiet', is_active: true, stage: 'New Lead', last_outbound_at: iso(20), last_outbound_call_at: iso(20), open_task_count: 1, oldest_open_due_at: iso(-2) }),
    ]
    DATA.touched = [{ contact_id: 'c', business_id: 'bay' }, { contact_id: 'c', business_id: 'bay' }, { contact_id: 'zz', business_id: 'bay' }]
    const host = await render()
    const text = host.textContent
    expect(text).toContain('Up Next')
    expect(text).toContain('1 touched today · 2 to go')
    expect(text).toContain('They reached out')
    expect(text).toContain('Follow-up overdue')
    expect(text).toContain('Follow-up 3 days overdue')
    expect(text).not.toContain('Cy Quiet')
    const showAll = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Show all 3')
    await act(async () => showAll.click())
    expect(host.textContent).toContain('Cy Quiet')
    expect(host.textContent).toContain('20 days since last touch')
  })

  it('leaves out leads the dial list already shows (hideIds)', async () => {
    mobile = false
    DATA.signals = [
      lead({ id: 'a', name: 'Ana Inbound', last_inbound_at: iso(0, 1) }),
      lead({ id: 'b', name: 'Ben Overdue', open_task_count: 1, oldest_open_due_at: iso(3) }),
    ]
    await refreshPriorityQueue()
    const host = document.createElement('div')
    document.body.appendChild(host)
    await act(async () => {
      createRoot(host).render(React.createElement(MemoryRouter, null, React.createElement(Priority, { embedded: true, hideIds: new Set(['a']) })))
    })
    await act(async () => {})
    expect(host.textContent).not.toContain('Ana Inbound')
    expect(host.textContent).toContain('Ben Overdue')
  })

  it('shows only the given buckets, and nothing at all when they are empty', async () => {
    mobile = false
    DATA.signals = [
      lead({ id: 'a', name: 'Ana Inbound', last_inbound_at: iso(0, 1) }),
      lead({ id: 'b', name: 'Ben Overdue', open_task_count: 1, oldest_open_due_at: iso(3) }),
    ]
    await refreshPriorityQueue()
    const host = document.createElement('div')
    document.body.appendChild(host)
    await act(async () => {
      createRoot(host).render(React.createElement(MemoryRouter, null,
        React.createElement(Priority, { embedded: true, buckets: ['overdue'] }),
        React.createElement('div', { id: 'none' }, React.createElement(Priority, { embedded: true, buckets: ['stuck'] })),
      ))
    })
    await act(async () => {})
    expect(host.textContent).toContain('Ben Overdue')
    expect(host.textContent).not.toContain('Ana Inbound')
    expect(host.querySelector('#none').textContent).toBe('')
  })

  it('makes the whole row a tel: link on a phone', async () => {
    mobile = true
    DATA.signals = [lead({ id: 'a', name: 'Ana Inbound', last_inbound_at: iso(0, 1) })]
    const host = await render()
    const link = host.querySelector('a[aria-label="Call Ana Inbound"]')
    expect(link.getAttribute('href')).toBe('tel:7135550142')
    expect(link.textContent).toContain('no callback')
  })

  it('shows the phone number on the card, formatted, as a call link', async () => {
    mobile = false
    DATA.signals = [lead({ id: 'a', name: 'Ana Inbound', last_inbound_at: iso(0, 1) })]
    const host = await render()
    const phone = host.querySelector('a[aria-label="Call Ana Inbound at (713) 555-0142"]')
    expect(phone.textContent).toBe('(713) 555-0142')
    expect(phone.getAttribute('href')).toBe('tel:7135550142')
  })

  it('shows the formatted number inside the tap-to-dial row on a phone', async () => {
    mobile = true
    DATA.signals = [lead({ id: 'a', name: 'Ana Inbound', last_inbound_at: iso(0, 1) })]
    const host = await render()
    const row = host.querySelector('a[aria-label="Call Ana Inbound"]')
    expect(row.textContent).toContain('(713) 555-0142')
    expect(row.querySelector('a')).toBe(null)
  })

  it('shows the lead source and the first note as quick facts', async () => {
    mobile = false
    DATA.signals = [
      lead({
        id: 'a', name: 'Ana Inbound', last_inbound_at: iso(0, 1), lead_source: 'Lendingflow',
        first_note: 'Credit: 660-699 / email: ana@example.com / loan type: DSCR Purchase / state: North Carolina / loan amount: $200K - $500K',
      }),
      lead({ id: 'b', name: 'Ben Overdue', open_task_count: 1, oldest_open_due_at: iso(3), lead_source: '<unspecified>', first_note: 'Wants to refi after rates drop' }),
    ]
    const host = await render()
    const facts = host.querySelector('[aria-label="First note for Ana Inbound"]')
    expect([...facts.querySelectorAll('span[data-fact]')].map((e) => e.textContent)).toEqual([
      'Credit 660-699', 'Loan type DSCR Purchase', 'State North Carolina', 'Amount $200K - $500K',
    ])
    expect(facts.textContent).not.toContain('ana@example.com')
    expect(host.querySelector('[title="Lead source"]').textContent).toBe('Lendingflow')
    expect(host.querySelectorAll('[title="Lead source"]')).toHaveLength(1)
    expect(host.querySelector('[aria-label="First note for Ben Overdue"]').textContent).toBe('“Wants to refi after rates drop”')
  })

  it('shows a PrivateMortgageLeads note as the same quick facts', async () => {
    mobile = false
    DATA.signals = [
      lead({
        id: 'p', name: 'Pat Private', last_inbound_at: iso(0, 1), lead_source: 'PrivateMortgageLeads',
        first_note: 'Loan Amount: $200K-$500K Credit Score: (740-799) Very Good State: GA Specific Property?: Purchase',
      }),
    ]
    const host = await render()
    const facts = host.querySelector('[aria-label="First note for Pat Private"]')
    expect([...facts.querySelectorAll('span[data-fact]')].map((e) => e.textContent)).toEqual([
      'Credit 740-799 Very Good', 'Loan type Purchase', 'State Georgia', 'Amount $200K - $500K',
    ])
  })

  it('shows the whole name, wrapping instead of cutting it off', async () => {
    mobile = false
    DATA.signals = [lead({ id: 'a', name: 'Maria Guadalupe Hernandez-Villarreal', last_inbound_at: iso(0, 1) })]
    const host = await render()
    const name = host.querySelector('[data-lead-name]')
    expect(name.textContent).toBe('Maria Guadalupe Hernandez-Villarreal')
    expect(name.className).not.toContain('truncate')
    expect(name.parentElement.className).toContain('flex-wrap')
  })

  it('shows the empty state when nobody is slipping', async () => {
    mobile = false
    DATA.signals = [lead({ id: 'fine', name: 'All Good' })]
    DATA.touched = []
    const host = await render()
    expect(host.textContent).toContain('Nobody slipping. Nice work.')
  })
})
