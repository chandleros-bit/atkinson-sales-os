// Today's three work lists (Workbench v2 spec 2026-11-23, §6): Calls, Files
// and Partners. No set times: they are worked whenever the day allows.
// Workbench owns the lists; Overview shows their counts from this same
// function so the two pages agree. Pure: callers pass what the builders
// already returned.
//   dial:   { dueNow, laterToday }       (dialList.js)
//   groups: [{ id, items: [{ late }] }]  (workbench.js), 'waiting' is parked
//   theme:  { theme, items, total }       (dialThemes.js), today's theme
//   queue:  Up Next rows (priorityQueue.js); only 'reached_out' and 'overdue'
//           are list items, and rows already in the dial or theme list are left out
// -> [{ key, label, sub, count, flagged, items, flaggedItems }]
// Calls, in order: they reached out, today's borrower theme (Tue loan status,
// Wed past clients, Thu pre-approved), overdue follow-ups, the cadence due
// now, the cadence later today. Partners: the realtor themes (Mon new
// realtors, Fri top partners); empty Tuesday to Thursday.

const startOfDay = (now) => {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export const NEW_LEAD_MINUTES = 30
export const REALTOR_THEMES = new Set(['new_realtor', 'top_partner'])
export const isRealtorTheme = (theme) => !!theme && REALTOR_THEMES.has(theme.key)

export function workLists({ dial, groups, theme, queue = [], now = Date.now() }) {
  const today = startOfDay(now)
  const lateCall = (i) => i.dueAt != null && i.dueAt < today

  const dueNow = dial?.dueNow || []
  const later = dial?.laterToday || []
  const themeItems = theme?.items || []
  const realtorDay = isRealtorTheme(theme?.theme)
  const borrowerTheme = theme?.theme && !realtorDay ? themeItems : []
  const partners = realtorDay ? themeItems : []

  const inLists = new Set([...dueNow, ...later, ...themeItems].map((i) => i.id))
  const fromQueue = (bucket) => (queue || []).filter((r) => r.bucket === bucket && !inLists.has(r.id))
  const reachedOut = fromQueue('reached_out')
  const overdue = fromQueue('overdue')

  const calls = [...reachedOut, ...borrowerTheme, ...overdue, ...dueNow, ...later]
  const callFlagged = [...overdue, ...[...borrowerTheme, ...dueNow, ...later].filter(lateCall)]

  const files = (groups || []).filter((g) => g.id !== 'waiting').flatMap((g) => g.items || [])
  const parked = (groups || []).find((g) => g.id === 'waiting')?.items?.length || 0
  const fileFlagged = files.filter((i) => i.late)

  const callSub = [
    reachedOut.length && `${reachedOut.length} reached out`,
    borrowerTheme.length && `${theme.theme.label.toLowerCase()} first`,
    later.length && `${later.length} later today`,
  ].filter(Boolean)

  return [
    {
      key: 'calls',
      label: 'Calls',
      sub: callSub.length ? callSub.join(' · ') : 'Speed to lead first, then follow-ups',
      count: calls.length,
      flagged: callFlagged.length,
      items: calls,
      flaggedItems: callFlagged,
    },
    {
      key: 'files',
      label: 'Files',
      sub: parked ? `Estimates, applications, MPG work · ${parked} parked` : 'Estimates, applications, MPG work',
      count: files.length,
      flagged: fileFlagged.length,
      items: files,
      flaggedItems: fileFlagged,
    },
    {
      key: 'partners',
      label: 'Partners',
      sub: realtorDay
        ? `Today: ${theme.theme.label.toLowerCase()}`
        : theme?.theme
          ? `No partner list today · ${theme.theme.label.toLowerCase()} is in Calls`
          : 'No partner list on weekends',
      count: partners.length,
      flagged: partners.filter(lateCall).length,
      items: partners,
      flaggedItems: partners.filter(lateCall),
    },
  ]
}

// The newest uncalled lead under 30 minutes old, for the new-lead strip, or null.
export function freshLead(dial, now = Date.now()) {
  const cutoff = now - NEW_LEAD_MINUTES * 60_000
  const fresh = (dial?.dueNow || []).filter((i) => i.kind === 'attempt' && i.step === 1 && i.dueAt >= cutoff && i.dueAt <= now)
  if (!fresh.length) return null
  return fresh.reduce((a, b) => (b.dueAt > a.dueAt ? b : a))
}
