import { describe, it, expect } from 'vitest'
import {
  phoneKey, cellText, sheetDate, yesNo, contactLabel, reachLabel, toTsv,
  buildVisit, visitRow, zohoVisitNote, occurredAtFor, dayRange, newSinceCopy, readCopied, writeCopied, OUTCOMES,
} from './mpgTracker'

describe('phoneKey', () => {
  it('keeps the 10 US digits', () => {
    expect(phoneKey('832-474-7707')).toBe('8324747707')
    expect(phoneKey('+1 (832) 474-7707')).toBe('8324747707')
  })
  it('is null for anything that is not a 10-digit US number', () => {
    expect(phoneKey('281767-898')).toBe(null)
    expect(phoneKey('')).toBe(null)
    expect(phoneKey(null)).toBe(null)
  })
})

describe('cellText', () => {
  it('turns null into an empty cell', () => {
    expect(cellText(null)).toBe('')
    expect(cellText(undefined)).toBe('')
  })
  it('replaces tabs and line breaks so a note stays in one cell', () => {
    expect(cellText('wants\tlower\nrates\r\nnow')).toBe('wants · lower · rates · now')
  })
  it('keeps Excel from reading text as a formula', () => {
    expect(cellText('+1 832 474 7707')).toBe(' +1 832 474 7707')
    expect(cellText('=SUM(A1)')).toBe(' =SUM(A1)')
    expect(cellText('-15% fee')).toBe(' -15% fee')
    expect(cellText('@owner')).toBe(' @owner')
  })
  it('trims ordinary text', () => {
    expect(cellText('  Feges BBQ ')).toBe('Feges BBQ')
  })
})

describe('sheetDate', () => {
  it('formats a day key as M/D/YYYY', () => {
    expect(sheetDate('2026-11-05')).toBe('11/5/2026')
  })
  it('formats a timestamp by its local day', () => {
    const d = new Date(2026, 9, 3, 23, 30) // Oct 3, 11:30 PM local
    expect(sheetDate(d.toISOString())).toBe('10/3/2026')
  })
  it('is empty for no date', () => {
    expect(sheetDate(null)).toBe('')
  })
})

describe('labels', () => {
  it('yesNo', () => {
    expect(yesNo(true)).toBe('Yes')
    expect(yesNo(false)).toBe('No')
    expect(yesNo(null)).toBe('No')
  })
  it('contactLabel joins name and role', () => {
    expect(contactLabel('Jimmy', 'Manager')).toBe('Jimmy / Manager')
    expect(contactLabel('Jimmy', '')).toBe('Jimmy')
    expect(contactLabel('', 'Owner')).toBe('Owner')
    expect(contactLabel(' ', null)).toBe(null)
  })
  it('reachLabel joins phone and email', () => {
    expect(reachLabel('832-474-7707', 'jimmy@njr.com')).toBe('832-474-7707 / jimmy@njr.com')
    expect(reachLabel('', 'jimmy@njr.com')).toBe('jimmy@njr.com')
    expect(reachLabel(null, null)).toBe(null)
  })
})

describe('toTsv', () => {
  it('joins cells with tabs and rows with line breaks, no header', () => {
    expect(toTsv([['a', 'b'], ['c', '']])).toBe('a\tb\nc\t')
  })
})

const NOW = new Date(2026, 10, 5, 15, 0) // Nov 5 2026, 3:00 PM local

const baseForm = {
  dayKey: '2026-11-05',
  business: { type: 'new', name: 'Feges BBQ' },
  contactName: 'Patrick',
  role: 'Owner',
  phone: '713-555-0101',
  email: '',
  notes: 'Pays 3.9% on Square',
  nextStep: 'Bring a quote',
  followUpOn: '2026-11-10',
  temperature: 'warm',
  outcomes: { dm_conversation: true, statement: false, demo_proposal: false, application: false, boarded: false },
}

describe('occurredAtFor', () => {
  it('uses now for today', () => {
    expect(occurredAtFor('2026-11-05', NOW)).toBe(NOW.toISOString())
  })
  it('uses local noon for an earlier day', () => {
    expect(occurredAtFor('2026-11-03', NOW)).toBe(new Date(2026, 10, 3, 12, 0).toISOString())
  })
})

describe('dayRange', () => {
  it('spans local midnight to the next local midnight', () => {
    expect(dayRange('2026-11-05')).toEqual({
      from: new Date(2026, 10, 5).toISOString(),
      to: new Date(2026, 10, 6).toISOString(),
    })
  })
})

