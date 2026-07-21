import { describe, it, expect } from 'vitest'
import { diffTracking, diffDocs, assertNotMassRemoval } from './sheet-docs-diff.ts'

const NOW = '2026-07-20T12:00:00.000Z'

describe('diffTracking', () => {
  it('inserts a borrower who is new to the sheet', () => {
    const out = diffTracking([{ fub_person_id: '2972', notes: 'hi', docs: [] }], [], NOW)
    expect(out).toEqual({
      active: [{ fub_person_id: '2972', notes: 'hi', last_seen_at: NOW, removed_at: null }],
      removed: [],
    })
  })

  it('clears removed_at when a borrower returns to the sheet', () => {
    const existing = [{ fub_person_id: '2972', notes: '', removed_at: '2026-07-01T00:00:00.000Z' }]
    const out = diffTracking([{ fub_person_id: '2972', notes: 'back', docs: [] }], existing, NOW)
    expect(out.active[0].removed_at).toBeNull()
  })

  it('stamps removed_at for a borrower who dropped out', () => {
    const existing = [{ fub_person_id: '3104', notes: '', removed_at: null }]
    const out = diffTracking([], existing, NOW)
    expect(out).toEqual({
      active: [],
      removed: [{ fub_person_id: '3104', notes: '', removed_at: NOW }],
    })
  })

  it('does not re-stamp a borrower who was already removed', () => {
    const existing = [{ fub_person_id: '3104', notes: '', removed_at: '2026-07-01T00:00:00.000Z' }]
    expect(diffTracking([], existing, NOW)).toEqual({ active: [], removed: [] })
  })

  it('ensures removed rows have no last_seen_at key', () => {
    const existing = [{ fub_person_id: '3104', notes: '', removed_at: null }]
    const out = diffTracking([], existing, NOW)
    expect(out.removed).toHaveLength(1)
    expect('last_seen_at' in out.removed[0]).toBe(false)
  })
})

describe('diffDocs', () => {
  const person = (docs) => [{ fub_person_id: '2972', notes: '', docs }]

  it('stamps first_requested_at when a doc first becomes needed', () => {
    const out = diffDocs(person([{ doc_type: 'W2', status: 'needed' }]), new Map(), NOW)
    expect(out).toEqual([
      {
        fub_person_id: '2972',
        doc_type: 'W2',
        status: 'needed',
        first_requested_at: NOW,
        received_at: null,
        removed_at: null,
      },
    ])
  })

  it('preserves the original first_requested_at while a doc stays needed', () => {
    const existing = new Map([
      ['2972', [{ doc_type: 'W2', status: 'needed', first_requested_at: '2026-07-08T00:00:00.000Z', received_at: null, removed_at: null }]],
    ])
    const out = diffDocs(person([{ doc_type: 'W2', status: 'needed' }]), existing, NOW)
    expect(out).toEqual([])
  })

  it('stamps received_at on needed -> received', () => {
    const existing = new Map([
      ['2972', [{ doc_type: 'W2', status: 'needed', first_requested_at: '2026-07-08T00:00:00.000Z', received_at: null, removed_at: null }]],
    ])
    const out = diffDocs(person([{ doc_type: 'W2', status: 'received' }]), existing, NOW)
    expect(out[0].status).toBe('received')
    expect(out[0].received_at).toBe(NOW)
    expect(out[0].first_requested_at).toBe('2026-07-08T00:00:00.000Z')
  })

  it('re-opens a doc on received -> needed, clearing received_at', () => {
    const existing = new Map([
      ['2972', [{ doc_type: 'W2', status: 'received', first_requested_at: '2026-07-01T00:00:00.000Z', received_at: '2026-07-10T00:00:00.000Z', removed_at: null }]],
    ])
    const out = diffDocs(person([{ doc_type: 'W2', status: 'needed' }]), existing, NOW)
    expect(out[0].received_at).toBeNull()
    expect(out[0].first_requested_at).toBe(NOW)
  })

  it('stamps removed_at when a doc disappears from the sheet', () => {
    const existing = new Map([
      ['2972', [{ doc_type: 'W2', status: 'needed', first_requested_at: NOW, received_at: null, removed_at: null }]],
    ])
    const out = diffDocs(person([]), existing, NOW)
    expect(out[0].removed_at).toBe(NOW)
  })

  it('restores a soft-removed doc without resetting its original request date', () => {
    const existing = new Map([
      ['2972', [{ doc_type: 'W2', status: 'needed', first_requested_at: '2026-07-08T00:00:00.000Z', received_at: null, removed_at: '2026-07-15T00:00:00.000Z' }]],
    ])
    const out = diffDocs(person([{ doc_type: 'W2', status: 'needed' }]), existing, NOW)
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual({
      fub_person_id: '2972',
      doc_type: 'W2',
      status: 'needed',
      first_requested_at: '2026-07-08T00:00:00.000Z',
      received_at: null,
      removed_at: null,
    })
  })

  it('emits nothing when nothing changed', () => {
    const existing = new Map([
      ['2972', [{ doc_type: 'W2', status: 'needed', first_requested_at: '2026-07-08T00:00:00.000Z', received_at: null, removed_at: null }]],
    ])
    expect(diffDocs(person([{ doc_type: 'W2', status: 'needed' }]), existing, NOW)).toEqual([])
  })

  it('soft-removes all docs when a borrower drops out', () => {
    const existing = new Map([
      ['2972', [
        { doc_type: 'W2', status: 'needed', first_requested_at: '2026-07-08T00:00:00.000Z', received_at: null, removed_at: null },
        { doc_type: 'Paystubs', status: 'received', first_requested_at: '2026-07-01T00:00:00.000Z', received_at: '2026-07-05T00:00:00.000Z', removed_at: null },
      ]],
    ])
    const out = diffDocs([], existing, NOW)
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({
      fub_person_id: '2972',
      doc_type: 'W2',
      status: 'needed',
      first_requested_at: '2026-07-08T00:00:00.000Z',
      received_at: null,
      removed_at: NOW,
    })
    expect(out[1]).toEqual({
      fub_person_id: '2972',
      doc_type: 'Paystubs',
      status: 'received',
      first_requested_at: '2026-07-01T00:00:00.000Z',
      received_at: '2026-07-05T00:00:00.000Z',
      removed_at: NOW,
    })
  })

  it('does not re-stamp docs when a borrower who dropped out is seen again', () => {
    const existing = new Map([
      ['2972', [
        { doc_type: 'W2', status: 'needed', first_requested_at: '2026-07-08T00:00:00.000Z', received_at: null, removed_at: NOW },
      ]],
    ])
    const out = diffDocs([], existing, NOW)
    expect(out).toEqual([])
  })

  it('emits nothing when a doc stays received', () => {
    const existing = new Map([
      ['2972', [{ doc_type: 'W2', status: 'received', first_requested_at: '2026-07-01T00:00:00.000Z', received_at: '2026-07-10T00:00:00.000Z', removed_at: null }]],
    ])
    const out = diffDocs(person([{ doc_type: 'W2', status: 'received' }]), existing, NOW)
    expect(out).toEqual([])
  })
})

