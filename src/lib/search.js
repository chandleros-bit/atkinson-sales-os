// Global search (Ctrl+K): pure helpers. The query runs in useSearch.js; people
// come from the search_people RPC (migration 0036).
// Spec: docs/superpowers/specs/2026-10-19-tier1-pipeline-flow-design.md (5)

export const MIN_QUERY = 2

// What was typed, minus characters that would break a PostgREST or() filter.
export function cleanQuery(q) {
  return String(q ?? '')
    .replace(/[,()"*%\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export const digitsOf = (q) => String(q ?? '').replace(/\D/g, '')

// "Go to" results. keywords: other words people type for the page.
export const PAGES = [
  { label: 'Up Next', to: '/priority', keywords: 'priority call queue' },
  { label: 'Overview', to: '/', keywords: 'home dashboard' },
  { label: 'Calendar', to: '/calendar', keywords: 'agenda appointments' },
  { label: 'Tasks', to: '/tasks', keywords: 'follow-ups to do' },
  { label: 'Reports', to: '/reports', keywords: 'metrics goals' },
  { label: 'Bayway pipeline', to: '/bayway/pipeline', keywords: 'board stages' },
  { label: 'Bayway priority leads', to: '/bayway/priority-leads', keywords: 'hot score' },
  { label: 'Bayway activity', to: '/bayway/activity', keywords: 'calls notes' },
  { label: 'Bayway contacts', to: '/bayway/contacts', keywords: 'people fub' },
  { label: 'MPG pipeline', to: '/mpg/pipeline', keywords: 'board merchants' },
  { label: 'MPG activity', to: '/mpg/activity', keywords: 'calls notes' },
  { label: 'MPG contacts', to: '/mpg/contacts', keywords: 'people zoho merchants' },
  { label: 'Sync status', to: '/sync', keywords: 'sync health' },
]

export function matchPages(q, max = 4) {
  const t = cleanQuery(q).toLowerCase()
  if (!t) return []
  return PAGES.filter((p) => `${p.label} ${p.keywords}`.toLowerCase().includes(t)).slice(0, max)
}
