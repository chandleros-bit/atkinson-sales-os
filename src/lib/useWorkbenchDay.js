// The Workbench day's saved order (workbench_days, migration 0076; dayOrder.js).
// Reads today's row and the last saved day before it. Workbench passes
// `create` with today's built lists once they've loaded: after 6 AM Central,
// with no row yet, it saves the order (last day's unfinished items first).
// Overview only reads, so its counts follow the same order.
// A missing table (before 0076 is applied) or any failure leaves the lists
// live, as before step 3.
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, isDemoMode } from './supabase'
import { initialOrder, isOrderTime, dayKeyOf } from './dayOrder'

const COLS = 'day, set_at, lists, pulled_in, closed_at'

export function useWorkbenchDay({ lists = null, ready = false, create = false } = {}) {
  const [state, setState] = useState({ today: null, last: null, loaded: isDemoMode, error: null })
  const creating = useRef(false)
  const day = dayKeyOf()

  useEffect(() => {
    if (isDemoMode) return
    let live = true
    ;(async () => {
      try {
        const [t, l] = await Promise.all([
          supabase.from('workbench_days').select(COLS).eq('day', day).maybeSingle(),
          supabase.from('workbench_days').select(COLS).lt('day', day).order('day', { ascending: false }).limit(1).maybeSingle(),
        ])
        if (!live) return
        const error = t?.error || l?.error || null
        setState({ today: error ? null : t?.data || null, last: error ? null : l?.data || null, loaded: true, error })
      } catch (e) {
        if (live) setState({ today: null, last: null, loaded: true, error: e })
      }
    })()
    return () => {
      live = false
    }
  }, [day])

  // Set the day's order once: first load after 6 AM with the lists loaded.
  useEffect(() => {
    if (!create || !ready || !lists || !state.loaded || state.error || state.today || creating.current || isDemoMode) return
    if (!isOrderTime()) return
    creating.current = true
    const row = { day, lists: initialOrder(lists, state.last), pulled_in: [] }
    ;(async () => {
      try {
        // Another tab may have set it first: keep theirs and read it back.
        await supabase.from('workbench_days').upsert(row, { onConflict: 'user_id,day', ignoreDuplicates: true })
        const { data } = await supabase.from('workbench_days').select(COLS).eq('day', day).maybeSingle()
        setState((s) => ({ ...s, today: data || { ...row, set_at: new Date().toISOString() } }))
      } catch {
        creating.current = false
      }
    })()
  }, [create, ready, lists, state, day])

  // Pull New since items into today's lists, after the saved order.
  const pullIn = useCallback(
    async (keys) => {
      if (!state.today || !keys.length) return
      const pulled_in = [...new Set([...(state.today.pulled_in || []), ...keys])]
      setState((s) => ({ ...s, today: { ...s.today, pulled_in } }))
      await supabase.from('workbench_days').update({ pulled_in }).eq('day', day)
    },
    [state.today, day],
  )

  return { saved: state.today, loaded: state.loaded, pullIn }
}
