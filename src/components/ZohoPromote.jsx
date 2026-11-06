// Runs a promote_prospect for one walk-in touch and shows its progress. When
// the business matches more than one Zoho lead it lets you pick which to link,
// or create a new one. Used by LogVisitDialog and the Daily tracker.
import { useEffect, useRef, useState } from 'react'
import { buildActionRequest } from '../lib/crmActions'
import { invokeCrmAction } from '../lib/writeback'
import { zohoVisitNote } from '../lib/mpgTracker'
import { notifyTouchesChanged } from '../lib/mpgTouches'
import { showToast } from './Toaster'

export default function ZohoPromote({ prospectId, touch, onDone }) {
  const [phase, setPhase] = useState('running') // 'running' | 'choose'
  const [candidates, setCandidates] = useState([])
  const started = useRef(false)

  async function run(extra = {}) {
    setPhase('running')
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
      showToast({ tone: 'error', text: `Not in Zoho yet: ${e.message}` })
      onDone({ ok: false })
      return
    }
    const res = await invokeCrmAction(request)
    const first = res?.results?.[0]

    if (res?.status === 'ok') {
      notifyTouchesChanged()
      showToast({ tone: 'ok', text: first?.linked ? `Linked to ${touch.business_name} in Zoho` : 'Added to Zoho as Open' })
      onDone({ ok: true, contactId: first?.contact_id })
    } else if (res?.status === 'partial') {
      const bad = (res.results || []).find((r) => r.ok === false)
      showToast({ tone: 'partial', text: `In Zoho; the note or task didn't save: ${bad?.error || 'unknown error'}` })
      notifyTouchesChanged()
      onDone({ ok: true })
    } else if (res?.status === 'choose') {
      setCandidates(res.candidates || [])
      setPhase('choose')
    } else if (res?.status === 'busy') {
      showToast({ tone: 'partial', text: 'Already being added to Zoho — check again in a minute' })
      notifyTouchesChanged()
      onDone({ ok: false })
    } else if (res?.status === 'refused' && res.error === 'Already in Zoho') {
      showToast({ tone: 'ok', text: 'Already in Zoho' })
      notifyTouchesChanged()
      onDone({ ok: true })
    } else {
      showToast({ tone: 'error', text: `Not in Zoho yet: ${res?.error || 'Something went wrong'}`, retry: () => run(extra) })
      onDone({ ok: false })
    }
  }

  useEffect(() => {
    if (started.current) return
    started.current = true
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (phase === 'running') {
    return <div className="py-2 text-[13px] text-muted">Adding to Zoho…</div>
  }
  return (
    <div className="flex flex-col gap-2 py-2">
      <div className="text-[13px] font-semibold">This business may already be in Zoho</div>
      {candidates.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => run({ linkLeadId: c.id })}
          className="flex min-h-[40px] w-full items-center rounded-[10px] border border-line2 px-3 text-left text-[13px] hover:bg-hoverbg"
        >
          <span className="truncate">{[c.company, c.name, c.phone, c.status].filter(Boolean).join(' · ')}</span>
        </button>
      ))}
      <button type="button" onClick={() => run({ createNew: true })} className="min-h-[40px] w-full rounded-[10px] border border-line2 px-3 text-left text-[13px] font-semibold hover:bg-hoverbg">
        Create a new lead
      </button>
      <button type="button" onClick={() => onDone({ ok: false })} className="min-h-[40px] w-full rounded-[10px] px-3 text-left text-[13px] text-muted hover:bg-hoverbg">
        Not now
      </button>
    </div>
  )
}
