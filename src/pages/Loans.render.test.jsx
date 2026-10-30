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
// Dates relative to today (local) so the fixture never rots. The Newfi loan is
// funded this year but never this month: Jan 1, or Dec 1 when it is January.
const pad = (n) => String(n).padStart(2, '0')
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const TODAY = new Date()
const THIS_YEAR_NOT_THIS_MONTH = key(new Date(TODAY.getFullYear(), TODAY.getMonth() === 0 ? 11 : 0, 1))
const BASE_LOANS = [
  loan({ arive_loan_id: '1', borrower_name: 'Gina Park', stage: 'Loan Funded', stage_group: 'funded', amount: 400000, lender: 'UWM', funded_on: key(TODAY) }),
  loan({ arive_loan_id: '2', borrower_name: 'Omar Vale', role: 'assisted', loan_officer: 'Ronnie Gaydos', amount: 200000 }),
  loan({ arive_loan_id: '3', borrower_name: 'Test Test', scenario_auto: true, amount: 633750 }),
  loan({ arive_loan_id: '4', borrower_name: 'Lena Ford', stage: 'Loan Funded', stage_group: 'funded', amount: 300000, lender: 'Newfi', funded_on: THIS_YEAR_NOT_THIS_MONTH }),
]
const DATA = { loans: BASE_LOANS, updates: [], upserts: [], updateError: null }

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
  q.update = (patch) => { DATA.updates.push(patch); return { eq: () => Promise.resolve({ error: DATA.updateError }) } }
  q.upsert = (rows) => { DATA.upserts.push({ table, rows }); return Promise.resolve({ error: null }) }
  q.insert = () => Promise.resolve({ error: null })
  q.then = (resolve) => resolve({ data: table === 'loans' ? DATA.loans : [], error: null })
  return q
}

vi.mock('../lib/supabase', () => ({ isDemoMode: false, supabase: { from: (t) => query(t) } }))

beforeEach(() => {
  document.body.innerHTML = ''
  DATA.updates = []
  DATA.upserts = []
  DATA.updateError = null
  DATA.loans = [...BASE_LOANS]
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
})

const { default: Loans } = await import('./Loans')
const { default: Toaster } = await import('../components/Toaster')

async function render() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    createRoot(host).render(React.createElement(MemoryRouter, null, React.createElement(Loans), React.createElement(Toaster)))
  })
  await act(async () => {})
  return host
}

const settle = () => act(async () => new Promise((r) => setTimeout(r, 0)))
const buttonNamed = (root, t) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === t)
const typeInto = (el, value) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
const press = (el, k) => act(async () => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })) })

// Opens the commission editor on a row and returns its input.
async function editComp(host, id) {
  const cell = host.querySelector(`[data-loan="${id}"] td:nth-child(7) button`)
  await act(async () => cell.click())
  return host.querySelector(`[data-loan="${id}"] input[aria-label^="Commission for"]`)
}

// jsdom's File may lack text(); read it through FileReader when so.
if (typeof File !== 'undefined' && !File.prototype.text) {
  File.prototype.text = function text() {
    return new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(r.result)
      r.onerror = () => reject(r.error)
      r.readAsText(this)
    })
  }
}

