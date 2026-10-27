import { describe, it, expect } from 'vitest'
import { syncHealth, timeAgo } from './syncHealth'

const NOW = new Date('2026-10-26T12:00:00Z').getTime()
const ago = (mins) => new Date(NOW - mins * 60000).toISOString()
const ok = (mins) => ({ ran_at: ago(mins), status: 'ok' })

describe('timeAgo', () => {
  it('reads minutes, hours and days', () => {
    expect(timeAgo(null, NOW)).toBe('never')
    expect(timeAgo(ago(0.2), NOW)).toBe('just now')
    expect(timeAgo(ago(12), NOW)).toBe('12m ago')
    expect(timeAgo(ago(150), NOW)).toBe('3h ago')
    expect(timeAgo(ago(60 * 50), NOW)).toBe('2d ago')
  })
})

describe('syncHealth', () => {
  it('unknown when nothing has synced', () => {
    expect(syncHealth({}, NOW)).toMatchObject({ state: 'unknown', text: 'No sync yet' })
  })

  it('ok reports the oldest feed', () => {
    const h = syncHealth({ fub: ok(1), zoho: ok(9), 'outlook-mpg': ok(4), 'outlook-bayway': ok(4) }, NOW)
    expect(h).toMatchObject({ state: 'ok', text: 'Synced 9m ago' })
  })

  it('ignores feeds that were never connected', () => {
    const h = syncHealth({ fub: ok(2), zoho: ok(3) }, NOW)
    expect(h.state).toBe('ok')
    expect(h.detail.find((d) => d.source === 'outlook-mpg')).toMatchObject({ state: 'missing', text: 'not connected' })
  })

  it('stale past 45 minutes, naming the stalest feed', () => {
    const h = syncHealth({ fub: ok(2), zoho: ok(50), 'outlook-mpg': ok(180) }, NOW)
    expect(h).toMatchObject({ state: 'stale', text: 'Outlook MPG last synced 3h ago' })
  })

  it('a failed latest run beats stale', () => {
    const h = syncHealth({ fub: ok(2), zoho: { ran_at: ago(5), status: 'error' }, 'outlook-mpg': ok(180) }, NOW)
    expect(h).toMatchObject({ state: 'error', text: 'Zoho sync failed' })
    expect(h.detail.find((d) => d.source === 'zoho').text).toBe('failed 5m ago')
  })
})
