// Pure helpers for Quick Actions (CRM write-back). The QuickActions component
// builds a request with these and sends it to the crm-action edge function,
// which writes to FollowUpBoss (Bayway) or Zoho (MPG). See
// docs/superpowers/specs/2026-10-18-quick-actions-writeback-design.md.

// FUB's six allowed call outcomes. Zoho gets the same label (zoho-write.ts).
export const OUTCOMES = ['Interested', 'Not Interested', 'Left Message', 'No Answer', 'Busy', 'Bad Number']

export const CRM_LABEL = { bay: 'FollowUpBoss', mpg: 'Zoho' }

export const FOLLOW_UP_PRESETS = [
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'in3', label: 'In 3 days' },
  { key: 'nextMonday', label: 'Next Monday' },
  { key: 'pick', label: 'Pick a date' },
]

const ACTIONS = new Set(['log_call', 'add_note', 'create_task', 'complete_task', 'push_task', 'set_stage', 'create_contact'])

const pad = (n) => String(n).padStart(2, '0')

// YYYY-MM-DD in local time (toISOString would shift to UTC late in the day).
export function localDateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function addDays(d, n) {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

// preset: 'tomorrow' | 'in3' | 'nextMonday' | 'pick'. "Tomorrow" on a Friday,
// Saturday or Sunday lands on Monday. "Next Monday" on a Monday is a week out.
export function followUpDate(preset, now = new Date(), picked) {
  switch (preset) {
    case 'tomorrow': {
      const t = addDays(now, 1)
      const day = t.getDay() // 0 Sun .. 6 Sat
      if (day === 6) return localDateKey(addDays(t, 2))
      if (day === 0) return localDateKey(addDays(t, 1))
      return localDateKey(t)
    }
    case 'in3':
      return localDateKey(addDays(now, 3))
    case 'nextMonday': {
      const ahead = (8 - now.getDay()) % 7 || 7
      return localDateKey(addDays(now, ahead))
    }
    case 'pick':
      if (!picked) throw new Error('Pick a date for the follow-up')
      return picked
    default:
      throw new Error(`Unknown follow-up preset: ${preset}`)
  }
}

// Outcomes whose Next step defaults to a dated follow-up.
const FOLLOW_UP_ON = new Set(['Interested', 'Left Message', 'No Answer', 'Busy'])
const CONNECTED = new Set(['Interested', 'Not Interested'])

// Why a call ends with no next step. Audit-only (crm_actions.request): nothing
// extra is written to the CRM. "Moving to Nurture" also parks a Bayway lead.
export const NO_NEXT_STEP_REASONS = ['Not interested', 'Bad number', 'Moving to Nurture', 'Other']
export const PARK_REASON = 'Moving to Nurture'
// Why a lead is marked Lost from the board; written to FUB as a note.
export const LOST_REASONS = ['Not interested', 'Went elsewhere', 'Unreachable', 'Not qualified']
// The `Lost` tag starts Chandler's "Lost Leads" action plan in FUB, which sets
// the person stage to Lost. Only the FUB account owner can edit person stages,
// so there is no Undo: say so before the write.
export const LOST_WARNING =
  "FollowUpBoss's Lost Leads plan will move this lead to stage Lost. Only the FUB account owner can move it back."
export const NEXT_STEPS = ['follow_up', 'scheduled', 'none']

// The Next step the Log call form preselects. A task already on the books
// beats a second follow-up; Not Interested / Bad Number preselect nothing so
// the choice is deliberate.
export function defaultNextStep(outcome, hasFutureTask = false) {
  if (!FOLLOW_UP_ON.has(outcome)) return null
  return hasFutureTask ? 'scheduled' : 'follow_up'
}

// After a stage move: offer a follow-up when nothing is scheduled. Parking in
// Nurture needs none, and callers that don't know the open-task count never prompt.
export function needsNextStepPrompt(targetKey, openTaskCount) {
  if (targetKey === 'credit_repair' || targetKey === 'lost' || openTaskCount == null) return false
  return !(openTaskCount > 0)
}
export const defaultDurationMin = (outcome) => (CONNECTED.has(outcome) ? 5 : 1)

export function defaultFollowUpTitle(name) {
  const first = String(name || '').trim().split(/\s+/)[0]
  return first ? `Follow up: ${first}` : 'Follow up'
}

export function endOfTodayIso(now = new Date()) {
  const d = new Date(now)
  d.setHours(23, 59, 59, 999)
  return d.toISOString()
}

export function newClientActionId() {
  return crypto.randomUUID()
}

const trimmed = (s) => (typeof s === 'string' ? s.trim() : '')

// What a new lead still needs before it can be created, or null when ready.
// FUB takes a name plus a phone or email; Zoho requires Last_Name and Company.
export function newLeadProblem(form) {
  const has = (v) => trimmed(v) !== ''
  if (!has(form.firstName) && !has(form.lastName)) return 'Add a name'
  if (form.businessId === 'mpg') {
    if (!has(form.lastName)) return 'Zoho needs a last name'
    if (!has(form.company)) return 'Zoho needs a company'
    return null
  }
  if (!has(form.phone) && !has(form.email)) return 'Add a phone or an email'
  return null
}

// form -> the crm-action request body. Throws on a form the UI should not have
// let through, so a bug surfaces as a message rather than a half-built write.
export function buildActionRequest(form) {
  const { action } = form || {}
  if (!ACTIONS.has(action)) throw new Error(`Unknown action: ${action}`)
  const base = { client_action_id: newClientActionId(), action }

  if (action === 'log_call') {
    if (!form.outcome) throw new Error('Pick a call outcome')
    const payload = { outcome: form.outcome }
    const note = trimmed(form.note)
    if (note) payload.note = note
    payload.duration_min = Number(form.durationMin) || defaultDurationMin(form.outcome)
    if (!NEXT_STEPS.includes(form.nextStep)) throw new Error('Pick a next step')
    payload.next_step = form.nextStep
    if (form.nextStep === 'follow_up') {
      payload.follow_up = {
        due_date: form.followUp?.dueDate,
        title: trimmed(form.followUp?.title) || 'Follow up',
        type: form.followUp?.type || 'Follow Up',
      }
    }
    if (form.nextStep === 'none') {
      if (!NO_NEXT_STEP_REASONS.includes(form.noNextStepReason)) throw new Error('Pick why there is no next step')
      payload.no_next_step_reason = form.noNextStepReason
      if (form.noNextStepReason === PARK_REASON) payload.set_stage = 'credit_repair'
    }
    if (form.completeTaskId) payload.complete_task_id = form.completeTaskId
    return { ...base, contact_id: form.contactId, payload }
  }
  if (action === 'add_note') {
    const body = trimmed(form.body)
    if (!body) throw new Error('Write a note first')
    const payload = { body }
    const subject = trimmed(form.subject)
    if (subject) payload.subject = subject
    return { ...base, contact_id: form.contactId, payload }
  }
  if (action === 'create_task') {
    return {
      ...base,
      contact_id: form.contactId,
      payload: { due_date: form.dueDate, title: trimmed(form.title) || 'Follow up', type: form.type || 'Follow Up' },
    }
  }
  if (action === 'complete_task') return { ...base, task_id: form.taskId, payload: {} }
  if (action === 'create_contact') {
    if (!['bay', 'mpg'].includes(form.businessId)) throw new Error('Pick Bayway or MPG')
    const problem = newLeadProblem(form)
    if (problem) throw new Error(problem)
    const payload = {}
    const fields = [
      ['first_name', form.firstName], ['last_name', form.lastName], ['phone', form.phone],
      ['email', form.email], ['company', form.company], ['note', form.note],
    ]
    for (const [k, v] of fields) if (trimmed(v)) payload[k] = trimmed(v)
    return { ...base, business_id: form.businessId, payload }
  }
  if (action === 'set_stage') {
    const payload = { target: form.target }
    if (form.reason) payload.reason = form.reason
    return { ...base, contact_id: form.contactId, payload }
  }
  return { ...base, task_id: form.taskId, payload: { due_date: form.dueDate } }
}

// A request that re-runs only `step` from `original`, with a new id so the
// function doesn't hand back the stored result of the first attempt.
export function retryRequestFor(step, original) {
  const id = newClientActionId()
  const p = original.payload || {}
  if (original.action === 'log_call' && step === 'create_task') {
    return { client_action_id: id, action: 'create_task', contact_id: original.contact_id, payload: { ...p.follow_up } }
  }
  if (original.action === 'log_call' && step === 'complete_task') {
    return { client_action_id: id, action: 'complete_task', task_id: p.complete_task_id, payload: {} }
  }
  if (original.action === 'log_call' && step === 'set_stage') {
    return { client_action_id: id, action: 'set_stage', contact_id: original.contact_id, payload: { target: p.set_stage } }
  }
  return { ...original, client_action_id: id }
}

const DONE = {
  log_call: 'call logged',
  add_note: 'note added',
  create_task: 'follow-up scheduled',
  complete_task: 'task completed',
  push_task: 'task moved',
  set_stage: 'stage moved',
  create_contact: 'lead created',
}
const LABEL = {
  log_call: 'Call',
  add_note: 'Note',
  create_task: 'Follow-up task',
  complete_task: 'Completing the task',
  push_task: 'Moving the task',
  set_stage: 'Moving the stage',
  create_contact: 'Creating the lead',
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)

function joinAnd(parts) {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

// crm-action response -> { tone: 'ok' | 'partial' | 'error', text, failed: [step] }
export function summarizeResult(res, businessId) {
  const crm = CRM_LABEL[businessId] || 'the CRM'
  if (!res || res.status === 'refused' || !Array.isArray(res.results)) {
    if (res?.status === 'pending') {
      return { tone: 'error', text: 'Still saving the first try. Check the CRM before retrying.', failed: [] }
    }
    return { tone: 'error', text: res?.error || 'Something went wrong', failed: [] }
  }
  // Deleted in FollowUpBoss: crm-action removed our copy. Nothing to retry;
  // 'partial' so the page refreshes and the card goes away.
  const removed = res.results.find((r) => r.contact_removed)
  if (removed) return { tone: 'partial', text: removed.error, failed: [] }
  const okSteps = res.results.filter((r) => r.ok)
  const failed = res.results.filter((r) => !r.ok)
  const phrases = okSteps.map((r) => (r.step === 'push_task' && r.rescheduled ? 'task rescheduled' : DONE[r.step]))
  const doneText = phrases.length ? `${cap(joinAnd(phrases))} in ${crm}` : ''
  const failText = failed.map((r) => `${LABEL[r.step]} failed: ${r.error || 'unknown error'}.`).join(' ')
  const tone = failed.length === 0 ? 'ok' : okSteps.length ? 'partial' : 'error'
  return {
    tone,
    text: [doneText && (failText ? `${doneText}.` : doneText), failText].filter(Boolean).join(' '),
    failed: failed.map((r) => r.step),
  }
}

// crm_actions rows (newest first) -> the Sync Status "Write-back" row:
// counts by outcome and the newest failure's message.
export function summarizeWriteback(rows) {
  const out = { ok: 0, partial: 0, error: 0, refused: 0, pending: 0, latestError: null, lastAt: null }
  for (const r of rows || []) {
    if (r.status in out) out[r.status] += 1
    out.lastAt ??= r.created_at
    if (!out.latestError && ['partial', 'error', 'refused'].includes(r.status)) {
      const failed = (r.results || []).find((x) => !x.ok)
      out.latestError = { text: failed?.error || r.status, at: r.created_at, step: failed?.step || null }
    }
  }
  return out
}
