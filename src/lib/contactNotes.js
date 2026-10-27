// A lead's notes for the contact card: activities rows of type 'note' (both
// CRMs' mirrors) in one shape, newest first. The full text comes from raw
// (FUB body, often HTML; Zoho Note_Content); `notes` is the fallback.
import { useCallback, useEffect, useState } from 'react'
import { supabase, isDemoMode } from './supabase'

function plainText(html) {
  return String(html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|li)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const same = (a, b) => plainText(a).replace(/\s+/g, ' ') === plainText(b).replace(/\s+/g, ' ')

// firstNote: the lead form's note, pinned above the list, so left out of it.
export function noteRows(activities, firstNote = null) {
  return (activities || [])
    .map((a) => {
      const raw = a.raw || {}
      const text = plainText(raw.body ?? raw.Note_Content ?? a.notes)
      const author = (typeof raw.createdBy === 'string' ? raw.createdBy : raw.Created_By?.name) || null
      return { id: a.id, at: a.occurred_at, title: raw.Note_Title || raw.subject || null, text, author }
    })
    .filter((n) => n.text && !(firstNote && same(n.text, firstNote)))
    .sort((a, b) => new Date(b.at) - new Date(a.at))
}

const PAGE = 10

// The card shows the mirror at once, then asks crm-action (read-only) for the
// lead's full note list from FUB / Zoho and reloads. refreshError: why the
// CRM couldn't be read (the mirrored notes still show).
export function useContactNotes(contactId) {
  const [state, setState] = useState({ notes: [], firstNote: null, loading: true, refreshing: false, refreshError: null, more: false })
  const [limit, setLimit] = useState(PAGE)

  const load = useCallback(async () => {
    if (!contactId || isDemoMode) return setState((s) => ({ ...s, loading: false }))
    const [acts, contact] = await Promise.all([
      supabase
        .from('activities')
        .select('id, occurred_at, notes, raw')
        .eq('contact_id', contactId)
        .eq('type', 'note')
        .order('occurred_at', { ascending: false })
        .range(0, limit),
      supabase.from('contacts').select('first_note').eq('id', contactId).maybeSingle(),
    ])
    const firstNote = contact.data?.first_note || null
    const rows = acts.data || []
    setState((s) => ({
      ...s,
      loading: false,
      firstNote,
      notes: noteRows(rows.slice(0, limit), firstNote),
      more: rows.length > limit,
    }))
  }, [contactId, limit])

  const refresh = useCallback(async () => {
    if (!contactId || isDemoMode) return
    setState((s) => ({ ...s, refreshing: true, refreshError: null }))
    // Read-only and not a write: invoked directly, so no crm-action:done event.
    const { data, error } = await supabase.functions.invoke('crm-action', {
      body: { client_action_id: crypto.randomUUID(), action: 'contact_notes', contact_id: contactId },
    })
    const problem = error?.message || (data?.status !== 'ok' ? data?.error || 'Could not read the CRM' : null)
    setState((s) => ({ ...s, refreshing: false, refreshError: problem }))
    if (!problem) await load()
  }, [contactId, load])

  useEffect(() => {
    load()
  }, [load])
  useEffect(() => {
    refresh()
    // Once per card: refresh is stable per contact.
  }, [refresh])

  return { ...state, reload: load, showMore: () => setLimit((n) => n + 20) }
}

// The last few mirrored notes, for the Workbench's quick look at a lead. No
// CRM refresh: that runs when the full contact card opens.
export function useRecentNotes(contactId, firstNote = null, count = 3) {
  const [state, setState] = useState({ notes: [], loading: true })
  useEffect(() => {
    if (!contactId || isDemoMode) return setState({ notes: [], loading: false })
    let live = true
    supabase
      .from('activities')
      .select('id, occurred_at, notes, raw')
      .eq('contact_id', contactId)
      .eq('type', 'note')
      .order('occurred_at', { ascending: false })
      .limit(count + 1)
      .then(({ data }) => live && setState({ notes: noteRows(data || [], firstNote).slice(0, count), loading: false }))
    return () => {
      live = false
    }
  }, [contactId, firstNote, count])
  return state
}
