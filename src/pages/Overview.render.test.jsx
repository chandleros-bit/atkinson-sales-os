// @vitest-environment jsdom
// Render smoke test: mounts the command center against a fake Supabase client
// so every card is exercised with real-shaped data. Guards the JSX wiring that
// the pure lib tests cannot reach.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import React from 'react'

const today = (() => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
})()
const monthFirst = today.slice(0, 8) + '01'

const TABLES = {
  metrics_daily: [
    { date: today, business_id: 'bay', metric_key: 'calls', value: 47 },
    { date: today, business_id: 'mpg', metric_key: 'calls', value: 31 },
    { date: today, business_id: 'bay', metric_key: 'live_conversations', value: 12 },
    { date: monthFirst, business_id: 'mpg', metric_key: 'rev_monthly_residual', value: 8400 },
  ],
  // Every settings key gets this row: as metric_targets it sets calls; as
  // 'arive' resolveRates keeps primary_pct and drops calls (unknown key).
  settings: { value: { calls: 100, primary_pct: 1.25 } },
  sync_log: { ran_at: new Date().toISOString(), status: 'ok', message: null },
  v_tasks: [{ id: 't1', business_id: 'bay', due_at: new Date().toISOString() }],
  v_active_pipeline: [
    { id: 'p1', business_id: 'bay', name: 'Ramirez', email: null, phone: '555', last_touch_at: null, stage: 'Pre-Approved' },
    { id: 'p2', business_id: 'bay', name: 'Nguyen', email: null, phone: '555', last_touch_at: new Date().toISOString(), stage: 'App Sent' },
  ],
  contacts: [
    { id: 'p1', name: 'Ramirez', email: null, phone: '555', last_touch_at: null, external_id: '9', tags: ['HOT'] },
  ],
  deals: [
    { status: 'won', value: 340000, expected_close: today, business_id: 'bay' },
    { status: 'open', value: 215000, expected_close: today, business_id: 'bay' },
  ],
  // One primary loan funded today: Arive takes over Bayway's loan cards.
  loans: [
    { id: 'ln1', arive_loan_id: 'A-1', business_id: 'bay', role: 'primary', amount: 400000, stage: 'Funded', stage_group: 'funded', funded_on: today, scenario_auto: false, scenario_override: null, comp_override: null },
  ],
  // A Hot Bayway rating with no loan: 60% of 400,000 x 1.25% = 3,000, due next month.
  lead_ratings: [
    { contact_id: 'r1', business_id: 'bay', temperature: 'hot', est_amount: 400000, close_month: null, rated_at: new Date().toISOString(), score_at_rating: 10, contact: { name: 'Rae Rated', score: 10, tier: 'warm' } },
  ],
  v_priority_leads: [
    { id: 'l1', name: 'Jessica Chen', score: 92, tier: 'hot', last_activity_at: null, fub_profile_url: '#' },
  ],
  v_mpg_contacts: [
    { id: 'm1', name: 'Ana', company: 'Riverside Deli', email: null, phone: null, last_touch_at: null, stage: 'Open', crm_profile_url: '#' },
  ],
  calendar_events: [
    { id: 'c1', source_account: 'outlook-bayway', title: 'Closing', starts_at: new Date().toISOString(), ends_at: null, location: 'Title Co.', is_all_day: false },
  ],
}

// Every query is the same thenable: chainable methods return `this`, awaiting
// resolves the table's fixture (or its single row for maybeSingle).
function query(table) {
  const q = {
    _single: false,
    data: TABLES[table] ?? [],
    count: Array.isArray(TABLES[table]) ? TABLES[table].length : 0,
  }
  for (const m of ['select', 'eq', 'gte', 'lt', 'in', 'order', 'limit', 'range', 'or']) q[m] = () => q
  q.maybeSingle = () => {
    q._single = true
    return q
  }
  q.then = (resolve) =>
    resolve({
      data: q._single ? (Array.isArray(q.data) ? q.data[0] : q.data) : q.data,
      count: q.count,
      error: null,
    })
  return q
}

vi.mock('../lib/supabase', () => ({
  isDemoMode: false,
  supabase: { from: (table) => query(table) },
}))

vi.mock('../context/BusinessContext', () => ({
  useBusiness: () => globalThis.__biz,
}))

const { default: Overview } = await import('./Overview')
const { __resetRatingsForTest } = await import('../lib/useLeadRatings')
const { __resetForecastForTest } = await import('../lib/useForecastInputs')

async function render(biz) {
  globalThis.__biz = { biz, matches: () => true }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(
      React.createElement(MemoryRouter, null, React.createElement(Overview, null)),
    )
  })
  return host.textContent
}

const MONTH = new Date().toLocaleString('en-US', { month: 'long' })
const q = (sel) => document.querySelector(sel)

