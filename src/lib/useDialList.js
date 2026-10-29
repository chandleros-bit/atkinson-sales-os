// Data for the dial list: v_dial_contacts (paged) and today's "Not today"
// skips. Reloads after any CRM write (crm-action:done), on window focus, and
// every minute so "later today" items come due on time.
import { useCallback, useEffect, useState } from 'react'
import { supabase, isDemoMode } from './supabase'
import { fetchAllSettled } from './fetchAll'
import { localDateKey } from './crmActions'

export function useDialList() {
  const [state, setState] = useState({ rows: [], skips: new Set(), loading: !isDemoMode, error: null, now: Date.now() })

  const load = useCallback(async () => {
    if (isDemoMode) return
    const today = localDateKey(new Date())
    const [v, s] = await Promise.all([
      fetchAllSettled(() => supabase.from('v_dial_contacts').select('*').order('id')),
      supabase.from('dial_skips').select('contact_id').gt('until_date', today),
    ])
    const error = v.error || s.error
    setState((st) => ({
      rows: error ? st.rows : v.data || [],
      skips: error ? st.skips : new Set((s.data || []).map((r) => r.contact_id)),
      loading: false,
      error: error ? error.message : null,
      now: Date.now(),
    }))
  }, [])

  useEffect(() => {
    load()
    const tick = setInterval(() => setState((st) => ({ ...st, now: Date.now() })), 60_000)
    window.addEventListener('crm-action:done', load)
    window.addEventListener('focus', load)
    return () => {
      clearInterval(tick)
      window.removeEventListener('crm-action:done', load)
      window.removeEventListener('focus', load)
    }
  }, [load])

  // "Not today": off the list until tomorrow.
  const skipToday = useCallback(async (contactId) => {
    const tomorrow = localDateKey(new Date(Date.now() + 86_400_000))
    setState((st) => ({ ...st, skips: new Set([...st.skips, contactId]) }))
    await supabase.from('dial_skips').upsert({ contact_id: contactId, until_date: tomorrow }, { onConflict: 'user_id,contact_id' })
  }, [])

  return { ...state, reload: load, skipToday }
}