describe('assertNotMassRemoval', () => {
  it('throws when the sheet reads empty but we previously had borrowers', () => {
    expect(() => assertNotMassRemoval(0, 42)).toThrow(/refusing/i)
  })

  it('names the prior count so the sync_log line is actionable', () => {
    expect(() => assertNotMassRemoval(0, 42)).toThrow(/42/)
  })

  it('allows an empty sheet on the very first run', () => {
    expect(() => assertNotMassRemoval(0, 0)).not.toThrow()
  })

  it('allows a normal run', () => {
    expect(() => assertNotMassRemoval(42, 42)).not.toThrow()
  })

  it('allows a large but non-total drop — only a TOTAL wipe is suspect', () => {
    expect(() => assertNotMassRemoval(1, 500)).not.toThrow()
  })

  // Defensive input validation: guard must catch garbage data, not be disabled by it
  it('throws when incomingCount is NaN', () => {
    expect(() => assertNotMassRemoval(NaN, 42)).toThrow(/cannot assess sheet safety.*incomingCount/i)
  })

  it('throws when incomingCount is null', () => {
    expect(() => assertNotMassRemoval(null, 42)).toThrow(/cannot assess sheet safety.*incomingCount/i)
  })

  it('throws when incomingCount is undefined', () => {
    expect(() => assertNotMassRemoval(undefined, 42)).toThrow(/cannot assess sheet safety.*incomingCount/i)
  })

  it('throws when previousCount is NaN', () => {
    expect(() => assertNotMassRemoval(0, NaN)).toThrow(/cannot assess sheet safety.*previousCount/i)
  })

  it('throws when previousCount is null', () => {
    expect(() => assertNotMassRemoval(0, null)).toThrow(/cannot assess sheet safety.*previousCount/i)
  })

  it('throws when previousCount is undefined', () => {
    expect(() => assertNotMassRemoval(0, undefined)).toThrow(/cannot assess sheet safety.*previousCount/i)
  })
})
