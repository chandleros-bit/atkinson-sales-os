import { describe, it, expect } from 'vitest'
import { parseCsv } from './csv'
import { mapHeader, rowToAgent, scoreParts, scoreAgent, tierFor, buildHarPreview, templateCsv, TEMPLATE_COLUMNS } from './harImport'

const NOW = new Date('2026-11-22T20:00:00Z')

describe('HAR import', () => {
  it('reads the template and common header variants', () => {
    const { header, rows } = parseCsv(templateCsv())
    expect(header).toEqual(TEMPLATE_COLUMNS)
    const a = rowToAgent(rows[0], mapHeader(header))
    expect(a).toMatchObject({ name: 'Jane Example', closings_12mo: 14, volume_12mo: 5200000, avg_price: 371000, buyer_side_pct: 70, areas: 'Katy, Cypress', preferred_lender: null })
    const m = mapHeader(['Agent Name', 'Office', 'Transactions', 'Sales Volume', 'Buyer Side'])
    const b = rowToAgent({ 'Agent Name': 'Bo', Office: 'KW', Transactions: '10', 'Sales Volume': '$4,000,000', 'Buyer Side': '0.6' }, m)
    expect(b).toMatchObject({ name: 'Bo', brokerage: 'KW', closings_12mo: 10, avg_price: 400000, buyer_side_pct: 60 })
  })

  it("scores the doc's five factors 1 to 10, neutral when unknown", () => {
    expect(scoreParts({ closings_12mo: 27, avg_price: 400000, buyer_side_pct: 80, areas: 'Katy', preferred_lender: null }))
      .toEqual({ closings: 10, price: 10, buyer: 8, area: 10, lender: 10 })
    expect(scoreParts({})).toEqual({ closings: 5, price: 5, buyer: 5, area: 5, lender: 10 })
    expect(scoreParts({ avg_price: 1_500_000, areas: 'Galveston', preferred_lender: 'ABC Mortgage' })).toMatchObject({ price: 2.5, area: 2, lender: 3 })
    expect(scoreAgent({ closings_12mo: 27, avg_price: 400000, buyer_side_pct: 80, areas: 'Katy' }).score).toBe(9.6)
    expect([tierFor(1), tierFor(20), tierFor(21), tierFor(100), tierFor(101), tierFor(null)]).toEqual(['Dream 20', 'Dream 20', 'Bench', 'Bench', null, null])
  })

  it('updates matched partners, adds new ones as HAR prospects, skips repeats', () => {
    const csv = `Name,Brokerage,Email,Phone,HAR URL,Closings 12mo,Avg Price
Laura Hughes,Compass,laura@compass.com,,https://har.com/laura,18,450000
New Agent,eXp,new@exp.com,281-555-0101,,6,300000
New Agent,eXp,new@exp.com,281-555-0101,,6,300000
,NoName,,,,,
Sam Lee,KW,,(713) 555-0199,,9,350000`
    const { header, rows } = parseCsv(csv)
    const partners = [
      { id: 'p1', name: 'Laura Hughes', email: 'Laura@Compass.com', brokerage: null, phone: null },
      { id: 'p2', name: 'Samuel Lee', email: null, brokerage: 'KW', phone: '7135550199' },
    ]
    const p = buildHarPreview({ header, rows, partners }, NOW)
    expect(p.counts).toEqual({ new: 1, updated: 2, skipped: 2, total: 3 })
    expect(p.updates.map((u) => u.id)).toEqual(['p1', 'p2'])
    expect(p.updates[0].patch).toMatchObject({ brokerage: 'Compass', closings_12mo: 18, har_updated_at: NOW.toISOString() })
    expect(p.inserts[0]).toMatchObject({ name: 'New Agent', source: 'har', partner_type: 'realtor' })
    expect(p.inserts[0].score).toBeGreaterThan(0)
    expect(buildHarPreview({ header: ['Foo'], rows: [], partners: [] }).error).toContain('No Name column')
  })
})