describe('Overview dashboard', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    __resetRatingsForTest()
    __resetForecastForTest()
  })

  it('opens on Your day, the focus, the month goals and the forecast', async () => {
    const text = await render('all')
    for (const t of ['Your day', "Today's work", 'Meetings', "This week's focus", `${MONTH} goals`, `${MONTH} forecast`, 'Open Workbench',
      'Book health', 'Rate watch', 'Source pull-through', 'Touchpoints · 30 days', 'Income this month']) {
      expect(text).toContain(t)
    }
    // The three untimed work lists.
    expect([...document.querySelectorAll('[data-work-list]')].map((e) => e.dataset.workList)).toEqual(['calls', 'files', 'partners'])
    // Today's calendar event, with its location, inside Your day.
    const day = q('[aria-label="Your day"]').textContent
    expect(day).toContain('Closing')
    expect(day).toContain('Title Co.')
    // The summary line names both books and the Workbench count.
    expect(text).toContain('Bayway is tracking')
    expect(text).toContain('MPG expects')
    expect(text).toMatch(/\d+ items? in Workbench/)
    // Five goals; the funded loan counts toward Loans funded.
    expect([...document.querySelectorAll('[data-goal]')].map((e) => e.dataset.goal)).toEqual(['calls', 'applications', 'funded', 'proposals', 'accounts'])
    expect(q('[data-goal="funded"]').textContent).toContain('1 / 2')
    // Replaced cards are gone.
    for (const t of ['Gross commission (MTD)', 'Monthly Goals', 'Income Mix', 'Up Next', "Today's Events", 'Activity & Production', 'Pipeline Mix', 'Lead Sources']) {
      expect(text).not.toContain(t)
    }
    // Pull-through covers both books; the funded loan's commission reaches income.
    expect([...document.querySelectorAll('[data-pull-book]')].map((e) => e.dataset.pullBook)).toEqual(['bay', 'mpg'])
    expect(q('[data-trend="income"]').textContent).toContain('$5,000')
    expect(q('[data-trend="income"]').textContent).toContain('$8,400')
    // No PMMS rate in the fixtures.
    expect(q('[aria-label="Rate watch"]').textContent).toContain('No PMMS rate loaded yet')
  })

  it('scopes the Bayway view', async () => {
    const text = await render('bay')
    expect(q('[data-forecast="bay"]')).not.toBeNull()
    expect(q('[data-forecast="mpg"]')).toBeNull()
    expect(q('[data-goal="proposals"]')).toBeNull()
    expect(text).not.toContain('MPG expects')
    expect(q('[aria-label="Rate watch"]')).not.toBeNull()
    expect([...document.querySelectorAll('[data-pull-book]')].map((e) => e.dataset.pullBook)).toEqual(['bay'])
    expect(q('[data-trend="income"]').textContent).not.toContain('MPG residual')
  })

  it('scopes the MPG view', async () => {
    const text = await render('mpg')
    expect(q('[data-forecast="bay"]')).toBeNull()
    expect(q('[data-forecast="mpg"]').textContent).toContain('accounts')
    expect([...document.querySelectorAll('[data-goal]')].map((e) => e.dataset.goal)).toEqual(['calls', 'proposals', 'accounts'])
    expect(text).not.toContain('Bayway is tracking')
    // Rate watch is Bayway only.
    expect(q('[aria-label="Rate watch"]')).toBeNull()
    expect([...document.querySelectorAll('[data-pull-book]')].map((e) => e.dataset.pullBook)).toEqual(['mpg'])
    expect(q('[data-trend="income"]').textContent).not.toContain('Bayway commission')
  })

  it('splits the Bayway forecast into funded, closing and leads, this month and next', async () => {
    await render('all')
    const bay = () => q('[data-forecast="bay"]').textContent
    // 400,000 x 1.25% funded this month.
    expect(bay()).toContain('Funded')
    expect(bay()).toContain('$5,000')
    const next = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Next month')
    await act(async () => next.click())
    // Hot at 60% of 400,000 x 1.25% = 3,000, due next month by default.
    expect(bay()).toContain('$3K')
    expect(bay()).toContain('1 rated')
    expect(q('[data-undated]')).toBeNull()
  })

  it('shows loans and merchants in flight and book health', async () => {
    const saved = TABLES.loans
    TABLES.loans = [
      ...saved,
      { id: 'ln3', arive_loan_id: 'A-3', business_id: 'bay', role: 'primary', borrower_name: 'Marcus Lee', amount: 365000, stage: 'Submitted to UW', stage_group: 'processing', funded_on: null, firm_closing_on: '2099-01-15', lock_expires_on: null, contact_id: null, scenario_auto: false, scenario_override: null, comp_override: null },
    ]
    try {
      await render('all')
    } finally {
      TABLES.loans = saved
    }
    const loans = q('[aria-label="Loans in flight"]')
    expect(q('[data-count="funded"]').textContent).toContain('1')
    expect(q('[data-count="underwriting"]').textContent).toContain('1')
    expect(loans.querySelector('[data-loan="ln3"]').textContent).toContain('Marcus Lee')
    expect(loans.querySelector('[data-loan="ln3"]').textContent).toContain('On track')
    const merchants = q('[aria-label="Merchants in flight"]')
    expect(merchants.querySelector('[data-merchant="m1"]').textContent).toContain('Riverside Deli')
    expect(q('[data-count="open"]').textContent).toContain('1')
    expect(q('[data-mpg-tile="walkins"]').textContent).toContain('0')
    expect(q('[aria-label="Book health"]').textContent).toContain('Nothing slipping')
  })

  it('hides the other book in flight cards', async () => {
    await render('bay')
    expect(q('[aria-label="Loans in flight"]')).not.toBeNull()
    expect(q('[aria-label="Merchants in flight"]')).toBeNull()
    document.body.innerHTML = ''
    await render('mpg')
    expect(q('[aria-label="Loans in flight"]')).toBeNull()
    expect(q('[aria-label="Merchants in flight"]')).not.toBeNull()
  })

  it('notes an open loan with no closing date once', async () => {
    const saved = TABLES.loans
    TABLES.loans = [
      ...saved,
      { id: 'ln2', arive_loan_id: 'A-2', business_id: 'bay', role: 'primary', amount: 300000, stage: 'Processing', stage_group: 'processing', funded_on: null, firm_closing_on: null, contact_id: null, scenario_auto: false, scenario_override: null, comp_override: null },
    ]
    try {
      await render('bay')
    } finally {
      TABLES.loans = saved
    }
    expect(q('[data-undated]').textContent).toContain('1 open loan with no closing date')
  })
})
