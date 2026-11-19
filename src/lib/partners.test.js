import { describe, it, expect } from 'vitest'
import {
  daysSince, lastTouchText, touchStatus, stageCounts, filterPartners, sortPartners,
  buildPatch, newPartnerRow, PARTNER_STAGES,
} from './partners'

const NOW = new Date('2026-11-18T18:00:00Z') // Nov 18, noon Central

describe('partners helpers', () => {
  it('counts days since a touch, null when never', () => {
    expect(daysSince(null, NOW)).toBeNull()
    expect(daysSince('2026-11-18T10:00:00Z', NOW)).toBe(0)
    expect(daysSince('2026-11-08T18:00:00Z', NOW)).toBe(10)
    expect(lastTouchText(null, NOW)).toBe('Never')
    expect(lastTouchText('2026-11-17T17:00:00Z', NOW)).toBe('Yesterday')
    expect(lastTouchText('2026-11-08T18:00:00Z', NOW)).toBe('10 days ago')
  })

  it('flags due (next touch today or past) before quiet (30+ days or never)', () => {
    expect(touchStatus({ next_touch_due: '2026-11-18', last_touch_at: '2026-11-17T00:00:00Z' }, NOW)).toBe('due')
    expect(touchStatus({ next_touch_due: '2026-11-19', last_touch_at: '2026-11-17T00:00:00Z' }, NOW)).toBe('ok')
    expect(touchStatus({ last_touch_at: '2026-10-01T00:00:00Z' }, NOW)).toBe('quiet')
    expect(touchStatus({}, NOW)).toBe('quiet')
  })

  it('counts every stage, zero when empty', () => {
    const c = stageCounts([{ partner_stage: 'dream_20' }, { partner_stage: 'dream_20' }, { partner_stage: 'prospect' }])
    expect(Object.keys(c)).toEqual(PARTNER_STAGES.map((s) => s.key))
    expect(c.dream_20).toBe(2)
    expect(c.top_partner).toBe(0)
  })

  const ROWS = [
    { id: 1, name: 'Laura Hughes', brokerage: 'Compass', partner_stage: 'dream_20', partner_type: 'realtor', last_touch_at: '2026-11-15T00:00:00Z' },
    { id: 2, name: 'Sam Lee', brokerage: 'Keller Williams', partner_stage: 'prospect', partner_type: 'property_manager', last_touch_at: null },
    { id: 3, name: 'Ana Ruiz', brokerage: 'eXp', partner_stage: 'top_partner', partner_type: 'realtor', last_touch_at: '2026-11-17T00:00:00Z' },
    { id: 4, name: 'Bo Kim', brokerage: 'Compass', partner_stage: 'prospect', partner_type: 'realtor', last_touch_at: '2026-11-01T00:00:00Z' },
  ]

  it('filters by stage, type, search and due/quiet', () => {
    expect(filterPartners(ROWS, { stage: 'prospect' }, NOW).map((r) => r.id)).toEqual([2, 4])
    expect(filterPartners(ROWS, { type: 'property_manager' }, NOW).map((r) => r.id)).toEqual([2])
    expect(filterPartners(ROWS, { q: 'compass' }, NOW).map((r) => r.id)).toEqual([1, 4])
    expect(filterPartners(ROWS, { due: true }, NOW).map((r) => r.id)).toEqual([2])
  })

  it('sorts furthest stage first, then longest without a touch', () => {
    expect(sortPartners(ROWS).map((r) => r.id)).toEqual([3, 1, 2, 4])
  })

  it('builds a stage patch that restarts stage_since', () => {
    const p = buildPatch('partner_stage', 'invited', NOW)
    expect(p.partner_stage).toBe('invited')
    expect(p.stage_since).toBe(NOW.toISOString())
    expect(buildPatch('next_touch_due', '', NOW).next_touch_due).toBeNull()
    expect(() => buildPatch('partner_stage', 'closed', NOW)).toThrow()
    expect(() => buildPatch('name', 'x', NOW)).toThrow()
  })

  it('needs a name for a new partner and marks it manual', () => {
    expect(() => newPartnerRow({ name: '  ' })).toThrow('Name is required')
    expect(newPartnerRow({ name: ' Jo ', email: '' })).toEqual({
      name: 'Jo', brokerage: null, email: null, phone: null, partner_type: 'realtor', source: 'manual',
    })
  })
})
