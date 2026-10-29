// @vitest-environment jsdom
// Priority Leads: a lead's name opens the contact card (like every other list),
// not FollowUpBoss in a new tab.
import { describe, it, expect, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import React from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const opened = []
const ROW = { id: 'c1', name: 'Cy Applied', owner: 'Chandler', score: 91, tier: 'hot', last_activity_at: null, last_activity_type: null, ai_note: null, tags: [], fub_profile_url: 'https://fub.example/p/1', phone: '8325550100' }

function query() {
  const q = {}
  for (const m of ['select', 'eq', 'order', 'range']) q[m] = () => q
  q.maybeSingle = async () => ({ data: { value: { bay: true, mpg: true } }, error: null })
  q.then = (resolve) => resolve({ data: [ROW], error: null })
  return q
}

vi.mock('../lib/supabase', () => ({ isDemoMode: false, supabase: { from: () => query() } }))
vi.mock('../components/PersonSheet', () => ({ openPerson: (id) => opened.push(id) }))

const { default: PriorityLeads } = await import('./PriorityLeads')

describe('Priority Leads', () => {
  it("opens the contact card from a lead's name", async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    await act(async () => createRoot(host).render(React.createElement(PriorityLeads)))
    await act(async () => {})
    const link = host.querySelector('[data-person-link]')
    expect(link.textContent).toBe('Cy Applied')
    expect(host.querySelector('a[href="https://fub.example/p/1"]')).toBe(null)
    await act(async () => link.click())
    expect(opened).toEqual(['c1'])
  })
})
