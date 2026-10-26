// Browser side of CRM write-back: the per-book feature flag and the call into
// the crm-action edge function. Kept apart from QuickActions so other surfaces
// (the sidebar's New Task, later the natural-language updates) share them.
import { useEffect, useState } from 'react'
import { supabase, isDemoMode } from './supabase'

const flagPromises = new Map()

// settings[key] -> { bay: bool, mpg: bool } (writeback_enabled,
// create_lead_enabled). Read once per page load; a failed read means "off"
// (actions hidden), never "on".
export function loadSettingFlags(key) {
  if (isDemoMode) return Promise.resolve({})
  if (!flagPromises.has(key)) {
    flagPromises.set(
      key,
      Promise.resolve(supabase.from('settings').select('value').eq('key', key).maybeSingle()).then(
        ({ data }) => data?.value || {},
        () => ({}),
      ),
    )
  }
  return flagPromises.get(key)
}

export const loadWritebackFlags = () => loadSettingFlags('writeback_enabled')

// Test hook: forget the cached flags.
export function resetWritebackFlags() {
  flagPromises.clear()
}

export function useSettingFlags(key) {
  const [flags, setFlags] = useState({})
  useEffect(() => {
    let alive = true
    loadSettingFlags(key).then((f) => alive && setFlags(f))
    return () => {
      alive = false
    }
  }, [key])
  return flags
}

export const useWritebackFlags = () => useSettingFlags('writeback_enabled')

// Sends one request to crm-action. Always resolves to the function's body
// shape ({ status, results } or { status, error }) so callers handle one form.
export async function invokeCrmAction(request) {
  try {
    const { data, error } = await supabase.functions.invoke('crm-action', { body: request })
    if (!error) {
      // Lets other views (the Up Next queue and its badge) refresh.
      // A lead removed because FUB deleted it counts too: its card must go.
      if (data?.status === 'ok' || data?.status === 'partial' || data?.results?.some?.((r) => r.contact_removed)) {
        window.dispatchEvent(new CustomEvent('crm-action:done', { detail: data }))
      }
      return data
    }
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
