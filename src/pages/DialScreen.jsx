// Power Dialer dial screen (spec 2026-11-20, "Dial screen"). One lead at a
// time: tap Call (a tel: link, Chandler's own phone), come back, log the
// outcome, the next lead loads. Every call is a human tap; nothing dials on
// its own. Nothing here writes to Zoho or FUB: confirmed outcomes only add a
// Ready to Push row for review.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import BizBadge from '../components/BizBadge'
import { fetchDialData, startSession, endSession, logDial, logOutcome } from '../lib/dialerData'
import { applyOutcome, nextLead, outcome as outcomeOf, outcomesFor, needsPush, DEFAULT_MAX_ATTEMPTS, DEFAULT_MIN_RETRY_HOURS } from '../lib/dialerQueue'
import { formatPhone, telHref } from '../lib/phone'
import { dayKey } from '../lib/calendar'
import { targetsFor } from '../lib/reports'

const quiet = 'min-h-[48px] rounded-lg border border-line2 bg-panel px-4 text-body font-semibold text-ink2 disabled:opacity-40'

const personName = (l) => [l.first_name, l.last_name].filter(Boolean).join(' ')
const when = (iso) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

// The script is markdown-ish: "# " headings and "- " bullets; the rest is text.
function Script({ body }) {
  const lines = String(body || '').split('\n')
  return (
    <div className="flex flex-col gap-1 text-body">
      {lines.map((ln, i) => {
        if (/^#+\s/.test(ln)) return <div key={i} className="mt-1 text-ui font-semibold">{ln.replace(/^#+\s/, '')}</div>
        if (/^[-*]\s/.test(ln)) return <div key={i} className="flex gap-2"><span aria-hidden="true">•</span><span>{ln.slice(2)}</span></div>
        if (!ln.trim()) return <div key={i} className="h-1" />
        return <p key={i}>{ln.replace(/^_(.*)_$/, '$1')}</p>
      })}
    </div>
  )
}

function Stat({ label, value, target }) {
  return (
    <div className="min-w-0">
      <div className="text-micro font-semibold uppercase tracking-[.4px] text-dim">{label}</div>
      <div className="num text-ui font-semibold">
        {value}
        {target != null && <span className="font-normal text-muted"> / {target}</span>}
      </div>
    </div>
  )
}

export default function DialScreen() {
  const { listId } = useParams()
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [error, setError] = useState(null)
  const [leads, setLeads] = useState([])
  const [calls, setCalls] = useState([])
  const [sessionId, setSessionId] = useState(null)
  const [skip, setSkip] = useState(() => new Set())
  const [history, setHistory] = useState([])
  const [pinned, setPinned] = useState(null) // lead id shown by Back
  const [phase, setPhase] = useState('call') // call | outcome
  const [call, setCall] = useState(null) // { id } once the dial is logged
  const [picked, setPicked] = useState(null)
  const [notes, setNotes] = useState('')
  const [callbackAt, setCallbackAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [scriptOpen, setScriptOpen] = useState(false)
  const [stats, setStats] = useState({ dials: 0, connects: 0, confirmed: 0 })
  const dialPending = useRef(null)

  useEffect(() => {
    let live = true
    let sid = null
    ;(async () => {
      const res = await fetchDialData(listId, dayKey(Date.now()))
      if (!live) return
      if (res.error) { setLoadError(res.error.message || String(res.error)); return }
      setData(res.data)
      setLeads(res.data.leads)
      setCalls(res.data.calls)
      const s = await startSession(res.data.list.business_id, listId)
      sid = s.id
      if (live) setSessionId(s.id)
      else endSession(sid)
    })()
    return () => { live = false; endSession(sid) }
  }, [listId])

  const business = data?.list.business_id
  const script = data?.script
  const lead = useMemo(() => {
    if (pinned) return leads.find((l) => l.id === pinned) || null
    return nextLead(leads, { now: Date.now(), skip })
  }, [leads, skip, pinned])
  const leadCalls = useMemo(() => (lead ? calls.filter((c) => c.lead_id === lead.id && c.outcome) : []), [calls, lead])
  const targets = useMemo(() => (business ? targetsFor(data.targetsValue, business) : {}), [data, business])

  if (loadError) {
    return (
      <div className="flex flex-col gap-3 pt-4">
        <Link to="/dialer" className="text-body font-semibold text-muted">‹ Lists</Link>
        <div role="alert" className="rounded-lg border border-neg-line bg-neg-bg px-3 py-2 text-body text-neg-ink">{loadError}</div>
      </div>
    )
  }
  if (!data) return <div className="pt-6 text-body text-muted">Loading list…</div>

  const maxAttempts = script?.max_attempts || DEFAULT_MAX_ATTEMPTS
  const minHours = script?.min_retry_hours || DEFAULT_MIN_RETRY_HOURS
  const tone = business === 'mpg' ? 'var(--mpg)' : 'var(--bay)'

  function resetOutcome() {
    setPhase('call')
    setCall(null)
    setPicked(null)
    setNotes('')
    setCallbackAt('')
  }

  function moveOn() {
    setHistory((h) => [...h, lead.id])
    setPinned(null)
    resetOutcome()
  }

  // Runs on the tap that opens the phone's dialer; the link itself does the dialing.
  function dial() {
    setError(null)
    setPhase('outcome')
    setStats((s) => ({ ...s, dials: s.dials + 1 }))
    const p = logDial({ lead, sessionId }).then(({ call: c, error: err }) => {
      if (err) setError(`The dial wasn't saved: ${err.message}`)
      else setCall(c)
      return c
    })
    dialPending.current = p
  }

  async function save() {
    const o = outcomeOf(picked)
    if (!o) return
    if (picked === 'callback_requested' && !callbackAt) { setError('Pick a callback date and time.'); return }
    setBusy(true)
    setError(null)
    const c = call || (await dialPending.current)
    if (!c) { setBusy(false); setError("The dial wasn't saved, so the outcome can't be. Try Call again."); return }
    const update = applyOutcome(lead, picked, { now: Date.now(), maxAttempts, minHours })
    const { error: err } = await logOutcome({
      callId: c.id, lead, outcomeKey: picked, notes: notes.trim(),
      callbackAt: callbackAt ? new Date(callbackAt).toISOString() : null,
      update, pushTarget: needsPush(picked) ? (business === 'mpg' ? 'zoho' : 'fub') : null,
    })
    setBusy(false)
    if (err) { setError(`Couldn't save the outcome: ${err.message}`); return }
    setLeads((ls) => ls.map((l) => {
      if (l.id === lead.id) return { ...l, ...update }
      if (picked === 'do_not_call' && l.phone_e164 === lead.phone_e164 && ['queued', 'retry'].includes(l.status)) return { ...l, status: 'dnc' }
      return l
    }))
    setCalls((cs) => [...cs, { lead_id: lead.id, outcome: picked, notes: notes.trim() || null, dialed_at: c.dialed_at }])
    setStats((s) => ({ ...s, connects: s.connects + (o.connect ? 1 : 0), confirmed: s.confirmed + (o.status === 'confirmed' ? 1 : 0) }))
    moveOn()
  }

  function skipLead() {
    setSkip((s) => new Set(s).add(lead.id))
    moveOn()
  }

  function back() {
    const prev = history[history.length - 1]
    if (!prev) return
    setHistory((h) => h.slice(0, -1))
    setSkip((s) => { const n = new Set(s); n.delete(prev); return n })
    setPinned(prev)
    resetOutcome()
  }

  const waiting = leads.filter((l) => l.status === 'retry' && l.next_attempt_at && Date.parse(l.next_attempt_at) > Date.now())
  const nextDue = waiting.map((l) => l.next_attempt_at).sort()[0]

  return (
    <div className="flex flex-col gap-3 pt-4">
      <div className="flex items-center gap-2">
        <Link to="/dialer" className="text-body font-semibold text-muted">‹ Lists</Link>
        <span className="min-w-0 flex-1 truncate text-ui font-semibold">{data.list.name}</span>
        <BizBadge biz={business} />
        <button type="button" onClick={() => setScriptOpen(true)} className="min-h-[36px] rounded-lg border border-line2 px-3 text-body font-semibold">Script</button>
      </div>

      <div aria-label="Numbers" className="grid grid-cols-3 gap-2 rounded-card sm:grid-cols-5 border border-line bg-panel px-3 py-2">
        <Stat label="Dials" value={stats.dials} />
        <Stat label="Connects" value={stats.connects} />
        <Stat label="Confirmed" value={stats.confirmed} />
        <Stat label="Calls today" value={(data.today.calls || 0) + stats.dials} target={targets.calls} />
        <Stat label="Convos today" value={(data.today.live_conversations || 0) + stats.connects} target={targets.live_conversations} />
      </div>

      {error && <div role="alert" className="rounded-lg border border-neg-line bg-neg-bg px-3 py-2 text-body text-neg-ink">{error}</div>}

      {!lead && (
        <div className="rounded-card border border-line bg-panel px-6 py-10 text-center text-body text-muted">
          <p className="text-ui font-semibold text-[color:var(--text)]">Nothing left to dial right now.</p>
          {nextDue && <p className="mt-1">{waiting.length} {waiting.length === 1 ? 'retry is' : 'retries are'} waiting. Next one is due {when(nextDue)}.</p>}
          {history.length > 0 && <button type="button" onClick={back} className={`${quiet} mt-4`}>Back</button>}
        </div>
      )}

      {lead && (
        <article aria-label="Lead" data-lead-id={lead.id} className="flex overflow-hidden rounded-card border border-line bg-panel">
          <span aria-hidden="true" className="w-1 flex-none" style={{ background: tone }} />
          <div className="flex min-w-0 flex-1 flex-col gap-2 p-4">
            <div className="text-title font-semibold tracking-[-0.4px]">{personName(lead) || lead.company || 'No name'}</div>
            {personName(lead) && lead.company && <div className="text-ui text-ink2">{lead.company}</div>}
            <div className="num text-ui font-semibold">{formatPhone(lead.phone_e164?.replace(/^\+1/, '')) || lead.phone_e164}</div>
            <div className="flex flex-wrap gap-x-3 text-body text-muted">
              {(lead.city || lead.state) && <span>{[lead.city, lead.state].filter(Boolean).join(', ')}</span>}
              <span data-attempt>Attempt {Math.min((lead.attempt_count || 0) + 1, maxAttempts)} of {maxAttempts}</span>
            </div>
            {Object.keys(lead.extra || {}).length > 0 && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-body">
                {Object.entries(lead.extra).map(([k, v]) => (
                  <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="min-w-0 break-words">{v}</dd></div>
                ))}
              </dl>
            )}
            {leadCalls.length > 0 && (
              <ul aria-label="Past attempts" className="flex flex-col gap-1 border-t border-line pt-2 text-body">
                {leadCalls.map((c, i) => (
                  <li key={i}><span className="font-semibold">{outcomeOf(c.outcome)?.label}</span> <span className="text-muted">· {when(c.dialed_at)}</span>{c.notes && <span> · {c.notes}</span>}</li>
                ))}
              </ul>
            )}
          </div>
        </article>
      )}

      {lead && phase === 'outcome' && (
        <section aria-label="Outcome" className="flex flex-col gap-3 rounded-card border border-line bg-panel p-3">
          <div className="grid grid-cols-2 gap-2">
            {outcomesFor(business).map((o) => (
              <button key={o.key} type="button" aria-pressed={picked === o.key} onClick={() => setPicked(o.key)}
                className={`min-h-[44px] rounded-lg border px-2 text-body font-semibold ${picked === o.key ? 'text-white' : 'border-line2 text-ink2'}`}
                style={picked === o.key ? { background: tone, borderColor: tone } : undefined}>
                {o.label}
              </button>
            ))}
          </div>
          {picked === 'callback_requested' && (
            <label className="block text-body font-semibold">
              Call back at
              <input type="datetime-local" aria-label="Callback time" value={callbackAt} onChange={(e) => setCallbackAt(e.target.value)}
                className="mt-1 block min-h-[44px] w-full rounded-lg border border-line2 bg-panel px-3 font-normal" />
            </label>
          )}
          <textarea aria-label="Notes" rows={2} placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-lg border border-line2 bg-panel px-3 py-2 text-body" />
        </section>
      )}

      {lead && (
        <div className="sticky bottom-[calc(64px+env(safe-area-inset-bottom))] z-20 -mx-4 flex gap-2 border-t border-line bg-panel px-4 py-3 sm:bottom-0 sm:mx-0 sm:rounded-card sm:border">
          <button type="button" onClick={back} disabled={!history.length || busy} className={quiet}>Back</button>
          <button type="button" onClick={skipLead} disabled={busy} className={quiet}>Skip</button>
          {phase === 'call' ? (
            <a href={telHref(lead.phone_e164)} onClick={dial}
              className="flex min-h-[48px] flex-1 items-center justify-center rounded-lg text-ui font-semibold text-white" style={{ background: tone }}>
              Call
            </a>
          ) : (
            <button type="button" onClick={save} disabled={!picked || busy}
              className="min-h-[48px] flex-1 rounded-lg bg-[color:var(--text)] text-ui font-semibold text-white disabled:opacity-40">
              {busy ? 'Saving…' : 'Save and next'}
            </button>
          )}
        </div>
      )}

      {scriptOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center" onClick={(e) => { if (e.target === e.currentTarget) setScriptOpen(false) }}>
          <div role="dialog" aria-modal="true" aria-label="Call script" className="max-h-[80vh] w-full max-w-[560px] overflow-y-auto rounded-t-card border border-line bg-panel p-4 pb-[calc(16px+env(safe-area-inset-bottom))] sm:rounded-card">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-ui font-semibold">Call script</span>
              <button type="button" onClick={() => setScriptOpen(false)} className="min-h-[36px] px-2 text-body font-semibold text-muted">Close</button>
            </div>
            {script?.body ? <Script body={script.body} /> : <p className="text-body text-muted">No script yet. Scripts are edited in Power Dialer settings.</p>}
          </div>
        </div>
      )}
    </div>
  )
}
