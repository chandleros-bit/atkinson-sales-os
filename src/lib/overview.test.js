import { describe, it, expect } from 'vitest'
import {
  daysSince,
  lastTouchLabel,
  sortByAttention,
  buildKpis,
  buildCombinedKpis,
  deriveAlert,
  isHot,
  isMpgOpen,
} from './overview'

// Fixed clock: 2026-07-09T12:00:00Z
const NOW = new Date('2026-07-09T12:00:00Z').getTime()
const daysAgo = (n) => new Date(NOW - n * 86_400_000).toISOString()

describe('daysSince', () => {
  it('returns null for missing timestamps', () => {
    expect(daysSince(null, NOW)).toBe(null)
  })
  it('returns whole days elapsed', () => {
    expect(daysSince(daysAgo(3), NOW)).toBe(3)
  })
  it('returns 0 for a touch earlier today', () => {
    expect(daysSince(daysAgo(0.25), NOW)).toBe(0)
  })
})

describe('lastTouchLabel', () => {
  it('shows an em dash when unknown', () => {
    expect(lastTouchLabel(null, NOW)).toBe('—')
  })
  it('shows "today" for touches under a day old', () => {
    expect(lastTouchLabel(daysAgo(0.5), NOW)).toBe('today')
  })
  it('shows day counts otherwise', () => {
    expect(lastTouchLabel(daysAgo(9), NOW)).toBe('9d ago')
  })
})

describe('sortByAttention', () => {
  it('puts unknown touches first, then oldest to newest', () => {
    const rows = [
      { id: 'fresh', last_touch_at: daysAgo(1) },
      { id: 'unknown', last_touch_at: null },
      { id: 'old', last_touch_at: daysAgo(10) },
    ]
    expect(sortByAttention(rows).map((r) => r.id)).toEqual(['unknown', 'old', 'fresh'])
  })
  it('does not mutate the input array', () => {
    const rows = [
      { id: 'a', last_touch_at: daysAgo(1) },
      { id: 'b', last_touch_at: null },
    ]
    sortByAttention(rows)
    expect(rows[0].id).toBe('a')
  })
})

describe('isHot', () => {
  it('matches a HOT tag regardless of case or padding', () => {
    expect(isHot(['HOT'])).toBe(true)
    expect(isHot(['Buyer', 'hot'])).toBe(true)
    expect(isHot([' Hot '])).toBe(true)
  })
  it('does not match tags that merely contain "hot"', () => {
    expect(isHot(['Hot Lead'])).toBe(false)
    expect(isHot(['Hotlist'])).toBe(false)
  })
  it('is false for missing or non-array tags', () => {
    expect(isHot(null)).toBe(false)
    expect(isHot(undefined)).toBe(false)
    expect(isHot('hot')).toBe(false)
    expect(isHot([])).toBe(false)
  })
})

describe('isMpgOpen', () => {
  it('matches the Open status case-insensitively', () => {
    expect(isMpgOpen('Open')).toBe(true)
    expect(isMpgOpen('open')).toBe(true)
    expect(isMpgOpen(' Open ')).toBe(true)
  })
  it('is false for any other status', () => {
    expect(isMpgOpen('Contacted')).toBe(false)
    expect(isMpgOpen('—')).toBe(false)
    expect(isMpgOpen(null)).toBe(false)
  })
})

describe('buildKpis', () => {
  const rows = [
    { stage: 'Pre-Approved', last_touch_at: daysAgo(1) },
    { stage: 'Pre-Approved', last_touch_at: daysAgo(2) },
    { stage: 'Waiting on Docs', last_touch_at: daysAgo(3) },
    { stage: 'New Lead', last_touch_at: daysAgo(1) },
  ]
  it('counts active loans (everything except New Lead)', () => {
    expect(buildKpis(rows, 10).activeLoans).toBe(3)
  })
  it('produces top-2 stage cards by count', () => {
    expect(buildKpis(rows, 10).stageCards).toEqual([
      { label: 'Pre-Approved', count: 2 },
      { label: 'Waiting on Docs', count: 1 },
    ])
  })
  it('counts New Lead separately', () => {
    expect(buildKpis(rows, 10).newLeads).toBe(1)
  })
  it('computes nurture as total contacts minus pipeline rows', () => {
    expect(buildKpis(rows, 10).nurture).toBe(6)
  })
  it('never returns negative nurture', () => {
    expect(buildKpis(rows, 2).nurture).toBe(0)
  })
})

