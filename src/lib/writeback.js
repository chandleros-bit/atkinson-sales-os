// Browser side of CRM write-back: the per-book feature flag and the call into
// the crm-action edge function. Kept apart from QuickActions so other surfaces
// (the sidebar's New Task, later the natural-language updates) share them.
import { useEffect, useState } from 'react'
import { supabase, isDemoMode } from './supabase'

let flagsPromise = null

// settings.writeback_enabled -> { bay: bool, mpg: bool }. Read once per page
// load; a failed read means "off" (actions hidden), never "on".
export function loadWritebackFlags() {
  if (isDemoMode) return Promise.resolve({})
  flagsPromise ??= supabase
    .from('settings')
    .select('value')
    .eq('key', 'writeback_enabled')
    .maybeSingle()
    .then(
      ({ data }) => data?.value || {},
      () => ({}),
    )
  return flagsPromise
}

// Test hook: forget the cached flags.
export function resetWritebackFlags() {
  flagsPromise = null
}

export function useWritebackFlags() {
  const [flags, setFlags] = useState({})
  useEffect(() => {
    let alive = true
    loadWritebackFlags().then((f) => alive && setFlags(f))
    return () => {
      alive = false
    }
  }, [])
  return flags
}

// Sends one request to crm-action. Always resolves to the function's body
// shape ({ status, results } or { status, error }) so callers handle one form.
export async function invokeCrmAction(request) {
  try {
    const { data, error } = await supabase.functions.invoke('crm-action', { body: request })
    if (!error) return data
    let message = error.message
    try {
      const body = await error.context?.json?.()
      if (body?.error) message = body.error
    } catch {
      // keep error.message
    }
    return { status: 'error', error: message }
  } catch (e) {
    return { status: 'error', error: String(e?.message || e) }
  }
}
