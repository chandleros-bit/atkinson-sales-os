// One lead at a time (spec: The dialer). Calls go out on Chandler's phone or
// in the CRM; this logs the outcome through crm-action and offers the text
// for the step. items: [...dueNow, ...laterToday] at the moment dialing began.
import { useState } from 'react'
import QuickActions, { Sheet, quickActionTone } from './QuickActions'
import BizBadge from './BizBadge'
import { Pips } from './DialList'
import { invokeCrmAction } from '../lib/writeback'
import { buildActionRequest, summarizeResult, callStageAdvance, CRM_LABEL } from '../lib/crmActions'
import { formatPhone, telHref } from '../lib/phone'
import { textFor, smsHref } from '../lib/dialTexts'

const quiet = 'min-h-[40px] rounded-[10px] border border-line2 px-3 text-[13px] font-semibold text-[#344054]'

export default function Dialer({ items, start = 0, onClose, skipToday }) {
  const [queue, setQueue] = useState(() => items.slice(start).concat(items.slice(0, start)))
  const [pos, setPos] = useState(0)
  const [phase, setPhase] = useState('call') // call | after | bad | log
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [stats, setStats] = useState({ calls: 0, connected: 0, texts: 0 })
  const it = queue[pos]
  const t = quickActionTone(it?.book || 'bay')

  const next = () => {
    setPhase('call')
    setError(null)
    setPos((p) => p + 1)
  }

  const send = async (request, after) => {
    setBusy(true)
    setError(null)
    const res = await invokeCrmAction(request)
    const summary = summarizeResult(res, it.book)
    setBusy(false)
    if (summary.tone === 'error') {
      setError({ text: summary.text, retry: () => send(request, after) })
      return
    }
    after()
  }

  const logOutcome = (outcome) =>
    send(
      buildActionRequest({ action: 'log_call', contactId: it.id, outcome, durationMin: 1, nextStep: 'scheduled', setStage: callStageAdvance(it.book, it.row.stage) }),
      () => {
        setStats((s) => ({ ...s, calls: s.calls + 1 }))
        setPhase(outcome === 'Bad Number' ? 'bad' : 'after')
      },
    )

  const move = (target, reason) => send(buildActionRequest({ action: 'set_stage', contactId: it.id, target, reason }), next)

  if (!it) {
    return (
      <Sheet title="Done for now" subtitle="Lead cadence" t={t} onClose={onClose}>
        <div className="text-[14px]">{stats.calls} calls · {stats.connected} connected · {stats.texts} texts</div>
        <button type="button" onClick={onClose} className={`${quiet} mt-4 w-full`}>Close</button>
      </Sheet>
    )
  }

  const r = it.row
  const text = textFor(it.book, it.textKey, r.name)
  const parkPrompt = it.book === 'bay' && (it.kind === 'move_nurture' || (it.kind === 'attempt' && it.step === 6))

  return (
    <Sheet title={r.name || '(no name)'} subtitle={`${pos + 1} of ${queue.length} · ${it.label}`} t={t} onClose={onClose}>
      <div className="flex items-center gap-2 text-[13px] text-muted">
        <BizBadge biz={it.book} /> <span>{r.stage}</span> {r.lead_source && <span>· {r.lead_source}</span>}
      </div>
      <div className="mt-2 flex items-center gap-2 text-[12.5px] text-muted">
        <Pips item={it} /> <span>{[it.label, it.hint].filter(Boolean).join(' · ')}</span>
      </div>
      <div className="num mt-3 text-[24px] font-bold">{formatPhone(r.phone) || 'No phone'}</div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {telHref(r.phone) && <a href={telHref(r.phone)} className={`${quiet} grid place-items-center`}>Call on phone</a>}
        {r.crm_profile_url && <a href={r.crm_profile_url} target="_blank" rel="noreferrer" className={`${quiet} grid place-items-center`}>Open {CRM_LABEL[it.book]}</a>}
      </div>

      {error && (
        <div role="alert" className="mt-3 rounded-[10px] border px-3 py-2 text-[12.5px]" style={{ borderColor: '#f2b8b4', background: 'var(--neg-bg)', color: 'var(--neg-ink)' }}>
          {error.text}
          <button type="button" onClick={error.retry} className="ml-2 font-semibold underline">Retry</button>
        </div>
      )}

      {phase === 'call' && (
        <>
          {it.kind === 'move_nurture' && (
            <button type="button" disabled={busy} onClick={() => move('nurture')} className="mt-4 min-h-[42px] w-full rounded-[10px] text-[13.5px] font-bold text-white" style={{ background: t.accent }}>Move to Nurture</button>
          )}
          <div className="mt-4 text-[12px] font-semibold text-dim">How did it go?</div>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            <button type="button" disabled={busy} className={quiet} onClick={() => logOutcome('No Answer')}>No answer</button>
            <button type="button" disabled={busy} className={quiet} onClick={() => logOutcome('Left Message')}>Left voicemail</button>
            <button type="button" disabled={busy} className={quiet} onClick={() => setPhase('log')} style={{ color: 'var(--pos-ink)' }}>Connected</button>
            <button type="button" disabled={busy} className={quiet} onClick={() => logOutcome('Bad Number')}>Bad number</button>
          </div>
        </>
      )}

      {phase === 'log' && (
        <QuickActions
          businessId={it.book}
          contactId={it.id}
          contactName={r.name}
          hasPhone={!!r.phone}
          stage={it.book === 'bay' ? r.stage : null}
          only={[]}
          autoOpen="call"
          onDone={() => setStats((s) => ({ ...s, calls: s.calls + 1, connected: s.connected + 1 }))}
          onSheetClose={next}
        />
      )}

      {phase === 'after' && (
        <div className="mt-4 flex flex-col gap-2">
          {parkPrompt && <button type="button" disabled={busy} onClick={() => move('nurture')} className="min-h-[42px] rounded-[10px] text-[13.5px] font-bold text-white" style={{ background: t.accent }}>Move to Nurture</button>}
          {text && smsHref(r.phone, text) && (
            <>
              <div className="rounded-[10px] bg-panel2 px-3 py-2 text-[12.5px]">{text}</div>
              <div className="grid grid-cols-2 gap-2">
                <a href={smsHref(r.phone, text)} className={`${quiet} grid place-items-center`}>Text</a>
                <button type="button" disabled={busy} className={quiet} onClick={() => send(buildActionRequest({ action: 'add_note', contactId: it.id, body: `Texted: ${text}` }), () => setStats((s) => ({ ...s, texts: s.texts + 1 })))}>Log text</button>
              </div>
            </>
          )}
        </div>
      )}

      {phase === 'bad' && it.book === 'bay' && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" disabled={busy} className={quiet} onClick={() => move('nurture')}>Move to Nurture</button>
          <button type="button" disabled={busy} className={quiet} onClick={() => move('lost', 'Unreachable')}>Mark Lost</button>
        </div>
      )}

      {phase !== 'log' && (
        <div className="mt-4 flex gap-2 border-t border-line pt-3">
          <button type="button" className={quiet} onClick={() => { setQueue((q) => [...q.slice(0, pos), ...q.slice(pos + 1), it]); setPhase('call'); setError(null) }}>Skip</button>
          <button type="button" className={quiet} onClick={async () => { await skipToday(it.id); next() }}>Not today</button>
          <button type="button" className={`${quiet} ml-auto`} onClick={next}>Next</button>
        </div>
      )}
    </Sheet>
  )
}
