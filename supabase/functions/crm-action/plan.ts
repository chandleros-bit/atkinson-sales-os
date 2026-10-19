// Pure step planning for crm-action. A request names one action; this turns it
// into the ordered CRM steps to run. A Log call submit can carry a task to
// complete and a follow-up to create, and those run after the call, in that
// order, so the user's "done" and "next" both hang off a call that happened.

export const ACTIONS = ['log_call', 'add_note', 'create_task', 'complete_task', 'push_task', 'whoami']

// Actions that act on one of our contacts / tasks (the request carries its uuid).
export const CONTACT_ACTIONS = new Set(['log_call', 'add_note', 'create_task'])
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
    case 'whoami':
      return [{ step: 'whoami' }]
    default:
      throw new Error(`Unknown action: ${request?.action}`)
  }
}

// Nothing after a failed call runs: the user is reacting to that call. Any
// other failed step doesn't block the steps after it.
export function shouldStop(step, ok) {
  return step === 'log_call' && !ok
}

// Overall status from per-step results.
export function overallStatus(results) {
  const ok = results.filter((r) => r.ok).length
  if (ok === results.length) return 'ok'
  return ok === 0 ? 'error' : 'partial'
}
