import { describe, it, expect } from 'vitest'
import { sourceTable } from './analytics'
import { DEFAULT_RATES } from './loans'
import { aliasMap, labelFor, isFree, windowKeys, spendInWindow, fundedInWindow, roiTable, kpis, formatUsd, NOT_LINKED } from './roi'

const NOW = new Date(2026, 10, 5, 10).getTime() // Thu 5 Nov 2026, 10:00 local
const LEADS = [
  { id: 'a', business_id: 'bay', source: 'Realtor', created: new Date(2026, 9, 20, 9).toISOString(), person_stage: 'Lead', tags: ['estimate sent'] },
  { id: 'b', business_id: 'bay', source: 'Realtor Referral', created: new Date(2026, 9, 25, 9).toISOString(), person_stage: 'Lead', tags: [] },
  { id: 'c', business_id: 'bay', source: 'Lendgo', created: new Date(2026, 9, 28, 9).toISOString(), person_stage: 'Lead', tags: [] },
  { id: 'd', business_id: 'bay', source: 'Lendgo', created: new Date(2026, 10, 1, 9).toISOString(), person_stage: 'Lead', tags: [] },
  { id: 'm', business_id: 'mpg', source: 'Web Research', created: new Date(2026, 10, 2, 9).toISOString(), person_stage: 'Open', tags: null },
]
const BY_ID = new Map(LEADS.map((l) => [l.id, l]))
const ALIASES = [
  { id: 'x1', book: 'bay', raw: 'Realtor', label: 'Realtor referral', is_free: true },
  { id: 'x2', book: 'bay', raw: 'Realtor Referral', label: 'Realtor referral', is_free: false },
]
const SPEND = [
  { id: 's1', book: 'bay', source: 'Lendgo', month: '2026-10-01', amount: 310 },
  { id: 's2', book: 'bay', source: 'Lendgo', month: '2026-11-01', amount: 300 },
  { id: 's3', book: 'bay', source: 'Facebook', month: '2026-10-01', amount: 31 },
  { id: 's4', book: 'mpg', source: 'Web Research', month: '2026-11-01', amount: 30 },
]
const loan = (o) => ({ business_id: 'bay', stage_group: 'funded', role: 'primary', scenario_auto: false, scenario_override: null, comp_override: null, ...o })
const LOANS = [
  loan({ id: 1, contact_id: 'c', funded_on: '2026-10-30', amount: 200000 }), // Lendgo, $2,500
  loan({ id: 2, contact_id: 'c', funded_on: '2026-10-01', amount: 500000 }), // before the window
  loan({ id: 3, contact_id: 'd', funded_on: '2026-11-02', amount: 400000, scenario_override: true }), // scenario
  loan({ id: 4, contact_id: null, funded_on: '2026-11-03', amount: 100000, role: 'assisted' }), // not linked, $750
  loan({ id: 5, contact_id: 'a', funded_on: '2026-11-02', amount: 300000, comp_override: 999 }), // Realtor, override
  loan({ id: 6, contact_id: 'b', funded_on: '2026-11-01', amount: 300000, stage_group: 'closing' }), // not funded
]
const keys = windowKeys(30, NOW)
const fromMs = NOW - 30 * 86400000

function bayRoi() {
  return roiTable(sourceTable(LEADS, 'bay', fromMs), {
    book: 'bay', contactsById: BY_ID, loans: LOANS, rates: DEFAULT_RATES, spendRows: SPEND, aliases: aliasMap(ALIASES), ...keys,
  })
}
const row = (t, source) => t.rows.find((r) => r.source === source)

describe('aliases', () => {
  const map = aliasMap(ALIASES)
  it('maps a raw source to its label, or keeps it', () => {
    expect(labelFor('Realtor', 'bay', map)).toBe('Realtor referral')
    expect(labelFor('Lendgo', 'bay', map)).toBe('Lendgo')
    expect(labelFor('Realtor', 'mpg', map)).toBe('Realtor')
  })
  it('a label is free when any of its alias rows is free', () => {
    expect(isFree('Realtor referral', 'bay', map)).toBe(true)
    expect(isFree('Lendgo', 'bay', map)).toBe(false)
  })
})

