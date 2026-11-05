// Who sees what (spec 2026-11-03, section 3, "The assistant's login"). The
// database enforces it (RLS, crm-action); this only keeps the app from
// offering what the server would refuse.
const ASSISTANT_PATHS = /^\/(workbench|priority|tasks|pipeline|bayway\/pipeline|reference)(\/|$)/

export const ASSISTANT_QUICK_ACTIONS = ['note', 'followup', 'done']

export function canVisit(role, path) {
  if (role === 'owner') return true
  if (role === 'assistant') return ASSISTANT_PATHS.test(path)
  return false
}

export const homeFor = (role) => (role === 'assistant' ? '/workbench' : '/')

// QuickActions' `only` list for this role (undefined = every action).
export function quickActionsFor(role, only) {
  if (role !== 'assistant') return only
  return (only || ASSISTANT_QUICK_ACTIONS).filter((a) => ASSISTANT_QUICK_ACTIONS.includes(a))
}

export const roleLabel = (role) => (role === 'assistant' ? 'Assistant' : 'Super Admin')
