// Data for the Workbench Work lane: Bayway leads in the two work stages, open
// MPG Zoho tasks and this user's work_items rows. Refreshes after any CRM
// write (crm-action:done) and every minute while the tab is visible. Rules
// live in workbench.js.
import { useCallback, useEffect, useState } from 'react'
import { supabase, isDemoMode } from './supabase'
import { fetchAllSettled } from './fetchAll'

const WORK_STAGES = ['Contacted/Working', 'Application Received']
// Done rows older than this no longer change the lane (application review = 3 days).
const WORK_ITEM_DAYS = 8

export function useWorkLane() {
  const [state, setState] = useState({ pipeline: [], tasks: [], workItems: [], loading: !isDemoMode, error: null })

  const load = useCallback(async () => {
    if (isDemoMode) return
    try {
      // Paged past PostgREST's 1,000-row cap (fetchAll.js), ordered for stable pages.
      const since = new Date(Date.now() - WORK_ITEM_DAYS * 86400000).toISOString()
      const [p, t, w] = await Promise.all([
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
        // Open rows, plus rows done in the last week (the weekly review and
        // today's progress). RLS returns only this user's rows.
        fetchAllSettled(() =>
          supabase
            .from('work_items')
            .select('id, business_id, source_key, kind, contact_id, title, status, waiting_on, check_back_on, notes, due_on, review_docs, created_at, done_at, contact:contacts(name)')
            .or(`status.neq.done,done_at.gte.${since}`)
            .order('id'),
        ),
      ])
      // The work leads' FUB tags: a DSCR estimate suggests "Estimate sent"; a
      // Pre-Approved or Disclosed application is done with review.
      const leadIds = (p.data || []).map((r) => r.id)
      const tagged = leadIds.length
        ? await fetchAllSettled(() => supabase.from('contacts').select('id, tags:raw->tags').in('id', leadIds).order('id'))
        : { data: [] }
      const tagsById = new Map((tagged.data || []).map((c) => [c.id, c.tags]))
      setState({
        pipeline: (p.data || []).map((r) => (tagsById.has(r.id) ? { ...r, tags: tagsById.get(r.id) } : r)),
        tasks: t.data || [],
        workItems: (w.data || []).map(({ contact, ...row }) => ({ ...row, contact_name: contact?.name || null })),
        loading: false,
        error: p.error?.message || t.error?.message || w.error?.message || null,
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
