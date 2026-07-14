import { describe, it, expect } from 'vitest'
import { METRICS, DEFAULT_TARGETS, metricsForTab, resolveTargets } from './reports'

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
