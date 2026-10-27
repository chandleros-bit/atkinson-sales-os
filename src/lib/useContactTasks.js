// A lead's open tasks (v_tasks is open-only), soonest due first, for the
// Workbench's quick look. reload() after completing or pushing one.
import { useEffect, useState } from 'react'
import { supabase, isDemoMode } from './supabase'

export function useContactTasks(contactId) {
  const [state, setState] = useState({ tasks: [], loading: true })
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    if (!contactId || isDemoMode) return setState({ tasks: [], loading: false })
    let live = true
    supabase
      .from('v_tasks')
      .select('id, title, due_at')
      .eq('contact_id', contactId)
      .order('due_at', { ascending: true })
      .limit(50)
      .then(({ data }) => live && setState({ tasks: data || [], loading: false }))
    return () => {
      live = false
    }
  }, [contactId, nonce])
  return { ...state, reload: () => setNonce((n) => n + 1) }
}
