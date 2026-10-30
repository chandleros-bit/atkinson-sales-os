// The buyer's and seller's agents on the Tuesday loans (dialer phase 3).
// v_loan_agents is the mirror of FUB Relationships, each agent linked to a
// Realtor contact when one matches. The hook shows the mirror at once, then
// asks crm-action (read-only, at most once an hour per borrower) to pull FUB
// and reloads. checked: that pull has answered, so an empty list means no
// agents are recorded in FUB.
import { useCallback, useEffect, useState } from 'react'
import { supabase, isDemoMode } from './supabase'

export const AGENT_LABEL = { buyer_agent: "Buyer's agent", seller_agent: "Seller's agent" }
const ORDER = { buyer_agent: 0, seller_agent: 1 }
// crm-action pulls at most this many borrowers per call.
const MAX_IDS = 25

// v_loan_agents rows -> Map(borrower id -> agents, buyer's first).
export function agentsByContact(rows) {
  const out = new Map()
  for (const r of rows || []) {
    if (!out.has(r.contact_id)) out.set(r.contact_id, [])
    out.get(r.contact_id).push(r)
  }
  for (const list of out.values()) list.sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || String(a.name).localeCompare(String(b.name)))
  return out
}

export function useLoanAgents(ids) {
  const list = [...new Set(ids || [])].sort().slice(0, MAX_IDS)
  const key = list.join(',')
  const [state, setState] = useState({ byContact: new Map(), checked: false })

  const load = useCallback(async () => {
    const wanted = key ? key.split(',') : []
    if (!wanted.length || isDemoMode) return
    const { data, error } = await supabase.from('v_loan_agents').select('*').in('contact_id', wanted).limit(200)
    if (!error) setState((s) => ({ ...s, byContact: agentsByContact(data) }))
  }, [key])

  useEffect(() => {
    const wanted = key ? key.split(',') : []
    // Keep the agents already shown (lookups are by borrower id) while re-checking.
    setState((s) => ({ ...s, checked: false }))
    if (!wanted.length || isDemoMode) return
    let live = true
    load().then(async () => {
      // Read-only, so invoked directly: no crm-action:done event.
      await supabase.functions
        .invoke('crm-action', { body: { client_action_id: crypto.randomUUID(), action: 'contact_relationships', payload: { contact_ids: wanted } } })
        .catch(() => null)
      if (!live) return
      await load()
      if (live) setState((s) => ({ ...s, checked: true }))
    })
    return () => {
      live = false
    }
  }, [key, load])

  return state
}
