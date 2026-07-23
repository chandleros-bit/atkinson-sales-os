import { describe, it, expect } from 'vitest'
import {
  dateKey, todayKey, daysAgoKey, deltaPill, goalPct, niceMax, smoothPath,
  buildChartModel, gaugeArcs, compactCurrency, monthCells, eventDots, initials,
  monthLabel, CHART, GAUGE,
} from './overviewCards'

// Local noon so the day never flips under a timezone offset.
const at = (y, mo, d) => new Date(y, mo - 1, d, 12, 0).getTime()

describe('date keys', () => {
  it('formats a local date as YYYY-MM-DD', () => {
    expect(dateKey(new Date(2026, 6, 5, 23, 30))).toBe('2026-07-05')
    expect(todayKey(at(2026, 7, 23))).toBe('2026-07-23')
  })

  it('walks back N days, crossing a month boundary', () => {
    expect(daysAgoKey(0, at(2026, 7, 23))).toBe('2026-07-23')
    expect(daysAgoKey(13, at(2026, 7, 5))).toBe('2026-06-22')
  })
})

describe('deltaPill', () => {
  it('omits the pill when yesterday is zero or missing', () => {
    expect(deltaPill(12, 0)).toBeNull()
    expect(deltaPill(12, null)).toBeNull()
  })

  it('reports direction and magnitude', () => {
    expect(deltaPill(120, 100)).toEqual({ text: '+20% ↑', up: true })
    expect(deltaPill(80, 100)).toEqual({ text: '−20% ↓', up: false })
    expect(deltaPill(100, 100)).toEqual({ text: 'even', up: null })
  })
})

describe('goalPct', () => {
  it('clamps to 0-100 and survives a missing goal', () => {
    expect(goalPct(45, 90)).toBe(50)
    expect(goalPct(200, 90)).toBe(100)
    expect(goalPct(5, 0)).toBe(0)
    expect(goalPct(null, 90)).toBe(0)
  })
})

describe('niceMax', () => {
  it('rounds up to a round ceiling and never collapses to zero', () => {
    expect(niceMax([0, 0, 0])).toBe(20)
    expect(niceMax([12, 4, 9])).toBe(20)
    expect(niceMax([78, 31])).toBe(100)
    expect(niceMax([140, 20])).toBe(200)
  })
})

describe('smoothPath', () => {
  it('handles degenerate inputs without throwing', () => {
    expect(smoothPath([])).toBe('')
    expect(smoothPath([[1, 2]])).toBe('M 1 2')
  })

  it('emits one cubic per segment', () => {
    const d = smoothPath([[0, 0], [10, 5], [20, 0]])
    expect(d.startsWith('M 0 0')).toBe(true)
    expect(d.match(/C/g)).toHaveLength(2)
  })
})

describe('buildChartModel', () => {
  const bay = [10, 20, 30, 40]
  const mpg = [5, 5, 5, 5]
  const model = buildChartModel({ bay, mpg }, '2026-07-23')

  it('spans the plot area and scales to a round max', () => {
    expect(model.max).toBe(40)
    expect(model.gridY.map((g) => g.label)).toEqual(['40', '30', '20', '10', '0'])
    expect(model.gridY[0].y).toBeCloseTo(CHART.top)
    expect(model.gridY[4].y).toBeCloseTo(CHART.bottom)
  })

  it('marks the newest point of the marker series', () => {
    expect(model.marker).toEqual({ x: CHART.x1, y: CHART.top, value: 40 })
    expect(buildChartModel({ bay, mpg }, '2026-07-23', 'mpg').marker.value).toBe(5)
  })

  it('labels the newest tick Today and counts back by day', () => {
    const labels = model.xticks.map((t) => t.label)
    expect(labels[labels.length - 1]).toBe('Today')
    expect(labels).toContain('21')
  })

  it('closes the area path back to the baseline', () => {
    expect(model.area.endsWith(`L ${CHART.x1} ${CHART.bottom} L ${CHART.x0} ${CHART.bottom} Z`)).toBe(true)
  })

  it('flags an empty series instead of emitting NaN paths', () => {
    const empty = buildChartModel({ bay: [], mpg: [] }, '2026-07-23')
    expect(empty.empty).toBe(true)
    expect(empty.bay).toBe('')
    expect(empty.marker).toBeNull()
  })
})

describe('gaugeArcs', () => {
  it('draws no value arc at zero', () => {
    expect(gaugeArcs(0).valD).toBe('')
  })

  it('clamps past 100 and flips the large-arc flag past the halfway sweep', () => {
    expect(gaugeArcs(180).pct).toBe(100)
    expect(gaugeArcs(30).valD).toContain(`${GAUGE.r} 0 0 1`)
    expect(gaugeArcs(90).valD).toContain(`${GAUGE.r} 0 1 1`)
  })

  it('always emits a full track', () => {
    expect(gaugeArcs(0).trackD).toContain('A 74 74 0 1 1')
  })
})

describe('compactCurrency', () => {
  it('shortens by magnitude', () => {
    expect(compactCurrency(4_240_000)).toBe('$4.2M')
    expect(compactCurrency(28_400)).toBe('$28.4K')
    expect(compactCurrency(940)).toBe('$940')
    expect(compactCurrency(null)).toBe('$0')
  })
})

describe('monthCells', () => {
  // July 2026 starts on a Wednesday -> two leading blanks in a Monday grid.
  const cells = monthCells(2026, 6, { '2026-07-09': 'var(--bay)' })

  it('pads to the Monday-first grid and covers every day', () => {
    expect(cells.filter((c) => c.blank)).toHaveLength(2)
    expect(cells.filter((c) => !c.blank)).toHaveLength(31)
    expect(cells[2].key).toBe('2026-07-01')
  })

  it('carries the event dot color on matching days only', () => {
    expect(cells.find((c) => c.key === '2026-07-09').dot).toBe('var(--bay)')
    expect(cells.find((c) => c.key === '2026-07-10').dot).toBeNull()
  })

  it('labels the month', () => {
    expect(monthLabel(2026, 6)).toBe('July 2026')
  })
})

describe('eventDots', () => {
  const keyOf = (e) => e.k
  const bizOf = (e) => e.b

  it('colors a day by its business and marks mixed days gold', () => {
    const out = eventDots(
      [{ k: '2026-07-09', b: 'bay' }, { k: '2026-07-10', b: 'mpg' }, { k: '2026-07-09', b: 'mpg' }],
      keyOf, bizOf,
    )
    expect(out).toEqual({
      '2026-07-09': 'var(--bay-gold)',
      '2026-07-10': 'var(--mpg)',
    })
  })

  it('skips events with no day key', () => {
    expect(eventDots([{ k: null, b: 'bay' }], keyOf, bizOf)).toEqual({})
  })
})

describe('initials', () => {
  it('takes first and last initials', () => {
    expect(initials('Michael Reynolds')).toBe('MR')
    expect(initials('Riverside Deli Group')).toBe('RG')
    expect(initials('Cher')).toBe('C')
    expect(initials('')).toBe('?')
    expect(initials(null)).toBe('?')
  })
})
