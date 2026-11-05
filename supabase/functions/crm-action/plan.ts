// Pure step planning for crm-action. A request names one action; this turns it
// into the ordered CRM steps to run. A Log call submit can carry a task to
// complete and a follow-up to create, and those run after the call, in that
// order, so the user's "done" and "next" both hang off a call that happened.

export const ACTIONS = ['log_call', 'add_note', 'create_task', 'complete_task', 'push_task', 'set_stage', 'set_temperature', 'send_app_email', 'create_contact', 'whoami', 'smart_lists', 'contact_notes', 'contact_relationships']

// Actions that act on one of our contacts / tasks (the request carries its uuid).
export const CONTACT_ACTIONS = new Set(['log_call', 'add_note', 'create_task', 'set_stage', 'set_temperature', 'send_app_email'])
export const TASK_ACTIONS = new Set(['complete_task', 'push_task'])

export function planSteps(request) {
  const p = request?.payload || {}
  switch (request?.action) {
    case 'log_call': {
      const steps = [{ step: 'log_call', outcome: p.outcome, note: p.note || null, durationMin: p.duration_min || null }]
      if (p.complete_task_id) steps.push({ step: 'complete_task', taskId: p.complete_task_id })
      if (p.follow_up) {
        steps.push({
          step: 'create_task',
          title: p.follow_up.title || 'Follow up',
          type: p.follow_up.type || 'Follow Up',
          dueDate: p.follow_up.due_date,
        })
      }
      // "No next step: Moving to Nurture" parks the lead after the call.
      if (p.set_stage) steps.push({ step: 'set_stage', target: p.set_stage })
      return steps
    }
    case 'add_note':
      return [{ step: 'add_note', subject: p.subject || null, body: p.body }]
    case 'create_task':
      return [{ step: 'create_task', title: p.title || 'Follow up', type: p.type || 'Follow Up', dueDate: p.due_date }]
    case 'complete_task':
      return [{ step: 'complete_task', taskId: request.task_id }]
    case 'push_task':
      return [{ step: 'push_task', taskId: request.task_id, dueDate: p.due_date }]
    case 'set_stage': {
      const steps = [{ step: 'set_stage', target: p.target }]
      // Marking Lost records why, as a note on the lead.
      if (p.target === 'lost' && p.reason) steps.push({ step: 'add_note', subject: null, body: `Marked Lost: ${p.reason}` })
      return steps
    }
    case 'send_app_email': {
      // Application Sent email: save a typed email / first name to FUB first,
      // then tag the lead so FUB's automation sends it (app-email-step.ts).
      const s = (v) => (typeof v === 'string' ? v.trim() : '')
      const steps = []
      if (s(p.email) || s(p.first_name)) steps.push({ step: 'update_person', email: s(p.email) || null, firstName: s(p.first_name) || null })
      steps.push({ step: 'app_email', variant: p.variant })
      return steps
    }
    case 'set_temperature':
      return [{ step: 'set_temperature', temperature: p.temperature }]
    case 'create_contact': {
      // A new lead from the dashboard; the note (optional) goes on it after.
      const s = (v) => (typeof v === 'string' ? v.trim() : '')
      const steps = [{
        step: 'create_contact',
        person: { firstName: s(p.first_name), lastName: s(p.last_name), phone: s(p.phone), email: s(p.email), company: s(p.company) },
      }]
      if (s(p.note)) steps.push({ step: 'add_note', subject: null, body: s(p.note) })
      return steps
    }
    case 'whoami':
      return [{ step: 'whoami' }]
    default:
      throw new Error(`Unknown action: ${request?.action}`)
  }
}

// Nothing after a failed call runs: the user is reacting to that call. Any
// other failed step doesn't block the steps after it.
// Likewise nothing runs after a failed create: there's no lead to attach to.
export function shouldStop(step, ok) {
  // And no Application email is tagged when its email couldn't be saved.
  return (step === 'log_call' || step === 'create_contact' || step === 'update_person') && !ok
}

// FollowUpBoss answers 404 on /people/<id> (and "Contact not found" on a note)
// once a lead is deleted there. Only an error about THIS lead counts.
export function fubPersonGone(error, externalId) {
  const e = String(error || '')
  if (!externalId) return false
  const id = String(externalId).replace(/\D/g, '')
  if (!id) return false
  return new RegExp(String.raw`^FUB \w+ /people/${id}(\?|\s|$).*-> 404`).test(e) || /-> 400: .*Contact not found/i.test(e)
}
export const PERSON_GONE = 'This lead was deleted in FollowUpBoss, so it has been removed from the dashboard.'

// Overall status from per-step results.
export function overallStatus(results) {
  const ok = results.filter((r) => r.ok).length
  if (ok === results.length) return 'ok'
  return ok === 0 ? 'error' : 'partial'
}

// The assistant login (spec 2026-11-03, section 3): notes, follow-ups and
// completing tasks on Bayway, plus the two read-only refreshes the contact
// card runs (contact_notes, contact_relationships). Everything else is
// refused (and recorded) for her; whoami and smart_lists are 403.
export const ASSISTANT_ACTIONS = new Set(['add_note', 'create_task', 'complete_task'])
export const ASSISTANT_REFUSED = 'The assistant login cannot do that'
export const ASSISTANT_BAYWAY_ONLY = 'The assistant login is Bayway only'
