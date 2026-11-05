import { describe, it, expect } from 'vitest'
import { sourceTable } from './analytics'
import { DEFAULT_RATES } from './loans'
import {
  aliasMap, labelFor, isFree, windowKeys, keyStartMs, spendInWindow, fundedInWindow, roiTable, kpis, formatUsd, NOT_LINKED,
  lastMonths, sheetLabels, spendCells, spendChanges, mergeRows, freeRows,
} from './roi'

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

describe('spend sheet helpers', () => {
  it('lastMonths lists month keys newest first', () => {
    expect(lastMonths(3, NOW)).toEqual(['2026-11-01', '2026-10-01', '2026-09-01'])
    expect(lastMonths(2, new Date(2026, 0, 15).getTime())).toEqual(['2026-01-01', '2025-12-01'])
  })

  it('sheetLabels joins lead labels and spend labels, sorted', () => {
    const t = sourceTable(LEADS, 'bay', fromMs)
    expect(sheetLabels(t, 'bay', SPEND, aliasMap(ALIASES))).toEqual(['Facebook', 'Lendgo', 'Realtor referral'])
  })

  it('spendCells keys amounts by label and month', () => {
    expect(spendCells(SPEND, 'bay')).toEqual({ 'Lendgo|2026-10-01': '310', 'Lendgo|2026-11-01': '300', 'Facebook|2026-10-01': '31' })
  })

  it('spendChanges upserts edits, deletes cleared cells and skips unchanged ones', () => {
    const cells = { 'Lendgo|2026-10-01': '310', 'Lendgo|2026-11-01': '', 'Facebook|2026-10-01': '$45', 'Lendgo|2026-09-01': '1,200' }
    expect(spendChanges(SPEND, 'bay', cells)).toEqual({
      upserts: [
        { book: 'bay', source: 'Facebook', month: '2026-10-01', amount: 45 },
        { book: 'bay', source: 'Lendgo', month: '2026-09-01', amount: 1200 },
      ],
      deletes: ['s2'],
      problem: null,
    })
  })

  it('spendChanges refuses text and negative amounts', () => {
    expect(spendChanges(SPEND, 'bay', { 'Lendgo|2026-09-01': 'abc' }).problem).toBe('Enter a dollar amount for Lendgo, 2026-09.')
    expect(spendChanges(SPEND, 'bay', { 'Lendgo|2026-09-01': '-5' }).problem).toBe('Enter a dollar amount for Lendgo, 2026-09.')
  })

  it('mergeRows makes one alias row per raw source', () => {
    expect(mergeRows('bay', ['Chandler', 'Chandler Atkinson'], ' Self-sourced ')).toEqual([
      { book: 'bay', raw: 'Chandler', label: 'Self-sourced', is_free: false },
      { book: 'bay', raw: 'Chandler Atkinson', label: 'Self-sourced', is_free: false },
    ])
  })

  it('freeRows flips every alias row of a label, or adds a self-alias', () => {
    expect(freeRows('bay', 'Realtor referral', ALIASES, false)).toEqual([
      { book: 'bay', raw: 'Realtor', label: 'Realtor referral', is_free: false },
      { book: 'bay', raw: 'Realtor Referral', label: 'Realtor referral', is_free: false },
    ])
    expect(freeRows('bay', 'Lendgo', ALIASES, true)).toEqual([{ book: 'bay', raw: 'Lendgo', label: 'Lendgo', is_free: true }])
  })
})

describe('keyStartMs', () => {
  it('is local midnight of the key, the same day windowKeys counts from', () => {
    expect(keyStartMs('2026-10-07')).toBe(new Date(2026, 9, 7).getTime())
    expect(keyStartMs(keys.fromKey)).toBe(new Date(2026, 9, 7).getTime())
  })
  it('leads and spend share one window: a lead from the day before fromKey is out', () => {
    const early = { id: 'e', business_id: 'bay', source: 'Lendgo', created: new Date(2026, 9, 6, 23).toISOString(), person_stage: 'Lead', tags: [] }
    const late = { id: 'f', business_id: 'bay', source: 'Lendgo', created: new Date(2026, 9, 7, 0, 30).toISOString(), person_stage: 'Lead', tags: [] }
    const t = sourceTable([early, late], 'bay', keyStartMs(keys.fromKey))
    expect(t.total.leads).toBe(1)
  })
})

