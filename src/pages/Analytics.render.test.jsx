// @vitest-environment jsdom
// Analytics: the calling heatmap and the lead-source tables, by business filter.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import React from 'react'
import { MemoryRouter } from 'react-router-dom'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const DATA = { activities: [], contacts: [], loans: [], source_aliases: [], marketing_spend: [], sync_log: [] }
const ERRORS = {}
let filter = 'all'

function query(table) {
  let from = 0
  let to = 999
  let write = false
  const q = {}
  for (const m of ['select', 'eq', 'gte', 'order', 'limit', 'in']) q[m] = () => q
  // ERRORS fail reads only, so a save can succeed and its reload fail.
  for (const m of ['upsert', 'delete'])
    q[m] = () => {
      write = true
      return q
    }
  q.range = (a, b) => {
    from = a
    to = b
    return q
  }
  q.maybeSingle = async () => ({ data: table === 'settings' ? { value: { calls: 10 } } : null, error: null })
  q.then = (resolve) => resolve(ERRORS[table] && !write ?{ data: null, error: ERRORS[table] } : { data: (DATA[table] || []).slice(from, to + 1), error: null })
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
  for (const k of Object.keys(ERRORS)) delete ERRORS[k]
  DATA.contacts = [
    { id: 'c1', business_id: 'bay', person_stage: 'Lead', bay_source: 'LendingFlow', bay_created: daysAgo(10), tags: ['estimate sent'] },
    { id: 'c2', business_id: 'bay', person_stage: 'Lead', bay_source: 'LendingFlow', bay_created: daysAgo(20), tags: [] },
    { id: 'c3', business_id: 'bay', person_stage: 'Lead', bay_source: 'Old', bay_created: daysAgo(200), tags: [] },
    { id: 'c4', business_id: 'mpg', person_stage: 'Qualified', mpg_source: 'Web', mpg_created: daysAgo(5), tags: null },
  ]
  const d = new Date()
  const key = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
  const lastMonth = new Date(d.getFullYear(), d.getMonth() - 1, 1)
  DATA.loans = [{ id: 1, business_id: 'bay', stage_group: 'funded', funded_on: key(new Date(Date.now() - 3 * 86400000)), amount: 300000, role: 'primary', contact_id: 'c1', scenario_auto: false, scenario_override: null, comp_override: null }]
  DATA.source_aliases = []
  DATA.marketing_spend = [{ id: 's1', book: 'bay', source: 'LendingFlow', month: key(lastMonth), amount: 300 }]
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

  it('shows funded loans, commission, spend and costs per source, with KPI tiles', async () => {
    const host = await mount()
    const bay = host.querySelector('[aria-label="Bayway · FollowUpBoss"]')
    const lf = bay.querySelector('[data-source="LendingFlow"]')
    expect(lf.querySelector('[data-funded]').textContent).toBe('1')
    expect(lf.querySelector('[data-commission]').textContent).toBe('$3,750')
    expect(lf.querySelector('[data-spend]').textContent).toBe('$300')
    expect(lf.querySelector('[data-cpl]').textContent).toBe('$150')
    expect(lf.querySelector('[data-cpf]').textContent).toBe('$300')
    expect(bay.querySelector('[data-kpi="cpl"]').textContent).toContain('$150')
    const mpg = host.querySelector('[aria-label="MPG · Zoho"]')
    expect(mpg.querySelector('[data-kpi="cpf"]')).toBeNull()
    expect(mpg.querySelector('[data-source="Web"] [data-spend]').textContent).toBe('—')
  })

  it('opens the Spend sheet', async () => {
    const host = await mount()
    await act(async () => host.querySelector('button[aria-label="Spend"]').click())
    expect(document.querySelector('[role="dialog"][aria-label="Marketing spend"]')).not.toBe(null)
  })

  it('keeps the lead rows and says so when spend cannot load', async () => {
    ERRORS.marketing_spend = { message: 'boom' }
    const host = await mount()
    expect(host.querySelector('[role="alert"]').textContent).toBe("Couldn't load spend or loans: boom")
    expect(host.querySelector('[aria-label="Bayway · FollowUpBoss"] [data-source="LendingFlow"] [data-rate]').textContent).toBe('50%')
  })

  it('a failed reload after a sheet action keeps the spend already shown', async () => {
    const host = await mount()
    const spendCell = () => host.querySelector('[aria-label="Bayway · FollowUpBoss"] [data-source="LendingFlow"] [data-spend]')
    expect(spendCell().textContent).toBe('$300')
    await act(async () => host.querySelector('button[aria-label="Spend"]').click())
    ERRORS.marketing_spend = { message: 'reload failed' }
    await act(async () => document.querySelector('input[aria-label="Free LendingFlow"]').click())
    await act(async () => {})
    expect(host.querySelector('[role="alert"]').textContent).toBe("Couldn't load spend or loans: reload failed")
    expect(spendCell().textContent).toBe('$300')
    expect(document.querySelector('[role="dialog"] [role="alert"]').textContent).toBe("Saved, but couldn't reload: reload failed")
  })

  it('a failed reload after Save keeps the sheet open with the error in it', async () => {
    const host = await mount()
    await act(async () => host.querySelector('button[aria-label="Spend"]').click())
    const cell = [...document.querySelectorAll('input[aria-label^="LendingFlow "]')].find((i) => i.value === '300')
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    await act(async () => {
      set.call(cell, '400')
      cell.dispatchEvent(new Event('input', { bubbles: true }))
    })
    ERRORS.marketing_spend = { message: 'reload failed' }
    await act(async () => document.querySelector('button[aria-label="Save spend"]').click())
    await act(async () => {})
    const dialog = document.querySelector('[role="dialog"][aria-label="Marketing spend"]')
    expect(dialog).not.toBe(null)
    expect(dialog.querySelector('[role="alert"]').textContent).toBe("Saved, but couldn't reload: reload failed")
  })

  it('a source literally named "Total" or "Not linked to a lead" gets its own row', async () => {
    DATA.contacts.push(
      { id: 'c5', business_id: 'bay', person_stage: 'Lead', bay_source: 'Total', bay_created: daysAgo(3), tags: [] },
      { id: 'c6', business_id: 'bay', person_stage: 'Lead', bay_source: 'Not linked to a lead', bay_created: daysAgo(3), tags: [] },
    )
    DATA.loans.push({ ...DATA.loans[0], id: 2, contact_id: null })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const host = await mount()
    const dupes = errors.mock.calls.filter((c) => String(c[0]).includes('same key'))
    errors.mockRestore()
    expect(dupes).toEqual([])
    const bay = host.querySelector('[aria-label="Bayway · FollowUpBoss"]')
    expect(bay.querySelectorAll('[data-source="Total"]')).toHaveLength(2)
    expect(bay.querySelectorAll('[data-source="Not linked to a lead"]')).toHaveLength(2)
  })
})