describe('buildVisit', () => {
  it('builds a new prospect and its walk-in touch', () => {
    const { prospect, touch } = buildVisit(baseForm, NOW)
    expect(prospect).toEqual({
      kind: 'merchant', business_name: 'Feges BBQ', contact_name: 'Patrick', contact_role: 'Owner',
      phone: '713-555-0101', phone_key: '7135550101', email: null, temperature: 'warm', status: 'working',
    })
    expect(touch).toEqual({
      channel: 'walk_in', occurred_at: NOW.toISOString(), contact_id: null, prospect_id: null,
      business_name: 'Feges BBQ', contact_label: 'Patrick / Owner', reach_label: '713-555-0101',
      notes: 'Pays 3.9% on Square', next_step: 'Bring a quote', follow_up_on: '2026-11-10', temperature: 'warm',
      dm_conversation: true, statement: false, demo_proposal: false, application: false, boarded: false,
    })
  })
  it('points at an existing prospect without creating one', () => {
    const { prospect, touch } = buildVisit({ ...baseForm, business: { type: 'prospect', id: 'p1', name: 'Feges BBQ' } }, NOW)
    expect(prospect).toBe(null)
    expect(touch.prospect_id).toBe('p1')
    expect(touch.contact_id).toBe(null)
  })
  it('points at a Zoho contact', () => {
    const { prospect, touch } = buildVisit({ ...baseForm, business: { type: 'contact', id: 'c1', name: 'NJR Salons' } }, NOW)
    expect(prospect).toBe(null)
    expect(touch.contact_id).toBe('c1')
    expect(touch.business_name).toBe('NJR Salons')
  })
  it('edit mode returns only the touch fields', () => {
    const { prospect, touch } = buildVisit({ ...baseForm, business: { type: 'edit', name: 'Feges BBQ' } }, NOW)
    expect(prospect).toBe(null)
    expect(touch).not.toHaveProperty('contact_id')
    expect(touch).not.toHaveProperty('prospect_id')
    expect(touch).not.toHaveProperty('channel')
  })
  it('allows no rating and no follow-up', () => {
    const { touch } = buildVisit({ ...baseForm, temperature: null, followUpOn: '' }, NOW)
    expect(touch.temperature).toBe(null)
    expect(touch.follow_up_on).toBe(null)
  })
  it('rejects bad input', () => {
    expect(() => buildVisit({ ...baseForm, business: { type: 'new', name: '  ' } }, NOW)).toThrow('Pick or type the business')
    expect(() => buildVisit({ ...baseForm, business: null }, NOW)).toThrow('Pick or type the business')
    expect(() => buildVisit({ ...baseForm, dayKey: '' }, NOW)).toThrow('Pick the visit date')
    expect(() => buildVisit({ ...baseForm, dayKey: '2026-11-06' }, NOW)).toThrow('The visit date is in the future')
    expect(() => buildVisit({ ...baseForm, followUpOn: '11/10' }, NOW)).toThrow('Follow-up date is not a date')
    expect(() => buildVisit({ ...baseForm, temperature: 'lukewarm' }, NOW)).toThrow('Pick Hot, Warm or Cold')
  })
})

describe('visitRow', () => {
  it('lays a touch out in Chandler Visits columns A–M', () => {
    const { touch } = buildVisit(baseForm, NOW)
    expect(visitRow(touch)).toEqual([
      '11/5/2026', 'Feges BBQ', 'Patrick / Owner', '713-555-0101', 'Pays 3.9% on Square',
      'Bring a quote', '11/10/2026', 'Warm', 'Yes', 'No', 'No', 'No', 'No',
    ])
  })
  it('leaves quality and follow-up empty when not set', () => {
    const row = visitRow({ occurred_at: NOW.toISOString(), business_name: 'X', temperature: null, follow_up_on: null })
    expect(row[6]).toBe('')
    expect(row[7]).toBe('')
    expect(row.slice(8)).toEqual(['No', 'No', 'No', 'No', 'No'])
  })
})

describe('zohoVisitNote', () => {
  it('names the visit, rating and outcomes, then the notes', () => {
    const { touch } = buildVisit({ ...baseForm, outcomes: { ...baseForm.outcomes, statement: true } }, NOW)
    expect(zohoVisitNote(touch)).toBe('Walk-in · Warm · Decision-maker conversation, Statement received — Pays 3.9% on Square')
  })
  it('is just "Walk-in" with nothing else', () => {
    expect(zohoVisitNote({ temperature: null, notes: null })).toBe('Walk-in')
  })
})

describe('newSinceCopy', () => {
  const rows = [
    { id: 'a', created_at: '2026-11-05T20:00:00.000Z' },
    { id: 'b', created_at: '2026-11-05T23:30:00.000Z' },
  ]
  it('returns every row when the day was never copied', () => {
    expect(newSinceCopy(rows, null)).toEqual(rows)
  })
  it('returns rows created after the copy', () => {
    expect(newSinceCopy(rows, '2026-11-05T22:00:00.000Z').map((r) => r.id)).toEqual(['b'])
  })
})

describe('copy state', () => {
  it('round-trips through a storage object', () => {
    const store = new Map()
    const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }
    expect(readCopied('2026-11-05', 'visits', storage)).toBe(null)
    writeCopied('2026-11-05', 'visits', '2026-11-05T23:00:00.000Z', storage)
    expect(readCopied('2026-11-05', 'visits', storage)).toBe('2026-11-05T23:00:00.000Z')
  })
  it('never throws when storage is blocked', () => {
    const storage = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
    expect(readCopied('2026-11-05', 'visits', storage)).toBe(null)
    expect(() => writeCopied('2026-11-05', 'visits', 'x', storage)).not.toThrow()
  })
})

describe('OUTCOMES', () => {
  it('lists the five sheet outcomes in column order', () => {
    expect(OUTCOMES.map((o) => o.key)).toEqual(['dm_conversation', 'statement', 'demo_proposal', 'application', 'boarded'])
  })
})
