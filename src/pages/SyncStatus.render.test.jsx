// @vitest-environment jsdom
// Sync Status against a fake Supabase: a page left open refreshes its rows
// every minute while visible, instead of freezing at its first read.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import React from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const state = { reads: 0, fubAt: null }
vi.mock('../lib/supabase', () => {
  const chain = (resolve) => {
    const q = {
      select: () => q,
      eq: () => q,
      gte: () => q,
      order: () => q,
      limit: () => q,
      maybeSingle: async () => ({ data: null, error: null }),
      then: (ok, bad) => Promise.resolve(resolve()).then(ok, bad),
    }
    return q
  }
  return {
    isDemoMode: false,
    supabase: {
      from: (table) =>
        chain(() => {
          if (table !== 'sync_log') return { data: [], error: null }
          state.reads += 1
          return {
            data: [
              { source: 'fub', ran_at: state.fubAt, status: 'ok', records_upserted: 18, message: null },
              { source: 'briefing-owner', ran_at: state.fubAt, status: 'ok', records_upserted: 1, message: 'sent' },
            ],
            error: null,
          }
        }),
      functions: { invoke: async () => ({ data: { ok: true }, error: null }) },
    },
  }
})

const { default: SyncStatus } = await import('./SyncStatus')

describe('SyncStatus', () => {
  let root
  let el
  beforeEach(() => {
    vi.useFakeTimers()
    state.reads = 0
    state.fubAt = new Date().toISOString()
    el = document.createElement('div')
    root = createRoot(el)
  })
  afterEach(() => {
    act(() => root.unmount())
    vi.useRealTimers()
  })

  it('refreshes the rows every minute while the page stays open', async () => {
    await act(async () => root.render(<MemoryRouter><SyncStatus /></MemoryRouter>))
    await act(async () => {})
    const first = state.reads
    expect(first).toBeGreaterThan(0)
    expect(el.textContent).toContain('just now')

    // Four minutes pass with the sync landing a row each minute. Without the
    // refresh the row would read "4m ago".
    for (let i = 0; i < 4; i += 1) {
      state.fubAt = new Date().toISOString()
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    }
    expect(state.reads).toBeGreaterThan(first + 2)
    expect(el.textContent).toMatch(/FollowUpBoss \(Bayway\)BAYWAY(just now|1m ago)/)
  })

  it('lists the daily briefing source', async () => {
    await act(async () => root.render(<MemoryRouter><SyncStatus /></MemoryRouter>))
    await act(async () => {})
    expect(el.textContent).toContain('Daily briefing (you)')
  })

  it('does not refetch while the tab is hidden, then catches up when shown', async () => {
    await act(async () => root.render(<MemoryRouter><SyncStatus /></MemoryRouter>))
    await act(async () => {})
    const before = state.reads
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000) })
    expect(state.reads).toBe(before)
    vis.mockReturnValue('visible')
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    await act(async () => {})
    expect(state.reads).toBeGreaterThan(before)
    vis.mockRestore()
  })
})
