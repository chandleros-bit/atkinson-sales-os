// @vitest-environment jsdom
// Partners: syncs on load, lists partners furthest stage first with stage
// counts, filters by stage, and saves a stage change to partner_profiles.
import { describe, it, expect, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import React from 'react'
import { MemoryRouter } from 'react-router-dom'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const calls = { rpc: [], update: [] }
const ROWS = [
  { id: 'a', contact_id: 'c1', fub_id: '11', name: 'Laura Hughes', brokerage: 'Compass', partner_type: 'realtor', partner_stage: 'dream_20', source: 'fub', last_touch_at: new Date().toISOString(), next_touch_due: null, loans_sent: 2, loans_funded: 1 },
  { id: 'b', contact_id: null, fub_id: null, name: 'Sam Lee', brokerage: 'KW', partner_type: 'realtor', partner_stage: 'prospect', source: 'arive', last_touch_at: null, next_touch_due: null, loans_sent: 1, loans_funded: 0 },
]

function query(table) {
  const q = {}
  for (const m of ['select', 'eq', 'order', 'limit', 'gte', 'in', 'not', 'range']) q[m] = () => q
  q.maybeSingle = async () => ({ data: null, error: null })
  q.update = (patch) => {
    calls.update.push({ table, patch })
    return q
  }
  q.then = (resolve) => resolve({ data: table === 'v_partners' ? ROWS : null, error: null })
  return q
}

vi.mock('../lib/supabase', () => ({
  isDemoMode: false,
  supabase: { from: (t) => query(t), rpc: async (name) => { calls.rpc.push(name); return { data: 0, error: null } } },
}))
vi.mock('../components/PersonSheet', () => ({ openPerson: () => {} }))

const { default: Partners } = await import('./Partners')

describe('Partners', () => {
  it('lists partners, filters by stage and saves a stage change', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    await act(async () => createRoot(host).render(React.createElement(MemoryRouter, null, React.createElement(Partners))))
    await act(async () => {})
    await act(async () => {})
    expect(calls.rpc).toEqual(['sync_partner_profiles'])

    const names = () => [...host.querySelectorAll('tr[data-partner]')].map((r) => r.querySelector('td').textContent)
    expect(names()[0]).toContain('Laura Hughes')
    expect(names()[1]).toContain('Sam Lee')
    expect(host.querySelector('tr[data-partner="a"]').textContent).toContain('2 · 1 funded')
    expect(host.querySelector('tr[data-partner="b"] [data-touch]').textContent).toBe('Never')
    expect(host.querySelector('[data-stage-filter="dream_20"]').textContent).toContain('1')

    await act(async () => host.querySelector('[data-stage-filter="prospect"]').click())
    expect(names()).toHaveLength(1)
    expect(names()[0]).toContain('Sam Lee')

    const select = host.querySelector('tr[data-partner="b"] select[aria-label="Stage"]')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
      setter.call(select, 'invited')
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => {})
    expect(calls.update).toHaveLength(1)
    expect(calls.update[0].table).toBe('partner_profiles')
    expect(calls.update[0].patch.partner_stage).toBe('invited')
    expect(calls.update[0].patch.stage_since).toBeTruthy()
  })
})
