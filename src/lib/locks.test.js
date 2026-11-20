import { describe, it, expect } from 'vitest'
import { locksExpiring, lockDetail } from './locks'

const NOW = new Date('2026-11-19T16:00:00Z').getTime() // Nov 19, Central
const loan = (over) => ({ id: 'l', borrower_name: 'Ann Lee', stage_group: 'processing', lock_expires_on: '2026-11-22', ...over })

describe('locksExpiring', () => {
  it('keeps open, unfunded, real loans locked to expire within 10 days or expired in the last 30', () => {
    const rows = locksExpiring([
      loan({ id: 'a', lock_expires_on: '2026-11-22' }),
      loan({ id: 'b', lock_expires_on: '2026-11-30' }),
      loan({ id: 'c', lock_expires_on: '2026-11-15' }),
      loan({ id: 'd', lock_expires_on: '2026-10-19' }),
      loan({ id: 'e', lock_expires_on: '2026-11-20', funded_on: '2026-11-18' }),
      loan({ id: 'f', lock_expires_on: '2026-11-20', stage_group: 'funded' }),
      loan({ id: 'g', lock_expires_on: '2026-11-20', scenario_auto: true }),
      loan({ id: 'h', lock_expires_on: null }),
    ], NOW)
    expect(rows.map((r) => r.id)).toEqual(['c', 'a'])
    expect(rows[0]).toMatchObject({ expired: true, daysLeft: -4 })
  })

  it('flags a firm closing after the lock and words the detail', () => {
    const [r] = locksExpiring([loan({ firm_closing_on: '2026-11-24' })], NOW)
    expect(r.closesAfterLock).toBe(true)
    expect(lockDetail(r)).toBe('expires in 3 days, closing is after the lock (2026-11-24)')
    expect(lockDetail({ daysLeft: 0, expired: false })).toBe('expires today')
    expect(lockDetail({ daysLeft: -1, expired: true })).toBe('expired 1 day ago')
  })
})
