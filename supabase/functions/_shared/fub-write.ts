// Pure FollowUpBoss request-body builders for crm-action (CRM write-back).
// Checked against FUB's API reference on 2026-10-18; see
// docs/superpowers/specs/2026-10-18-quick-actions-writeback-design.md.

// FUB's allowed call outcomes, exact casing (FUB 400s on 'Left message').
// The dashboard's chips use these labels as-is.
export const FUB_OUTCOMES = ['Interested', 'Not Interested', 'Left Message', 'No Answer', 'Busy', 'Bad Number']

export const FUB_TASK_TYPES = [
  'Follow Up', 'Call', 'Text', 'Email', 'Appointment', 'Showing', 'Closing', 'Open House', 'Thank You',
]

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function personIdOf(personId) {
  const n = Number(personId)
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Not a FUB person id: ${personId}`)
  return n
}

function dueDateOf(dueDate) {
  if (!DATE_RE.test(String(dueDate || ''))) throw new Error(`Due date must be YYYY-MM-DD, got ${dueDate}`)
  return dueDate
}

// POST /v1/calls. FUB requires personId, phone and isIncoming; duration is in
// seconds. The call is attributed to the API key's owner.
export function buildFubCall({ personId, phone, outcome, note, durationMin }) {
  if (!FUB_OUTCOMES.includes(outcome)) throw new Error(`Unknown call outcome: ${outcome}`)
  if (!phone) throw new Error('No phone on file in FUB')
  const body = { personId: personIdOf(personId), phone: String(phone), isIncoming: false, outcome }
  if (note) body.note = note
  const minutes = Number(durationMin)
  if (minutes > 0) body.duration = Math.round(minutes * 60)
  return body
}

// POST /v1/notes.
export function buildFubNote({ personId, subject, body }) {
  if (!body) throw new Error('Note body is empty')
  return { personId: personIdOf(personId), subject: subject || 'Note from Sales OS', body }
}

// POST /v1/tasks. FUB requires an assignee; we always send assignedUserId
// (the FUB_USER_ID secret) so the task lands on Chandler.
export function buildFubTask({ personId, assignedUserId, title, type, dueDate }) {
  if (!assignedUserId) throw new Error('FUB_USER_ID is not set as a function secret')
  const taskType = type || 'Follow Up'
  if (!FUB_TASK_TYPES.includes(taskType)) throw new Error(`Unknown FUB task type: ${taskType}`)
  return {
    personId: personIdOf(personId),
    assignedUserId: Number(assignedUserId),
    name: title || 'Follow up',
    type: taskType,
    dueDate: dueDateOf(dueDate),
  }
}

// PUT /v1/tasks/{id}: complete it, or move its due date.
export function buildFubTaskUpdate({ complete, dueDate }) {
  if (complete) return { isCompleted: true }
  return { dueDate: dueDateOf(dueDate) }
}

const clean = (v) => (typeof v === 'string' ? v.trim() : '')

// A new lead from the dashboard. Sent as an event (not POST /people) so FUB
// dedupes it and runs its lead flow and action plans.
export function buildFubLeadEvent({ firstName, lastName, phone, email }) {
  const person = {}
  if (clean(firstName)) person.firstName = clean(firstName)
  if (clean(lastName)) person.lastName = clean(lastName)
  if (clean(phone)) person.phones = [{ value: clean(phone) }]
  if (clean(email)) person.emails = [{ value: clean(email) }]
  return { source: 'Atkinson Sales OS', system: 'Atkinson Sales OS', type: 'Registration', person }
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// PUT /v1/people/{id}: save the email (as primary) and/or first name the
// Application email needs (crm-action send_app_email). FUB replaces the
// emails list, so send it whole: the new one first, the others kept.
// VERIFY on the test lead (docs/app-email-setup.md): isPrimary as 1/0.
export function buildFubPersonUpdate({ person, email, firstName }) {
  const body = {}
  const e = clean(email)
  if (e) {
    if (!EMAIL_RE.test(e)) throw new Error(`Not an email address: ${e}`)
    const others = (person?.emails || [])
      .filter((x) => clean(x?.value) && clean(x.value).toLowerCase() !== e.toLowerCase())
      .map((x) => ({ value: x.value, type: x.type || 'home', isPrimary: 0 }))
    body.emails = [{ value: e, type: 'home', isPrimary: 1 }, ...others]
  }
  const f = clean(firstName)
  if (f) body.firstName = f
  if (!Object.keys(body).length) throw new Error('Nothing to update on the FUB person')
  return body
}

// PUT /v1/templates/{id}: the Application email copy (app-email.ts).
// VERIFY on the test lead: FUB's reference lists no fields for this call.
export function buildFubTemplate({ name, subject, body }) {
  return { name, subject, body }
}
