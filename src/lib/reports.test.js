import { describe, it, expect } from 'vitest'
import { METRICS, DEFAULT_TARGETS, metricsForTab, resolveTargets, pace, formatValue, metricCardView, buildTabModel } from './reports'

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
