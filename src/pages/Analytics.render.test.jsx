// @vitest-environment jsdom
// Analytics: the calling heatmap and the lead-source tables, by business filter.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import React from 'react'
import { MemoryRouter } from 'react-router-dom'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const DATA = { activities: [], contacts: [] }
let filter = 'all'

function query(table) {
  let from = 0
  let to = 999
  const q = {}
  for (const m of ['select', 'eq', 'gte', 'order', 'limit']) q[m] = () => q
  q.range = (a, b) => {
    from = a
    to = b
    return q
  }
  q.maybeSingle = async () => ({ data: table === 'settings' ? { value: { calls: 10 } } : null, error: null })
  q.then = (resolve) => resolve({ data: (DATA[table] || []).slice(from, to + 1), error: null })
  return q
}

vi.mock('../lib/supabase', () => ({ isDemoMode: false, supabase: { from: (t) => query(t) } }))
vi.mock('../context/BusinessContext', () => ({ useBusiness: () => ({ biz: filter }) }))

const { default: Analytics } = await import('./Analytics')

const today = (h) => {
  const d = new Date()
  d.setHours(h, 0, 0, 0)
  return d.toISOString()
}
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString()

async function mount() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    createRoot(host).render(React.createElement(MemoryRouter, null, React.createElement(Analytics)))
  })
  await act(async () => {})
  await act(async () => {})
  return host
}

beforeEach(() => {
  document.body.innerHTML = ''
  filter = 'all'
  DATA.activities = [
    ...Array.from({ length: 10 }, (_, i) => ({ occurred_at: today(9), business_id: i < 7 ? 'bay' : 'mpg' })),
  ]
  DATA.contacts = [
    { business_id: 'bay', person_stage: 'Lead', bay_source: 'LendingFlow', bay_created: daysAgo(10), tags: ['estimate sent'] },
    { business_id: 'bay', person_stage: 'Lead', bay_source: 'LendingFlow', bay_created: daysAgo(20), tags: [] },
    { business_id: 'bay', person_stage: 'Lead', bay_source: 'Old', bay_created: daysAgo(200), tags: [] },
    { business_id: 'mpg', person_stage: 'Qualified', mpg_source: 'Web', mpg_created: daysAgo(5), tags: null },
  ]
})

describe('Analytics', () => {
  it("shades today's calls, counts days at goal and lists both books' sources", async () => {
    const host = await mount()
    const heat = host.querySelector('[aria-label="Calling heatmap"]')
    expect(heat.textContent).toContain('Days at goal (10)1')
    expect(heat.querySelectorAll('[data-heat="4"]')).toHaveLength(1)
    const bay = host.querySelector('[aria-label="Bayway · FollowUpBoss"]')
    expect(bay.querySelector('[data-source="LendingFlow"] [data-rate]').textContent).toBe('50%')
    expect(bay.querySelector('[data-source="Old"]')).toBeNull()
    expect(host.querySelector('[aria-label="MPG · Zoho"] [data-source="Web"] [data-rate]').textContent).toBe('100%')
  })

  it('the 12-month window brings older leads in', async () => {
    const host = await mount()
    await act(async () => [...host.querySelectorAll('[role="tab"]')].find((b) => b.textContent === '12 months').click())
    expect(host.querySelector('[aria-label="Bayway · FollowUpBoss"] [data-source="Old"]')).not.toBeNull()
  })

  it('a book filter narrows the calls and hides the other book', async () => {
    filter = 'bay'
    const host = await mount()
    // Only the 7 Bayway calls count: short of the goal of 10.
    expect(host.querySelector('[aria-label="Calling heatmap"]').textContent).toContain('Days at goal (10)0')
    expect(host.querySelectorAll('[data-heat="4"]')).toHaveLength(1)
    expect(host.querySelector('[aria-label="MPG · Zoho"]')).toBeNull()
  })
})
