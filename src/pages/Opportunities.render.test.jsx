// @vitest-environment jsdom
// Opportunities: today's pick shows its call-prep note, reason chips and the
// estimate label, and its outcome buttons; the name opens the contact card.
import { describe, it, expect, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import React from 'react'
import { MemoryRouter } from 'react-router-dom'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const opened = []
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
const PICK = {
  id: 'p1', pick_date: today, contact_id: 'c1', rank: 1, score: 60, kind: 'review',
  reason_codes: ['RATE_GAP_HIGH', 'EQUITY_100K'], status: 'pending', outcome_note: null,
  ai_note: { headline: 'Rate looks high and equity has grown', why_now: ['Their rate looks well above today.'], known: ['Owned about 4 years'], unknown: ['Current plans'], opener: "Hey Maria, it's Chandler.", channel: 'call - warm', do_not_say: ['Any rate'], fub_task: 'CA: Mortgage review follow-up' },
  contacts: { id: 'c1', name: 'Maria Lopez', raw: { firstName: 'Maria' } },
}
const DATA = {
  opportunity_picks: [PICK],
  opportunity_estimates: [{ contact_id: 'c1', est_rate: 7.125, est_value: 450000, est_balance: 280833, est_equity: 169167, years_owned: 4.2, computed_at: '2026-11-18T11:00:00Z' }],
  past_client_property: [{ contact_id: 'c1', address: '12211 HURST CT', city: 'CYPRESS', source: 'hcad' }],
}

function query(table) {
  const q = {}
  for (const m of ['select', 'eq', 'order', 'range', 'limit', 'gte', 'in', 'not']) q[m] = () => q
  q.maybeSingle = async () => ({ data: null, error: null })
  q.then = (resolve) => resolve({ data: DATA[table] || [], error: null, count: 0 })
  return q
}

vi.mock('../lib/supabase', () => ({ isDemoMode: false, supabase: { from: (t) => query(t) } }))
vi.mock('../components/PersonSheet', () => ({ openPerson: (id) => opened.push(id) }))

const { default: Opportunities } = await import('./Opportunities')

describe('Opportunities', () => {
  it("shows today's pick with its note, chips, estimate label and outcome buttons", async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    await act(async () => createRoot(host).render(React.createElement(MemoryRouter, null, React.createElement(Opportunities))))
    await act(async () => {})
    await act(async () => {})
    const card = host.querySelector('[data-pick="p1"]')
    expect(card).not.toBeNull()
    expect(card.textContent).toContain('Rate looks high and equity has grown')
    expect(card.textContent).toContain('Rate gap 1+ pt')
    expect(card.textContent).toContain('Estimate · Harris County')
    expect([...card.querySelectorAll('button')].map((b) => b.textContent)).toEqual(
      expect.arrayContaining(['Connected', 'No answer', 'Skip', 'Not a fit']),
    )
    const link = card.querySelector('[data-person-link]')
    expect(link.textContent).toBe('Maria Lopez')
    await act(async () => link.click())
    expect(opened).toEqual(['c1'])
  })
})