describe('Postgres numeric strings', () => {
  const STR = [{ id: 'n1', book: 'bay', source: 'Lendgo', month: '2026-11-01', amount: '300.00' }]
  it('spendInWindow reads "300.00" as 300', () => {
    expect(spendInWindow(STR, 'bay', 'Lendgo', '2026-11-01', '2026-11-30')).toBe(300)
  })
  it('spendCells shows "300"', () => {
    expect(spendCells(STR, 'bay')).toEqual({ 'Lendgo|2026-11-01': '300' })
  })
  it('spendChanges skips an unchanged cell', () => {
    expect(spendChanges(STR, 'bay', { 'Lendgo|2026-11-01': '300' })).toEqual({ upserts: [], deletes: [], problem: null })
  })
})

describe('spendInWindow edges', () => {
  it('a window inside one month prorates by its days', () => {
    // 10 of 30 November days.
    expect(spendInWindow([{ book: 'bay', source: 'X', month: '2026-11-01', amount: 300 }], 'bay', 'X', '2026-11-03', '2026-11-12')).toBe(100)
  })
  it('a window over December -> January takes the tail of one and the head of the next', () => {
    const rows = [
      { book: 'bay', source: 'X', month: '2026-11-01', amount: 999 },
      { book: 'bay', source: 'X', month: '2026-12-01', amount: 310 },
      { book: 'bay', source: 'X', month: '2027-01-01', amount: 310 },
      { book: 'bay', source: 'X', month: '2027-02-01', amount: 999 },
    ]
    // Dec 20-31: 12 of 31 -> 120. Jan 1-10: 10 of 31 -> 100.
    expect(spendInWindow(rows, 'bay', 'X', '2026-12-20', '2027-01-10')).toBe(220)
  })
})

describe('roiTable edge cases', () => {
  it('a funded loan whose contact is in the other book goes to "Not linked to a lead"', () => {
    const loans = [...LOANS, loan({ id: 7, contact_id: 'm', funded_on: '2026-11-04', amount: 100000, role: 'assisted' })]
    const t = roiTable(sourceTable(LEADS, 'bay', fromMs), {
      book: 'bay', contactsById: BY_ID, loans, rates: DEFAULT_RATES, spendRows: SPEND, aliases: aliasMap(ALIASES), ...keys,
    })
    expect(t.rows.at(-1)).toMatchObject({ source: NOT_LINKED, funded: 2, commission: 1500 })
    expect(row(t, 'Web Research')).toBe(undefined)
  })

  it('a free label with spend keeps the number and counts in the total; without spend it shows free', () => {
    const aliases = aliasMap([...ALIASES, { book: 'bay', raw: 'Lendgo', label: 'Lendgo', is_free: true }])
    const t = roiTable(sourceTable(LEADS, 'bay', fromMs), {
      book: 'bay', contactsById: BY_ID, loans: LOANS, rates: DEFAULT_RATES, spendRows: SPEND, aliases, ...keys,
    })
    expect(row(t, 'Lendgo')).toMatchObject({ spend: 300, costPerLead: 150 })
    expect(row(t, 'Realtor referral')).toMatchObject({ spend: 'free' })
    expect(t.total.spend).toBe(325)
  })
})

