// The contact card's extra data, loaded once the card knows the lead: source
// and call dates (v_lead_signals), owner and tags (contacts), the Priority
// Leads score (Bayway), open tasks, and recent calls, texts, emails and
// appointments (notes load separately, useContactNotes). Missing rows are
// fine: each tab shows what it has.
import { useCallback, useEffect, useState } from 'react'
import { supabase, isDemoMode } from './supabase'

const ACTIVITY_TYPES = ['call', 'text', 'email', 'appointment']
const ACTIVITY_LIMIT = 30

export function useContactCard(id, biz) {
  const [state, setState] = useState({ signal: null, contact: null, priority: null, tasks: [], activity: [], loading: true })

  const load = useCallback(async () => {
    if (!id || !biz || isDemoMode) return setState((s) => ({ ...s, loading: false }))
    const [signal, contact, priority, tasks, activity] = await Promise.all([
      supabase.from('v_lead_signals').select('lead_source, crm_created_at, last_outbound_call_at').eq('id', id).maybeSingle(),
      supabase.from('contacts').select('owner, tags:raw->tags').eq('id', id).maybeSingle(),
      biz === 'bay' ? supabase.from('v_priority_leads').select('score, tier, ai_note').eq('id', id).maybeSingle() : { data: null },
      supabase.from('v_tasks').select('id, title, due_at').eq('contact_id', id).order('due_at', { ascending: true }).limit(50),
      supabase
        .from('activities')
        .select('id, type, occurred_at, notes, direction')
        .eq('contact_id', id)
        .in('type', ACTIVITY_TYPES)
        .order('occurred_at', { ascending: false })
        .limit(ACTIVITY_LIMIT),
    ])
    setState({
      signal: signal.data || null,
      contact: contact.data || null,
      priority: priority.data || null,
      tasks: tasks.data || [],
      activity: activity.data || [],
      loading: false,
    })
  }, [id, biz])

  useEffect(() => {
    load()
  }, [load])

  return { ...state, reload: load }
}