describe('windowKeys', () => {
  it('covers exactly N local days ending today', () => {
    expect(windowKeys(30, NOW)).toEqual({ fromKey: '2026-10-07', toKey: '2026-11-05' })
  })
})

describe('spendInWindow', () => {
  it('prorates each month by the days inside the window', () => {
    // Oct: 25 of 31 days -> 250. Nov: 5 of 30 days -> 50.
    expect(spendInWindow(SPEND, 'bay', 'Lendgo', keys.fromKey, keys.toKey)).toBe(300)
  })
  it('is null when the label has no spend in the window', () => {
    expect(spendInWindow(SPEND, 'bay', 'Realtor referral', keys.fromKey, keys.toKey)).toBe(null)
    expect(spendInWindow(SPEND, 'bay', 'Lendgo', '2026-12-01', '2026-12-31')).toBe(null)
  })
  it('counts an entered $0 as zero, not missing', () => {
    expect(spendInWindow([{ book: 'bay', source: 'X', month: '2026-11-01', amount: 0 }], 'bay', 'X', keys.fromKey, keys.toKey)).toBe(0)
  })
})

describe('fundedInWindow', () => {
  it('keeps Bayway funded, non-scenario loans funded in the window', () => {
    expect(fundedInWindow(LOANS, keys.fromKey, keys.toKey).map((l) => l.id)).toEqual([1, 4, 5])
  })
})

describe('roiTable (Bayway)', () => {
  it('merges aliased sources and recomputes the rate', () => {
    const r = row(bayRoi(), 'Realtor referral')
    expect(r.leads).toBe(2)
    expect(r.raws).toEqual(['Realtor', 'Realtor Referral'])
    expect(r.counts.apps).toBe(1)
    expect(r.rate).toBe(50)
  })
  it('credits funded loans and commission to the lead source', () => {
    const r = row(bayRoi(), 'Lendgo')
    expect(r).toMatchObject({ leads: 2, funded: 1, commission: 2500, spend: 300, costPerLead: 150, costPerFunded: 300 })
  })
  it('uses the comp override and shows free sources as free with no costs', () => {
    expect(row(bayRoi(), 'Realtor referral')).toMatchObject({ funded: 1, commission: 999, spend: 'free', costPerLead: null, costPerFunded: null })
  })
  it('puts a funded loan with no lead in "Not linked to a lead", last', () => {
    const t = bayRoi()
    expect(t.rows.at(-1)).toMatchObject({ source: NOT_LINKED, funded: 1, commission: 750, spend: null, notLinked: true })
  })
  it('shows spend on a source with no leads in the window', () => {
    expect(row(bayRoi(), 'Facebook')).toMatchObject({ leads: 0, spend: 25, costPerLead: null })
  })
  it('orders by leads, then name; no-lead rows and Not linked come after', () => {
    expect(bayRoi().rows.map((r) => r.source)).toEqual(['Lendgo', 'Realtor referral', 'Facebook', NOT_LINKED])
  })
  it('totals use the summed spend, leads and funded', () => {
    expect(bayRoi().total).toMatchObject({ source: 'Total', leads: 4, funded: 3, commission: 4249, spend: 325, costPerLead: 81.25, costPerFunded: 108.33 })
  })
})

describe('roiTable (MPG)', () => {
  it('has spend and cost per lead, no funded or commission', () => {
    const t = roiTable(sourceTable(LEADS, 'mpg', fromMs), {
      book: 'mpg', contactsById: BY_ID, loans: LOANS, rates: DEFAULT_RATES, spendRows: SPEND, aliases: aliasMap([]), ...keys,
    })
    expect(t.rows).toHaveLength(1)
    expect(t.rows[0]).toMatchObject({ source: 'Web Research', leads: 1, funded: null, commission: null, spend: 5, costPerLead: 5, costPerFunded: null })
  })
})

describe('kpis and formatUsd', () => {
  it('reads the tiles off the total', () => {
    expect(kpis(bayRoi())).toEqual({ leads: 4, spend: 325, costPerLead: 81.25, costPerFunded: 108.33 })
  })
  it('formats whole dollars, dashes and free', () => {
    expect(formatUsd(4249)).toBe('$4,249')
    expect(formatUsd(81.25)).toBe('$81')
    expect(formatUsd(null)).toBe('—')
    expect(formatUsd('free')).toBe('free')
  })
})
