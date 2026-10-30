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

describe('Overview dashboard', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('renders every card in the combined view', async () => {
    const text = await render('all')
    for (const t of ['Gross commission (MTD)', 'Closed this month', 'Calls this month', 'Pipeline value (open)',
      'Activity & Production', 'Monthly Goals', "Today's Events", 'Pipeline Mix', 'Lead Sources', 'Income Mix', 'Up Next', '90-Day Sprints']) {
      expect(text).toContain(t)
    }
    // MPG residual entered in Reports reaches the income card.
    expect(text).toContain('$8,400')
    // Today's calendar event, with its location.
    expect(text).toContain('Closing')
    expect(text).toContain('Title Co.')
    // One Arive loan funded this month.
    expect(document.querySelector('[data-kpi="closed"]').textContent).toContain('Bayway 1 loans · MPG 0 merchants')
    // Commission is estimated from that loan: 400,000 × 1.25%.
    const commission = document.querySelector('[data-kpi="commission"]').textContent
    expect(commission).toContain('Est. from Arive')
    expect(commission).toContain('$5,000')
    expect(text).toContain('Commission estimated from Arive')
    expect(text).not.toContain('Entered in Reports')
    // Old command-center cards are gone.
    expect(text).not.toContain('Priority Leads')
    expect(text).not.toContain('Bayway Sprint')
  })

  it('scopes the Bayway view', async () => {
    const text = await render('bay')
    expect(text).toContain('Bayway view')
    expect(text).toContain('Gross commission (MTD)')
    expect(text).toContain('Apps & estimates')
    expect(text).not.toContain('MPG residual')
    expect(document.querySelector('[data-goal="merchants"]')).toBeNull()
    expect(document.querySelector('[data-kpi="commission"]').textContent).toContain('Est. from Arive')
    expect(document.querySelector('[data-kpi="closed"]').textContent).toMatch(/Closed this month\s*1/)
    expect(document.querySelector('[data-goal="closings"]').textContent).toContain('1 / 5')
    expect(text).toContain('Estimated from Arive')
  })

  it('swaps in MPG cards in the MPG view', async () => {
    const text = await render('mpg')
    expect(text).toContain('MPG view')
    expect(text).toContain('MPG residual (MTD)')
    expect(text).toContain('Open MPG leads')
    expect(text).toContain('MPG leads by stage')
    expect(text).not.toContain('Pipeline value')
    expect(text).not.toContain('Apps & estimates')
    // No Bayway commission on the MPG view, and its income note stays manual.
    expect(text).not.toContain('Arive')
    expect(text).toContain('Entered in Reports')
  })
})
