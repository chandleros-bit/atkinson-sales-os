// Reference > Lenders: the reference_lenders table (migration 0058).
import { useCallback, useEffect, useState } from 'react'
import { supabase, isDemoMode } from './supabase'

export const LENDER_FIELDS = ['lender', 'ae_name', 'ae_phone', 'ae_email', 'portal_url', 'programs', 'min_fico', 'max_ltv', 'turn_time', 'comp_notes', 'notes']

export function useReferenceLenders() {
  const [state, setState] = useState({ rows: [], loading: !isDemoMode, error: null })

  const load = useCallback(async () => {
    if (isDemoMode) return
    const { data, error } = await supabase.from('reference_lenders').select('*').order('lender', { ascending: true }).limit(500)
    setState({ rows: data || [], loading: false, error: error?.message ?? null })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const done = async (res) => {
    await load()
    if (res?.error) setState((s) => ({ ...s, error: res.error.message }))
    return !res?.error
  }

  const save = async (row) => {
    const values = Object.fromEntries(LENDER_FIELDS.map((k) => [k, row[k] ?? null]))
    values.programs = row.programs || []
    return done(row.id ? await supabase.from('reference_lenders').update(values).eq('id', row.id) : await supabase.from('reference_lenders').insert(values))
  }
  const remove = async (id) => done(await supabase.from('reference_lenders').delete().eq('id', id))

  return { ...state, reload: load, save, remove }
}
