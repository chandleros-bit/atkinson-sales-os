import { describe, it, expect } from 'vitest'
import { buildOwnerBriefing } from './briefing'

// Wed Nov 4 2026, 7:30 AM CST. Data timestamps sit mid-day UTC so the test
// passes in any TZ.
const NOW = new Date('2026-11-04T13:30:00Z').getTime()
const iso = (s) => new Date(s).toISOString()

const base = () => ({
  rules: null,
  targets: { calls: 100, applications: 10 },
  rates: { primary_pct: 1.25, assisted_pct: 0.75 },
  forecastSettings: null,
  metrics: [],
  deals: [],
  activities: [
    { occurred_at: iso('2026-11-03T16:00:00Z'), type: 'call', business_id: 'bay' },
    { occurred_at: iso('2026-11-02T16:00:00Z'), type: 'call', business_id: 'mpg' },
  ],
  yesterdayActivities: [
    { type: 'call', direction: 'outbound', raw: { outcome: 'Interested' } },
    { type: 'call', direction: 'outbound', raw: { outcome: 'No Answer' } },
  ],
  pipeline: [
    { id: 'p1', business_id: 'bay', name: 'Ann App', stage: 'Application Received', stage_since: iso('2026-11-03T15:00:00Z'), open_task_count: 0, docs_outstanding_count: 0 },
  ],
  loans: [
    { id: 1, borrower_name: 'Cal Close', role: 'primary', amount: 400000, stage_group: 'closing', firm_closing_on: '2026-11-06', funded_on: null, contact_id: null, comp_override: null, scenario_auto: false, scenario_override: null },
  ],
  ratings: [],
  signals: [
    { id: 's1', business_id: 'bay', name: 'Rita Reply', stage: 'Contacted/Working', is_active: true, last_inbound_at: iso('2026-11-03T20:00:00Z'), last_outbound_at: iso('2026-11-03T15:00:00Z'), open_task_count: 1, oldest_open_due_at: iso('2026-11-10T15:00:00Z'), crm_created_at: iso('2026-01-01T15:00:00Z') },
    { id: 's2', business_id: 'mpg', name: 'Oscar Overdue', stage: 'Pending', is_active: true, last_outbound_at: iso('2026-11-03T15:00:00Z'), open_task_count: 1, oldest_open_due_at: iso('2026-11-01T15:00:00Z'), crm_created_at: iso('2026-01-01T15:00:00Z') },
  ],
  dialRows: [],
  dialSkips: [],
  mpgTasks: [],
  workItems: [],
  events: [{ id: 'e1', source_account: 'mpg', title: 'Deli review', starts_at: iso('2026-11-04T16:00:00Z'), is_all_day: false }],
  syncLatest: {
    fub: { ran_at: iso('2026-11-04T13:28:00Z'), status: 'ok' },
    zoho: { ran_at: iso('2026-11-04T13:15:00Z'), status: 'ok' },
    'outlook-mpg': { ran_at: iso('2026-11-04T13:15:00Z'), status: 'error' },
    'outlook-bayway': { ran_at: iso('2026-11-04T13:15:00Z'), status: 'ok' },
  },
})

describe('buildOwnerBriefing', () => {
  it('builds every section from the app logic', () => {
    const b = buildOwnerBriefing(base(), NOW)
    expect(b.dateLabel).toBe('Wed Nov 4')
    // Goals: calls and applications are targeted; commission and residual are never listed.
    expect(b.numbers.goals.map((g) => g.id)).toEqual(expect.arrayContaining(['calls', 'applications']))
    expect(b.numbers.goals.map((g) => g.id)).not.toContain('commission')
    expect(b.numbers.goals.map((g) => g.id)).not.toContain('residual')
    expect(b.numbers.goals.find((g) => g.id === 'calls').needPerDay).toBeGreaterThan(0)
    expect(b.numbers.scorecard).toEqual({ calls: 2, connects: 1, texts: 0, applications: 1, label: 'Yesterday' })
    // Closing Friday at 95% of 400,000 x 1.25% = 4,750 this month.
    expect(b.today.closings).toEqual({ count: 1, top: [{ name: 'Cal Close', date: '2026-11-06' }] })
    expect(b.numbers.forecast.expected).toBe(4750)
    expect(b.today.meetings).toHaveLength(1)
    expect(b.today.meetings[0]).toMatchObject({ title: 'Deli review', book: 'mpg' })
    expect(b.callFirst.replied.top.map((r) => r.name)).toEqual(['Rita Reply'])
    expect(b.callFirst.replied.top[0].book).toBeTruthy()
    expect(b.callFirst.overdue.top.map((r) => r.name)).toEqual(['Oscar Overdue'])
    expect(b.slipping.syncProblems.map((s) => s.label)).toEqual(['Outlook MPG'])
    expect(b.callFirstCount).toBe(2)
    expect(b.nothingSlipping).toBe(false)
  })

  it('caps every list at five but keeps the full count', () => {
    const d = base()
    d.signals = Array.from({ length: 8 }, (_, i) => ({
      id: `o${i}`, business_id: 'mpg', name: `Lead ${i}`, stage: 'Pending', is_active: true,
      last_outbound_at: iso('2026-11-03T15:00:00Z'), open_task_count: 1, oldest_open_due_at: iso('2026-10-30T15:00:00Z'), crm_created_at: iso('2026-01-01T15:00:00Z'),
    }))
    const b = buildOwnerBriefing(d, NOW)
    expect(b.callFirst.overdue.count).toBe(8)
    expect(b.callFirst.overdue.top).toHaveLength(5)
  })

  it('reports nothing slipping on a quiet day', () => {
    const d = base()
    d.syncLatest['outlook-mpg'].status = 'ok'
    const b = buildOwnerBriefing(d, NOW)
    expect(b.nothingSlipping).toBe(true)
  })
})

