import { describe, it, expect, vi } from 'vitest'
import { cleanNoteText, pickFirstNote, fetchFirstNote, backfillFirstNotes } from './fub-first-note.ts'

const PROVIDER = 'Credit: 660-699 / email: sample@example.com / loan type: DSCR Purchase / state: North Carolina / loan amount: $200K - $500K'

describe('cleanNoteText', () => {
  it('strips HTML, decodes entities and collapses whitespace', () => {
    expect(cleanNoteText('<p>Credit: 660-699 &amp; up<br/>  state:&nbsp;NC</p>')).toBe('Credit: 660-699 & up\nstate: NC')
  })
  it('caps the length and handles nothing', () => {
    expect(cleanNoteText('x'.repeat(1500))).toHaveLength(1000)
    expect(cleanNoteText(null)).toBe('')
  })
})

describe('pickFirstNote', () => {
  it('takes the earliest note with text', () => {
    const notes = [
      { body: 'Called, left message', created: '2026-10-21T15:00:00Z' },
      { body: PROVIDER, created: '2026-10-20T09:00:00Z' },
      { body: '   ', created: '2026-10-19T09:00:00Z' },
    ]
    expect(pickFirstNote(notes, [])).toEqual({ text: PROVIDER, at: '2026-10-20T09:00:00Z' })
  })
  it('falls back to the first event message when there are no notes', () => {
    const events = [
      { message: 'Later event', created: '2026-10-21T10:00:00Z' },
      { message: '', description: PROVIDER, created: '2026-10-20T09:00:00Z' },
    ]
    expect(pickFirstNote([], events)).toEqual({ text: PROVIDER, at: '2026-10-20T09:00:00Z' })
  })
  it('gives null when there is nothing to read', () => {
    expect(pickFirstNote([], [])).toBe(null)
  })
})

describe('fetchFirstNote', () => {
  it('reads notes first and only asks for events when there are none', async () => {
    const get = vi.fn(async (path) => (path === '/notes' ? { notes: [{ body: PROVIDER, created: '2026-10-20T09:00:00Z' }] } : { events: [] }))
    expect((await fetchFirstNote('6001', get)).text).toBe(PROVIDER)
    expect(get).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenCalledWith('/notes', { personId: '6001', sort: 'created', limit: 10 })

    const get2 = vi.fn(async (path) => (path === '/notes' ? { notes: [] } : { events: [{ message: PROVIDER, created: '2026-10-20T09:00:00Z' }] }))
    expect((await fetchFirstNote('6002', get2)).text).toBe(PROVIDER)
    expect(get2).toHaveBeenCalledWith('/events', { personId: '6002', sort: 'created', limit: 10 })
  })
})

describe('backfillFirstNotes', () => {
  function fakeDb(candidates) {
    const updates = []
    return {
      updates,
      rpc: vi.fn(async () => ({ data: candidates, error: null })),
      from: () => ({
        update: (patch) => ({
          eq: async (col, id) => {
            updates.push({ id, ...patch })
            return { error: null }
          },
        }),
      }),
    }
  }

  it('stores what it finds, stamps every check, and skips a person that fails', async () => {
    const db = fakeDb([{ id: 'c1', external_id: '6001' }, { id: 'c2', external_id: '6002' }, { id: 'c3', external_id: '6003' }])
    const get = vi.fn(async (path, { personId }) => {
      if (personId === '6002') throw new Error('FUB GET /notes -> 500')
      if (personId === '6001') return path === '/notes' ? { notes: [{ body: PROVIDER, created: '2026-10-20T09:00:00Z' }] } : { events: [] }
      return path === '/notes' ? { notes: [] } : { events: [] }
    })
    const now = new Date('2026-10-22T20:00:00Z')
    expect(await backfillFirstNotes(db, get, { max: 30, now })).toEqual({ checked: 2, found: 1 })
    expect(db.rpc).toHaveBeenCalledWith('first_note_candidates', { max_rows: 30 })
    expect(db.updates).toEqual([
      { id: 'c1', first_note: PROVIDER, first_note_at: '2026-10-20T09:00:00Z', first_note_checked_at: '2026-10-22T20:00:00.000Z' },
      { id: 'c3', first_note_checked_at: '2026-10-22T20:00:00.000Z' },
    ])
  })
})
