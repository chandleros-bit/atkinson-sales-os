// Global search data: people from the search_people RPC (migration 0036) and
// open tasks from v_tasks. Debounced; nothing is sent under MIN_QUERY
// characters; an answer to an older query is dropped.
import { useEffect, useRef, useState } from 'react'
import { supabase, isDemoMode } from './supabase'
import { demoPeople } from './demoData'
import { cleanQuery, MIN_QUERY } from './search'
import { friendlyError } from './friendlyError'

const EMPTY = { people: [], tasks: [], loading: false, error: null }
export const DEBOUNCE_MS = 150

// prefer: the book in view ('bay' | 'mpg'), ranked first; 'all' prefers none.
export function useSearch(query, prefer = 'all') {
  const [state, setState] = useState(EMPTY)
  const seq = useRef(0)

  useEffect(() => {
    const q = cleanQuery(query)
    const mine = ++seq.current
    if (q.length < MIN_QUERY) {
      setState(EMPTY)
      return undefined
    }
    if (isDemoMode) {
      // Demo mode searches the sample leads, so the palette works without a database.
      const needle = q.toLowerCase()
      const people = demoPeople()
        .filter((p) => [p.name, p.company, p.phone].some((v) => v && v.toLowerCase().includes(needle)))
        .sort((a, b) => (prefer !== 'all' && a.business_id === prefer ? -1 : 0) - (prefer !== 'all' && b.business_id === prefer ? -1 : 0))
      setState({ people, tasks: [], loading: false, error: null })
      return undefined
    }
    setState((s) => ({ ...s, loading: true }))
    const id = setTimeout(async () => {
      try {
        const [people, tasks] = await Promise.all([
          supabase.rpc('search_people', { q, prefer: prefer === 'all' ? null : prefer, max_rows: 8 }),
          supabase
            .from('v_tasks')
            .select('id, title, due_at, contact_id, contact_name, business_id')
            .or(`title.ilike."*${q}*",contact_name.ilike."*${q}*"`)
            .limit(5),
        ])
        if (mine !== seq.current) return
        setState({
          people: people.data || [],
          tasks: tasks.data || [],
          loading: false,
          error: people.error?.message || tasks.error?.message || null,
        })
      } catch (e) {
        if (mine === seq.current) setState({ ...EMPTY, error: friendlyError(e) })
      }
    }, DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [query, prefer])

  return state
}
