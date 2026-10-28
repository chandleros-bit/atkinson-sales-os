// Quick Actions: log a call, add a note, schedule a follow-up, and (on task
// rows) complete or push a task, written to FollowUpBoss (Bayway) or Zoho
// (MPG) through the crm-action edge function.
//
// Page-agnostic on purpose: it fetches nothing about the row beyond the Log
// call form's open-task lookup, so Pipeline, Priority Leads, the task lists,
// the sidebar and later surfaces can all drop it in. Colors follow the row's
// own business, never the current filter.
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useWritebackFlags, invokeCrmAction } from '../lib/writeback'
import { showToast } from './Toaster'
import { STAGE_TARGETS } from '../../supabase/functions/_shared/bay-stages.ts'
import { dueLabel } from '../lib/tasks'
import {
  OUTCOMES,
  FOLLOW_UP_PRESETS,
  CRM_LABEL,
  followUpDate,
  defaultNextStep,
  NO_NEXT_STEP_REASONS,
  PARK_REASON,
  LOST_REASONS,
  LOST_WARNING,
  needsNextStepPrompt,
  callStageAdvance,
  defaultDurationMin,
  defaultFollowUpTitle,
  endOfTodayIso,
  buildActionRequest,
  retryRequestFor,
  summarizeResult,
} from '../lib/crmActions'

const FUB_TASK_TYPES = ['Follow Up', 'Call', 'Text', 'Email', 'Appointment', 'Showing', 'Closing', 'Open House', 'Thank You']

const tone = (biz) =>
  biz === 'mpg'
    ? { accent: 'var(--mpg)', ink: 'var(--mpg-ink)', soft: 'var(--mpg-soft)', line: 'var(--mpg-line)' }
    : { accent: 'var(--bay)', ink: 'var(--bay-ink)', soft: 'var(--bay-soft)', line: 'var(--bay-line)' }

const Icon = {
  call: (
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
  ),
  note: <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5" />,
  followup: <path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM12 14v4M10 16h4" />,
  done: <path d="M20 6L9 17l-5-5" />,
  push: <path d="M5 12h14M13 6l6 6-6 6" />,
  stage: <path d="M4 6h16M4 12h11M4 18h6M18 15l3 3-3 3" />,
}

function Svg({ name, size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {Icon[name]}
    </svg>
  )
}

// small: the Workbench's stacked 2×2 grid (outlined, about half the size).
function IconButton({ name, label, onClick, disabled, title, t, small }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title || label}
      disabled={disabled}
      onClick={onClick}
      className={`grid flex-none place-items-center text-muted transition-colors hover:bg-hoverbg disabled:cursor-not-allowed disabled:opacity-40 ${
        small ? 'h-[22px] w-[26px] rounded-md border border-line bg-panel' : 'h-10 w-10 rounded-[10px]'
      }`}
      onMouseEnter={(e) => !disabled && (e.currentTarget.style.color = t.ink)}
      onMouseLeave={(e) => (e.currentTarget.style.color = '')}
    >
      <Svg name={name} size={small ? 13 : 16} />
    </button>
  )
}

