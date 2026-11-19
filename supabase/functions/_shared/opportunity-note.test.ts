import { describe, it, expect } from 'vitest'
import { postCheck, makeNote, buildModelInput, templateNote, rangeText, parseNote } from './opportunity-note.ts'
import type { Pick } from './opportunity-scoring.ts'

const pick: Pick = { contactId: 'c1', householdKey: 'h1', rank: 1, kind: 'review', score: 60, reasons: ['RATE_GAP_HIGH', 'EQUITY_100K'] }
const facts = {
  firstName: 'Maria', city: 'Katy',
  estimates: { rate_gap: 1.2, tappable_80: 132_000, years_owned: 4.2, est_balance: 280_833, est_value: 450_000 },
  recentActivity: [{ type: 'call', date: '2026-01-05T15:00:00Z' }],
  hasProperty: true, hasLoanAmount: true, hasMarketValue: true,
}
const good = {
  headline: 'Rate looks high and equity has grown', why_now: ['a'], known: ['b'], unknown: ['c'],
  opener: "Hey Maria, it's Chandler. It's been about four years since we closed. Got five minutes this week?",
  channel: 'call - warm relationship', do_not_say: ['rates'], fub_task: 'CA: Mortgage review follow-up',
}

describe('postCheck', () => {
  it('passes a clean note', () => expect(postCheck(good).ok).toBe(true))
  it.each(['%', '$', 'qualify', 'payment'])('rejects a note containing "%s"', (bad) => {
    expect(postCheck({ ...good, opener: `${good.opener} ${bad === '$' ? '$200' : bad === '%' ? '6%' : bad}` }).ok).toBe(false)
  })
  it('rejects banned words in the headline too', () => {
    expect(postCheck({ ...good, headline: 'You could save money' }).ok).toBe(false)
  })
})

describe('makeNote', () => {
  it('regenerates once, then falls back to a template after a second failure', async () => {
    let calls = 0
    const rejections: string[][] = []
    const bad = JSON.stringify({ ...good, opener: 'You qualify for a lower payment' })
    const note = await makeNote(pick, facts, async () => { calls++; return bad }, (p) => rejections.push(p))
    expect(calls).toBe(2)
    expect(rejections).toHaveLength(2)
    expect(note.fallback).toBe(true)
    expect(postCheck(note).ok).toBe(true)
  })
  it('keeps the model note when the retry passes', async () => {
    let calls = 0
    const note = await makeNote(pick, facts, async () => (++calls === 1 ? 'not json' : JSON.stringify(good)))
    expect(calls).toBe(2)
    expect(note.fallback).toBe(false)
    expect(note.headline).toBe(good.headline)
  })
  it('uses the template when the AI is off', async () => {
    expect((await makeNote(pick, facts, null)).fallback).toBe(true)
  })
})

describe('model input', () => {
  it('carries no phone, email, street address, note text or exact dollars', () => {
    const s = JSON.stringify(buildModelInput(pick, facts))
    expect(s).not.toMatch(/280833|450000|132000|@|\d{3}-\d{3}-\d{4}/)
    expect(s).toContain('Maria')
    expect(s).toContain('about 1 point')
    expect(s).toContain('roughly $')
  })
  it('lists missing fields', () => {
    const s = buildModelInput(pick, { ...facts, hasLoanAmount: false, hasMarketValue: false })
    expect(s.missing).toEqual(['original loan amount', 'current value'])
  })
  it('rounds equity into a range', () => {
    expect(rangeText({ tappable_80: 132_000 }).tappable_equity).toBe('roughly $125k to $175k')
    expect(rangeText({ tappable_80: 10_000 }).tappable_equity).toBe('little or none')
  })
})

describe('templates and parsing', () => {
  it('template note passes its own post-check for a check-in with no data', () => {
    const t = templateNote({ ...pick, kind: 'check_in', reasons: [] }, { ...facts, estimates: null, recentActivity: [], hasProperty: false })
    expect(postCheck(t).ok).toBe(true)
    expect(t.unknown).toContain('Which home they own now')
  })
  it('parses JSON wrapped in prose', () => {
    expect(parseNote(`Here you go:\n${JSON.stringify(good)}`)?.headline).toBe(good.headline)
    expect(parseNote('nope')).toBeNull()
  })
})
