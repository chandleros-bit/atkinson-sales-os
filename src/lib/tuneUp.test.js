import { describe, it, expect } from 'vitest'
import { approvalTable, commitUrl } from './tuneUp'

describe('tune-up approval table', () => {
  const rows = [
    { bot: 'cold_email', week_start: '2026-11-30', decided: 10, approval_rate: 70 },
    { bot: 'cold_email', week_start: '2026-12-07', decided: 10, approval_rate: 55 },
    { bot: 'gbp', week_start: '2026-12-07', decided: 3, approval_rate: 100 },
    { bot: 'gbp', week_start: '2026-11-23', decided: 0, approval_rate: null },
  ]
  it('lays out bots by week and flags a 10-point drop', () => {
    const t = approvalTable(rows)
    expect(t.weeks).toEqual(['2026-11-23', '2026-11-30', '2026-12-07'])
    expect(t.bots.map((b) => b.bot)).toEqual(['cold_email', 'gbp'])
    expect(t.bots[0].cells).toEqual([null, { rate: 70, decided: 10 }, { rate: 55, decided: 10 }])
    expect(t.bots[0].dropped).toBe(true)
    expect(t.bots[1].dropped).toBe(false)
    expect(approvalTable([])).toEqual({ weeks: [], bots: [] })
    expect(commitUrl('abc')).toBe('https://github.com/chandleros-bit/bayway-bots/commit/abc')
  })
})
