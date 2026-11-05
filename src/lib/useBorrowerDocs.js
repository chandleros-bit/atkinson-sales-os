// One Bayway contact's full doc list (Needed and Received) plus the three
// write RPCs (migration 0057). The view only carries outstanding names, so
// this reads the tables: contact -> tracking (fub_person_id) -> docs.
import { useCallback, useEffect, useState } from 'react'
import { supabase, isDemoMode } from './supabase'

const EMPTY = { loading: false, tracked: false, docs: [], note: null, error: null }

export function useBorrowerDocs(contactId) {
  const [state, setState] = useState({ ...EMPTY, loading: true })

  const load = useCallback(async () => {
    if (isDemoMode || !contactId) {
      setState(EMPTY)
      return
    }
    const { data: c } = await supabase.from('contacts').select('external_id').eq('id', contactId).maybeSingle()
    if (!c?.external_id) {
      setState(EMPTY)
      return
    }
    const { data: t } = await supabase
      .from('borrower_doc_tracking')
      .select('id, notes')
      .eq('fub_person_id', c.external_id)
      .is('removed_at', null)
      .maybeSingle()
    if (!t) {
      setState(EMPTY)
      return
    }
    const { data: docs, error } = await supabase
      .from('borrower_docs')
      .select('id, doc_type, status, first_requested_at, received_at, received_by_name')
      .eq('tracking_id', t.id)
      .is('removed_at', null)
    setState({ loading: false, tracked: true, docs: docs || [], note: t.notes ?? null, error: error?.message ?? null })
  }, [contactId])

  useEffect(() => {
    load()
  }, [load])

  // Every write reloads, so the screen always matches the database; an error
  // stays visible until the next successful write.
  const call = useCallback(
    async (fn, args) => {
      const { error } = await supabase.rpc(fn, args)
      await load()
      if (error) setState((s) => ({ ...s, error: error.message }))
      return !error
    },
    [load],
  )

  return {
    ...state,
    reload: load,
    setDoc: (docType, status) => call('set_borrower_doc', { p_contact: contactId, p_doc_type: docType, p_status: status }),
    setNote: (note) => call('set_borrower_doc_note', { p_contact: contactId, p_note: note }),
    setup: () => call('setup_borrower_docs', { p_contact: contactId }),
  }
}