describe('Loans page', () => {
  it('shows the three panels and hides scenario files by default', async () => {
    const host = await render()
    const text = host.textContent
    expect(text).toContain('Pipeline Status')
    expect(text).toContain('Lender Spread')
    expect(text).toMatch(/Loans? Funded/)
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

  it('Lender Spread defaults to YTD and narrows to this month', async () => {
    const host = await render()
    const panel = host.querySelector('[data-panel="lender-spread"]')
    const pill = (t) => [...panel.querySelectorAll('[role="group"] button')].find((b) => b.textContent === t)
    expect(pill('YTD').getAttribute('aria-pressed')).toBe('true')
    expect(panel.textContent).toContain('UWM')
    expect(panel.textContent.includes('Newfi')).toBe(TODAY.getMonth() > 0)
    await act(async () => pill('Year').click())
    expect(panel.textContent).toContain('Newfi')
    expect(panel.querySelector('[role="img"]').getAttribute('aria-label')).toMatch(/UWM 1.*Newfi 1|Newfi 1.*UWM 1/)
    await act(async () => pill('This month').click())
    expect(pill('This month').getAttribute('aria-pressed')).toBe('true')
    expect(panel.textContent).toContain('UWM')
    expect(panel.textContent).not.toContain('Newfi')
    expect(panel.querySelector('[role="img"]').getAttribute('aria-label')).toContain('UWM 1')
  })

  it('draws the lender ring only when loans funded in the period', async () => {
    DATA.loans = BASE_LOANS.filter((l) => !l.funded_on)
    const host = await render()
    expect(host.querySelector('[data-panel="lender-spread"] [role="img"]')).toBeNull()
  })

  it('Loans Funded title is singular for one loan and plural otherwise', async () => {
    let host = await render()
    const title = (h) => h.querySelector('[data-panel="loans-funded"]').textContent
    expect(title(host)).toContain('2 Loans Funded')
    document.body.innerHTML = ''
    DATA.loans = BASE_LOANS.filter((l) => l.arive_loan_id !== '4')
    host = await render()
    expect(title(host)).toContain('1 Loan Funded')
    expect(title(host)).not.toContain('1 Loans Funded')
  })

  it('Pipeline Status shows Now until a loan has an application date', async () => {
    const host = await render()
    const panel = host.querySelector('[data-panel="pipeline-status"]')
    expect(panel.querySelector('[role="group"]')).toBeNull()
    expect(panel.textContent).toContain('add Application Date for YTD')
  })

  it('Pipeline Status filters by application date once one exists', async () => {
    DATA.loans = [...BASE_LOANS, loan({ arive_loan_id: '5', borrower_name: 'Ada New', application_on: key(TODAY) })]
    const host = await render()
    const panel = host.querySelector('[data-panel="pipeline-status"]')
    const pills = [...panel.querySelectorAll('[role="group"] button')]
    expect(pills.map((b) => b.textContent)).toEqual(['Now', 'YTD', 'This month'])
    expect(pills[0].getAttribute('aria-pressed')).toBe('true')
    const intake = () => panel.querySelector('[data-stage="App Intake"] .num').textContent
    expect(intake()).toBe('2') // Omar + Ada
    await act(async () => pills[2].click())
    expect(intake()).toBe('1') // only Ada has an application date
    await act(async () => pills[1].click())
    expect(intake()).toBe('1')
  })

  it('Loans Funded switches between this year and last year', async () => {
    const y = TODAY.getFullYear()
    DATA.loans = [...BASE_LOANS, loan({ arive_loan_id: '6', borrower_name: 'Old Funded', stage: 'Loan Funded', stage_group: 'funded', amount: 500000, lender: 'UWM', funded_on: `${y - 1}-06-15` })]
    const host = await render()
    const panel = host.querySelector('[data-panel="loans-funded"]')
    const pill = (t) => [...panel.querySelectorAll('[role="group"] button')].find((b) => b.textContent === t)
    expect(pill(String(y)).getAttribute('aria-pressed')).toBe('true')
    expect(panel.textContent).toContain('2 Loans Funded')
    await act(async () => pill(String(y - 1)).click())
    expect(pill(String(y - 1)).getAttribute('aria-pressed')).toBe('true')
    expect(panel.textContent).toContain('1 Loan Funded')
    // Lender Spread's Year still means this year.
    const spread = host.querySelector('[data-panel="lender-spread"]')
    await act(async () => [...spread.querySelectorAll('[role="group"] button')].find((b) => b.textContent === 'Year').click())
    expect(spread.querySelector('[role="img"]').getAttribute('aria-label')).toMatch(/UWM 1/)
  })

  it('saves a typed commission, dropping $ and commas', async () => {
    const host = await render()
    const input = await editComp(host, '1')
    expect(input.getAttribute('aria-label')).toBe('Commission for Gina Park')
    await typeInto(input, '$4,200')
    await press(input, 'Enter')
    expect(DATA.updates).toHaveLength(1)
    expect(DATA.updates[0]).toMatchObject({ comp_override: 4200 })
    expect(host.querySelector('[data-loan="1"]').textContent).toContain('$4,200 *')
  })

  it('ignores a commission that is not a number', async () => {
    const host = await render()
    const input = await editComp(host, '1')
    await typeInto(input, 'abc')
    await press(input, 'Enter')
    expect(DATA.updates).toHaveLength(0)
    expect(host.textContent).not.toContain('NaN')
    expect(host.querySelector('[data-loan="1"]').textContent).toContain('$5,000')
  })

  it('clearing a commission resets it to the estimate', async () => {
    DATA.loans = BASE_LOANS.map((l) => (l.arive_loan_id === '1' ? { ...l, comp_override: 4200 } : l))
    const host = await render()
    const input = await editComp(host, '1')
    await typeInto(input, '')
    await press(input, 'Enter')
    expect(DATA.updates[0]).toMatchObject({ comp_override: null })
    expect(host.querySelector('[data-loan="1"]').textContent).toContain('$5,000')
  })

  it('does not save an unchanged commission', async () => {
    DATA.loans = BASE_LOANS.map((l) => (l.arive_loan_id === '1' ? { ...l, comp_override: 4200 } : l))
    const host = await render()
    const input = await editComp(host, '1')
    await press(input, 'Enter')
    expect(DATA.updates).toHaveLength(0)
  })

  it('restores a scenario toggle when the save fails', async () => {
    DATA.updateError = { message: 'network down' }
    const host = await render()
    const toggle = () => host.querySelector('[data-loan="2"] input[name="scenario"]')
    expect(toggle().getAttribute('aria-label')).toBe('Scenario file: Omar Vale')
    await act(async () => toggle().click())
    await settle()
    expect(DATA.updates[0]).toMatchObject({ scenario_override: true })
    expect(toggle().checked).toBe(false)
    expect(document.body.querySelector('[role="status"]').textContent).toContain('Omar Vale')
    expect(buttonNamed(document.body, 'Retry')).toBeTruthy()
  })

  it('labels an assisted loan without a loan officer as Assisted', async () => {
    DATA.loans = [loan({ arive_loan_id: '9', borrower_name: 'No Officer', role: 'assisted', loan_officer: null })]
    const host = await render()
    expect(host.querySelector('[data-loan="9"]').textContent).toContain('Assisted')
    expect(host.querySelector('[data-loan="9"]').textContent).not.toContain('null')
  })

  it('shows the last import as relative time with the full date on hover', async () => {
    const host = await render()
    const note = [...host.querySelectorAll('[title]')].find((el) => el.textContent.includes('Last import'))
    expect(note.textContent).toMatch(/Last import (just now|\d+[mhd] ago)/)
    expect(note.getAttribute('title')).toBe(new Date('2026-10-30T12:00:00Z').toLocaleString())
  })

  it('rates editor accepts 1.25% as 1.25 and saves before closing', async () => {
    const host = await render()
    await act(async () => buttonNamed(host, 'Rates').click())
    const dialog = host.querySelector('[role="dialog"]')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    const [name, primary] = dialog.querySelectorAll('input')
    expect(document.activeElement).toBe(name)
    await typeInto(primary, '1.25%')
    await act(async () => buttonNamed(dialog, 'Save').click())
    await settle()
    const saved = DATA.upserts.find((u) => u.table === 'settings')
    expect(saved.rows.value).toMatchObject({ lo_name: 'Chandler Dean Atkinson', primary_pct: 1.25, assisted_pct: 0.75 })
    expect(host.querySelector('[role="dialog"]')).toBeNull()
  })

  it('rates editor rejects a blank name and stays open', async () => {
    const host = await render()
    await act(async () => buttonNamed(host, 'Rates').click())
    const dialog = host.querySelector('[role="dialog"]')
    const [name] = dialog.querySelectorAll('input')
    await typeInto(name, '   ')
    await act(async () => buttonNamed(dialog, 'Save').click())
    await settle()
    expect(DATA.upserts).toHaveLength(0)
    expect(host.querySelector('[role="dialog"]')).not.toBeNull()
    expect(host.querySelector('[role="dialog"] [role="alert"]').textContent).toMatch(/name/i)
  })

  it('Escape closes the import dialog', async () => {
    const host = await render()
    await act(async () => buttonNamed(host, 'Import CSV').click())
    const dialog = host.querySelector('[role="dialog"]')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(dialog.querySelector('input[type="file"]'))
    await press(window, 'Escape')
    expect(host.querySelector('[role="dialog"]')).toBeNull()
  })

  it('imports a picked file: preview, then confirm upserts the loans', async () => {
    const host = await render()
    await act(async () => buttonNamed(host, 'Import CSV').click())
    const input = host.querySelector('input[aria-label="Arive CSV export"]')
    const csv = [
      'ARIVE Loan Id,Stage Name,Total Loan Amount,Primary Loan Officer Name,Primary Borrower',
      '100,App Intake,250000,Chandler Dean Atkinson,New Person',
      '1,Loan Funded,400000,Chandler Dean Atkinson,Gina Park',
    ].join('\n')
    const file = new File([csv], 'arive.csv', { type: 'text/csv' })
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
    await settle()
    await settle()
    const dialog = host.querySelector('[role="dialog"]')
    expect(dialog.textContent).toContain('2 loans in this file')
    expect(input.value).toBe('')
    await act(async () => buttonNamed(dialog, 'Import 2 loans').click())
    await settle()
    const up = DATA.upserts.find((u) => u.table === 'loans')
    expect(up.rows.map((r) => r.arive_loan_id)).toEqual(['100', '1'])
    expect(host.querySelector('[role="dialog"]')).toBeNull()
  })
})
