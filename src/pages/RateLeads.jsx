// One-time rating pass (spec 2026-11-03, section 1): active leads with at
// least one outbound call and no temperature yet. H / W / C rate and move on,
// S skips, Enter takes the suggestion, or skips when there is none. The
// suggestion is Hot when the lead's is_hot flag is set (Engagement tier hot,
// or a FUB Hot tag) and nothing otherwise.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import { showToast } from '../components/Toaster'
import { isDemoMode } from '../lib/supabase'
import { usePriorityQueue } from '../lib/usePriorityQueue'
import { useLeadRatings, useLeadRatingsStatus, saveRating } from '../lib/useLeadRatings'
import { TEMPERATURES, TEMP_LABEL } from '../lib/leadRatings'
import { friendlyError } from '../lib/friendlyError'

const KEYS = { h: 'hot', w: 'warm', c: 'cold' }

// Keystrokes aimed at a field belong to the field; ones inside a dialog (a
// Person sheet opened over this page) belong to the dialog.
const ignoredTarget = (t) =>
  !!t && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable || !!t.closest?.('[role="dialog"]'))

export default function RateLeads() {
  const { signals, loading: queueLoading, error } = usePriorityQueue('all')
  const ratings = useLeadRatings()
  const { loading: ratingsLoading, error: ratingsError } = useLeadRatingsStatus()
  const loading = queueLoading || ratingsLoading
  const failed = error || ratingsError
  // Fixed when it first loads, so rating a lead doesn't reshuffle the list.
  const [list, setList] = useState(null)
  const [i, setI] = useState(0)
  const [busy, setBusy] = useState(false)
  // The state flag disables the buttons; the ref stops a second keystroke that
  // lands before React re-renders.
  const busyRef = useRef(false)

  const candidates = useMemo(
    () =>
      (signals || [])
        .filter((r) => r.is_active && r.last_outbound_call_at && !r.temperature && !ratings.has(r.id))
        .sort((a, b) =>
          a.business_id === b.business_id ? String(a.name || '').localeCompare(String(b.name || '')) : a.business_id === 'bay' ? -1 : 1,
        ),
    [signals, ratings],
  )
  // Not while either source has failed: a snapshot of half the data would
  // offer leads that are already rated, or an empty list.
  useEffect(() => {
    if (list === null && !loading && !failed && !isDemoMode) setList(candidates)
  }, [list, loading, failed, candidates])

  const lead = list?.[i]
  const suggested = lead?.is_hot ? 'hot' : null

  const skip = () => {
    if (!busyRef.current) setI((n) => n + 1)
  }

  const rate = async (temperature) => {
    if (!lead || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    let res
    try {
      res = await saveRating({ contactId: lead.id, businessId: lead.business_id, temperature })
    } catch (e) {
      res = { ok: false, error: friendlyError(e) }
    }
    if (!res?.ok) showToast({ tone: 'error', text: `Temperature not saved: ${res?.error || 'unknown error'}` })
    else if (res.tagError) showToast({ tone: 'error', text: `Temperature saved; FUB tag not updated: ${res.tagError}` })
    busyRef.current = false
    setBusy(false)
    setI((n) => n + 1)
  }

  useEffect(() => {
    const onKey = (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || ignoredTarget(e.target)) return
      const k = e.key.toLowerCase()
      if (KEYS[k]) rate(KEYS[k])
      else if (k === 's') skip()
      else if (k === 'enter' && lead) {
        // Never also a click on whichever button holds focus.
        e.preventDefault()
        if (suggested) rate(suggested)
        else skip()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const errors = [error, ratingsError].filter(Boolean)

  return (
    <div>
      <PageHeader title="Rate leads" subtitle="One pass over leads you've called: H Hot, W Warm, C Cold, S skip, Enter for the suggestion." />
      {errors.map((m) => (
        <div key={m} className="mt-4 text-sm text-neg-ink">{m}</div>
      ))}
      {isDemoMode && <div className="mt-6 text-sm text-muted">Not available in demo mode.</div>}
      {!isDemoMode && !failed && (loading || list === null) && <div className="mt-6 text-sm text-muted">Loading…</div>}
      {!isDemoMode && !failed && list && !lead && (
        <div className="mt-6 rounded-card border border-line bg-panel px-6 py-10 text-center text-sm text-muted">
          All rated. <Link to="/" className="font-semibold">Back to Overview</Link>
        </div>
      )}
      {lead && (
        <div className="mt-6 max-w-md rounded-card border border-line bg-panel p-5">
          <div className="num text-caption text-muted">
            {i + 1} of {list.length}
          </div>
          <div className="mt-1 text-lead font-bold">{lead.name || '(no name)'}</div>
          <div className="text-body text-muted">
            {lead.business_id === 'bay' ? 'Bayway' : 'MPG'} · {lead.stage || '—'}
          </div>
          {suggested && <div className="mt-2 text-body font-semibold">Suggested: {TEMP_LABEL[suggested]}</div>}
          <div className="mt-4 flex gap-2">
            {TEMPERATURES.map((k) => (
              <button key={k} type="button" disabled={busy} onClick={() => rate(k)} className="min-h-[44px] flex-1 rounded-lg border border-line2 font-semibold">
                {TEMP_LABEL[k]}
              </button>
            ))}
            <button type="button" disabled={busy} onClick={skip} className="min-h-[44px] rounded-lg px-3 text-muted">
              Skip
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
