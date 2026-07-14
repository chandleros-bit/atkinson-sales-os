import { describe, it, expect } from 'vitest'
import { METRICS, DEFAULT_TARGETS, metricsForTab, resolveTargets, pace, formatValue, metricCardView, buildTabModel, weekStart, monthWindow, rollupMetrics, sumWon, countWon, pipelineValue, deriveStageCounts, dailySeries, inWindow, periodDateFor } from './reports'

describe('METRICS registry', () => {
  it('every metric has a default target', () => {
    for (const m of METRICS) {
      expect(DEFAULT_TARGETS[m.key], `target for ${m.key}`).toBeTypeOf('number')
    }
  })
  it('uses only known tabs, sources, biz, units', () => {
    for (const m of METRICS) {
      expect(['daily', 'weekly', 'monthly', 'revenue']).toContain(m.tab)
      expect(['live', 'derived', 'manual']).toContain(m.source)
      expect(['mpg', 'bay', 'both']).toContain(m.biz)
      expect(['count', 'currency', 'minutes']).toContain(m.unit)
    }
  })
  it('has unique keys', () => {
    const keys = METRICS.map((m) => m.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('metricsForTab', () => {
  it('returns only the tab, and filters by business when not "all"', () => {
    const bay = metricsForTab('daily', 'bay')
    expect(bay.every((m) => m.tab === 'daily' && (m.biz === 'bay' || m.biz === 'both'))).toBe(true)
    const all = metricsForTab('daily', 'all')
    expect(all.length).toBeGreaterThanOrEqual(bay.length)
  })
})

describe('resolveTargets', () => {
  it('overlays saved values over the defaults', () => {
    const merged = resolveTargets({ calls: 100, followups: 25 }, { calls: 80 })
    expect(merged).toEqual({ calls: 80, followups: 25 })
  })
  it('ignores a null/non-object saved value', () => {
    expect(resolveTargets({ calls: 100 }, null)).toEqual({ calls: 100 })
  })
})

describe('pace', () => {
  it('is "none" when value or target is missing, or target <= 0', () => {
    expect(pace(null, 10)).toBe('none')
    expect(pace(5, null)).toBe('none')
    expect(pace(5, 0)).toBe('none')
  })
  it('is "on" at/above target, "behind" below', () => {
    expect(pace(10, 10)).toBe('on')
    expect(pace(11, 10)).toBe('on')
    expect(pace(4, 10)).toBe('behind')
  })
})

describe('formatValue', () => {
  it('renders dash for null', () => expect(formatValue(null, 'count')).toBe('—'))
  it('renders currency with commas', () => expect(formatValue(17500, 'currency')).toBe('$17,500'))
  it('renders minutes with an m', () => expect(formatValue(30, 'minutes')).toBe('30m'))
  it('renders plain counts', () => expect(formatValue(12, 'count')).toBe('12'))
})

describe('metricCardView', () => {
  const metric = { key: 'calls', label: 'Outbound calls', source: 'manual', unit: 'count' }
  it('caps pct at 100 and reports pace', () => {
    const v = metricCardView(metric, 120, 100)
    expect(v.pct).toBe(100)
    expect(v.pace).toBe('on')
    expect(v.valueText).toBe('120')
    expect(v.targetText).toBe('100')
  })
  it('handles no-data (null value)', () => {
    const v = metricCardView(metric, null, 100)
    expect(v.pace).toBe('none')
    expect(v.pct).toBe(0)
    expect(v.valueText).toBe('—')
  })
})

describe('buildTabModel', () => {
  it('maps metrics to card view-models, target overrides winning', () => {
    const metrics = [{ key: 'calls', label: 'Calls', source: 'manual', unit: 'count' }]
    const cards = buildTabModel(metrics, { calls: 50 }, { calls: 80 })
    expect(cards[0].valueText).toBe('50')
    expect(cards[0].targetText).toBe('80')
    expect(cards[0].pace).toBe('behind')
  })
})

describe('weekStart', () => {
  // Fixed clock: Wednesday 2026-07-15T12:00:00 local.
  const NOW = new Date(2026, 6, 15, 12, 0, 0).getTime()

  it('returns the most-recent Monday as a YYYY-MM-DD key', () => {
    expect(weekStart(NOW)).toBe('2026-07-13') // Monday of that week
  })
  it('returns the same day when now is a Monday', () => {
    const mon = new Date(2026, 6, 13, 9, 0, 0).getTime()
    expect(weekStart(mon)).toBe('2026-07-13')
  })
})

describe('monthWindow', () => {
  // Fixed clock: Wednesday 2026-07-15T12:00:00 local.
  const NOW = new Date(2026, 6, 15, 12, 0, 0).getTime()

  it('spans the 1st of this month to the 1st of next', () => {
    expect(monthWindow(NOW)).toEqual({ from: '2026-07-01', to: '2026-08-01' })
  })
  it('rolls the year over in December', () => {
    const dec = new Date(2026, 11, 20, 12, 0, 0).getTime()
    expect(monthWindow(dec)).toEqual({ from: '2026-12-01', to: '2027-01-01' })
  })
})

describe('rollupMetrics', () => {
  it('sums value per metric_key, coercing strings', () => {
    const rows = [
      { metric_key: 'calls', value: 30 },
      { metric_key: 'calls', value: '20' },
      { metric_key: 'followups', value: 5 },
    ]
    expect(rollupMetrics(rows)).toEqual({ calls: 50, followups: 5 })
  })
  it('returns an empty object for no rows', () => {
    expect(rollupMetrics([])).toEqual({})
  })
})

describe('sumWon / countWon', () => {
  const WIN = { from: '2026-07-01', to: '2026-08-01' }
  const deals = [
    { status: 'won',  value: 300000, expected_close: '2026-07-05' },
    { status: 'won',  value: 250000, expected_close: '2026-07-20' },
    { status: 'won',  value: 999999, expected_close: '2026-06-30' }, // out of window
    { status: 'open', value: 400000, expected_close: null },
    { status: 'lost', value: 100000, expected_close: '2026-07-10' },
  ]

  it('sums won deal value within the window', () => {
    expect(sumWon(deals, WIN)).toBe(550000)
    expect(countWon(deals, WIN)).toBe(2)
  })
})

describe('pipelineValue', () => {
  it('sums open deal value only', () => {
    const deals = [
      { status: 'won',  value: 300000, expected_close: '2026-07-05' },
      { status: 'won',  value: 250000, expected_close: '2026-07-20' },
      { status: 'won',  value: 999999, expected_close: '2026-06-30' },
      { status: 'open', value: 400000, expected_close: null },
      { status: 'lost', value: 100000, expected_close: '2026-07-10' },
    ]
    expect(pipelineValue(deals)).toBe(400000)
  })
})

describe('deriveStageCounts', () => {
  it('counts rows per named stage, zero-filling absent stages', () => {
    const rows = [{ stage: 'App Sent' }, { stage: 'App Sent' }, { stage: 'New Lead' }]
    expect(deriveStageCounts(rows, ['App Sent', 'Pre-Approved'])).toEqual({
      'App Sent': 2,
      'Pre-Approved': 0,
    })
  })
})

describe('dailySeries', () => {
  it('returns `days` daily sums ending at endKey, oldest first, zero-filling gaps', () => {
    const rows = [
      { date: '2026-07-15', metric_key: 'calls', value: 12 },
      { date: '2026-07-13', metric_key: 'calls', value: 5 },
      { date: '2026-07-13', metric_key: 'followups', value: 9 }, // other key ignored
    ]
    expect(dailySeries(rows, 'calls', '2026-07-15', 3)).toEqual([5, 0, 12])
  })
})

describe('inWindow boundaries', () => {
  it('includes the from day, excludes the to day, and rejects null', () => {
    expect(inWindow('2026-07-01', '2026-07-01', '2026-08-01')).toBe(true)
    expect(inWindow('2026-08-01', '2026-07-01', '2026-08-01')).toBe(false)
    expect(inWindow(null, '2026-07-01', '2026-08-01')).toBe(false)
  })
  it('handles a full ISO timestamp by taking the date part', () => {
    expect(inWindow('2026-07-15T23:30:00.000Z', '2026-07-01', '2026-08-01')).toBe(true)
  })
})

describe('periodDateFor', () => {
  // Wednesday 2026-07-15T12:00 local
  const NOW_P = new Date(2026, 6, 15, 12, 0, 0).getTime()

  it('writes daily entries to today', () => {
    expect(periodDateFor('daily', NOW_P)).toBe('2026-07-15')
  })
  it('writes weekly entries to the week Monday', () => {
    expect(periodDateFor('weekly', NOW_P)).toBe('2026-07-13')
  })
  it('writes monthly and revenue entries to the 1st of the month', () => {
    expect(periodDateFor('monthly', NOW_P)).toBe('2026-07-01')
    expect(periodDateFor('revenue', NOW_P)).toBe('2026-07-01')
  })
})