describe('buildOwnerBriefing: review fixes', () => {
  const sig = (o) => ({
    business_id: 'bay', is_active: true, is_hot: false, open_task_count: 1,
    oldest_open_due_at: iso('2026-11-10T15:00:00Z'), crm_created_at: iso('2026-01-01T15:00:00Z'),
    last_outbound_at: iso('2026-11-03T15:00:00Z'), ...o,
  })
  const loan = (o) => ({ id: 1, borrower_name: 'X', role: 'primary', amount: 400000, stage_group: 'closing', firm_closing_on: null, funded_on: null, contact_id: null, comp_override: null, scenario_auto: false, scenario_override: null, ...o })

  it('lists the monthly goals in order, proposals included', () => {
    const b = buildOwnerBriefing(base(), NOW)
    expect(b.numbers.goals.map((g) => g.id)).toEqual(['calls', 'closings', 'applications', 'merchants', 'proposals'])
    expect(b.numbers.goals.find((g) => g.id === 'proposals').target).toBe(20)
  })

  it('shows needPerDay only for goals that are behind, null when on pace', () => {
    const d = base()
    d.targets = { calls_monthly: 2 }
    const calls = buildOwnerBriefing(d, NOW).numbers.goals.find((g) => g.id === 'calls')
    expect(calls.status).toBe('hit')
    expect(calls.needPerDay).toBeNull()
  })

  it('scores yesterday on a Wednesday and the last business day on a Monday', () => {
    expect(buildOwnerBriefing(base(), NOW).numbers.scorecard.label).toBe('Yesterday')
    const MON = new Date('2026-11-09T13:30:00Z').getTime()
    const d = base()
    d.pipeline = [
      { id: 'f', business_id: 'bay', name: 'Fri App', stage: 'Application Received', stage_since: iso('2026-11-06T15:00:00Z') },
      { id: 's', business_id: 'bay', name: 'Sun App', stage: 'Application Received', stage_since: iso('2026-11-08T15:00:00Z') },
    ]
    const sc = buildOwnerBriefing(d, MON).numbers.scorecard
    expect(sc.label).toBe('Friday')
    expect(sc.applications).toBe(1)
  })

  it('counts new applications by Chicago day in the production stages', () => {
    const d = base()
    const row = (id, stage, since) => ({ id, business_id: 'bay', name: id, stage, stage_since: since })
    d.pipeline = [
      row('in', 'Application Received', '2026-11-04T05:59:00Z'),
      row('out', 'Application Received', '2026-11-04T06:00:00Z'),
      row('disc', 'Disclosed', '2026-11-03T20:00:00Z'),
      row('other', 'Contacted/Working', '2026-11-03T20:00:00Z'),
    ]
    expect(buildOwnerBriefing(d, NOW).numbers.scorecard.applications).toBe(2)
  })

  it('treats a core sync with no rows as a problem', () => {
    const d = base()
    d.syncLatest['outlook-mpg'].status = 'ok'
    delete d.syncLatest.zoho
    const b = buildOwnerBriefing(d, NOW)
    expect(b.slipping.syncProblems).toEqual([{ label: 'Zoho', text: 'not connected' }])
    expect(b.nothingSlipping).toBe(false)
  })

  it('applies ratings before bucketing (hot, going cold)', () => {
    const d = base()
    d.signals = [sig({ id: 'h1', name: 'Hank Hot', stage: 'Contacted/Working', last_outbound_at: iso('2026-10-30T15:00:00Z') })]
    expect(buildOwnerBriefing(d, NOW).callFirst.hotCold.count).toBe(0)
    d.ratings = [{ contact_id: 'h1', business_id: 'bay', temperature: 'hot', est_amount: 300000, close_month: null, rated_at: iso('2026-10-01T15:00:00Z'), contact: { name: 'Hank Hot' } }]
    const b = buildOwnerBriefing(d, NOW)
    expect(b.callFirst.hotCold.top.map((r) => r.name)).toEqual(['Hank Hot'])
    expect(b.callFirstCount).toBe(1)
  })

  it('buckets new leads', () => {
    const d = base()
    d.signals = [sig({ id: 'n1', name: 'Nina New', stage: 'New Lead', crm_created_at: iso('2026-11-04T10:00:00Z'), last_outbound_at: null, open_task_count: 0 })]
    const b = buildOwnerBriefing(d, NOW)
    expect(b.callFirst.newLeads.top.map((r) => r.name)).toEqual(['Nina New'])
  })

  it('counts the call cadence per book and honors skips', () => {
    const d = base()
    const row = (id, business_id, stage) => ({ id, business_id, stage, outbound_calls: 0, crm_created_at: iso('2026-11-04T10:00:00Z') })
    d.dialRows = [row('d1', 'bay', 'New Lead'), row('d2', 'mpg', 'Open'), row('d3', 'bay', 'New Lead')]
    d.dialSkips = ['d3']
    expect(buildOwnerBriefing(d, NOW).callFirst.cadence).toEqual({ bay: 1, mpg: 1 })
  })

  it('reports quiet applications and aging docs', () => {
    const d = base()
    d.signals = [sig({ id: 'q1', name: 'Quinn Quiet', stage: 'Application Received', last_outbound_at: iso('2026-10-25T15:00:00Z') })]
    d.pipeline = [{ id: 'p2', business_id: 'bay', name: 'Dana Docs', stage: 'Application Received', stage_since: iso('2026-10-20T15:00:00Z'), docs_outstanding_count: 2, docs_oldest_requested_at: iso('2026-10-25T15:00:00Z') }]
    d.syncLatest['outlook-mpg'].status = 'ok'
    const b = buildOwnerBriefing(d, NOW)
    expect(b.slipping.quietApps.top.map((r) => r.name)).toEqual(['Quinn Quiet'])
    expect(b.slipping.quietApps.count).toBe(1)
    expect(b.slipping.docsAging.count).toBe(1)
    expect(b.slipping.docsAging.top[0]).toMatchObject({ name: 'Dana Docs' })
    expect(b.slipping.docsAging.top[0].detail).toContain('2 missing')
    expect(b.nothingSlipping).toBe(false)
  })

  it('limits closings to today through six days out, open loans only', () => {
    const d = base()
    d.loans = [
      loan({ id: 1, borrower_name: 'Plus6', firm_closing_on: '2026-11-10' }),
      loan({ id: 2, borrower_name: 'Today', firm_closing_on: '2026-11-04' }),
      loan({ id: 3, borrower_name: 'Plus7', firm_closing_on: '2026-11-11' }),
      loan({ id: 4, borrower_name: 'Yday', firm_closing_on: '2026-11-03' }),
      loan({ id: 5, borrower_name: 'Funded', stage_group: 'funded', firm_closing_on: '2026-11-05', funded_on: '2026-11-05' }),
    ]
    const c = buildOwnerBriefing(d, NOW).today.closings
    expect(c.count).toBe(2)
    expect(c.top.map((x) => x.name)).toEqual(['Today', 'Plus6'])
  })

  it('labels all-day meetings and sorts by start', () => {
    const d = base()
    d.events = [
      { id: 'a', source_account: 'bayway', title: 'Late', starts_at: iso('2026-11-04T20:00:00Z'), is_all_day: false },
      { id: 'b', source_account: 'mpg', title: 'Holiday', starts_at: iso('2026-11-04T06:00:00Z'), is_all_day: true },
      { id: 'c', source_account: 'bayway', title: 'Early', starts_at: iso('2026-11-04T15:00:00Z'), is_all_day: false },
    ]
    const m = buildOwnerBriefing(d, NOW).today.meetings
    expect(m.map((x) => x.title)).toEqual(['Holiday', 'Early', 'Late'])
    expect(m[0].time).toBe('All day')
    expect(m.map((x) => x.book)).toEqual(['mpg', 'bay', 'bay'])
  })

  describe('MPG per-account metrics', () => {
    const mpgFixture = () => {
      const d = base()
      d.ratings = [{ contact_id: 'm1', business_id: 'mpg', temperature: 'hot', est_amount: null, close_month: '2026-11-01', rated_at: iso('2026-10-01T15:00:00Z'), contact: { name: 'Deli' } }]
      const m = (date, metric_key, value) => ({ date, business_id: 'mpg', metric_key, value })
      d.metrics = [
        m('2026-11-01', 'rev_monthly_residual', 800), m('2026-11-01', 'rev_active_merchants', 4),
        m('2026-11-03', 'rev_monthly_residual', 900), m('2026-11-03', 'rev_active_merchants', 3),
      ]
      return d
    }
    it('falls back to the newest metrics_daily date', () => {
      const f = buildOwnerBriefing(mpgFixture(), NOW).numbers.forecast
      expect(f.mpgAccounts).toBe(0.6)
      expect(f.mpgExpected).toBe(180) // 900 / 3 = 300 per account x 60%
    })
    it('prefers mpgMetricRows when given', () => {
      const d = mpgFixture()
      d.mpgMetricRows = [
        { date: '2026-11-01', metric_key: 'rev_monthly_residual', value: 800 },
        { date: '2026-11-01', metric_key: 'rev_active_merchants', value: 4 },
      ]
      expect(buildOwnerBriefing(d, NOW).numbers.forecast.mpgExpected).toBe(120) // 200 x 60%
    })
  })
})