describe('spend saved under a raw source that is later merged', () => {
  const MERGED = aliasMap([...ALIASES, { book: 'bay', raw: 'Lendgo', label: 'Lendgo Ads', is_free: false }])
  const SPEND2 = [...SPEND, { id: 's5', book: 'bay', source: 'Lendgo Ads', month: '2026-11-01', amount: '50.00' }]

  it('roiTable counts it under the label, with no stray raw-source row', () => {
    const t = roiTable(sourceTable(LEADS, 'bay', fromMs), {
      book: 'bay', contactsById: BY_ID, loans: LOANS, rates: DEFAULT_RATES, spendRows: SPEND, aliases: MERGED, ...keys,
    })
    expect(row(t, 'Lendgo')).toBe(undefined)
    expect(row(t, 'Lendgo Ads')).toMatchObject({ leads: 2, spend: 300, costPerLead: 150 })
    expect(spendInWindow(SPEND, 'bay', 'Lendgo Ads', keys.fromKey, keys.toKey, MERGED)).toBe(300)
  })

  it('a spend-only raw source shows under its label', () => {
    const map = aliasMap([{ book: 'bay', raw: 'Facebook', label: 'Social', is_free: false }])
    const t = roiTable(sourceTable(LEADS, 'bay', fromMs), {
      book: 'bay', contactsById: BY_ID, loans: LOANS, rates: DEFAULT_RATES, spendRows: SPEND, aliases: map, ...keys,
    })
    expect(row(t, 'Facebook')).toBe(undefined)
    expect(row(t, 'Social')).toMatchObject({ leads: 0, spend: 25 })
  })

  it('sheetLabels lists the label, not the raw source', () => {
    const t = sourceTable(LEADS, 'bay', fromMs)
    expect(sheetLabels(t, 'bay', SPEND, MERGED)).toEqual(['Facebook', 'Lendgo Ads', 'Realtor referral'])
  })

  it('spendCells keys by label and sums rows that land in one cell', () => {
    expect(spendCells(SPEND2, 'bay', MERGED)).toEqual({ 'Lendgo Ads|2026-10-01': '310', 'Lendgo Ads|2026-11-01': '350', 'Facebook|2026-10-01': '31' })
  })

  it('spendChanges skips a cell equal to the group sum', () => {
    const cells = { 'Lendgo Ads|2026-10-01': '310', 'Lendgo Ads|2026-11-01': '350.00' }
    expect(spendChanges(SPEND2, 'bay', cells, MERGED)).toEqual({ upserts: [], deletes: [], problem: null })
  })

  it('spendChanges re-saves an edit under the label and deletes the old raw-source rows', () => {
    const cells = { 'Lendgo Ads|2026-10-01': '400', 'Lendgo Ads|2026-11-01': '360' }
    expect(spendChanges(SPEND2, 'bay', cells, MERGED)).toEqual({
      upserts: [
        { book: 'bay', source: 'Lendgo Ads', month: '2026-10-01', amount: 400 },
        { book: 'bay', source: 'Lendgo Ads', month: '2026-11-01', amount: 360 },
      ],
      deletes: ['s1', 's2'],
      problem: null,
    })
  })

  it('spendChanges clears every row in a group when the cell is blank', () => {
    expect(spendChanges(SPEND2, 'bay', { 'Lendgo Ads|2026-11-01': '' }, MERGED)).toEqual({ upserts: [], deletes: ['s2', 's5'], problem: null })
  })
})

describe('spendChanges keys and rounding', () => {
  it('a label containing "|" round-trips', () => {
    const saved = [{ id: 'p1', book: 'bay', source: 'A|B', month: '2026-10-01', amount: '50.00' }]
    const cells = spendCells(saved, 'bay')
    expect(cells).toEqual({ 'A|B|2026-10-01': '50' })
    expect(spendChanges(saved, 'bay', cells)).toEqual({ upserts: [], deletes: [], problem: null })
    expect(spendChanges(saved, 'bay', { ...cells, 'A|B|2026-11-01': '75' })).toEqual({
      upserts: [{ book: 'bay', source: 'A|B', month: '2026-11-01', amount: 75 }],
      deletes: [],
      problem: null,
    })
    expect(spendChanges(saved, 'bay', { 'A|B|2026-10-01': '' }).deletes).toEqual(['p1'])
  })

  it('"310.004" against a saved "310.00" is unchanged', () => {
    const saved = [{ id: 'r1', book: 'bay', source: 'Lendgo', month: '2026-10-01', amount: '310.00' }]
    expect(spendChanges(saved, 'bay', { 'Lendgo|2026-10-01': '310.004' })).toEqual({ upserts: [], deletes: [], problem: null })
  })

  it('upserts are rounded to cents', () => {
    expect(spendChanges([], 'bay', { 'Lendgo|2026-10-01': '45.678' }).upserts).toEqual([{ book: 'bay', source: 'Lendgo', month: '2026-10-01', amount: 45.68 }])
  })
})
