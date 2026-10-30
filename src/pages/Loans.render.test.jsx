// @vitest-environment jsdom
// Loans page against a fake Supabase: panels, filters, the scenario toggle,
// and the import dialog's preview. Same createRoot + act style as the other
// render tests.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import React from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const loan = (o) => ({
  id: o.arive_loan_id, role: 'primary', loan_officer: 'Chandler Dean Atkinson', stage: 'App Intake', stage_group: 'prospect',
  amount: 100000, purpose: 'Purchase', lender: null, funded_on: null, firm_closing_on: null, contact_id: null,
  scenario_auto: false, scenario_override: null, comp_override: null, last_seen_at: '2026-10-30T12:00:00Z', ...o,
})
const DATA = {
  loans: [
    loan({ arive_loan_id: '1', borrower_name: 'Gina Park', stage: 'Loan Funded', stage_group: 'funded', amount: 400000, lender: 'UWM', funded_on: '2026-10-03' }),
    loan({ arive_loan_id: '2', borrower_name: 'Omar Vale', role: 'assisted', loan_officer: 'Ronnie Gaydos', amount: 200000 }),
    loan({ arive_loan_id: '3', borrower_name: 'Test Test', scenario_auto: true, amount: 633750 }),
  ],
  updates: [],
}

function query(table) {
  const q = {}
  for (const m of ['select', 'eq', 'gte', 'lt', 'in', 'order', 'limit', 'range', 'or']) q[m] = () => q
  q.maybeSingle = () => ({
    then: (r) => r({
      data: table === 'settings' ? { value: { lo_name: 'Chandler Dean Atkinson', primary_pct: 1.25, assisted_pct: 0.75 } }
        : table === 'sync_log' ? { ran_at: '2026-10-30T12:00:00Z', records_upserted: 3 } : null,
      error: null,
    }),
  })
  q.update = (patch) => { DATA.updates.push(patch); return { eq: () => Promise.resolve({ error: null }) } }
  q.then = (resolve) => resolve({ data: table === 'loans' ? DATA.loans : [], error: null })
  return q
}

vi.mock('../lib/supabase', () => ({ isDemoMode: false, supabase: { from: (t) => query(t) } }))

beforeEach(() => {
  document.body.innerHTML = ''
  DATA.updates = []
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
})

const { default: Loans } = await import('./Loans')

async function render() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    createRoot(host).render(React.createElement(MemoryRouter, null, React.createElement(Loans)))
  })
  await act(async () => {})
  return host
}

describe('Loans page', () => {
  it('shows the three panels and hides scenario files by default', async () => {
    const host = await render()
    const text = host.textContent
    expect(text).toContain('Pipeline Status')
    expect(text).toContain('Lender Spread')
    expect(text).toContain('Loans Funded')
    expect(text).toContain('Gina Park')
    expect(text).toContain('Omar Vale')
    expect(text).not.toContain('Test Test')
    expect(text).toContain('$5,000') // 1.25% of 400,000
    expect(text).toContain('$1,500') // 0.75% of 200,000
  })

  it('shows scenario files when asked and filters by role', async () => {
    const host = await render()
    const box = host.querySelector('input[name="scenarios"]')
    await act(async () => box.click())
    expect(host.textContent).toContain('Test Test')
    const assisted = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Assisted')
    await act(async () => assisted.click())
    expect(host.textContent).not.toContain('Gina Park')
    expect(host.textContent).toContain('Omar Vale')
  })

  it('saves a scenario toggle on a loan', async () => {
    const host = await render()
    const toggle = host.querySelector('[data-loan="2"] input[name="scenario"]')
    await act(async () => toggle.click())
    expect(DATA.updates[0]).toMatchObject({ scenario_override: true })
  })

  it('opens the import dialog', async () => {
    const host = await render()
    const btn = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Import CSV')
    await act(async () => btn.click())
    expect(host.querySelector('[role="dialog"]').textContent).toContain('Import Arive loans')
  })
})
