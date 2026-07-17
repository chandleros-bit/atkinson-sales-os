// Vitest picks this up (no test-include restriction in vite.config.js). It runs
// under `npm test` because scoring.ts is pure — no Deno/URL imports.
import { describe, it, expect } from 'vitest'
import { scoreContact, assignTier, isHotTag, callDurationBonus, WEIGHTS } from './scoring.ts'

const NOW = new Date('2026-07-17T12:00:00Z').getTime()
const daysAgo = (n) => new Date(NOW - n * 86_400_000).toISOString()

describe('isHotTag', () => {
  it('matches "hot" case-insensitively, ignores others', () => {
    expect(isHotTag(['Buyer', 'HOT'])).toBe(true)
    expect(isHotTag([' hot '])).toBe(true)
    expect(isHotTag(['warm', 'Nurture'])).toBe(false)
    expect(isHotTag(null)).toBe(false)
  })
})

describe('callDurationBonus', () => {
  it('is capped and never negative', () => {
    expect(callDurationBonus(300)).toBeCloseTo(5) // 5 min
    expect(callDurationBonus(60 * 999)).toBe(WEIGHTS.callDurationCapMinutes) // capped
    expect(callDurationBonus(undefined)).toBe(0)
  })
})

describe('scoreContact', () => {
  it('scores zero and null last-activity when there is no activity', () => {
    const r = scoreContact([], { hasHotTag: false, now: NOW })
    expect(r).toEqual({ score: 0, lastActivityAt: null, activityCount: 0 })
  })

  it('ranks more recent engagement higher than older, all else equal', () => {
    const recent = scoreContact([{ type: 'call', occurredAt: daysAgo(1) }], { now: NOW })
    const old = scoreContact([{ type: 'call', occurredAt: daysAgo(60) }], { now: NOW })
    expect(recent.score).toBeGreaterThan(old.score)
  })

  it('gives the HOT tag a boost even with no recent activity', () => {
    const plain = scoreContact([{ type: 'note', occurredAt: daysAgo(90) }], { now: NOW })
    const hot = scoreContact([{ type: 'note', occurredAt: daysAgo(90) }], { hasHotTag: true, now: NOW })
    expect(hot.score).toBeGreaterThan(plain.score)
  })

  it('weights calls above emails above notes', () => {
    const call = scoreContact([{ type: 'call', occurredAt: daysAgo(1) }], { now: NOW })
    const email = scoreContact([{ type: 'email', occurredAt: daysAgo(1) }], { now: NOW })
    const note = scoreContact([{ type: 'note', occurredAt: daysAgo(1) }], { now: NOW })
    expect(call.score).toBeGreaterThan(email.score)
    expect(email.score).toBeGreaterThan(note.score)
  })

  it('reports the most recent occurredAt as lastActivityAt', () => {
    const r = scoreContact(
      [
        { type: 'note', occurredAt: daysAgo(30) },
        { type: 'call', occurredAt: daysAgo(2) },
        { type: 'email', occurredAt: daysAgo(10) },
      ],
      { now: NOW },
    )
    expect(r.lastActivityAt).toBe(daysAgo(2))
    expect(r.activityCount).toBe(3)
  })
})

describe('assignTier', () => {
  it('never_contacted only with no HOT tag, no pipeline, and zero activity', () => {
    expect(assignTier({ score: 0, lastActivityAt: null, activityCount: 0, now: NOW })).toBe('never_contacted')
  })

  it('HOT tag forces hot even with zero logged activity', () => {
    expect(
      assignTier({ score: 40, lastActivityAt: null, activityCount: 0, hasHotTag: true, now: NOW }),
    ).toBe('hot')
  })

  it('hot also via high score AND recent activity (no tag needed)', () => {
    expect(assignTier({ score: 85, lastActivityAt: daysAgo(2), activityCount: 5, now: NOW })).toBe('hot')
    // high score but stale, no tag -> not hot
    expect(assignTier({ score: 85, lastActivityAt: daysAgo(40), activityCount: 5, now: NOW })).toBe('warm')
  })

  it('active when in an open pipeline stage and not hot — even with zero activity', () => {
    expect(
      assignTier({ score: 0, lastActivityAt: null, activityCount: 0, inOpenPipeline: true, now: NOW }),
    ).toBe('active')
  })

  it('warm for contacted-but-not-hot-not-active', () => {
    expect(assignTier({ score: 30, lastActivityAt: daysAgo(20), activityCount: 2, now: NOW })).toBe('warm')
  })
})