describe('buildCombinedKpis', () => {
  const bayRows = [
    { stage: 'Pre-Approved', last_touch_at: daysAgo(1) },
    { stage: 'New Lead', last_touch_at: daysAgo(9) }, // stale
    { stage: 'Waiting on Docs', last_touch_at: null }, // stale (unknown)
  ]
  const mpgRows = [
    { stage: 'Open', last_touch_at: daysAgo(2) },
    { stage: 'Open', last_touch_at: daysAgo(10) }, // stale
  ]

  it('splits pipeline counts per business with a total', () => {
    const k = buildCombinedKpis(bayRows, mpgRows, 826, 3, NOW)
    expect(k.pipeline).toEqual({ mpg: 2, bay: 3, total: 5 })
  })
  it('counts stale/untouched rows as needing attention', () => {
    const k = buildCombinedKpis(bayRows, mpgRows, 826, 3, NOW)
    expect(k.attention).toEqual({ mpg: 1, bay: 2, total: 3 })
  })
  it('reports the whole book under contacts', () => {
    const k = buildCombinedKpis(bayRows, mpgRows, 826, 3, NOW)
    expect(k.contacts).toEqual({ mpg: 3, bay: 826, total: 829 })
  })
  it('derives nurture as contacts minus pipeline, never negative', () => {
    const k = buildCombinedKpis(bayRows, mpgRows, 826, 3, NOW)
    expect(k.nurture).toEqual({ mpg: 1, bay: 823, total: 824 })
    const empty = buildCombinedKpis([], [], 0, 0, NOW)
    expect(empty.nurture).toEqual({ mpg: 0, bay: 0, total: 0 })
  })
})

describe('deriveAlert', () => {
  const freshRows = [{ stage: 'Pre-Approved', last_touch_at: daysAgo(1) }]
  const okSync = { status: 'ok', ran_at: new Date(NOW - 10 * 60_000).toISOString(), message: null }

  it('is red when FUB has never synced', () => {
    const a = deriveAlert({ latestSync: null, rows: freshRows, now: NOW })
    expect(a.level).toBe('red')
  })
  it('is red when the latest sync errored', () => {
    const a = deriveAlert({
      latestSync: { ...okSync, status: 'error', message: 'FUB GET /people -> 401' },
      rows: freshRows,
      now: NOW,
    })
    expect(a.level).toBe('red')
    expect(a.text).toContain('FUB GET /people -> 401')
  })
  it('is red when the last ok sync is older than 45 minutes', () => {
    const a = deriveAlert({
      latestSync: { ...okSync, ran_at: new Date(NOW - 50 * 60_000).toISOString() },
      rows: freshRows,
      now: NOW,
    })
    expect(a.level).toBe('red')
  })
  it('is amber when loans are stale 7+ days (sync healthy)', () => {
    const a = deriveAlert({
      latestSync: okSync,
      rows: [
        { stage: 'Pre-Approved', last_touch_at: daysAgo(9) },
        { stage: 'Waiting on Docs', last_touch_at: daysAgo(8) },
        { stage: 'Pre-Approved', last_touch_at: daysAgo(1) },
      ],
      now: NOW,
    })
    expect(a.level).toBe('amber')
    expect(a.text).toContain('2 active loans')
  })
  it('ignores null touches for the amber rule', () => {
    const a = deriveAlert({
      latestSync: okSync,
      rows: [{ stage: 'Pre-Approved', last_touch_at: null }],
      now: NOW,
    })
    expect(a).toBe(null)
  })
  it('is null when everything is healthy', () => {
    expect(deriveAlert({ latestSync: okSync, rows: freshRows, now: NOW })).toBe(null)
  })
  it('red takes precedence over amber', () => {
    const a = deriveAlert({
      latestSync: { ...okSync, status: 'error', message: 'boom' },
      rows: [{ stage: 'Pre-Approved', last_touch_at: daysAgo(30) }],
      now: NOW,
    })
    expect(a.level).toBe('red')
  })
})
