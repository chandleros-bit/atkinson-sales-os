// Global search data: people from the search_people RPC (migration 0036) and
// open tasks from v_tasks. Debounced; nothing is sent under MIN_QUERY
// characters; an answer to an older query is dropped.
import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { cleanQuery, MIN_QUERY } from './search'

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
        if (mine === seq.current) setState({ ...EMPTY, error: String(e?.message || e) })
      }
    }, DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [query, prefer])

  return state
}
