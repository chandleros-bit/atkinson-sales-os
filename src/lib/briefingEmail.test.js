import { describe, it, expect } from 'vitest'
import { renderOwnerBriefing } from './briefingEmail'

const model = (o = {}) => ({
  dateLabel: 'Tue Nov 3',
  numbers: {
    goals: [{ id: 'calls', label: 'Calls', value: 40, target: 100, status: 'behind', unit: 'count', needPerDay: 4 }],
    forecast: { expected: 12400, funded: 5000, weighted: 7400, mpgAccounts: 1.5, mpgExpected: null },
    scorecard: { calls: 12, connects: 3, texts: 4, applications: 1 },
  },
  today: { meetings: [{ time: '2026-11-03T16:00:00.000Z', title: 'Deli <review>', book: 'mpg' }], closings: { count: 0, top: [] } },
  callFirst: {
    replied: { count: 7, top: Array.from({ length: 5 }, (_, i) => ({ name: `R${i}`, detail: 'Called back' })) },
    newLeads: { count: 0, top: [] },
    cadence: { bay: 6, mpg: 2 },
    overdue: { count: 0, top: [] },
    hotCold: { count: 0, top: [] },
  },
  slipping: { quietApps: { count: 0, top: [] }, docsAging: { count: 0, top: [] }, statementsLate: { count: 0, top: [] }, syncProblems: [] },
  callFirstCount: 7,
  nothingSlipping: true,
  ...o,
})

describe('renderOwnerBriefing', () => {
  it('subject carries the date, call-first count and forecast', () => {
    const { subject } = renderOwnerBriefing(model(), { appUrl: 'https://x.app' })
    expect(subject).toBe('Briefing | Tue Nov 3 | 7 to call first | $12,400 forecast')
    // ASCII only: denomailer mis-encodes non-ASCII subjects (raw =?utf-8?Q?…?= in Outlook).
    expect(/^[ -~]*$/.test(subject)).toBe(true)
  })
  it('shows top five plus the count and a link', () => {
    const { text, html } = renderOwnerBriefing(model(), { appUrl: 'https://x.app' })
    expect(text).toContain('They reached out (7)')
    expect(text).toContain('R4')
    expect(text).toContain('+2 more')
    expect(html).toContain('href="https://x.app/workbench"')
  })
  it('says nothing is slipping on a quiet day and escapes HTML', () => {
    const { text, html } = renderOwnerBriefing(model(), { appUrl: 'https://x.app' })
    expect(text).toContain('Nothing slipping today.')
    expect(html).toContain('Deli &lt;review&gt;')
    expect(html).not.toContain('Deli <review>')
  })
  it('shows a behind goal with its per-day need', () => {
    expect(renderOwnerBriefing(model(), { appUrl: 'https://x.app' }).text).toContain('Calls 40 / 100 · behind · need 4 per business day')
  })
  it('labels the scorecard Yesterday by default and by weekday on Mondays', () => {
    expect(renderOwnerBriefing(model(), { appUrl: 'https://x.app' }).text).toContain('Yesterday: 12 calls · 3 connects · 1 new applications · 4 texts')
    const m = model()
    m.numbers.scorecard = { ...m.numbers.scorecard, label: 'Friday' }
    expect(renderOwnerBriefing(m, { appUrl: 'https://x.app' }).text).toContain('Friday: 12 calls')
  })
  it('formats a 16:00Z meeting as 10:00 AM Chicago in November', () => {
    const { text } = renderOwnerBriefing(model(), { appUrl: 'https://x.app' })
    expect(text).toContain('10:00 AM · Deli <review> (MPG)')
  })
  it('writes closing dates like Nov 6', () => {
    const m = model()
    m.today.closings = { count: 1, top: [{ name: 'Pat Lee', date: '2026-11-06' }] }
    expect(renderOwnerBriefing(m, { appUrl: 'https://x.app' }).text).toContain('Pat Lee Nov 6')
  })
})
