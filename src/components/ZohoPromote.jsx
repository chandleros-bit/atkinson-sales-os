// Runs a promote_prospect for one walk-in touch and shows its progress. When
// the business matches more than one Zoho lead it lets you pick which to link,
// or create a new one. Used by LogVisitDialog and the Daily tracker.
import { useEffect, useRef, useState } from 'react'
import { buildActionRequest } from '../lib/crmActions'
import { invokeCrmAction } from '../lib/writeback'
import { zohoVisitNote } from '../lib/mpgTracker'
import { notifyTouchesChanged } from '../lib/mpgTouches'
import { showToast } from './Toaster'

const BTN = 'min-h-[40px] w-full rounded-[10px] border border-line2 px-3 text-left text-[13px] hover:bg-hoverbg'

export default function ZohoPromote({ prospectId, touch, onDone }) {
  // 'running' | 'choose' | 'failed' | 'done'
  const [phase, setPhase] = useState('running')
  const [candidates, setCandidates] = useState([])
  const [message, setMessage] = useState('')
  const started = useRef(false)
  const inFlight = useRef(false)
  const doneCalled = useRef(false)
  const mounted = useRef(true)
  const lastExtra = useRef({})
  const firstCandidate = useRef(null)

  function finish(result) {
    if (doneCalled.current) return
    doneCalled.current = true
    // The user may have closed the step already; a late onDone would close
    // whatever dialog is open now. Toasts still show.
    if (!mounted.current) return
    onDone(result)
  }

  async function run(extra = {}) {
    if (inFlight.current) return
    inFlight.current = true
    lastExtra.current = extra
    setMessage('')
    setPhase('running')
    try {
      let request
      try {
        request = buildActionRequest({
          action: 'promote_prospect',
          prospectId,
          touchId: touch.id,
          note: zohoVisitNote(touch),
          followUp: touch.follow_up_on ? { dueDate: touch.follow_up_on, title: touch.next_step || 'Follow up' } : null,
          ...extra,
        })
      } catch (e) {
        fail(`Not in Zoho yet: ${e.message}`, extra)
        return
      }
      const res = await invokeCrmAction(request)
      const first = res?.results?.[0]

      if (res?.status === 'ok') {
        notifyTouchesChanged()
        showToast({ tone: 'ok', text: first?.linked ? `Linked to ${touch.business_name} in Zoho` : 'Added to Zoho as Open' })
        finish({ ok: true, contactId: first?.contact_id })
      } else if (res?.status === 'partial') {
        const bad = (res.results || []).find((r) => r.ok === false)
        showToast({ tone: 'partial', text: `In Zoho; the note or task didn't save: ${bad?.error || 'unknown error'}` })
        notifyTouchesChanged()
        finish({ ok: true })
      } else if (res?.status === 'choose') {
        if (!mounted.current) return
        setCandidates(res.candidates || [])
        setPhase('choose')
      } else if (res?.status === 'busy') {
        const text = 'Already being added to Zoho — check again in a minute'
        showToast({ tone: 'partial', text })
        notifyTouchesChanged()
        if (!mounted.current) return
        setMessage(text)
        setPhase('done')
      } else if (res?.status === 'refused' && res.error === 'Already in Zoho') {
        showToast({ tone: 'ok', text: 'Already in Zoho' })
        notifyTouchesChanged()
        finish({ ok: true })
      } else {
        fail(`Not in Zoho yet: ${res?.error || 'Something went wrong'}`, extra)
      }
    } finally {
      inFlight.current = false
    }
  }

  // After a pick (or Create a new lead) an error returns to the list so the
  // user can pick again; otherwise it stays on a Try again screen.
  function fail(text, extra) {
    showToast({ tone: 'error', text })
    if (!mounted.current) return
    setMessage(text)
    setPhase((extra.linkLeadId || extra.createNew) ? 'choose' : 'failed')
  }

  useEffect(() => {
    mounted.current = true
    if (!started.current) {
      started.current = true
      run()
    }
    return () => { mounted.current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (phase === 'choose') firstCandidate.current?.focus()
  }, [phase])

  if (phase === 'running') {
    return <div role="status" className="py-2 text-[13px] text-muted">Adding to Zoho…</div>
  }
  if (phase === 'failed' || phase === 'done') {
    return (
      <div className="flex flex-col gap-2 py-2">
        <div role="alert" className="text-[13px] font-semibold">{message}</div>
        {phase === 'failed' && (
          <button type="button" onClick={() => run(lastExtra.current)} className={`${BTN} font-semibold`}>Try again</button>
        )}
        <button type="button" onClick={() => finish({ ok: false })} className="min-h-[40px] w-full rounded-[10px] px-3 text-left text-[13px] text-muted hover:bg-hoverbg">Close</button>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2 py-2">
      <div className="text-[13px] font-semibold">This business may already be in Zoho</div>
      {message && <div role="alert" className="text-[13px] text-[color:var(--neg-ink)]">{message}</div>}
      <div role="group" aria-label="Possible Zoho matches" className="flex flex-col gap-2">
        {candidates.map((c, i) => (
          <button
            key={c.id}
            ref={i === 0 ? firstCandidate : undefined}
            type="button"
            onClick={() => run({ linkLeadId: c.id })}
            className={`${BTN} flex flex-col items-start justify-center py-1`}
          >
            <span className="block w-full truncate">{[c.company, c.name].filter(Boolean).join(' · ')}</span>
            <span className="block w-full truncate text-[12px] text-muted">{[c.phone, c.status].filter(Boolean).join(' · ')}</span>
          </button>
        ))}
      </div>
      <button type="button" onClick={() => run({ createNew: true })} className={`${BTN} font-semibold`}>Create a new lead</button>
      <button type="button" onClick={() => finish({ ok: false })} className="min-h-[40px] w-full rounded-[10px] px-3 text-left text-[13px] text-muted hover:bg-hoverbg">Not now</button>
    </div>
  )
}