// Desktop: a small centered panel. Under 640px: a bottom sheet.
export function Sheet({ title, subtitle, t, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={title}
        className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl border border-line bg-panel p-5 sm:max-w-md sm:rounded-card"
        style={{ borderTop: `3px solid ${t.accent}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[15px] font-bold">{title}</div>
            {subtitle && <div className="truncate text-[12px] text-muted">{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-10 w-10 place-items-center rounded-[10px] text-muted hover:bg-hoverbg">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Chip({ active, onClick, children, t }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className="min-h-[40px] rounded-[10px] border px-3 text-[12.5px] font-semibold"
      style={
        active
          ? { borderColor: t.accent, background: t.soft, color: t.ink }
          : { borderColor: 'var(--line2)', color: 'var(--muted)' }
      }
    >
      {children}
    </button>
  )
}

const inputCls = 'w-full rounded-[10px] border border-line2 bg-panel px-3 py-2 text-[13px] text-[color:var(--text)]'

// Inline outcome of a submit: partial / error text with per-step Retry.
function ResultBox({ result, onRetry, busy }) {
  if (!result || result.tone === 'ok') return null
  const isPartial = result.tone === 'partial'
  return (
    <div
      role="alert"
      className="mt-3 rounded-[10px] border px-3 py-2 text-[12.5px]"
      style={{
        borderColor: isPartial ? '#e7c27a' : '#f2b8b4',
        background: isPartial ? '#fdf6e7' : 'var(--neg-bg)',
        color: isPartial ? '#8a5a0b' : 'var(--neg-ink)',
      }}
    >
      <div>{result.text}</div>
      {onRetry && (
        <div className="mt-2 flex flex-wrap gap-2">
          {(result.failed.length ? result.failed : [null]).map((step) => (
            <button
              key={step || 'all'}
              type="button"
              disabled={busy}
              onClick={() => onRetry(step)}
              className="min-h-[36px] rounded-md border border-current px-2.5 font-semibold disabled:opacity-50"
            >
              {step === 'create_task' ? 'Retry follow-up' : step === 'complete_task' ? 'Retry completing task' : 'Retry'}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function SubmitButton({ busy, disabled, children, t, onClick }) {
  return (
    <button
      type="button"
      disabled={busy || disabled}
      onClick={onClick}
      className="mt-4 flex min-h-[42px] w-full items-center justify-center gap-2 rounded-[10px] text-[13.5px] font-bold text-white disabled:opacity-50"
      style={{ background: t.accent }}
    >
      {busy && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />}
      {busy ? 'Saving…' : children}
    </button>
  )
}

function DatePresets({ preset, setPreset, picked, setPicked, t }) {
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {FOLLOW_UP_PRESETS.map((p) => (
          <Chip key={p.key} t={t} active={preset === p.key} onClick={() => setPreset(p.key)}>
            {p.label}
          </Chip>
        ))}
      </div>
      {preset === 'pick' && (
        <input
          type="date"
          aria-label="Follow-up date"
          value={picked}
          onChange={(e) => setPicked(e.target.value)}
          className={`${inputCls} mt-2`}
        />
      )}
    </>
  )
}

const safeDate = (preset, picked) => {
  try {
    return followUpDate(preset, new Date(), picked)
  } catch {
    return null
  }
}

// One submit pipeline for every form: double-submit guard, invoke, summarize,
// and Retry that re-sends only the failed step with a new client_action_id.
function useSubmit({ businessId, onSuccess }) {
  const busyRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const lastRequest = useRef(null)

  const send = async (request) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setResult(null)
    lastRequest.current = request
    const res = await invokeCrmAction(request)
    const summary = summarizeResult(res, businessId)
    busyRef.current = false
    setBusy(false)
    if (summary.tone === 'ok') onSuccess(summary)
    else {
      setResult(summary)
      // Something reached the CRM: let the page refresh behind the sheet.
      if (summary.tone === 'partial') onSuccess(summary, { keepOpen: true })
    }
  }
  const retry = (step) => {
    if (!lastRequest.current) return
    send(step ? retryRequestFor(step, lastRequest.current) : { ...lastRequest.current, client_action_id: crypto.randomUUID() })
  }
  return { busy, result, send, retry, setResult }
}

function LogCallForm({ businessId, contactId, contactName, stage, t, onSuccess }) {
  const [outcome, setOutcome] = useState(null)
  const [note, setNote] = useState('')
  const [duration, setDuration] = useState('')
  const [durationTouched, setDurationTouched] = useState(false)
  // Required: 'follow_up' | 'scheduled' (a future task exists) | 'none' (+ reason).
  const [nextStep, setNextStep] = useState(null)
  const [nextTouched, setNextTouched] = useState(false)
  const [reason, setReason] = useState(null)
  const [futureTask, setFutureTask] = useState(null)
  const [preset, setPreset] = useState('tomorrow')
  const [picked, setPicked] = useState('')
  const [title, setTitle] = useState(defaultFollowUpTitle(contactName))
  const [openTask, setOpenTask] = useState(null)
  const [completeOpen, setCompleteOpen] = useState(true)
  const { busy, result, send, retry, setResult } = useSubmit({ businessId, onSuccess })

  // Oldest open task due today or earlier for this contact. Bounded (limit 1).
  useEffect(() => {
    let alive = true
    Promise.resolve(
      supabase
        .from('v_tasks')
        .select('id, title, due_at')
        .eq('contact_id', contactId)
        .lte('due_at', endOfTodayIso())
        .order('due_at', { ascending: true })
        .limit(1),
    ).then(({ data }) => alive && setOpenTask(data?.[0] || null), () => {})
    // Soonest task due after today: "Already scheduled" counts as a next step.
    Promise.resolve(
      supabase
        .from('v_tasks')
        .select('id, title, due_at')
        .eq('contact_id', contactId)
        .gt('due_at', endOfTodayIso())
        .order('due_at', { ascending: true })
        .limit(1),
    ).then(({ data }) => alive && setFutureTask(data?.[0] || null), () => {})
    return () => {
      alive = false
    }
  }, [contactId])

  const pickOutcome = (o) => {
    setOutcome(o)
    if (!durationTouched) setDuration(String(defaultDurationMin(o)))
    if (!nextTouched) setNextStep(defaultNextStep(o, !!futureTask))
  }

  const chooseNext = (k) => {
    setNextStep(k)
    setNextTouched(true)
  }
  const reasons = businessId === 'bay' ? NO_NEXT_STEP_REASONS : NO_NEXT_STEP_REASONS.filter((r) => r !== PARK_REASON)
  const advance = callStageAdvance(businessId, stage)
  const parking = nextStep === 'none' && reason === PARK_REASON
  const nextReady =
    nextStep === 'follow_up' ? !!safeDate(preset, picked) : nextStep === 'scheduled' ? !!futureTask : nextStep === 'none' ? !!reason : false

  const submit = () => {
    try {
      send(
        buildActionRequest({
          action: 'log_call',
          contactId,
          outcome,
          note,
          durationMin: Number(duration),
          nextStep,
          followUp: nextStep === 'follow_up' ? { dueDate: followUpDate(preset, new Date(), picked), title } : null,
          noNextStepReason: nextStep === 'none' ? reason : null,
          completeTaskId: openTask && completeOpen ? openTask.id : null,
          setStage: advance,
        }),
      )
    } catch (e) {
      setResult({ tone: 'error', text: e.message, failed: [] })
    }
  }

  return (
    <>
      <div className="mb-1.5 text-[12px] font-semibold text-muted">Outcome</div>
      <div className="flex flex-wrap gap-2">
        {OUTCOMES.map((o) => (
          <Chip key={o} t={t} active={outcome === o} onClick={() => pickOutcome(o)}>
            {o}
          </Chip>
        ))}
      </div>

      <label className="mt-3 block text-[12px] font-semibold text-muted">
        Note
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className={`${inputCls} mt-1`} placeholder="Optional" />
      </label>

      <label className="mt-3 flex items-center justify-between gap-3 text-[12px] font-semibold text-muted">
        Duration (minutes){businessId === 'mpg' ? '' : ' · optional'}
        <input
          type="number"
          min="1"
          value={duration}
          onChange={(e) => {
            setDuration(e.target.value)
            setDurationTouched(true)
          }}
          className="w-20 rounded-[10px] border border-line2 bg-panel px-2 py-2 text-[13px] text-[color:var(--text)]"
        />
      </label>

      <div className="mb-1.5 mt-3 text-[12px] font-semibold text-muted">Next step</div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Next step">
        <Chip t={t} active={nextStep === 'follow_up'} onClick={() => chooseNext('follow_up')}>
          Follow-up
        </Chip>
        {futureTask && (
          <Chip t={t} active={nextStep === 'scheduled'} onClick={() => chooseNext('scheduled')}>
            Already scheduled
          </Chip>
        )}
        <Chip t={t} active={nextStep === 'none'} onClick={() => chooseNext('none')}>
          No next step
        </Chip>
      </div>
      {nextStep === 'follow_up' && (
        <div className="mt-2">
          <DatePresets preset={preset} setPreset={setPreset} picked={picked} setPicked={setPicked} t={t} />
          <input aria-label="Follow-up title" value={title} onChange={(e) => setTitle(e.target.value)} className={`${inputCls} mt-2`} />
        </div>
      )}
      {nextStep === 'scheduled' && futureTask && (
        <div className="mt-2 truncate text-[12.5px] text-muted">
          <span className="font-semibold text-[color:var(--text)]">{futureTask.title || 'Task'}</span> · {dueLabel(futureTask.due_at)}
        </div>
      )}
      {nextStep === 'none' && (
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Why no next step">
          {reasons.map((r) => (
            <Chip key={r} t={t} active={reason === r} onClick={() => setReason(r)}>
              {r}
            </Chip>
          ))}
        </div>
      )}
      {outcome && !nextReady && <div className="mt-2 text-[12px] text-muted">Pick a next step to save.</div>}

      {openTask && (
        <label className="mt-2 flex min-h-[40px] items-center gap-2 text-[13px]">
          <input type="checkbox" checked={completeOpen} onChange={(e) => setCompleteOpen(e.target.checked)} className="h-4 w-4" />
          <span className="truncate">
            Complete open task: <span className="font-semibold">{openTask.title || 'Task'}</span>
          </span>
        </label>
      )}

      {advance && !parking && (
        <div data-stage-advance className="mt-2 text-[12.5px] text-muted">
          Moves {contactName || 'the lead'} from New Lead to <span className="font-semibold text-[color:var(--text)]">Attempted</span> in FollowUpBoss.
        </div>
      )}

      <ResultBox result={result} onRetry={retry} busy={busy} />
      <SubmitButton
        t={t}
        busy={busy}
        disabled={!outcome || !nextReady || (businessId === 'mpg' && !(Number(duration) > 0))}
        onClick={submit}
      >
        Log call
      </SubmitButton>
    </>
  )
}

function NoteForm({ businessId, contactId, t, onSuccess }) {
  const [body, setBody] = useState('')
  const { busy, result, send, retry, setResult } = useSubmit({ businessId, onSuccess })
  const submit = () => {
    try {
      send(buildActionRequest({ action: 'add_note', contactId, body }))
    } catch (e) {
      setResult({ tone: 'error', text: e.message, failed: [] })
    }
  }
  return (
    <>
      <textarea aria-label="Note" value={body} onChange={(e) => setBody(e.target.value)} rows={4} className={inputCls} placeholder="What happened?" />
      <ResultBox result={result} onRetry={retry} busy={busy} />
      <SubmitButton t={t} busy={busy} disabled={!body.trim()} onClick={submit}>
        Add note
      </SubmitButton>
    </>
  )
}

export function FollowUpForm({ businessId, contactId, contactName, t, onSuccess }) {
  const [preset, setPreset] = useState('tomorrow')
  const [picked, setPicked] = useState('')
  const [title, setTitle] = useState(defaultFollowUpTitle(contactName))
  const [type, setType] = useState('Follow Up')
  const { busy, result, send, retry, setResult } = useSubmit({ businessId, onSuccess })
  const submit = () => {
    try {
      send(buildActionRequest({ action: 'create_task', contactId, dueDate: followUpDate(preset, new Date(), picked), title, type }))
    } catch (e) {
      setResult({ tone: 'error', text: e.message, failed: [] })
    }
  }
  return (
    <>
      <DatePresets preset={preset} setPreset={setPreset} picked={picked} setPicked={setPicked} t={t} />
      <input aria-label="Task title" value={title} onChange={(e) => setTitle(e.target.value)} className={`${inputCls} mt-3`} />
      {businessId === 'bay' && (
        <select aria-label="Task type" value={type} onChange={(e) => setType(e.target.value)} className={`${inputCls} mt-2`}>
          {FUB_TASK_TYPES.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      )}
      <ResultBox result={result} onRetry={retry} busy={busy} />
      <SubmitButton t={t} busy={busy} disabled={!safeDate(preset, picked)} onClick={submit}>
        Schedule follow-up
      </SubmitButton>
    </>
  )
}

function PushForm({ businessId, task, t, onSuccess, onPending, onFailed }) {
  const [preset, setPreset] = useState('tomorrow')
  const [picked, setPicked] = useState('')
  const { busy, result, send, retry, setResult } = useSubmit({
    businessId,
    onSuccess: (s, o) => onSuccess(s, o),
  })
  const submit = async () => {
    try {
      const dueDate = followUpDate(preset, new Date(), picked)
      onPending?.('push', dueDate)
      await send(buildActionRequest({ action: 'push_task', taskId: task.id, dueDate }))
    } catch (e) {
      setResult({ tone: 'error', text: e.message, failed: [] })
    }
  }
  useEffect(() => {
    if (result && result.tone !== 'ok') onFailed?.('push')
  }, [result, onFailed])
  return (
    <>
      <DatePresets preset={preset} setPreset={setPreset} picked={picked} setPicked={setPicked} t={t} />
      <ResultBox result={result} onRetry={retry} busy={busy} />
      <SubmitButton t={t} busy={busy} disabled={!safeDate(preset, picked)} onClick={submit}>
        Move task
      </SubmitButton>
    </>
  )
}

// Move a Bayway lead between board columns. Writes FUB workflow tags via
// crm-action set_stage (bay-stages.ts). Estimate Sent and Application Sent
// share a column but are separate tags (Smart Lists 04 / 05).
function StageForm({ businessId, contactId, stage, t, onSuccess }) {
  // Tell the caller which target moved, so it can offer a next step.
  const sent = useRef(null)
  const { busy, result, send, retry, setResult } = useSubmit({
    businessId,
    onSuccess: (summary, opts) => onSuccess(summary, { ...opts, target: sent.current }),
  })
  // Lost asks why first; the reason is written to FUB as a note.
  const [askLost, setAskLost] = useState(false)
  const move = (target, reason) => {
    sent.current = target
    try {
      send(buildActionRequest({ action: 'set_stage', contactId, target, reason }))
    } catch (e) {
      setResult({ tone: 'error', text: e.message, failed: [] })
    }
  }
  if (askLost) {
    return (
      <>
        <div className="text-[13px] font-semibold">Why is this lead lost?</div>
        <div className="mb-2 mt-1 text-[12px] text-muted">{LOST_WARNING}</div>
        <div className="flex flex-col gap-2">
          {LOST_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              disabled={busy}
              onClick={() => move('lost', r)}
              className="flex min-h-[44px] items-center rounded-[10px] border px-3 text-left text-[13.5px] font-semibold disabled:opacity-50"
              style={{ borderColor: 'var(--line2)' }}
            >
              {r}
            </button>
          ))}
          <button type="button" disabled={busy} onClick={() => setAskLost(false)} className="min-h-[40px] text-[12.5px] text-muted">
            Back
          </button>
        </div>
        {busy && <div className="mt-3 text-[12.5px] text-muted">Updating tags in FollowUpBoss…</div>}
        <ResultBox result={result} onRetry={retry} busy={busy} />
      </>
    )
  }
  return (
    <>
      <div className="flex flex-col gap-2">
        {STAGE_TARGETS.map((target) => {
          const current = target.stage === stage
          return (
            <button
              key={target.key}
              type="button"
              disabled={busy}
              aria-pressed={current}
              onClick={() => (target.key === 'lost' ? setAskLost(true) : move(target.key))}
              className="flex min-h-[44px] items-center justify-between rounded-[10px] border px-3 text-left text-[13.5px] font-semibold disabled:opacity-50"
              style={current ? { borderColor: t.accent, background: t.soft, color: t.ink } : { borderColor: 'var(--line2)' }}
            >
              <span>{target.label}</span>
              {current && <span className="text-[11px] font-bold uppercase tracking-wide">Now</span>}
            </button>
          )
        })}
      </div>
      {busy && <div className="mt-3 text-[12.5px] text-muted">Updating tags in FollowUpBoss…</div>}
      <ResultBox result={result} onRetry={retry} busy={busy} />
    </>
  )
}

// After a stage move leaves a lead with nothing scheduled: offer a follow-up.
// Skip is fine; the lead then shows in Up Next as "No next step".
export function NextStepPrompt({ businessId, contactId, contactName, onClose, onDone }) {
  const t = tone(businessId)
  const first = String(contactName || '').trim().split(/\s+/)[0]
  const done = (summary, { keepOpen } = {}) => {
    if (!keepOpen) {
      showToast(summary)
      onClose()
    }
    onDone?.(summary)
  }
  return (
    <Sheet title={first ? `Next step for ${first}?` : 'Next step?'} subtitle="Nothing is scheduled for this lead" t={t} onClose={onClose}>
      <FollowUpForm businessId={businessId} contactId={contactId} contactName={contactName} t={t} onSuccess={done} />
      <button
        type="button"
        onClick={onClose}
        className="mt-2 flex min-h-[42px] w-full items-center justify-center rounded-[10px] border border-line2 text-[13.5px] font-semibold text-muted"
      >
        Skip
      </button>
    </Sheet>
  )
}

/**
 * Props:
 *   businessId  'bay' | 'mpg' (the ROW's business)
 *   contactId   our contacts.id (uuid); null hides the contact actions
 *   contactName for titles and the follow-up default
 *   hasPhone    false disables Log call for Bayway (FUB requires a phone)
 *   task        { id, title } on task rows: adds Complete and Push
 *   onDone      called after a write reached the CRM, so the page reloads
 *   onPending / onFailed  (kind, dueDate?) for optimistic task-row updates
 *   stage       the Bayway board column the lead is in; adds Move stage
 *   openTaskCount  the lead's open tasks, when known; 0 makes Move stage
 *                  offer a follow-up afterwards
 *   onNeedsNextStep  show that offer yourself (a board that redraws the card
 *                  in its new column would unmount ours); else we show it
 *   autoOpen    'call' | 'note' | 'followup': open that sheet at once (quick
 *               add, usually with only={[]} so no buttons show)
 *   onSheetClose  called when that sheet closes (saved or dismissed)
 *   only        optional subset of ['call','note','followup','stage','done','push']
 *   size        'sm': small outlined buttons stacked two to a row (Workbench)
 *               'xs': the same small buttons in one wrapping row (Pipeline board)
 */
export default function QuickActions({ businessId, contactId, contactName, hasPhone = true, task, stage, openTaskCount, onNeedsNextStep, onDone, onPending, onFailed, only, autoOpen = null, onSheetClose, size, className = '' }) {
  const flags = useWritebackFlags()
  const [open, setOpen] = useState(autoOpen)
  // Tell a quick-add caller when its sheet has closed.
  const opened = useRef(!!autoOpen)
  useEffect(() => {
    if (open) opened.current = true
    else if (opened.current) {
      opened.current = false
      onSheetClose?.()
    }
  }, [open, onSheetClose])
  const completing = useRef(false)
  const t = tone(businessId)
  const crm = CRM_LABEL[businessId]

  if (!flags[businessId]) return null

  const success = (summary, { keepOpen } = {}) => {
    if (!keepOpen) {
      setOpen(null)
      showToast(summary)
    }
    onDone?.(summary)
  }

  const stageSuccess = (summary, opts = {}) => {
    if (!opts.keepOpen && needsNextStepPrompt(opts.target, openTaskCount)) {
      showToast(summary)
      if (onNeedsNextStep) {
        setOpen(null)
        onNeedsNextStep()
      } else setOpen('nextstep')
      onDone?.(summary)
      return
    }
    success(summary, opts)
  }

  const complete = async () => {
    if (completing.current) return
    completing.current = true
    onPending?.('complete')
    const res = await invokeCrmAction(buildActionRequest({ action: 'complete_task', taskId: task.id }))
    completing.current = false
    const summary = summarizeResult(res, businessId)
    if (summary.tone === 'ok') {
      showToast(summary)
      onDone?.(summary)
    } else {
      onFailed?.('complete')
      showToast({ ...summary, retry: complete })
    }
  }

  const callDisabled = businessId === 'bay' && !hasPhone
  const show = (name) => !only || only.includes(name)
  const stop = (e) => e.stopPropagation()
  const subtitle = [contactName, crm].filter(Boolean).join(' · ')
  const small = size === 'sm' || size === 'xs'

  return (
    <div className={`${size === 'sm' ? 'grid grid-cols-2 gap-[3px]' : size === 'xs' ? 'flex flex-wrap items-center gap-[3px]' : 'flex items-center gap-0.5'} ${className}`} onClick={stop}>
      {contactId && show('call') && (
        <IconButton
          t={t}
          small={small}
          name="call"
          label="Log call"
          title={callDisabled ? 'No phone on file in FUB' : 'Log call'}
          disabled={callDisabled}
          onClick={() => setOpen('call')}
        />
      )}
      {contactId && show('note') && <IconButton t={t} small={small} name="note" label="Add note" onClick={() => setOpen('note')} />}
      {contactId && show('followup') && (
        <IconButton t={t} small={small} name="followup" label="Schedule follow-up" onClick={() => setOpen('followup')} />
      )}
      {contactId && businessId === 'bay' && stage && show('stage') && (
        <IconButton t={t} small={small} name="stage" label="Move stage" onClick={() => setOpen('stage')} />
      )}
      {task && show('done') && <IconButton t={t} small={small} name="done" label="Complete task" onClick={complete} />}
      {task && show('push') && <IconButton t={t} small={small} name="push" label="Push task" onClick={() => setOpen('push')} />}

      {open === 'call' && (
        <Sheet title="Log call" subtitle={subtitle} t={t} onClose={() => setOpen(null)}>
          <LogCallForm businessId={businessId} contactId={contactId} contactName={contactName} stage={stage} t={t} onSuccess={success} />
        </Sheet>
      )}
      {open === 'note' && (
        <Sheet title="Add note" subtitle={subtitle} t={t} onClose={() => setOpen(null)}>
          <NoteForm businessId={businessId} contactId={contactId} t={t} onSuccess={success} />
        </Sheet>
      )}
      {open === 'followup' && (
        <Sheet title="Schedule follow-up" subtitle={subtitle} t={t} onClose={() => setOpen(null)}>
          <FollowUpForm businessId={businessId} contactId={contactId} contactName={contactName} t={t} onSuccess={success} />
        </Sheet>
      )}
      {open === 'stage' && (
        <Sheet title="Move stage" subtitle={subtitle} t={t} onClose={() => setOpen(null)}>
          <StageForm businessId={businessId} contactId={contactId} stage={stage} t={t} onSuccess={stageSuccess} />
        </Sheet>
      )}
      {open === 'nextstep' && (
        <NextStepPrompt businessId={businessId} contactId={contactId} contactName={contactName} onClose={() => setOpen(null)} onDone={onDone} />
      )}
      {open === 'push' && task && (
        <Sheet title="Push task" subtitle={[task.title, crm].filter(Boolean).join(' · ')} t={t} onClose={() => setOpen(null)}>
          <PushForm businessId={businessId} task={task} t={t} onSuccess={success} onPending={onPending} onFailed={onFailed} />
        </Sheet>
      )}
    </div>
  )
}

export { tone as quickActionTone }
