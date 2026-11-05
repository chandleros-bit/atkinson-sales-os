// Reference > Links: the reference_links table (migration 0058).
import { useCallback, useEffect, useState } from 'react'
import { supabase, isDemoMode } from './supabase'

export function useReferenceLinks() {
  const [state, setState] = useState({ rows: [], loading: !isDemoMode, error: null })

  const load = useCallback(async () => {
    if (isDemoMode) return
    const { data, error } = await supabase.from('reference_links').select('*').order('grp', { ascending: true }).order('sort', { ascending: true }).limit(500)
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
    const values = { title: row.title, url: row.url, grp: row.grp, sort: row.sort ?? 0, copy_address: !!row.copy_address }
    return done(row.id ? await supabase.from('reference_links').update(values).eq('id', row.id) : await supabase.from('reference_links').insert(values))
  }
  const remove = async (id) => done(await supabase.from('reference_links').delete().eq('id', id))
  // Swap sort with the neighbor in the same group (dir -1 up, +1 down).
  const move = async (link, groupLinks, dir) => {
    const i = groupLinks.findIndex((l) => l.id === link.id)
    const other = groupLinks[i + dir]
    if (!other) return true
    const a = await supabase.from('reference_links').update({ sort: other.sort === link.sort ? link.sort + dir : other.sort }).eq('id', link.id)
    const b = await supabase.from('reference_links').update({ sort: link.sort }).eq('id', other.id)
    return done(a.error ? a : b)
  }

  return { ...state, reload: load, save, remove, move }
}
