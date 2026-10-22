// Data for the Workbench Work lane: Bayway leads in the two work stages and
// open MPG Zoho tasks. Refreshes after any CRM write (crm-action:done) and
// every minute while the tab is visible. Rules live in workbench.js.
import { useCallback, useEffect, useState } from 'react'
import { supabase, isDemoMode } from './supabase'
import { fetchAllSettled } from './fetchAll'

const WORK_STAGES = ['Contacted/Working', 'Application Received']

export function useWorkLane() {
  const [state, setState] = useState({ pipeline: [], tasks: [], loading: !isDemoMode, error: null })

  const load = useCallback(async () => {
    if (isDemoMode) return
    try {
      // Paged past PostgREST's 1,000-row cap (fetchAll.js), ordered for stable pages.
      const [p, t] = await Promise.all([
        fetchAllSettled(() =>
          supabase
            .from('v_active_pipeline')
            .select('id, name, stage, stage_since, open_task_count, oldest_open_due_at, docs_outstanding_count')
            .eq('business_id', 'bay')
            .in('stage', WORK_STAGES)
            .order('id'),
        ),
        fetchAllSettled(() =>
          supabase
            .from('v_tasks')
            .select('id, title, due_at, contact_id, contact_name, company, business_id')
            .eq('business_id', 'mpg')
            .order('id'),
        ),
      ])
      setState({
        pipeline: p.data || [],
        tasks: t.data || [],
        loading: false,
        error: p.error?.message || t.error?.message || null,
      })
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: String(e?.message || e) }))
    }
  }, [])

  useEffect(() => {
    load()
    const onWrite = () => load()
    window.addEventListener('crm-action:done', onWrite)
    const id = setInterval(() => document.visibilityState === 'visible' && load(), 60_000)
    return () => {
      window.removeEventListener('crm-action:done', onWrite)
      clearInterval(id)
    }
  }, [load])

  return { ...state, reload: load }
}
