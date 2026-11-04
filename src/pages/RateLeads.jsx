// One-time rating pass (spec 2026-11-03, section 1): active leads with at
// least one outbound call and no temperature yet. H / W / C rate and move on,
// S skips, Enter takes the suggestion (Hot when the lead already reads as hot).
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import { showToast } from '../components/Toaster'
import { usePriorityQueue } from '../lib/usePriorityQueue'
import { useLeadRatings, useLeadRatingsStatus, saveRating } from '../lib/useLeadRatings'
import { TEMPERATURES, TEMP_LABEL } from '../lib/leadRatings'

const KEYS = { h: 'hot', w: 'warm', c: 'cold' }

// Keystrokes aimed at a field belong to the field.
const typingTarget = (t) => !!t && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable)

export default function RateLeads() {
  const { signals, loading: queueLoading, error } = usePriorityQueue('all')
  const ratings = useLeadRatings()
  const { loading: ratingsLoading } = useLeadRatingsStatus()
  const loading = queueLoading || ratingsLoading
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
  useEffect(() => {
    if (list === null && !loading) setList(candidates)
  }, [list, loading, candidates])

  const lead = list?.[i]
  const suggested = lead?.is_hot ? 'hot' : null

  const rate = async (temperature) => {
    if (!lead || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    let res
    try {
      res = await saveRating({ contactId: lead.id, businessId: lead.business_id, temperature })
    } catch (e) {
      res = { ok: false, error: String(e?.message || e) }
    }
    const who = lead.name || 'this lead'
    if (!res?.ok) showToast({ tone: 'error', text: `Could not save the rating for ${who}: ${res?.error || 'unknown error'}` })
    else if (res.tagError) showToast({ tone: 'partial', text: `Rated ${who}, but the FUB tag did not update: ${res.tagError}` })
    busyRef.current = false
    setBusy(false)
    setI((n) => n + 1)
  }

  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typingTarget(e.target)) return
      const k = e.key.toLowerCase()
      if (KEYS[k]) rate(KEYS[k])
      else if (k === 's') {
        if (!busyRef.current) setI((n) => n + 1)
      } else if (k === 'enter' && suggested) {
        // Not also a click on whichever button holds focus.
        e.preventDefault()
        rate(suggested)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div>
      <PageHeader title="Rate leads" subtitle="One pass over leads you've called: H Hot, W Warm, C Cold, S skip, Enter for the suggestion." />
      {error && <div className="mt-4 text-sm text-red-700">{error}</div>}
      {(loading || list === null) && <div className="mt-6 text-sm text-muted">Loading…</div>}
      {list && !lead && (
        <div className="mt-6 rounded-card border border-line bg-panel px-6 py-10 text-center text-sm text-muted">
          All rated. <Link to="/" className="font-semibold">Back to Overview</Link>
        </div>
      )}
      {lead && (
        <div className="mt-6 max-w-md rounded-card border border-line bg-panel p-5">
          <div className="num text-[12px] text-muted">
            {i + 1} of {list.length}
          </div>
          <div className="mt-1 text-[18px] font-bold">{lead.name || '(no name)'}</div>
          <div className="text-[13px] text-muted">
            {lead.business_id === 'bay' ? 'Bayway' : 'MPG'} · {lead.stage || '—'}
          </div>
          {suggested && <div className="mt-2 text-[12.5px] font-semibold">Suggested: {TEMP_LABEL[suggested]}</div>}
          <div className="mt-4 flex gap-2">
            {TEMPERATURES.map((k) => (
              <button key={k} type="button" disabled={busy} onClick={() => rate(k)} className="min-h-[44px] flex-1 rounded-[10px] border border-line2 font-semibold">
                {TEMP_LABEL[k]}
              </button>
            ))}
            <button type="button" disabled={busy} onClick={() => setI((n) => n + 1)} className="min-h-[44px] rounded-[10px] px-3 text-muted">
              Skip
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
