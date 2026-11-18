import { describe, it, expect } from 'vitest'
import {
  signals,
  exclusionReason,
  selectPicks,
  picksForDate,
  daysToAnniversary,
  type Candidate,
} from './opportunity-scoring.ts'

const NOW = new Date('2026-11-17T12:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString()
const CFG = { activeStages: ['New Lead', 'Pre-Approved'] }

let seq = 0
function cand(over: Partial<Candidate> = {}): Candidate {
  seq += 1
  return {
    contactId: `c${seq}`,
    householdKey: `h${seq}`,
    hasProperty: true,
    propertyState: 'TX',
    recordingDate: '2020-03-01',
    homestead: true,
    estimates: { rate_gap: 1.2, tappable_80: 120_000, years_owned: 6.7 },
    ...over,
  }
}

describe('signals', () => {
  it('a contact with no loan amount gets no equity signals but keeps rate and time-owned signals', () => {
    const c = cand({ estimates: { rate_gap: 0.6, tappable_80: null, est_ltv: null, years_owned: 5 } })
    const s = signals(c, NOW)
    expect(s.reasons).toContain('RATE_GAP')
    expect(s.reasons).toContain('MOVE_UP_WINDOW')
    expect(s.reasons).not.toContain('EQUITY_100K')
    expect(s.reasons).not.toContain('EQUITY_50K')
    expect(s.reasons).not.toContain('PMI_LIKELY_REMOVABLE')
  })

  it('is never dropped for missing data', () => {
    const c = cand({ estimates: null, recordingDate: null, homestead: null })
    expect(exclusionReason(c, NOW, CFG)).toBeNull()
    expect(signals(c, NOW).score).toBe(0)
  })

  it('flags investors and anniversaries', () => {
    const c = cand({ homestead: false, recordingDate: '2021-11-25' })
    const s = signals(c, NOW)
    expect(s.reasons).toContain('INVESTOR')
    expect(s.reasons).toContain('ANNIVERSARY')
    expect(daysToAnniversary('2021-11-25', NOW)).toBe(8)
  })
})

describe('exclusions', () => {
  it('a contact last touched 89 days ago is excluded; 91 days ago is eligible', () => {
    expect(exclusionReason(cand({ lastContactAt: daysAgo(89) }), NOW, CFG)).toBe('recent_contact')
    expect(exclusionReason(cand({ lastContactAt: daysAgo(91) }), NOW, CFG)).toBeNull()
  })
  it('every exclusion keeps a contact out', () => {
    expect(exclusionReason(cand({ lastPickedAt: daysAgo(30) }), NOW, CFG)).toBe('recently_picked')
    expect(exclusionReason(cand({ salesOsStage: 'Pre-Approved' }), NOW, CFG)).toBe('active_stage')
    expect(exclusionReason(cand({ doNotContact: true }), NOW, CFG)).toBe('do_not_contact')
    expect(exclusionReason(cand({ snoozed: true }), NOW, CFG)).toBe('snoozed')
    expect(exclusionReason(cand({ activeLoan: true }), NOW, CFG)).toBe('active_loan')
    expect(exclusionReason(cand({ recordingDate: daysAgo(200) }), NOW, CFG)).toBe('owned_under_12_months')
  })
  it('Nurture / Credit Repair and no stage stay eligible', () => {
    expect(exclusionReason(cand({ salesOsStage: 'Nurture / Credit Repair' }), NOW, CFG)).toBeNull()
    expect(exclusionReason(cand({ salesOsStage: null }), NOW, CFG)).toBeNull()
  })
})

describe('selectPicks', () => {
  it('returns exactly 5 rows with slot 5 as a relationship check-in', () => {
    const pool = [
      ...Array.from({ length: 8 }, () => cand()),
      cand({ hasProperty: false, propertyState: null, estimates: null }),
    ]
    const picks = selectPicks(pool, { now: NOW, count: 5, config: CFG })
    expect(picks).toHaveLength(5)
    expect(picks.map((p) => p.kind)).toEqual(['review', 'review', 'review', 'review', 'check_in'])
    expect(picks[4].score).toBe(0)
  })

  it('fills with check-ins when few contacts score', () => {
    const pool = [
      cand(),
      ...Array.from({ length: 6 }, () => cand({ hasProperty: false, propertyState: null, estimates: null })),
    ]
    const picks = selectPicks(pool, { now: NOW, count: 5, config: CFG })
    expect(picks).toHaveLength(5)
    expect(picks.filter((p) => p.kind === 'review')).toHaveLength(1)
    expect(picks.filter((p) => p.kind === 'check_in')).toHaveLength(4)
  })

  it('picks a household once and never picks an out-of-state property for a review', () => {
    const a = cand({ householdKey: 'shared' })
    const b = cand({ householdKey: 'shared' })
    const tn = cand({ propertyState: 'TN' })
    const picks = selectPicks([a, b, tn], { now: NOW, count: 5, config: CFG })
    expect(picks.filter((p) => p.householdKey === 'shared')).toHaveLength(1)
    expect(picks.find((p) => p.contactId === tn.contactId)?.kind).toBe('check_in')
  })

  it('Wednesday gets 15 picks with check-ins at 5, 10 and 15', () => {
    const wed = new Date('2026-11-18T12:00:00Z')
    expect(picksForDate(wed, 5, { '3': 15 })).toBe(15)
    expect(picksForDate(NOW, 5, { '3': 15 })).toBe(5)
    const pool = [
      ...Array.from({ length: 20 }, () => cand()),
      ...Array.from({ length: 5 }, () => cand({ hasProperty: false, propertyState: null, estimates: null })),
    ]
    const picks = selectPicks(pool, { now: wed, count: 15, config: CFG })
    expect(picks).toHaveLength(15)
    expect(picks.filter((p) => p.kind === 'check_in').map((p) => p.rank)).toEqual([5, 10, 15])
  })

  it('breaks score ties by the longest time since last contact', () => {
    const recent = cand({ lastContactAt: daysAgo(100) })
    const old = cand({ lastContactAt: daysAgo(400) })
    const picks = selectPicks([recent, old], { now: NOW, count: 2, config: CFG })
    expect(picks[0].contactId).toBe(old.contactId)
  })
})
