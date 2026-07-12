import { describe, it, expect } from 'vitest'
import { buildColumns, isLostStage, LOAN_FLOW_ORDER, MPG_LEAD_FLOW } from './pipeline'

const row = (id, stage, last_touch_at = null) => ({ id, stage, last_touch_at })

describe('LOAN_FLOW_ORDER', () => {
  it('is the curated Bayway sequence', () => {
    expect(LOAN_FLOW_ORDER).toEqual([
      'New Lead',
      'Attempted',
      'App Sent',
      'Waiting on Docs',
      'Pre-Approved',
    ])
  })
})

describe('MPG_LEAD_FLOW', () => {
  it('leads with the live Open bucket and standard Zoho statuses', () => {
    expect(MPG_LEAD_FLOW).toContain('Open')
    expect(MPG_LEAD_FLOW.indexOf('Open')).toBeLessThan(MPG_LEAD_FLOW.indexOf('Contacted'))
  })
})

describe('isLostStage', () => {
  it('flags lost-keyword stages case-insensitively', () => {
    expect(isLostStage('Lost')).toBe(true)
    expect(isLostStage('Dead Lead')).toBe(true)
    expect(isLostStage('Withdrawn')).toBe(true)
    expect(isLostStage('DISENGAGED')).toBe(true)
    expect(isLostStage('Denied')).toBe(true)
  })
  it('flags Zoho dead-lead statuses', () => {
    expect(isLostStage('Junk Lead')).toBe(true)
    expect(isLostStage('Lost Lead')).toBe(true)
    expect(isLostStage('Not Qualified')).toBe(true)
    expect(isLostStage('Unqualified')).toBe(true)
  })
  it('does not flag active stages', () => {
    expect(isLostStage('Pre-Approved')).toBe(false)
    expect(isLostStage('Waiting on Docs')).toBe(false)
    expect(isLostStage('Open')).toBe(false)
    expect(isLostStage('Pre-Qualified')).toBe(false)
    expect(isLostStage(null)).toBe(false)
  })
})

describe('buildColumns', () => {
  it('orders known stages by loan-flow order, not input order', () => {
    const cols = buildColumns([
      row(1, 'Pre-Approved'),
      row(2, 'New Lead'),
      row(3, 'Waiting on Docs'),
    ])
    expect(cols.map((c) => c.stage)).toEqual(['New Lead', 'Waiting on Docs', 'Pre-Approved'])
  })
  it('drops empty columns — only populated stages appear', () => {
    const cols = buildColumns([row(1, 'Pre-Approved')])
    expect(cols.map((c) => c.stage)).toEqual(['Pre-Approved'])
  })
  it('appends unknown stages after known ones, alphabetically', () => {
    const cols = buildColumns([row(1, 'Zebra'), row(2, 'Pre-Approved'), row(3, 'Apple')])
    expect(cols.map((c) => c.stage)).toEqual(['Pre-Approved', 'Apple', 'Zebra'])
  })
  it('routes lost-like stages to the rightmost columns', () => {
    const cols = buildColumns([row(1, 'Lost'), row(2, 'New Lead'), row(3, 'Zebra')])
    expect(cols.map((c) => c.stage)).toEqual(['New Lead', 'Zebra', 'Lost'])
    expect(cols.find((c) => c.stage === 'Lost').isLost).toBe(true)
    expect(cols.find((c) => c.stage === 'New Lead').isLost).toBe(false)
  })
  it('ignores blank / whitespace / null stages', () => {
    const cols = buildColumns([row(1, '   '), row(2, ''), row(3, null), row(4, 'Pre-Approved')])
    expect(cols.map((c) => c.stage)).toEqual(['Pre-Approved'])
  })
  it('groups multiple rows into one column', () => {
    const cols = buildColumns([row(1, 'Pre-Approved'), row(2, 'Pre-Approved')])
    expect(cols).toHaveLength(1)
    expect(cols[0].cards).toHaveLength(2)
  })
  it('sorts cards within a column by attention (null touch first, then oldest)', () => {
    const cols = buildColumns([
      row(1, 'Pre-Approved', '2026-07-09T00:00:00Z'),
      row(2, 'Pre-Approved', null),
      row(3, 'Pre-Approved', '2026-07-01T00:00:00Z'),
    ])
    expect(cols[0].cards.map((c) => c.id)).toEqual([2, 3, 1])
  })

  it('honors a custom flowOrder (MPG lead statuses)', () => {
    const cols = buildColumns(
      [row(1, 'Contacted'), row(2, 'Open'), row(3, 'Junk Lead')],
      MPG_LEAD_FLOW,
    )
    expect(cols.map((c) => c.stage)).toEqual(['Open', 'Contacted', 'Junk Lead'])
    expect(cols.find((c) => c.stage === 'Junk Lead').isLost).toBe(true)
  })
})
