// @vitest-environment jsdom
// The header's sync dot keeps refetching while a page stays open: before, it
// only refetched on page change or window focus, so a dashboard left open
// showed "last sync" aging past the 2-minute FUB runs that were landing fine.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import React from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const calls = { n: 0 }
vi.mock('./supabase', () => {
  const query = (source) => {
    const q = {
      select: () => q,
      eq: () => q,
      order: () => q,
      limit: () => q,
      maybeSingle: async () => {
        calls.n += 1
        return { data: { source, ran_at: new Date().toISOString(), status: 'ok' }, error: null }
      },
    }
    return q
  }
  return {
    isDemoMode: false,
    supabase: { from: () => ({ select: () => ({ eq: (_c, source) => query(source) }) }) },
  }
})

const { useSyncHealth } = await import('./useSyncHealth')

let seen
function Probe() {
  seen = useSyncHealth()
  return null
}

describe('useSyncHealth', () => {
  let root
  let el
  beforeEach(() => {
    vi.useFakeTimers()
    el = document.createElement('div')
    root = createRoot(el)
  })
  afterEach(() => {
    act(() => root.unmount())
    vi.useRealTimers()
  })

  it('refetches every minute or so while the page stays open and visible', async () => {
    await act(async () => root.render(<Probe />))
    await act(async () => {})
    const first = calls.n
    expect(first).toBe(4)
    expect(seen.fub.status).toBe('ok')

    await act(async () => { await vi.advanceTimersByTimeAsync(90_000) })
    expect(calls.n).toBe(first + 4)
  })

  it('skips the timer while the tab is hidden', async () => {
    await act(async () => root.render(<Probe />))
    const before = calls.n
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000) })
    expect(calls.n).toBe(before)
    vis.mockReturnValue('visible')
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(calls.n).toBe(before + 4)
    vis.mockRestore()
  })
})
