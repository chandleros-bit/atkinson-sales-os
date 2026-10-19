// Pure helpers for Quick Actions (CRM write-back). The QuickActions component
// builds a request with these and sends it to the crm-action edge function,
// which writes to FollowUpBoss (Bayway) or Zoho (MPG). See
// docs/superpowers/specs/2026-10-18-quick-actions-writeback-design.md.

// FUB's six allowed call outcomes. Zoho gets the same label (zoho-write.ts).
export const OUTCOMES = ['Interested', 'Not interested', 'Left message', 'No answer', 'Busy', 'Bad number']

export const CRM_LABEL = { bay: 'FollowUpBoss', mpg: 'Zoho' }

export const FOLLOW_UP_PRESETS = [
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'in3', label: 'In 3 days' },
  { key: 'nextMonday', label: 'Next Monday' },
  { key: 'pick', label: 'Pick a date' },
]

const ACTIONS = new Set(['log_call', 'add_note', 'create_task', 'complete_task', 'push_task'])

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

const FOLLOW_UP_ON = new Set(['Left message', 'No answer', 'Busy'])
const CONNECTED = new Set(['Interested', 'Not interested'])

export const defaultFollowUpOn = (outcome) => FOLLOW_UP_ON.has(outcome)
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
    if (form.followUp?.on) {
      payload.follow_up = {
        due_date: form.followUp.dueDate,
        title: trimmed(form.followUp.title) || 'Follow up',
        type: form.followUp.type || 'Follow Up',
      }
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
  return { ...original, client_action_id: id }
}

const DONE = {
  log_call: 'call logged',
  add_note: 'note added',
  create_task: 'follow-up scheduled',
  complete_task: 'task completed',
  push_task: 'task moved',
}
const LABEL = {
  log_call: 'Call',
  add_note: 'Note',
  create_task: 'Follow-up task',
  complete_task: 'Completing the task',
  push_task: 'Moving the task',
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
