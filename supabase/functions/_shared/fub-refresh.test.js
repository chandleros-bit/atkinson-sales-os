import { describe, it, expect } from 'vitest'
import { shouldFullPeopleRefresh } from './fub.ts'

describe('shouldFullPeopleRefresh', () => {
  it('runs a full pass in the first 15 minutes of each hour', () => {
    expect(shouldFullPeopleRefresh(Date.UTC(2026, 9, 19, 14, 0, 5), 'https://x/fub-sync')).toBe(true)
    expect(shouldFullPeopleRefresh(Date.UTC(2026, 9, 19, 14, 14, 59), 'https://x/fub-sync')).toBe(true)
    expect(shouldFullPeopleRefresh(Date.UTC(2026, 9, 19, 14, 15, 0), 'https://x/fub-sync')).toBe(false)
    expect(shouldFullPeopleRefresh(Date.UTC(2026, 9, 19, 14, 45, 0), 'https://x/fub-sync')).toBe(false)
  })
  it('runs a full pass on demand with ?full=1', () => {
    expect(shouldFullPeopleRefresh(Date.UTC(2026, 9, 19, 14, 30), 'https://x/fub-sync?full=1')).toBe(true)
  })
})
