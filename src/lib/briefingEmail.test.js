import { describe, it, expect } from 'vitest'
import { renderOwnerBriefing, renderAssistantBriefing } from './briefingEmail'

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
    expect(renderOwnerBriefing(model(), { appUrl: 'https://x.app' }).text).toContain('Calls 40 / 100 | behind | need 4 per business day')
  })
  it('labels the scorecard Yesterday by default and by weekday on Mondays', () => {
    expect(renderOwnerBriefing(model(), { appUrl: 'https://x.app' }).text).toContain('Yesterday: 12 calls | 3 connects | 1 new applications | 4 texts')
    const m = model()
    m.numbers.scorecard = { ...m.numbers.scorecard, label: 'Friday' }
    expect(renderOwnerBriefing(m, { appUrl: 'https://x.app' }).text).toContain('Friday: 12 calls')
  })
  it('formats a 16:00Z meeting as 10:00 AM Chicago in November', () => {
    const { text } = renderOwnerBriefing(model(), { appUrl: 'https://x.app' })
    expect(text).toContain('10:00 AM | Deli <review> (MPG)')
  })
  it('keeps the body ASCII-safe: no special separators in text, entities in HTML', () => {
    const m = model()
    m.callFirst.replied.top[0] = { name: 'José Núñez', detail: 'Called back' }
    const { text, html } = renderOwnerBriefing(m, { appUrl: 'https://x.app' })
    expect(text).not.toMatch(/[·— ]/)
    expect(text).toContain('José Núñez - Called back')
    expect(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(html)).toBe(true)
    expect(html).toContain('Jos&#233; N&#250;&#241;ez')
  })
  it('writes closing dates like Nov 6', () => {
    const m = model()
    m.today.closings = { count: 1, top: [{ name: 'Pat Lee', date: '2026-11-06' }] }
    expect(renderOwnerBriefing(m, { appUrl: 'https://x.app' }).text).toContain('Pat Lee Nov 6')
  })
})

const amodel = (o = {}) => ({
  dateLabel: 'Wed Nov 4',
  closing: { count: 1, top: [{ name: 'Pat Lee', date: '2026-11-06', title: 'Lone Star Title', docs: ['W2'], buyerAgent: { name: 'Jo Ray', phone: '7135550100' }, sellerAgent: null }] },
  disclosures: { count: 2, top: [{ name: 'Due Dan', dueBy: '2026-11-04', due: true }, { name: 'Fresh Fran', dueBy: '2026-11-06', due: false }] },
  missingDocs: { count: 1, top: [{ name: 'Old Olga', docs: ['W2', 'Bank'], days: 10, chase: true }] },
  newApps: { count: 0, top: [] },
  waiting: { count: 0, top: [] },
  closingCount: 1,
  chaseCount: 1,
  quiet: false,
  ...o,
})

describe('renderAssistantBriefing', () => {
  it('subject carries the date, closings and docs to chase, ASCII only', () => {
    const { subject } = renderAssistantBriefing(amodel(), { appUrl: 'https://x.app' })
    expect(subject).toBe('Bayway files | Wed Nov 4 | 1 closing this week | 1 doc to chase')
    expect(/^[ -~]*$/.test(subject)).toBe(true)
  })
  it('pluralizes the subject counts', () => {
    const { subject } = renderAssistantBriefing(amodel({ closingCount: 2, chaseCount: 5 }), { appUrl: 'https://x.app' })
    expect(subject).toBe('Bayway files | Wed Nov 4 | 2 closing this week | 5 docs to chase')
  })
  it('shows closings with title, agents and docs; disclosures before missing docs', () => {
    const { text } = renderAssistantBriefing(amodel(), { appUrl: 'https://x.app' })
    expect(text).toContain('Pat Lee - closes Nov 6 | Title: Lone Star Title | Buyer agent: Jo Ray 7135550100 | Docs: W2')
    expect(text).toContain('Due Dan - disclose by Nov 4 (DUE)')
    expect(text).toContain('Fresh Fran - disclose by Nov 6')
    expect(text).toContain('Old Olga - W2, Bank - 10 days - CHASE TODAY')
    expect(text.indexOf('Disclosures due')).toBeLessThan(text.indexOf('Missing docs'))
    expect(text).not.toContain('New applications')
  })
  it('marks due rows red in HTML and keeps HTML ASCII', () => {
    const { html } = renderAssistantBriefing(amodel(), { appUrl: 'https://x.app' })
    expect(html).toMatch(/<li style="color:#b42318">Due Dan - disclose by Nov 4 \(DUE\)<\/li>/)
    expect(html).toContain('href="https://x.app/pipeline"')
    expect(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(html)).toBe(true)
  })
  it('says the files are quiet when nothing is listed', () => {
    const empty = { count: 0, top: [] }
    const m = amodel({ closing: empty, disclosures: empty, missingDocs: empty, closingCount: 0, chaseCount: 0, quiet: true })
    const { text } = renderAssistantBriefing(m, { appUrl: 'https://x.app' })
    expect(text).toContain('Nothing on the files today.')
  })
})
